/**
 * fallback.ts — rule-based program-fallback (supersession) orchestrator.
 *
 * When a portal submission ends in status='program_full' ("Kontenjan Dolu") the
 * worker can fall back to an ordered list of alternative CRM programmes instead
 * of leaving the application stuck. This module:
 *
 *   1. Resolves the fallback rule for (portal university, source programme).
 *   2. Picks the FIRST fallback candidate whose resolved portal <option> value
 *      is OPEN (present + enabled) in the submission's meta.openPrograms.
 *   3. In a single transaction: cancels the old application, creates a NEW
 *      application on the fallback programme (fees/level/language copied from the
 *      fallback CATALOG, never from the old app), links them via
 *      superseded_from/by, and enqueues a portal submission for the new app.
 *   4. Writes an audit log and notifies the assigned consultant.
 *
 * Guards: kill-switch (portal_automation_settings.fallback_enabled), mode=real
 * only, idempotency (no duplicate supersession), loop-depth (max 2). When no
 * rule matches or every fallback is full/closed the submission is left in
 * program_full for a human to handle.
 *
 * IMPORTANT: lib/portal-runner cannot import from artifacts/api-server, so audit
 * + notification are written DIRECTLY via @workspace/db.
 */

import {
  db,
  applicationsTable,
  programsTable,
  portalSubmissionsTable,
  portalProgramFallbacksTable,
  portalProgramMappingTable,
  portalAutomationSettingsTable,
  auditLogsTable,
  notificationsTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { matchProgram, type ProgramCandidate } from "@workspace/portal-adapters";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Single portal <option> as persisted in portal_submissions.meta.openPrograms. */
export interface OpenProgram {
  value: string;
  name: string;
  enabled: boolean;
}

/** A fallback CRM programme considered for selection. */
export interface FallbackCandidate {
  /** CRM programs.id */
  programId: number;
  /** CRM catalog programme name (used for fuzzy matching). */
  name: string;
}

export interface SelectedFallback {
  programId: number;
  /** The portal <option> value the candidate resolved to. */
  portalValue: string;
  /** The matched open-program entry. */
  open: OpenProgram;
}

/** Maximum supersession chain depth (loop guard). */
export const MAX_FALLBACK_DEPTH = 2;

// ---------------------------------------------------------------------------
// Pure candidate resolver (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Walk the ordered fallback candidates and return the first one whose resolved
 * portal value is OPEN (present + enabled) in `openPrograms`. Returns null when
 * none are open/closed-resolvable.
 *
 * Resolution per candidate:
 *   1. Manual override: programOverrides[candidateId] → portal value, IF that
 *      value exists in openPrograms.
 *   2. Fuzzy: matchProgram(candidate.name, openPrograms-as-candidates, ...).
 * The candidate is SELECTED only when the resolved value's openPrograms entry
 * has enabled=true. Order is preserved — the first eligible candidate wins.
 */
export function selectFallbackCandidate(
  candidates: FallbackCandidate[],
  openPrograms: OpenProgram[],
  opts?: {
    programOverrides?: Record<string, string>;
    synonyms?: string[][];
  },
): SelectedFallback | null {
  const overrides = opts?.programOverrides ?? {};
  const synonyms = opts?.synonyms;
  // Matcher candidates use the portal value as the id so a match resolves
  // straight to the <option> value.
  const matchCandidates: ProgramCandidate[] = openPrograms.map((o) => ({
    id:   o.value,
    name: o.name,
  }));

  for (const cand of candidates) {
    const portalValue = resolvePortalValue(
      cand,
      openPrograms,
      matchCandidates,
      overrides,
      synonyms,
    );
    if (!portalValue) continue;

    const open = openPrograms.find((o) => o.value === portalValue);
    if (open && open.enabled) {
      return { programId: cand.programId, portalValue, open };
    }
    // Resolved but full/closed → skip, try the next candidate.
  }
  return null;
}

function resolvePortalValue(
  cand: FallbackCandidate,
  openPrograms: OpenProgram[],
  matchCandidates: ProgramCandidate[],
  overrides: Record<string, string>,
  synonyms?: string[][],
): string | null {
  // 1. Manual override (CRM programId → portal value/text).
  const override = overrides[String(cand.programId)];
  if (override !== undefined) {
    const byValue = openPrograms.find((o) => o.value === override);
    if (byValue) return byValue.value;
    // Override may carry the option TEXT instead of the value.
    const byName = openPrograms.find(
      (o) => o.name.trim().toLowerCase() === override.trim().toLowerCase(),
    );
    if (byName) return byName.value;
  }

  // 2. Fuzzy match the CRM catalog name against the portal options.
  const m = matchProgram(
    cand.name,
    matchCandidates,
    String(cand.programId),
    overrides,
    synonyms,
  );
  return m ? m.match.id : null;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type FallbackOutcome =
  | { status: "disabled" }
  | { status: "not_real_mode" }
  | { status: "wrong_status" }
  | { status: "no_meta" }
  | { status: "no_rule" }
  | { status: "no_open_fallback" }
  | { status: "loop_guard" }
  | { status: "already_superseded"; newApplicationId: number }
  | {
      status: "superseded";
      sourceApplicationId: number;
      newApplicationId: number;
      newSubmissionId: number;
      fallbackProgramId: number;
    };

// ---------------------------------------------------------------------------
// handleProgramFull — orchestrator entry point
// ---------------------------------------------------------------------------

/**
 * Process a program_full submission and, when a fallback rule applies, supersede
 * the full programme with the first open fallback.
 *
 * Safe to call for ANY submission id — it self-gates on kill-switch, mode and
 * status and returns a no-op outcome otherwise. Never throws for business
 * no-ops; it only throws on unexpected DB failures (caller logs).
 *
 * @param submissionId  portal_submissions.id of the program_full submission.
 */
export async function handleProgramFull(
  submissionId: number,
): Promise<FallbackOutcome> {
  // ----- Kill-switch ------------------------------------------------------
  const [settings] = await db
    .select({ fallbackEnabled: portalAutomationSettingsTable.fallbackEnabled })
    .from(portalAutomationSettingsTable)
    .limit(1);
  if (!settings?.fallbackEnabled) {
    console.log(
      `[fallback] Submission #${submissionId}: kill-switch off (fallback_enabled=false) — no-op`,
    );
    return { status: "disabled" };
  }

  // ----- Load submission --------------------------------------------------
  const [sub] = await db
    .select({
      id:             portalSubmissionsTable.id,
      applicationId:  portalSubmissionsTable.applicationId,
      studentId:      portalSubmissionsTable.studentId,
      universityKey:  portalSubmissionsTable.universityKey,
      universityName: portalSubmissionsTable.universityName,
      mode:           portalSubmissionsTable.mode,
      status:         portalSubmissionsTable.status,
      meta:           portalSubmissionsTable.meta,
    })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.id, submissionId));

  if (!sub) {
    console.error(`[fallback] Submission #${submissionId} not found`);
    return { status: "no_rule" };
  }

  // ----- mode=real guard (dry runs never supersede — test safety) ---------
  if (sub.mode !== "real") {
    console.log(
      `[fallback] Submission #${submissionId}: mode=${sub.mode} (not real) — no-op`,
    );
    return { status: "not_real_mode" };
  }

  // ----- status guard: only a program_full submission may supersede --------
  if (sub.status !== "program_full") {
    console.log(
      `[fallback] Submission #${submissionId}: status=${sub.status} (not program_full) — no-op`,
    );
    return { status: "wrong_status" };
  }

  const meta = (sub.meta ?? {}) as {
    openPrograms?: OpenProgram[];
  };
  const openPrograms = Array.isArray(meta.openPrograms) ? meta.openPrograms : [];
  if (openPrograms.length === 0) {
    console.log(
      `[fallback] Submission #${submissionId}: no openPrograms in meta — no-op`,
    );
    return { status: "no_meta" };
  }

  // ----- Load source application ------------------------------------------
  const [srcApp] = await db
    .select()
    .from(applicationsTable)
    .where(eq(applicationsTable.id, sub.applicationId));

  if (!srcApp || srcApp.programId == null) {
    console.log(
      `[fallback] Submission #${submissionId}: source app missing / no programId — no-op`,
    );
    return { status: "no_rule" };
  }

  // ----- Loop guard: count supersession chain depth -----------------------
  const depth = await chainDepth(srcApp.id);
  if (depth >= MAX_FALLBACK_DEPTH) {
    console.log(
      `[fallback] Submission #${submissionId}: chain depth ${depth} >= ${MAX_FALLBACK_DEPTH} — loop guard, no-op`,
    );
    return { status: "loop_guard" };
  }

  // ----- Resolve the fallback rule ----------------------------------------
  const [rule] = await db
    .select({
      fallbackProgramIds: portalProgramFallbacksTable.fallbackProgramIds,
      autoSubmit:         portalProgramFallbacksTable.autoSubmit,
    })
    .from(portalProgramFallbacksTable)
    .where(
      and(
        eq(portalProgramFallbacksTable.universityKey, sub.universityKey),
        eq(portalProgramFallbacksTable.sourceProgramId, srcApp.programId),
        eq(portalProgramFallbacksTable.enabled, true),
        isNull(portalProgramFallbacksTable.deletedAt),
      ),
    );

  if (!rule || !Array.isArray(rule.fallbackProgramIds) || rule.fallbackProgramIds.length === 0) {
    console.log(
      `[fallback] Submission #${submissionId}: no fallback rule for uni=${sub.universityKey} program=${srcApp.programId} — program_full kept`,
    );
    return { status: "no_rule" };
  }

  // ----- Load fallback catalog programmes (ordered) -----------------------
  const fallbackPrograms = await loadProgramsOrdered(rule.fallbackProgramIds);
  const candidates: FallbackCandidate[] = rule.fallbackProgramIds
    .map((id) => {
      const p = fallbackPrograms.get(id);
      return p ? { programId: id, name: p.name } : null;
    })
    .filter((c): c is FallbackCandidate => c !== null);

  // ----- Manual overrides / synonyms (panel-managed mapping) --------------
  const [mapping] = await db
    .select({
      programOverrides: portalProgramMappingTable.programOverrides,
      synonyms:         portalProgramMappingTable.synonyms,
    })
    .from(portalProgramMappingTable)
    .where(
      and(
        eq(portalProgramMappingTable.universityKey, sub.universityKey),
        isNull(portalProgramMappingTable.memberUniversityId),
      ),
    );

  const selected = selectFallbackCandidate(candidates, openPrograms, {
    programOverrides: mapping?.programOverrides ?? {},
    synonyms:         mapping?.synonyms ?? [],
  });

  if (!selected) {
    console.log(
      `[fallback] Submission #${submissionId}: all fallbacks full/closed/unresolvable — program_full kept`,
    );
    return { status: "no_open_fallback" };
  }

  const fallbackProgram = fallbackPrograms.get(selected.programId)!;

  // ----- Supersession transaction -----------------------------------------
  // Idempotency + concurrency safety: a tx-scoped advisory lock keyed on the
  // source application id serializes concurrent handlers for the same app, and
  // the "already superseded" recheck runs INSIDE the lock so a second caller
  // observes the first caller's committed child and no-ops instead of creating
  // a duplicate supersession.
  const newMode = rule.autoSubmit ? sub.mode : "dry";
  const reason = `Kontenjan dolu — ${srcApp.programName ?? srcApp.programId} → ${fallbackProgram.name}`;

  const txResult = await db.transaction(async (tx) => {
    const now = new Date();

    // Serialize on the source application id (xact lock auto-released on commit).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${srcApp.id})`);

    // Idempotency recheck under the lock: short-circuit if THIS source app has
    // already been superseded to ANY program (not only this fallback program).
    const [existing] = await tx
      .select({ id: applicationsTable.id })
      .from(applicationsTable)
      .where(eq(applicationsTable.supersededFromApplicationId, srcApp.id));
    if (existing) {
      console.log(
        `[fallback] Submission #${submissionId}: already superseded src #${srcApp.id} → app #${existing.id} — idempotent no-op`,
      );
      return { alreadySuperseded: true as const, newAppId: existing.id, newSubId: 0 };
    }

    // a. Cancel the old application.
    await tx
      .update(applicationsTable)
      .set({
        stage:          "cancelled",
        supersedeReason: reason,
        updatedAt:      now,
      })
      .where(eq(applicationsTable.id, srcApp.id));

    // b. Create the new application on the fallback programme. Fees / level /
    //    language come from the fallback CATALOG (never copied from the old app
    //    so a wrong fee can't carry over). Catalog gaps stay null.
    const [newApp] = await tx
      .insert(applicationsTable)
      .values({
        studentId:           srcApp.studentId,
        programId:           selected.programId,
        universityId:        srcApp.universityId,
        agentId:             srcApp.agentId,
        assignedToId:        srcApp.assignedToId,
        season:              srcApp.season,
        stage:               "inquiry",
        level:               fallbackProgram.degree ?? null,
        instructionLanguage: fallbackProgram.language ?? null,
        programName:         fallbackProgram.name,
        universityName:      srcApp.universityName,
        country:             srcApp.country,
        tuitionFee:          fallbackProgram.tuitionFee ?? null,
        discountedFee:       fallbackProgram.discountedFee ?? null,
        scholarship:         fallbackProgram.scholarship ?? null,
        commissionRate:      fallbackProgram.commissionRate ?? null,
        serviceFeeAmount:    fallbackProgram.serviceFeeAmount ?? null,
        applicationFee:      fallbackProgram.applicationFee ?? null,
        depositFee:          fallbackProgram.depositFee ?? null,
        advancedFee:         fallbackProgram.advancedFee ?? null,
        languageFee:         fallbackProgram.languageFee ?? null,
        currency:            fallbackProgram.currency ?? null,
        // Origin attribution copied verbatim from the source application.
        originType:          srcApp.originType,
        originEntityType:    srcApp.originEntityType,
        originEntityId:      srcApp.originEntityId,
        originDisplayName:   srcApp.originDisplayName,
        originLocked:        srcApp.originLocked,
        originStudentId:     srcApp.originStudentId,
        branchId:            srcApp.branchId,
        supersededFromApplicationId: srcApp.id,
        createdAt:           now,
        updatedAt:           now,
      })
      .returning({ id: applicationsTable.id });

    // c. Back-link the old application to the new one.
    await tx
      .update(applicationsTable)
      .set({ supersededByApplicationId: newApp.id, updatedAt: now })
      .where(eq(applicationsTable.id, srcApp.id));

    // d. Enqueue a portal submission for the new application.
    const [newSub] = await tx
      .insert(portalSubmissionsTable)
      .values({
        applicationId:  newApp.id,
        studentId:      srcApp.studentId,
        universityKey:  sub.universityKey,
        universityName: sub.universityName,
        mode:           newMode,
        status:         "queued",
        meta:           { note: `auto-fallback from #${srcApp.id}` },
      })
      .returning({ id: portalSubmissionsTable.id });

    // e. Audit.
    await tx.insert(auditLogsTable).values({
      userId:     null,
      action:     "program_fallback_supersede",
      resource:   "application",
      resourceId: srcApp.id,
      changes:    JSON.stringify({
        fromApplicationId:  srcApp.id,
        toApplicationId:    newApp.id,
        sourceProgramId:    srcApp.programId,
        fallbackProgramId:  selected.programId,
        portalValue:        selected.portalValue,
        newSubmissionId:    newSub.id,
        newSubmissionMode:  newMode,
        reason,
      }),
    });

    return { alreadySuperseded: false as const, newAppId: newApp.id, newSubId: newSub.id };
  });

  if (txResult.alreadySuperseded) {
    return { status: "already_superseded", newApplicationId: txResult.newAppId };
  }

  const { newAppId, newSubId } = txResult;

  console.log(
    `[fallback] Submission #${submissionId}: superseded app #${srcApp.id} → #${newAppId} ` +
      `(program ${selected.programId}, portal value ${selected.portalValue}); ` +
      `new submission #${newSubId} mode=${newMode} queued`,
  );

  // ----- Notify the assigned consultant (best-effort, after commit) -------
  if (srcApp.assignedToId) {
    try {
      await db.insert(notificationsTable).values({
        userId:    srcApp.assignedToId,
        type:      "program_fallback",
        title:     "Program kontenjanı dolu — otomatik yedeklendi",
        body:      `Öğrencinin programı kontenjan dolu; ${fallbackProgram.name} programına otomatik taşındı ve gönderim kuyruğa alındı.`,
        icon:      "Repeat",
        actionUrl: `/applications/${newAppId}`,
        data:      {
          i18nKey:           "notifications.programFallback",
          fromApplicationId: srcApp.id,
          toApplicationId:   newAppId,
          fallbackProgram:   fallbackProgram.name,
        },
      });
    } catch (err) {
      console.error("[fallback] Notification insert failed (non-fatal):", err);
    }
  }

  return {
    status:              "superseded",
    sourceApplicationId: srcApp.id,
    newApplicationId:    newAppId,
    newSubmissionId:     newSubId,
    fallbackProgramId:   selected.programId,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CatalogProgram = typeof programsTable.$inferSelect;

/** Load fallback catalog programmes keyed by id (order preserved by caller). */
async function loadProgramsOrdered(
  ids: number[],
): Promise<Map<number, CatalogProgram>> {
  const out = new Map<number, CatalogProgram>();
  if (ids.length === 0) return out;
  const rows = await db.select().from(programsTable);
  const want = new Set(ids);
  for (const r of rows) {
    if (want.has(r.id)) out.set(r.id, r);
  }
  return out;
}

/**
 * Count how many supersession hops led to `appId` by walking the
 * superseded_from_application_id chain upward. A fresh (non-superseded) app has
 * depth 0. Cycle-safe (visited set, capped iterations).
 */
async function chainDepth(appId: number): Promise<number> {
  let depth = 0;
  let cursor: number | null = appId;
  const visited = new Set<number>();
  while (cursor != null && !visited.has(cursor) && depth <= MAX_FALLBACK_DEPTH + 1) {
    visited.add(cursor);
    const [row]: { from: number | null }[] = await db
      .select({ from: applicationsTable.supersededFromApplicationId })
      .from(applicationsTable)
      .where(eq(applicationsTable.id, cursor));
    if (!row || row.from == null) break;
    depth += 1;
    cursor = row.from;
  }
  return depth;
}
