/**
 * profile.ts — builds a SubmitProfile + SubmitFiles from the DB record
 * for a given portal submission (or directly from an application).
 *
 * Documents are downloaded from their fileUrl / fileKey, or decoded from
 * base64 fileData, into a per-submission temp dir so the adapter can
 * reference them as local file paths.
 *
 * Two entry points share the same profile-mapping + document-download core:
 *   - buildStudentProfile(submissionId)      — used by the production worker
 *     (resolves application + student from a portal_submissions row).
 *   - buildProfileFromApplication(appId)      — used by the local dry-test CLI
 *     (resolves student directly from an application, no submission row).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  db,
  portalSubmissionsTable,
  applicationsTable,
  studentsTable,
  documentsTable,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { buildProfile, mapDocType, REQUIRED_DOCS } from "@workspace/portal-adapters";
import type { SubmitProfile, SubmitFiles } from "@workspace/portal-adapters";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface StudentProfileResult {
  profile: SubmitProfile;
  files: SubmitFiles;
  /** Caller is responsible for removing this directory after use. */
  tempDir: string;
  /** SubmitFiles keys that were successfully downloaded (for logging / resultJson). */
  filledSlots: string[];
  /** REQUIRED_DOCS slots with no downloaded file (for logging / resultJson). */
  missingSlots: string[];
  /**
   * Per-slot download errors for slots that had a document record but failed
   * to produce a local file. Empty when all slots resolved cleanly.
   */
  downloadErrors: Record<string, string>;
}

type StudentRow = typeof studentsTable.$inferSelect;
type ApplicationRow = typeof applicationsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Shared core: profile mapping
// ---------------------------------------------------------------------------

/**
 * Maps a CRM student + application record into a CRM-agnostic SubmitProfile.
 * Single source of truth shared by both entry points below.
 */
function buildSubmitProfileFromRecords(
  student: StudentRow,
  app: ApplicationRow,
): SubmitProfile {
  return buildProfile({
    email:          student.email          ?? "",
    passportNumber: student.passportNumber ?? "",
    firstName:      student.firstName       ?? "",
    lastName:       student.lastName        ?? "",
    dateOfBirth:    student.dateOfBirth     ?? "",
    gender:         student.gender          ?? "",
    fatherName:     student.fatherName      ?? "",
    motherName:     student.motherName      ?? "",
    nationality:    student.nationality     ?? "",
    address:        student.address         ?? "",
    phone:          student.phone           ?? "",
    level:          app.level               ?? "",
    programName:    app.programName         ?? "",
    programId:      app.programId           != null ? String(app.programId) : "",
    universityName: app.universityName      ?? undefined,
    gpa:            student.gpa             != null ? Number(student.gpa) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Shared core: document download
// ---------------------------------------------------------------------------

interface DownloadedDocs {
  files: SubmitFiles;
  tempDir: string;
  filledSlots: string[];
  missingSlots: string[];
  downloadErrors: Record<string, string>;
}

/**
 * Downloads a student's documents into a fresh temp directory.
 *
 * Document resolution order per slot:
 *   1. Non-deleted records with content (fileUrl / fileKey / fileData), sorted
 *      so content-bearing rows win over empty stubs when multiple non-deleted
 *      records exist for the same slot (first-wins after sort).
 *   2. Empty stub records (fileUrl = fileKey = fileData = NULL) are skipped.
 *   3. For each candidate: try URL download (fileUrl then fileKey), then fall
 *      back to base64 fileData written to a temp file.
 *
 * Download failures are non-fatal: they are recorded in `downloadErrors` and
 * the slot is listed in `missingSlots`.
 *
 * @param tempPrefix  mkdtemp prefix (e.g. "portal-sub-12" / "portal-app-2054").
 * @param logLabel    label used in log lines (e.g. "#12" / "app#2054").
 */
async function downloadStudentDocuments(
  studentId: number,
  tempPrefix: string,
  logLabel: string,
): Promise<DownloadedDocs> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `${tempPrefix}-`));

  const docs = await db
    .select({
      type:     documentsTable.type,
      fileUrl:  documentsTable.fileUrl,
      fileKey:  documentsTable.fileKey,
      fileData: documentsTable.fileData,
      name:     documentsTable.name,
    })
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.studentId, studentId),
        isNull(documentsTable.deletedAt),
      ),
    );

  // Sort: content-bearing records first so they win the first-wins slot race
  // when an empty stub also exists for the same type.
  const hasContent = (d: typeof docs[0]) =>
    !!(d.fileUrl || d.fileKey || d.fileData);
  const sortedDocs = [...docs].sort((a, b) => {
    const ac = hasContent(a) ? 0 : 1;
    const bc = hasContent(b) ? 0 : 1;
    return ac - bc;
  });

  const files: SubmitFiles = {};
  const downloadErrors: Record<string, string> = {};

  await Promise.all(
    sortedDocs.map(async (doc) => {
      if (!doc.type) return;

      const docKey = mapDocType(doc.type);
      if (!docKey) return;

      if (files[docKey]) return; // first-wins — already resolved by a content-bearing record

      // Skip empty stubs entirely (no content in any storage field)
      if (!doc.fileUrl && !doc.fileKey && !doc.fileData) return;

      try {
        // --- path A: URL download (fileUrl preferred, fileKey as fallback) ---
        const url = doc.fileUrl ?? doc.fileKey;
        if (url) {
          const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "bin";
          const dest = path.join(tempDir, `${docKey}.${ext}`);
          await downloadFile(url, dest);
          files[docKey] = dest;
          return;
        }

        // --- path B: base64 fileData fallback --------------------------------
        if (doc.fileData) {
          const buf = Buffer.from(doc.fileData, "base64");
          const dest = path.join(tempDir, `${docKey}.bin`);
          await fs.writeFile(dest, buf);
          files[docKey] = dest;
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        downloadErrors[docKey] = `type=${doc.type}: ${msg}`;
        console.warn(
          `[portal-profile] ${logLabel} doc download failed` +
          ` — slot=${docKey} type=${doc.type}: ${msg}`,
        );
      }
    }),
  );

  const filledSlots  = REQUIRED_DOCS.filter((slot) => !!files[slot]);
  const missingSlots = REQUIRED_DOCS.filter((slot) => !files[slot]);

  const missingDetail =
    missingSlots.length > 0
      ? missingSlots.map((s) => downloadErrors[s] ? `${s}(err: ${downloadErrors[s]})` : `${s}(no-record)`).join(", ")
      : "";

  console.log(
    `[portal-profile] ${logLabel} doc slots — filled: [${filledSlots.join(", ")}]` +
    (missingSlots.length > 0 ? ` | missing: [${missingDetail}]` : " | all 4 filled"),
  );

  return { files, tempDir, filledSlots, missingSlots, downloadErrors };
}

// ---------------------------------------------------------------------------
// buildStudentProfile — submission-keyed (production worker)
// ---------------------------------------------------------------------------

/**
 * Fetches the application + student data for a given portal_submission row,
 * downloads the student's documents to a temporary directory, and returns
 * a SubmitProfile + SubmitFiles ready for the adapter.
 *
 * Throws when the submission, application, or student cannot be found.
 */
export async function buildStudentProfile(
  submissionId: number,
): Promise<StudentProfileResult> {
  // ----- 1. Load submission ------------------------------------------------
  const [sub] = await db
    .select()
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.id, submissionId));

  if (!sub) throw new Error(`Submission ${submissionId} not found`);

  // ----- 2. Load application -----------------------------------------------
  const [app] = await db
    .select()
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.id, sub.applicationId),
        isNull(applicationsTable.deletedAt),
      ),
    );

  if (!app) throw new Error(`Application ${sub.applicationId} not found`);

  // ----- 3. Load student ---------------------------------------------------
  if (!sub.studentId) throw new Error(`Submission ${submissionId} has no studentId`);

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, sub.studentId));

  if (!student) throw new Error(`Student ${sub.studentId} not found`);

  // ----- 4. Build profile + download documents -----------------------------
  const profile = buildSubmitProfileFromRecords(student, app);
  const dl = await downloadStudentDocuments(
    sub.studentId,
    `portal-sub-${submissionId}`,
    `#${submissionId}`,
  );

  return { profile, ...dl };
}

// ---------------------------------------------------------------------------
// buildProfileFromApplication — application-keyed (local dry-test CLI)
// ---------------------------------------------------------------------------

/**
 * Builds a SubmitProfile + SubmitFiles directly from an application id, with
 * no portal_submissions row required. Resolves the student via the
 * application's studentId. Reuses the exact same profile-mapping and
 * document-download logic as buildStudentProfile (single source of truth) so
 * the local dry-test CLI exercises the identical profile the worker would.
 *
 * Throws when the application or student cannot be found.
 */
export async function buildProfileFromApplication(
  applicationId: number,
): Promise<StudentProfileResult> {
  const [app] = await db
    .select()
    .from(applicationsTable)
    .where(
      and(
        eq(applicationsTable.id, applicationId),
        isNull(applicationsTable.deletedAt),
      ),
    );

  if (!app) throw new Error(`Application ${applicationId} not found`);

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, app.studentId));

  if (!student) throw new Error(`Student ${app.studentId} not found`);

  const profile = buildSubmitProfileFromRecords(student, app);
  const dl = await downloadStudentDocuments(
    app.studentId,
    `portal-app-${applicationId}`,
    `app#${applicationId}`,
  );

  return { profile, ...dl };
}

// ---------------------------------------------------------------------------
// Internal: download helper
// ---------------------------------------------------------------------------

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}
