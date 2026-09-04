import { and, eq } from "drizzle-orm";
import { db, portalLifecycleObservationsTable } from "@workspace/db";
import type { NormalizedPortalLifecycleObservation } from "./portalLifecycleObservation";

export type RecordedPortalLifecycleObservation = {
  id: number;
  created: boolean;
};

/**
 * Appends one normalized portal observation. The database unique key makes
 * retries and overlapping pollers idempotent; the composite foreign key makes
 * cross-application attachment impossible.
 */
export async function recordPortalLifecycleObservation(
  observation: NormalizedPortalLifecycleObservation,
): Promise<RecordedPortalLifecycleObservation> {
  const [inserted] = await db
    .insert(portalLifecycleObservationsTable)
    .values({
      submissionId: observation.submissionId,
      applicationId: observation.applicationId,
      adapterKey: observation.adapterKey,
      observationHash: observation.observationHash,
      rawStatus: observation.rawStatus,
      signal: observation.signal,
      disposition: observation.disposition,
      identityVerified: observation.identityVerified,
      identitySource: observation.identitySource,
      missingDocuments: observation.missingDocuments,
      evidence: observation.evidence,
      observedAt: observation.observedAt,
    })
    .onConflictDoNothing({
      target: [
        portalLifecycleObservationsTable.submissionId,
        portalLifecycleObservationsTable.observationHash,
      ],
    })
    .returning({ id: portalLifecycleObservationsTable.id });
  if (inserted) return { id: inserted.id, created: true };

  const [existing] = await db
    .select({ id: portalLifecycleObservationsTable.id })
    .from(portalLifecycleObservationsTable)
    .where(
      and(
        eq(
          portalLifecycleObservationsTable.submissionId,
          observation.submissionId,
        ),
        eq(
          portalLifecycleObservationsTable.observationHash,
          observation.observationHash,
        ),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("portal_lifecycle_observation_dedup_failed");
  return { id: existing.id, created: false };
}
