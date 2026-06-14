/**
 * stageWriteback.ts — applies the 4 writeback rules after a submission run.
 *
 * Rule 1: submitted=true       → portal_submissions.status='submitted'
 *                                 application.stage='awaiting_offer_letter'
 * Rule 2: programMissing=true  → portal_submissions.status='program_missing'
 *                                 application.stage='documents'
 * Rule 3: alreadyExists=true   → portal_submissions.status='already_exists'
 *                                 application.stage='already_registered'
 * Rule 4: error / none matched → portal_submissions.status='failed'
 *                                 application stage unchanged (stays in Inquiry)
 *
 * Stage changes are BEST-EFFORT: if the target pipeline stage key does not
 * exist in the pipeline_stages table the application is left untouched.
 */

import {
  db,
  portalSubmissionsTable,
  applicationsTable,
  pipelineStagesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { SubmitResult } from "@workspace/portal-adapters";
import type { RunResult } from "./runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SubmissionStatus =
  | "submitted"
  | "program_missing"
  | "already_exists"
  | "failed"
  | "dry_run";

interface WritebackTarget {
  submissionStatus: SubmissionStatus;
  /** pipeline_stages.key to set on the application; null = no change */
  stageKey: string | null;
}

// ---------------------------------------------------------------------------
// Rule resolution
// ---------------------------------------------------------------------------

function resolveTarget(
  result: SubmitResult | null,
  meta?: Record<string, unknown>,
): WritebackTarget {
  if (!result) {
    return { submissionStatus: "failed", stageKey: null };
  }
  // Dry runs: pipeline smoke-test only, no real portal interaction → dry_run status
  if (meta?.["dryRun"]) {
    return { submissionStatus: "dry_run", stageKey: null };
  }
  if (result.submitted) {
    return { submissionStatus: "submitted",       stageKey: "awaiting_offer_letter" };
  }
  if (result.programMissing) {
    return { submissionStatus: "program_missing", stageKey: "documents_collected" };
  }
  if (result.alreadyExists) {
    return { submissionStatus: "already_exists",  stageKey: "already_registered" };
  }
  return { submissionStatus: "failed", stageKey: null };
}

// ---------------------------------------------------------------------------
// writebackResult
// ---------------------------------------------------------------------------

/**
 * Updates portal_submissions and (best-effort) the application stage.
 *
 * @param submissionId  The ID of the portal_submissions row
 * @param runResult     Null when the run threw an error
 * @param errorMessage  Set when runResult is null
 * @param workerId      When provided the UPDATE is guarded with
 *                      `locked_by = workerId` so a stale background write
 *                      (e.g. after an inline timeout + requeue) cannot
 *                      clobber a row that has since been re-claimed by
 *                      drain-once or another worker.
 */
export async function writebackResult(
  submissionId: number,
  runResult: RunResult | null,
  errorMessage?: string,
  workerId?: string,
): Promise<void> {
  const result = runResult?.result ?? null;
  const { submissionStatus, stageKey } = resolveTarget(result, runResult?.meta);

  // ----- 1. Load submission to get applicationId --------------------------
  const [sub] = await db
    .select({
      id:            portalSubmissionsTable.id,
      applicationId: portalSubmissionsTable.applicationId,
    })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.id, submissionId));

  if (!sub) {
    console.error(`[writeback] Submission ${submissionId} not found`);
    return;
  }

  // ----- 2. Update portal_submissions -------------------------------------
  // If workerId is provided we guard with locked_by = workerId so that a
  // stale background write (from an inline process that timed out and was
  // requeued) cannot clobber a row that has since been re-claimed.
  await db
    .update(portalSubmissionsTable)
    .set({
      status:         submissionStatus,
      resultJson:     runResult
                        ? { ...runResult.meta, result: runResult.result }
                        : { error: errorMessage ?? "unknown error" },
      screenshotUrls: runResult?.screenshotUrls ?? [],
      error:          submissionStatus === "failed"
                        ? (errorMessage ?? "submission failed")
                        : null,
      lockedAt:       null,
      lockedBy:       null,
      updatedAt:      new Date(),
    })
    .where(
      workerId !== undefined
        ? and(
            eq(portalSubmissionsTable.id, submissionId),
            eq(portalSubmissionsTable.lockedBy, workerId),
          )
        : eq(portalSubmissionsTable.id, submissionId),
    );

  // ----- 3. Best-effort application stage update --------------------------
  if (stageKey && sub.applicationId) {
    try {
      const [stageRow] = await db
        .select({ key: pipelineStagesTable.key })
        .from(pipelineStagesTable)
        .where(
          and(
            eq(pipelineStagesTable.entityType, "application"),
            eq(pipelineStagesTable.key, stageKey),
          ),
        );

      if (stageRow) {
        await db
          .update(applicationsTable)
          .set({ stage: stageKey, updatedAt: new Date() })
          .where(eq(applicationsTable.id, sub.applicationId));

        console.log(
          `[writeback] Submission #${submissionId}: status=${submissionStatus} → app #${sub.applicationId} stage=${stageKey}`,
        );
      } else {
        console.warn(
          `[writeback] Target stage "${stageKey}" not found in pipeline_stages; skipping stage update`,
        );
      }
    } catch (err) {
      console.error("[writeback] Stage update failed (non-fatal):", err);
    }
  } else {
    console.log(
      `[writeback] Submission #${submissionId}: status=${submissionStatus} (no stage change)`,
    );
  }
}
