/**
 * portalAutoTrigger.ts — automatic portal submission enqueue
 *
 * Called (fire-and-forget) from PATCH /applications/:id whenever the stage
 * field changes.  The function gates on:
 *
 *   1. isEnabled — global kill-switch in portal_automation_settings
 *   2. triggerStages — the new stage must be in the configured list
 *   3. University lookup — the application's university must have an active
 *      portal_universities row (matched by crmUniversityId then by name)
 *   4. Scope filter:
 *        only_applied → university row exists + isActive (default)
 *        selected     → additionally, universityKey ∈ selectedUniversityKeys
 *        all          → same as only_applied (row must still exist + isActive)
 *   5. hasCredentials — env vars <ADAPTER_KEY>_EMAIL/_USER + _PASSWORD set
 *   6. Dedup — skip when a queued/running/submitted submission already exists
 *              for this application × universityKey pair
 *
 * All failures are logged via console.error and swallowed so the HTTP
 * response is never blocked.
 */

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  portalAutomationSettingsTable,
  portalUniversitiesTable,
  portalSubmissionsTable,
} from "@workspace/db";
import { logAudit } from "./auth.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether process.env contains the portal credentials for the given
 * adapterKey following the <KEY>_EMAIL (or <KEY>_USER) + <KEY>_PASSWORD
 * convention used by portalCreds().
 */
function hasPortalCredentials(adapterKey: string): boolean {
  const K = adapterKey.toUpperCase().replace(/-/g, "_");
  const user = process.env[`${K}_EMAIL`] ?? process.env[`${K}_USER`];
  const password = process.env[`${K}_PASSWORD`];
  return !!(user && password);
}

// ---------------------------------------------------------------------------
// maybeEnqueuePortalSubmission
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

const ACTIVE_STATUSES = ["queued", "running", "submitted"] as const;

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
  const { applicationId, studentId, newStage, universityName, universityId, actorUserId } = params;

  // ----- Gate 1: global settings ----------------------------------------
  const [settings] = await db
    .select()
    .from(portalAutomationSettingsTable)
    .limit(1);

  if (!settings?.isEnabled) return;

  const triggerStages = Array.isArray(settings.triggerStages)
    ? (settings.triggerStages as string[])
    : [];

  if (!triggerStages.includes(newStage)) return;

  // ----- Gate 2: find matching portal_universities row ------------------
  if (!universityId && !universityName) return;

  const baseConditions = [
    isNull(portalUniversitiesTable.deletedAt),
    eq(portalUniversitiesTable.isActive, true),
  ];

  // Match priority: crmUniversityId (exact) → name (case-insensitive)
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

  const [portalUni] = await db
    .select()
    .from(portalUniversitiesTable)
    .where(and(...baseConditions, matchCondition!))
    .limit(1);

  if (!portalUni) return;

  // ----- Gate 3: scope filter -------------------------------------------
  if (settings.scope === "selected") {
    const selectedKeys = Array.isArray(settings.selectedUniversityKeys)
      ? (settings.selectedUniversityKeys as string[])
      : [];
    if (!selectedKeys.includes(portalUni.universityKey)) return;
  }
  // scope='only_applied' and scope='all' both pass when a portal_uni row exists

  // ----- Gate 4: credentials check -------------------------------------
  if (!hasPortalCredentials(portalUni.adapterKey)) return;

  // ----- Gate 5: dedup --------------------------------------------------
  const [existing] = await db
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
    console.log(
      `[portal-auto] Dedup — active submission #${existing.id} already exists ` +
      `for app #${applicationId} × ${portalUni.universityKey}; skipping`,
    );
    return;
  }

  // ----- Enqueue --------------------------------------------------------
  const [row] = await db
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

  logAudit(
    actorUserId,
    "auto_enqueue_portal_submission",
    "portal_submission",
    row.id,
    {
      applicationId,
      universityKey: portalUni.universityKey,
      newStage,
      mode: settings.mode,
    },
  );

  console.log(
    `[portal-auto] Enqueued submission #${row.id}` +
    ` app=${applicationId} uni=${portalUni.universityKey}` +
    ` stage=${newStage} mode=${settings.mode}`,
  );
}
