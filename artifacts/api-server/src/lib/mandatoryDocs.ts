import { db, programDocumentRequirementsTable, applicationsTable, documentsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { findMissingMandatoryTypes } from "@workspace/doc-equivalence";

/**
 * Returns mandatory document types for a program that the given upload set
 * does NOT yet cover (equivalence-aware).
 *
 * Pass `uploadedDocTypes` as the doc types already provided by the student
 * (apply-key short names OR canonical type names — both are handled by
 * `findMissingMandatoryTypes`).
 *
 * Returns `{ missing: [] }` when the program has no mandatory requirements or
 * all requirements are satisfied.
 */
export async function checkMandatoryDocs(
  programId: number | null,
  uploadedDocTypes: string[],
): Promise<{ missing: string[] }> {
  if (!programId) return { missing: [] };

  const requirements = await db
    .select({ documentType: programDocumentRequirementsTable.documentType })
    .from(programDocumentRequirementsTable)
    .where(
      and(
        eq(programDocumentRequirementsTable.programId, programId),
        eq(programDocumentRequirementsTable.mandatory, true),
      ),
    );

  if (requirements.length === 0) return { missing: [] };

  const mandatoryTypes = requirements.map((r) => r.documentType);
  const uploadedSet = new Set(uploadedDocTypes.map((t) => t.toLowerCase()));
  const missing = findMissingMandatoryTypes(mandatoryTypes, uploadedSet);

  return { missing };
}

/**
 * Convenience: fetch all non-rejected documents for a student from
 * `documentsTable` and check whether the program's mandatory requirements
 * are met. Used after document auto-linking in apply flows.
 */
export async function checkMandatoryDocsForStudent(
  programId: number | null,
  studentId: number,
): Promise<{ missing: string[] }> {
  const rows = await db
    .select({ type: documentsTable.type })
    .from(documentsTable)
    .where(and(eq(documentsTable.studentId, studentId), isNull(documentsTable.deletedAt)));

  const uploadedTypes = rows.map((r) => String(r.type || "")).filter(Boolean);
  return checkMandatoryDocs(programId, uploadedTypes);
}

/**
 * Move a newly-created application to the built-in "missing_docs" pipeline
 * stage so it sits in a visible, actionable state rather than polluting the
 * inquiry queue.
 */
export async function parkApplicationInMissingDocsStage(applicationId: number): Promise<void> {
  await db
    .update(applicationsTable)
    .set({ stage: "missing_docs", updatedAt: new Date() })
    .where(eq(applicationsTable.id, applicationId));
}

/**
 * Re-evaluate a "missing_docs"-parked application after a new document is
 * uploaded. If all mandatory docs for the program are now present in the
 * student's document library, advance the application back to "inquiry".
 *
 * Returns `true` when the application was advanced, `false` otherwise.
 * No-op (returns false) when the application is not in the "missing_docs" stage.
 */
export async function reEvaluateMandatoryDocs(applicationId: number): Promise<boolean> {
  const [app] = await db
    .select({
      id: applicationsTable.id,
      stage: applicationsTable.stage,
      programId: applicationsTable.programId,
      studentId: applicationsTable.studentId,
    })
    .from(applicationsTable)
    .where(eq(applicationsTable.id, applicationId));

  if (!app || app.stage !== "missing_docs") return false;

  const { missing } = await checkMandatoryDocsForStudent(app.programId, app.studentId);
  if (missing.length > 0) return false;

  await db
    .update(applicationsTable)
    .set({ stage: "inquiry", updatedAt: new Date() })
    .where(eq(applicationsTable.id, applicationId));

  return true;
}
