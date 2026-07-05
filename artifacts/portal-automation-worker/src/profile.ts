/**
 * profile.ts — builds a SubmitProfile + SubmitFiles from the DB record
 * for a given portal submission.
 *
 * Documents are downloaded from their fileUrl / fileKey, or decoded from
 * base64 fileData, into a per-submission temp dir so the adapter can
 * reference them as local file paths.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db, portalSubmissionsTable, applicationsTable, studentsTable, documentsTable } from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { buildProfile, mapDocType, REQUIRED_DOCS, extractStudentDocumentRefs } from "@workspace/portal-adapters";
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

// ---------------------------------------------------------------------------
// buildStudentProfile
// ---------------------------------------------------------------------------

/**
 * Fetches the application + student data for a given portal_submission row,
 * downloads the student's documents to a temporary directory, and returns
 * a SubmitProfile + SubmitFiles ready for the adapter.
 *
 * Document resolution order per slot:
 *   1. Non-deleted records with content (fileUrl / fileKey / fileData), sorted
 *      so content-bearing rows win over empty stubs when multiple non-deleted
 *      records exist for the same slot (first-wins after sort).
 *   2. Empty stub records (fileUrl = fileKey = fileData = NULL) are skipped.
 *   3. For each candidate: try URL download (fileUrl then fileKey), then fall
 *      back to base64 fileData written to a temp file.
 *
 * Throws when the submission, application, or student cannot be found.
 * Download failures are non-fatal: they are recorded in `downloadErrors` and
 * the slot is listed in `missingSlots`.
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

  // ----- 4. Build SubmitProfile --------------------------------------------
  const profile: SubmitProfile = buildProfile({
    email:          student.email         ?? "",
    passportNumber: student.passportNumber ?? "",
    firstName:      student.firstName      ?? "",
    lastName:       student.lastName       ?? "",
    dateOfBirth:    student.dateOfBirth ?? "",
    gender:         student.gender      ?? "",
    fatherName:     student.fatherName  ?? "",
    motherName:     student.motherName  ?? "",
    nationality:    student.nationality ?? "",
    address:        student.address     ?? "",
    phone:          student.phone          ?? "",
    level:          app.level              ?? "",
    programName:    app.programName        ?? "",
    programId:      app.programId          != null ? String(app.programId) : "",
    universityName: app.universityName       ?? undefined,
    schoolName:     student.highSchool       ?? undefined,
    gpa:            student.gpa             ?? undefined,
    graduationYear: student.graduationYear  != null ? Number(student.graduationYear) : undefined,
    languageScore:  student.languageScore   != null ? Number(student.languageScore)  : undefined,
    passportIssueDate:  student.passportIssueDate ?? undefined,
    passportExpiryDate: student.passportExpiry    ?? undefined,
  });

  // ----- 5. Download documents to temp dir ---------------------------------
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `portal-sub-${submissionId}-`),
  );

  const docs = await db
    .select({
      type:      documentsTable.type,
      fileUrl:   documentsTable.fileUrl,
      fileKey:   documentsTable.fileKey,
      fileData:  documentsTable.fileData,
      name:      documentsTable.name,
      sizeBytes: documentsTable.sizeBytes,
      mimeType:  documentsTable.mimeType,
    })
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.studentId, sub.studentId!),
        isNull(documentsTable.deletedAt),
      ),
    )
    .orderBy(desc(documentsTable.createdAt));

  // Carry document/photo URLs on the profile for URL-fetching create webhooks
  // (e.g. SIT). Derived directly from the CRM document rows; independent of the
  // local-file download below.
  const { photoUrl: docPhotoUrl, documents: docRefs } = extractStudentDocumentRefs(docs);
  if (docPhotoUrl) profile.photoUrl = docPhotoUrl;
  if (docRefs.length) profile.studentDocuments = docRefs;
  console.log(
    `[portal-profile] #${submissionId} doc urls — photo: ${docPhotoUrl ? "yes" : "no"}` +
    ` | documents: ${docRefs.length}` +
    (docRefs.length ? ` [${docRefs.map((d) => d.type).join(", ")}]` : ""),
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
          try {
            const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "bin";
            const dest = path.join(tempDir, `${docKey}.${ext}`);
            await downloadFile(url, dest);
            files[docKey] = dest;
            return;
          } catch {
            // Fall through to base64 fallback
          }
        }

        // --- path B: base64 fileData fallback --------------------------------
        if (doc.fileData) {
          const rawName = doc.name ?? `${docKey}`;
          const extMatch = rawName.match(/\.([a-z0-9]+)$/i);
          const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
          const dest = path.join(tempDir, `${docKey}.${ext}`);
          const buf = Buffer.from(doc.fileData, "base64");
          await fs.writeFile(dest, buf);
          files[docKey] = dest;
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        downloadErrors[docKey] = `type=${doc.type}: ${msg}`;
        console.warn(
          `[portal-profile] #${submissionId} doc download failed` +
          ` — slot=${docKey} type=${doc.type}: ${msg}`,
        );
      }
    }),
  );

  const filledSlots  = REQUIRED_DOCS.filter((slot) => !!files[slot]);
  const missingSlots = REQUIRED_DOCS.filter((slot) => !files[slot]);

  const missingDetail =
    missingSlots.length > 0
      ? missingSlots.map((s) =>
          downloadErrors[s] ? `${s}(err: ${downloadErrors[s]})` : `${s}(no-record)`,
        ).join(", ")
      : "";

  console.log(
    `[portal-profile] #${submissionId} doc slots — filled: [${filledSlots.join(", ")}]` +
    (missingSlots.length > 0 ? ` | missing: [${missingDetail}]` : " | all 4 filled"),
  );

  return { profile, files, tempDir, filledSlots, missingSlots, downloadErrors };
}

// ---------------------------------------------------------------------------
// Internal: download helper
// ---------------------------------------------------------------------------

async function downloadFile(url: string, dest: string): Promise<void> {
  // Relative /objects/... URLs must be absolutized — Node fetch() cannot parse relative URLs.
  // The api-server serves /objects/ on its own origin (proven: curl 127.0.0.1:PORT/objects/... = 200).
  const base = (process.env.OBJECT_BASE_URL || `http://127.0.0.1:${process.env.PORT || "5057"}`).replace(/\/$/, "");
  const absUrl = /^https?:\/\//i.test(url) ? url : base + (url.startsWith("/") ? url : "/" + url);
  const res = await fetch(absUrl);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${absUrl}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}
