import { db, applicationStageDocumentsTable, applicationsTable, pipelineStagesTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { areEquivalentDocTypes } from "@workspace/doc-equivalence";
import { logAudit } from "./auth";

/**
 * Task #187 — Missing-doc fulfillment + auto stage-advance.
 *
 * When a student (or any uploader) provides a document that satisfies an
 * open catalog-based missing-doc request on an application:
 *   1. Mark every matching open catalog request as fulfilled (stamp
 *      `fulfilledAt`). Custom (free-text) requests are NEVER auto-matched;
 *      they must be closed manually.
 *   2. If all *catalog* requests on the application's source stage are now
 *      fulfilled AND the source stage has `missingDocsFulfilledTargetStageId`
 *      configured, advance the application to that target stage.
 *
 * Wrapped in an advisory lock + transaction so concurrent uploads can't
 * each "see" 0 open requests and double-advance.
 *
 * `triggerUserId` is used for the audit row; pass the uploader's user id.
 */
export async function handleMissingDocFulfillment(
  applicationId: number,
  uploadedDocType: string,
  triggerUserId: number,
  uploadedDocumentId?: number,
  respondingToNoteId?: number | null,
): Promise<void> {
  if (!applicationId || !uploadedDocType) return;
  try {
    await db.transaction(async (tx) => {
      // Serialize concurrent uploads on the same application so the
      // "all fulfilled?" check is consistent. pg_advisory_xact_lock is
      // released automatically at commit/rollback.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${applicationId})`);

      const openRequests = await tx
        .select({
          id: applicationStageDocumentsTable.id,
          stage: applicationStageDocumentsTable.stage,
          fileName: applicationStageDocumentsTable.fileName,
        })
        .from(applicationStageDocumentsTable)
        .where(and(
          eq(applicationStageDocumentsTable.applicationId, applicationId),
          eq(applicationStageDocumentsTable.isMissingDocNote, true),
          eq(applicationStageDocumentsTable.isCustom, false),
          isNull(applicationStageDocumentsTable.fulfilledAt),
        ));

      const matchedIds: number[] = [];
      const affectedStages = new Set<string>();
      for (const r of openRequests) {
        if (areEquivalentDocTypes(r.fileName, uploadedDocType)) {
          matchedIds.push(r.id);
          affectedStages.add(r.stage);
        }
      }

      // Task #187 — mark CUSTOM (free-text) request as "uploaded, awaiting
      // staff review". Narrow scope so unrelated custom requests aren't
      // touched:
      //   - If the caller bound the upload to a specific note via
      //     `respondingToNoteId`, mark only THAT row (verified to belong
      //     to this application + still open + custom).
      //   - Otherwise (legacy / no explicit binding), only mark custom
      //     rows on the SAME source stages where a catalog match
      //     actually occurred — so an arbitrary doc upload doesn't blanket
      //     all open custom requests on the application.
      // Catalog requests are never set as merely "responded" — they
      // auto-fulfill below.
      if (respondingToNoteId) {
        await tx.update(applicationStageDocumentsTable)
          .set({ respondedAt: new Date(), respondedDocumentId: uploadedDocumentId ?? null })
          .where(and(
            eq(applicationStageDocumentsTable.id, respondingToNoteId),
            eq(applicationStageDocumentsTable.applicationId, applicationId),
            eq(applicationStageDocumentsTable.isMissingDocNote, true),
            eq(applicationStageDocumentsTable.isCustom, true),
            isNull(applicationStageDocumentsTable.fulfilledAt),
            isNull(applicationStageDocumentsTable.respondedAt),
          ));
      } else if (affectedStages.size > 0) {
        const affectedStagesArr = Array.from(affectedStages);
        await tx.update(applicationStageDocumentsTable)
          .set({ respondedAt: new Date(), respondedDocumentId: uploadedDocumentId ?? null })
          .where(and(
            eq(applicationStageDocumentsTable.applicationId, applicationId),
            eq(applicationStageDocumentsTable.isMissingDocNote, true),
            eq(applicationStageDocumentsTable.isCustom, true),
            isNull(applicationStageDocumentsTable.fulfilledAt),
            isNull(applicationStageDocumentsTable.respondedAt),
            sql`${applicationStageDocumentsTable.stage} = ANY(${affectedStagesArr})`,
          ));
      }

      if (matchedIds.length === 0) return;

      await tx.update(applicationStageDocumentsTable)
        .set({ fulfilledAt: new Date() })
        .where(sql`${applicationStageDocumentsTable.id} = ANY(${matchedIds})`);

      // Each request row is tied to the SOURCE stage where staff
      // originated the missing-doc action. Auto-advance only fires when
      // the application is CURRENTLY in that exact source stage — never
      // from unrelated stages (would cause silent regressions/jumps
      // across unrelated parts of the pipeline; Task #187 contract).
      const [app] = await tx.select({ stage: applicationsTable.stage })
        .from(applicationsTable)
        .where(and(eq(applicationsTable.id, applicationId), isNull(applicationsTable.deletedAt)));
      if (!app) return;

      // Resolve the application's current stage sortOrder once — used to
      // gate auto-advance below (source OR an intermediate waiting stage).
      const [currentStageRow] = await tx
        .select({ sortOrder: pipelineStagesTable.sortOrder })
        .from(pipelineStagesTable)
        .where(and(
          eq(pipelineStagesTable.entityType, "application"),
          eq(pipelineStagesTable.key, app.stage),
        ));
      const currentOrder = currentStageRow?.sortOrder ?? null;

      for (const sourceStageKey of affectedStages) {
        const stillOpen = await tx
          .select({ id: applicationStageDocumentsTable.id })
          .from(applicationStageDocumentsTable)
          .where(and(
            eq(applicationStageDocumentsTable.applicationId, applicationId),
            eq(applicationStageDocumentsTable.stage, sourceStageKey),
            eq(applicationStageDocumentsTable.isMissingDocNote, true),
            eq(applicationStageDocumentsTable.isCustom, false),
            isNull(applicationStageDocumentsTable.fulfilledAt),
          ))
          .limit(1);
        if (stillOpen.length > 0) continue;

        const [sourceStageRow] = await tx
          .select({
            id: pipelineStagesTable.id,
            sortOrder: pipelineStagesTable.sortOrder,
            targetId: pipelineStagesTable.missingDocsFulfilledTargetStageId,
          })
          .from(pipelineStagesTable)
          .where(and(
            eq(pipelineStagesTable.entityType, "application"),
            eq(pipelineStagesTable.key, sourceStageKey),
          ));
        if (!sourceStageRow?.targetId) continue;

        const [targetStageRow] = await tx
          .select({ key: pipelineStagesTable.key, sortOrder: pipelineStagesTable.sortOrder })
          .from(pipelineStagesTable)
          .where(eq(pipelineStagesTable.id, sourceStageRow.targetId));
        if (!targetStageRow) continue;

        // Already at target? Nothing to advance.
        if (app.stage === targetStageRow.key) continue;

        // Gate: auto-advance fires when the app is at the SOURCE stage
        // (no waiting stage in between) OR sitting in some intermediate
        // stage between source and target (typical "waiting on student"
        // flow where staff already moved the app forward after creating
        // the request). Never fires from unrelated parts of the pipeline.
        const isAtSource = app.stage === sourceStageKey;
        const isBetween = currentOrder != null
          && sourceStageRow.sortOrder != null
          && targetStageRow.sortOrder != null
          && currentOrder > sourceStageRow.sortOrder
          && currentOrder < targetStageRow.sortOrder;
        if (!isAtSource && !isBetween) continue;

        await tx.update(applicationsTable)
          .set({ stage: targetStageRow.key, updatedAt: new Date() })
          .where(eq(applicationsTable.id, applicationId));

        const fromStageForAudit = app.stage;
        setImmediate(() => {
          logAudit(triggerUserId, "auto_stage_advance_missing_docs_fulfilled", "application", applicationId, {
            fromStage: fromStageForAudit,
            sourceStage: sourceStageKey,
            toStage: targetStageRow.key,
            fulfilledCount: matchedIds.length,
          }).catch(() => {});
        });
        break;
      }
    });
  } catch (err) {
    // Never block the upload on fulfillment side-effects.
    console.error("[MISSING-DOCS] fulfillment hook failed:", err);
  }
}
