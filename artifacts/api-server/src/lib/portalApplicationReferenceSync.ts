import { and, eq, sql } from "drizzle-orm";
import { applicationsTable, db } from "@workspace/db";
import {
  parseVerifiedApplicationNumber,
  planUniversityApplicationIdSync,
  type VerifiedUniversityApplicationNumber,
} from "@workspace/portal-adapters";

export type PortalApplicationReferenceSyncOutcome =
  | "set"
  | "unchanged"
  | "invalid"
  | "conflict"
  | "concurrent_conflict"
  | "application_not_found";

/**
 * Stores only a semantically proven university application number. Existing
 * non-empty values are never overwritten; a disagreement is surfaced to the
 * review flow instead of silently choosing one identifier.
 */
export async function syncVerifiedPortalApplicationNumber(input: {
  applicationId: number;
  verifiedApplicationNumber: VerifiedUniversityApplicationNumber | null;
}): Promise<PortalApplicationReferenceSyncOutcome> {
  const parsed = parseVerifiedApplicationNumber(input.verifiedApplicationNumber);
  if (!parsed.ok) return "invalid";

  const [application] = await db
    .select({
      universityApplicationId: applicationsTable.universityApplicationId,
    })
    .from(applicationsTable)
    .where(eq(applicationsTable.id, input.applicationId))
    .limit(1);
  if (!application) return "application_not_found";

  const plan = planUniversityApplicationIdSync(
    application.universityApplicationId,
    parsed.value,
  );
  if (plan.action === "conflict") return "conflict";
  if (plan.action === "skip") return "unchanged";

  const updated = await db
    .update(applicationsTable)
    .set({ universityApplicationId: plan.value, updatedAt: new Date() })
    .where(
      and(
        eq(applicationsTable.id, input.applicationId),
        sql`(${applicationsTable.universityApplicationId} IS NULL OR btrim(${applicationsTable.universityApplicationId}) = '')`,
      ),
    )
    .returning({ id: applicationsTable.id });
  return updated.length > 0 ? "set" : "concurrent_conflict";
}
