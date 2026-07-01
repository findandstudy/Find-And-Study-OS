/**
 * stageWriteback.ts — applies the 4 writeback rules after a submission run.
 *
 * Rule 1: submitted=true       → portal_submissions.status='submitted'
 *                                 application.stage='awaiting_offer_letter'
 * Rule 2: programMissing=true  → portal_submissions.status='program_missing'
 *                                 application.stage='documents'
 * Rule 3: alreadyExists=true   → portal_submissions.status='already_exists'
 *                                 application.stage='already_registered'
 * Rule 4: programFull=true    → portal_submissions.status='program_full'
 *                                 portal_submissions.meta={requestedProgram,
 *                                 openPrograms, reason, detectedAt}
 *                                 application stage unchanged
 * Rule 5: error / none matched → portal_submissions.status='failed'
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
  | "program_full"
  | "exclusive_region"
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
  // Exclusive-region (nationality restricted to a specific agency) is a permanent
  // finding regardless of dry/real mode — surface it ahead of EVERYTHING (incl.
  // programFull and dry_run). The portal was skipped (preventive) or rejected the
  // application (reactive). Application stage unchanged; no retry.
  if (result.exclusiveRegion) {
    return { submissionStatus: "exclusive_region", stageKey: null };
  }
  // Quota-full ("Kontenjan Dolu") is a structural finding regardless of dry/real
  // mode — surface it (ahead of dry_run) so the orchestrator can supersede the
  // full programme. The application stage is left unchanged.
  if (result.programFull) {
    return { submissionStatus: "program_full", stageKey: null };
  }
  // Program not found in the portal dropdown, but the dropdown WAS reached and
  // its options are known (resolution="not_in_dropdown"). Like program_full this
  // is a structural finding surfaced ahead of dry_run so the orchestrator can
  // supersede to a backup programme even on a dry run. Application stage is left
  // unchanged. Only when availablePrograms is non-empty — otherwise this falls
  // through to the plain program_missing rule below (dropdown unreachable).
  if (
    result.programMissing &&
    result.resolution === "not_in_dropdown" &&
    (result.availablePrograms?.length ?? 0) > 0
  ) {
    return { submissionStatus: "program_missing", stageKey: null };
  }
  // Dry runs: pipeline smoke-test only, no real portal interaction → dry_run status
  if (meta?.["dryRun"]) {
    return { submissionStatus: "dry_run", stageKey: null };
  }
  if (result.submitted) {
    return { submissionStatus: "submitted",       stageKey: "awaiting_offer" };
  }
  if (result.programMissing) {
    return { submissionStatus: "program_missing", stageKey: "documents_collected" };
  }
  if (result.alreadyExists) {
    return { submissionStatus: "already_exists",  stageKey: "all_registered" };
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
      // Persist the portal-assigned reference (e.g. Topkapı success-page uuid)
      // only when present so a later non-submitted run never clobbers it.
      ...(result?.externalRef ? { externalRef: result.externalRef } : {}),
      // Structured quota-full context (Phase 2) → meta jsonb. Only set on
      // programFull so other flows never clobber the meta column.
      ...(result?.programFull
        ? {
            meta: {
              requestedProgram: result.requestedProgram,
              openPrograms:     result.openPrograms,
              reason:           "Kontenjan dolu",
              detectedAt:       new Date().toISOString(),
            },
          }
        : {}),
      // Program-not-in-dropdown context → meta jsonb. Only set when the dropdown
      // was reached (availablePrograms non-empty) so the orchestrator can
      // supersede; other flows never clobber the meta column.
      ...(result?.programMissing &&
      result.resolution === "not_in_dropdown" &&
      (result.availablePrograms?.length ?? 0) > 0
        ? {
            meta: {
              requestedProgram:  result.requestedProgram,
              availablePrograms: result.availablePrograms,
              resolution:        "not_in_dropdown",
              reason:            "Program portalda bulunamadı",
              detectedAt:        new Date().toISOString(),
            },
          }
        : {}),
      // Exclusive-region context → meta jsonb. Only set on exclusiveRegion so
      // other flows never clobber the meta column.
      ...(result?.exclusiveRegion
        ? {
            meta: {
              reason:          "Exclusive bölge",
              exclusiveAgency: result.exclusiveAgency ?? null,
              detectedAt:      new Date().toISOString(),
            },
          }
        : {}),
      error:          submissionStatus === "exclusive_region"
                        ? (result?.exclusiveAgency
                            ? `Exclusive bölge — ${result.exclusiveAgency} üzerinden başvurulmalı`
                            : "Exclusive bölge — acenta üzerinden başvurulmalı")
                        : submissionStatus === "failed"
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
