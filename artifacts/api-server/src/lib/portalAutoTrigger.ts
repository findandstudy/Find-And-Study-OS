/**
 * portalAutoTrigger.ts — automatic portal submission enqueue
 *
 * Event-driven: called (fire-and-forget) from PATCH /applications/:id whenever
 * the stage changes AND from POST /applications when a new application is
 * created at a trigger stage.  Batch: scanAndEnqueueTriggerStageApplications is
 * used by the "Run Now" endpoint to enqueue every eligible trigger-stage
 * application on demand.
 *
 * The eligibility gate (single source of truth in enqueueIfEligible) checks:
 *
 *   1. triggerStages — the stage must be in the configured list
 *   2. University lookup — the application's university must have an active
 *      portal_universities row (matched by crmUniversityId then by name)
 *   3. Scope filter:
 *        only_applied → university row exists + isActive (default)
 *        selected     → additionally, universityKey ∈ selectedUniversityKeys
 *        all          → same as only_applied (row must still exist + isActive)
 *   4. hasCredentials — DB row (portal_credentials) or env vars set
 *   5. Dedup — skip when a queued/running/submitted submission already exists
 *              for this application × universityKey pair
 *
 * The global isEnabled kill-switch is checked once by each caller before the
 * gate runs.  All single-trigger failures are logged via console.error and
 * swallowed so the HTTP response is never blocked.
 */

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  applicationsTable,
  portalAutomationSettingsTable,
  portalUniversitiesTable,
  portalSubmissionsTable,
} from "@workspace/db";
import { logAudit } from "./auth.js";
import { checkHasPortalCredentials } from "./portalCreds.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoTriggerParams {
  applicationId: number;
  studentId:     number;
  newStage:      string;
  /** Application's university free-text name (nullable). */
  universityName: string | null;
  /** Application's universityId FK (→ universities.id; used for exact match). */
  universityId:   number | null;
  actorUserId:    number;
}

/** Settings row shape used by the eligibility gate. */
type PortalSettings = typeof portalAutomationSettingsTable.$inferSelect;

/** Reason codes for a skipped application — surfaced to the Run Now UI. */
export type SkipReason =
  | "stage_not_trigger"
  | "no_active_portal_university"
  | "out_of_scope"
  | "no_credentials"
  | "duplicate";

export type EnqueueOutcome =
  | { status: "queued"; submissionId: number; universityKey: string }
  | { status: "skipped"; reason: SkipReason };

const ACTIVE_STATUSES = ["queued", "running", "submitted"] as const;

// ---------------------------------------------------------------------------
// findActivePortalUniversity
// ---------------------------------------------------------------------------

/**
 * Resolves the active portal_universities row for an application's university,
 * matching by crmUniversityId (exact) then universityName (case-insensitive).
 *
 * Single source of truth shared by the auto-trigger and the manual-submit
 * endpoint so both pick the same adapter from the application's OWN record
 * (never a hardcoded universityKey). Returns null when no active match exists.
 */
export async function findActivePortalUniversity(args: {
  universityId: number | null;
  universityName: string | null;
}): Promise<typeof portalUniversitiesTable.$inferSelect | null> {
  const { universityId, universityName } = args;
  if (universityId == null && !universityName) return null;

  const baseConditions = [
    isNull(portalUniversitiesTable.deletedAt),
    eq(portalUniversitiesTable.isActive, true),
  ];

  let matchCondition;
  if (universityId != null && universityName) {
    matchCondition = or(
      eq(portalUniversitiesTable.crmUniversityId, universityId),
      sql`LOWER(${portalUniversitiesTable.universityName}) = LOWER(${universityName})`,
    );
  } else if (universityId != null) {
    matchCondition = eq(portalUniversitiesTable.crmUniversityId, universityId);
  } else {
    matchCondition = sql`LOWER(${portalUniversitiesTable.universityName}) = LOWER(${universityName!})`;
  }

  const [row] = await db
    .select()
    .from(portalUniversitiesTable)
    .where(and(...baseConditions, matchCondition!))
    .limit(1);

  return row ?? null;
}

// ---------------------------------------------------------------------------
// enqueueIfEligible — the shared eligibility gate (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Evaluates the portal-automation policy for one application/stage pair against
 * the provided settings and inserts a portal_submissions row when every gate
 * passes.  Does NOT check settings.isEnabled — callers gate on that once before
 * iterating.  Returns a structured outcome so batch callers can tally reasons.
 */
export async function enqueueIfEligible(
  params: AutoTriggerParams,
  settings: PortalSettings,
): Promise<EnqueueOutcome> {
  const { applicationId, studentId, newStage, universityName, universityId, actorUserId } = params;

  // ----- Gate 1: trigger stage -----------------------------------------
  const triggerStages = Array.isArray(settings.triggerStages)
    ? (settings.triggerStages as string[])
    : [];
  if (!triggerStages.includes(newStage)) {
    return { status: "skipped", reason: "stage_not_trigger" };
  }

  // ----- Gate 2: find matching portal_universities row ------------------
  const portalUni = await findActivePortalUniversity({ universityId, universityName });
  if (!portalUni) {
    return { status: "skipped", reason: "no_active_portal_university" };
  }

  // ----- Gate 3: scope filter -------------------------------------------
  if (settings.scope === "selected") {
    const selectedKeys = Array.isArray(settings.selectedUniversityKeys)
      ? (settings.selectedUniversityKeys as string[])
      : [];
    if (!selectedKeys.includes(portalUni.universityKey)) {
      return { status: "skipped", reason: "out_of_scope" };
    }
  }
  // scope='only_applied' and scope='all' both pass when a portal_uni row exists

  // ----- Gate 4: credentials check (DB-first + env fallback) -----------
  if (!await checkHasPortalCredentials(portalUni.universityKey, portalUni.adapterKey)) {
    return { status: "skipped", reason: "no_credentials" };
  }

  // ----- Gate 5: dedup + enqueue (atomic) -------------------------------
  // A plain SELECT-then-INSERT is racy: multiple callers (creation hook, PATCH
  // hook, Run Now scan, or multiple server instances) can fire for the same
  // application concurrently, all pass the read, and all insert duplicate
  // queued rows.  Schema changes are out of scope (no partial unique index), so
  // we serialize the check+insert with a transaction-scoped Postgres advisory
  // lock keyed by (applicationId, universityKey).  The lock is released
  // automatically on commit/rollback, guaranteeing at most one active
  // submission per application × university pair.
  const outcome = await db.transaction(async (tx): Promise<EnqueueOutcome> => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${applicationId}, hashtext(${portalUni.universityKey}))`,
    );

    const [existing] = await tx
      .select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(
        and(
          eq(portalSubmissionsTable.applicationId, applicationId),
          eq(portalSubmissionsTable.universityKey, portalUni.universityKey),
          inArray(portalSubmissionsTable.status, [...ACTIVE_STATUSES]),
          isNull(portalSubmissionsTable.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      return { status: "skipped", reason: "duplicate" };
    }

    const [row] = await tx
      .insert(portalSubmissionsTable)
      .values({
        applicationId,
        studentId,
        universityKey:  portalUni.universityKey,
        universityName: portalUni.universityName,
        mode:           settings.mode,
        status:         "queued",
        enqueuedBy:     actorUserId,
      })
      .returning({ id: portalSubmissionsTable.id });

    return { status: "queued", submissionId: row.id, universityKey: portalUni.universityKey };
  });

  if (outcome.status === "queued") {
    logAudit(
      actorUserId,
      "auto_enqueue_portal_submission",
      "portal_submission",
      outcome.submissionId,
      {
        applicationId,
        universityKey: portalUni.universityKey,
        newStage,
        mode: settings.mode,
      },
    );
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// maybeEnqueuePortalSubmission — event-driven single trigger (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Evaluates the portal-automation policy for the given application/stage
 * transition and inserts a portal_submissions row when all gates pass.
 *
 * The function is intentionally async but callers MUST fire-and-forget:
 *   maybeEnqueuePortalSubmission(params).catch(err => console.error(...))
 */
export async function maybeEnqueuePortalSubmission(
  params: AutoTriggerParams,
): Promise<void> {
  // ----- Global kill-switch --------------------------------------------
  const [settings] = await db
    .select()
    .from(portalAutomationSettingsTable)
    .limit(1);

  if (!settings?.isEnabled) return;

  const outcome = await enqueueIfEligible(params, settings);

  if (outcome.status === "queued") {
    console.log(
      `[portal-auto] Enqueued submission #${outcome.submissionId}` +
      ` app=${params.applicationId} uni=${outcome.universityKey}` +
      ` stage=${params.newStage} mode=${settings.mode}`,
    );
  } else if (outcome.reason === "duplicate") {
    console.log(
      `[portal-auto] Dedup — active submission already exists ` +
      `for app #${params.applicationId}; skipping`,
    );
  }
}

// ---------------------------------------------------------------------------
// scanAndEnqueueTriggerStageApplications — batch (Run Now)
// ---------------------------------------------------------------------------

export interface RunNowSummary {
  scanned: number;
  queued: number;
  skipped: number;
  /** Count of skips grouped by reason code. */
  reasons: Partial<Record<SkipReason, number>>;
  /** Ids of the submissions enqueued by this run. */
  queuedIds: number[];
}

/**
 * Scans every non-deleted application whose current stage is one of the
 * configured trigger stages and enqueues the eligible ones, reusing the exact
 * same per-application gate as the event-driven path (enqueueIfEligible).
 *
 * The caller MUST verify settings.isEnabled before calling.  Returns a summary
 * with per-reason skip counts so the UI can report N queued / M skipped.
 */
export async function scanAndEnqueueTriggerStageApplications(
  actorUserId: number,
  settings: PortalSettings,
): Promise<RunNowSummary> {
  const summary: RunNowSummary = {
    scanned: 0,
    queued: 0,
    skipped: 0,
    reasons: {},
    queuedIds: [],
  };

  const triggerStages = Array.isArray(settings.triggerStages)
    ? (settings.triggerStages as string[])
    : [];
  if (triggerStages.length === 0) return summary;

  const apps = await db
    .select({
      id:             applicationsTable.id,
      studentId:      applicationsTable.studentId,
      stage:          applicationsTable.stage,
      universityId:   applicationsTable.universityId,
      universityName: applicationsTable.universityName,
    })
    .from(applicationsTable)
    .where(
      and(
        inArray(applicationsTable.stage, triggerStages),
        isNull(applicationsTable.deletedAt),
      ),
    )
    .orderBy(asc(applicationsTable.id));

  for (const app of apps) {
    summary.scanned += 1;
    try {
      const outcome = await enqueueIfEligible(
        {
          applicationId:  app.id,
          studentId:      app.studentId,
          newStage:       app.stage,
          universityName: app.universityName ?? null,
          universityId:   app.universityId ?? null,
          actorUserId,
        },
        settings,
      );

      if (outcome.status === "queued") {
        summary.queued += 1;
        summary.queuedIds.push(outcome.submissionId);
      } else {
        summary.skipped += 1;
        summary.reasons[outcome.reason] = (summary.reasons[outcome.reason] ?? 0) + 1;
      }
    } catch (err) {
      summary.skipped += 1;
      console.error(`[portal-auto] Run Now gate failed for app #${app.id}:`, err);
    }
  }

  return summary;
}
