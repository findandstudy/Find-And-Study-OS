/**
 * profile.ts — builds a SubmitProfile + SubmitFiles from the DB record
 * for a given portal submission.
 *
 * Documents are downloaded from their fileUrl to a per-submission temp dir
 * so the adapter can reference them as local file paths.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db, portalSubmissionsTable, applicationsTable, studentsTable, documentsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { buildProfile, mapDocType } from "@workspace/portal-adapters";
import type { SubmitProfile, SubmitFiles } from "@workspace/portal-adapters";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface StudentProfileResult {
  profile: SubmitProfile;
  files: SubmitFiles;
  /** Caller is responsible for removing this directory after use. */
  tempDir: string;
}

// ---------------------------------------------------------------------------
// buildStudentProfile
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
    gpa:            student.gpa             != null ? Number(student.gpa)            : undefined,
    graduationYear: student.graduationYear  != null ? Number(student.graduationYear) : undefined,
    languageScore:  student.languageScore   != null ? Number(student.languageScore)  : undefined,
  });

  // ----- 5. Download documents to temp dir ---------------------------------
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `portal-sub-${submissionId}-`),
  );

  const docs = await db
    .select({
      type: documentsTable.type,
      fileUrl: documentsTable.fileUrl,
      fileKey: documentsTable.fileKey,
      fileData: documentsTable.fileData,
      name: documentsTable.name,
    })
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.studentId, sub.studentId!),
        isNull(documentsTable.deletedAt),
      ),
    );

  const files: SubmitFiles = {};

  await Promise.all(
    docs.map(async (doc) => {
      if (!doc.type) return;

      const docKey = mapDocType(doc.type);
      if (!docKey) return;

      // Skip if we already mapped this slot (first-wins)
      if (files[docKey]) return;

      const url = doc.fileUrl ?? doc.fileKey ?? null;

      if (url) {
        // Prefer remote URL / GCS key
        try {
          const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "bin";
          const dest = path.join(tempDir, `${docKey}.${ext}`);
          await downloadFile(url, dest);
          files[docKey] = dest;
        } catch {
          // Non-fatal — fall through to file_data fallback below
        }
      }

      if (!files[docKey] && doc.fileData) {
        // Fallback: file_data column stores the raw base64 content
        try {
          const rawName = doc.name ?? `${docKey}`;
          const extMatch = rawName.match(/\.([a-z0-9]+)$/i);
          const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
          const dest = path.join(tempDir, `${docKey}.${ext}`);
          const buf = Buffer.from(doc.fileData, "base64");
          await fs.writeFile(dest, buf);
          files[docKey] = dest;
        } catch {
          // Non-fatal
        }
      }
    }),
  );

  return { profile, files, tempDir };
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
