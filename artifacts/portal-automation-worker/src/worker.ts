/**
 * worker.ts — main polling loop for the portal-automation worker.
 *
 * Start:  pnpm --filter @workspace/portal-automation-worker start
 * PM2:    configured in Faz 5
 *
 * Environment variables:
 *   WORKER_POLL_MS        Polling interval when queue is empty (default: 5000)
 *   WORKER_STALE_MS       Stale lock threshold for crash recovery (default: 300000 = 5 min)
 *   DATABASE_URL          Required — PostgreSQL connection string
 */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, portalUniversitiesTable, portalAutomationSettingsTable } from "@workspace/db";
import {
  claimNext,
  releaseStale,
  buildStudentProfile,
  runSubmission,
  writebackResult,
  handleNeedsFallback,
  resolveAdapterKey,
} from "@workspace/portal-runner";
import { resolvePortalCreds } from "./credResolver.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POLL_MS   = parseInt(process.env.WORKER_POLL_MS   ?? "5000",   10);
const STALE_MS  = parseInt(process.env.WORKER_STALE_MS  ?? "300000", 10);
const WORKER_ID = `${os.hostname()}-${process.pid}`;

// ---------------------------------------------------------------------------
// Safety-net /tmp sweeper — removes stale portal temp files left by crashes or
// leaks.  Only touches patterns we own; never touches functional state files
// (topkapi-portal-state.json, sit-login-state.png), DB dumps, or Node caches.
// Called at the top of every tick (cheap — synchronous readdir, no await).
// ---------------------------------------------------------------------------
const SWEEP_PATTERNS = [
  /^portal-sub-/,
  /^portal-shot-/,
  /-step\d*\.png$/i,
  /^playwright_chromiumdev_profile-/,
];

function sweepTmp(maxAgeMin = 180): void {
  const dir = os.tmpdir();
  const cutoff = Date.now() - maxAgeMin * 60_000;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!SWEEP_PATTERNS.some((p) => p.test(name))) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) {
          fs.rmSync(full, { recursive: true, force: true });
          console.log(`[portal-worker] sweepTmp: removed stale ${name}`);
        }
      } catch {
        // Ignore per-entry errors (file disappeared, permission, etc.)
      }
    }
  } catch {
    // Non-fatal — tmpdir unreadable
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

console.log(`[portal-worker] Starting — id=${WORKER_ID} poll=${POLL_MS}ms stale=${STALE_MS}ms`);

/**
 * Loads the allowlist of university keys eligible for auto-processing:
 * autoProcess=true AND isActive=true AND not soft-deleted.
 *
 * Aggregator families (salesforce/sit/united/emu) are NO LONGER hard-excluded
 * here — each aggregator now opts in/out through its OWN portal_universities
 * row's `autoProcess` toggle (panel-managed), same as any standalone portal.
 * That toggle is condition 1 of the 3-condition gate for aggregator auto-drain
 * (see worker.ts module doc / tick()): (1) this toggle, (2) the application's
 * university is an active DB member (portal_account_universities — already
 * enforced upstream at enqueue time by enqueueIfEligible/resolvePortalRouting,
 * which only ever queues a member submission under the AGGREGATOR's own
 * universityKey), (3) trigger stage (loadTriggerStages() below). Today the
 * United row's autoProcess is OFF in production, so removing this exclusion
 * changes nothing until an operator explicitly flips that toggle — and even
 * then the existing one-claim-per-tick cadence drains the queue gradually,
 * never in a burst. This mirrors the identical fix in
 * api-server/scripts/drain-once.ts.
 */
async function loadAutoProcessKeys(): Promise<string[]> {
  const unis = await db
    .select({
      universityKey: portalUniversitiesTable.universityKey,
      adapterKey:    portalUniversitiesTable.adapterKey,
    })
    .from(portalUniversitiesTable)
    .where(and(
      eq(portalUniversitiesTable.autoProcess, true),
      eq(portalUniversitiesTable.isActive, true),
      isNull(portalUniversitiesTable.deletedAt),
    ));

  return unis.map((u) => u.universityKey);
}

/**
 * Loads the configured trigger stages. Only applications currently in one of
 * these stages are eligible for auto-processing (mirrors the enqueue-time
 * candidate selection). An empty array means nothing is auto-processed.
 */
async function loadTriggerStages(): Promise<string[]> {
  const [settings] = await db
    .select({ triggerStages: portalAutomationSettingsTable.triggerStages })
    .from(portalAutomationSettingsTable)
    .limit(1);
  return settings?.triggerStages ?? [];
}

async function tick(): Promise<void> {
  // Sweep stale /tmp artifacts from crashes or leaks (cheap, sync, non-fatal)
  sweepTmp();

  // Reset stale locks on every tick (cheap, idempotent)
  const released = await releaseStale(STALE_MS);
  if (released.length > 0) {
    console.log(`[portal-worker] Released ${released.length} stale submission(s)`);
  }

  // Only claim submissions for autoProcess+active+non-experimental universities.
  // An empty allowlist means there is nothing to auto-process this tick.
  const autoProcessKeys = await loadAutoProcessKeys();
  if (autoProcessKeys.length === 0) return;

  // Gate on configured trigger stages: only claim submissions whose application
  // is currently in one of those stages (mirrors the enqueue scan).
  const triggerStages = await loadTriggerStages();

  const sub = await claimNext(WORKER_ID, autoProcessKeys, triggerStages);
  if (!sub) return; // Nothing to do

  console.log(
    `[portal-worker] Claimed submission #${sub.id} (attempt ${sub.attempts}/${sub.maxAttempts})` +
    ` app=${sub.applicationId} uni=${sub.universityKey} mode=${sub.mode}`,
  );

  let runResult = null;

  try {
    const profileResult = await buildStudentProfile(sub.id);

    // Resolve credentials (DB-first, env fallback) — worker-specific resolver.
    // Both dry AND real modes need credentials because dry mode still performs
    // a real browser login to smoke-test the full form-fill flow; only the
    // final submit click is skipped (doSubmit=false).
    //
    // Multi-portal / aggregator routing: a member university (e.g. "aydin")
    // routed to an aggregator (SIT=study_in_turkey→adapter "sit") must log in
    // with the AGGREGATOR's credentials, not its own. resolveAdapterKey returns
    // routedVia (the aggregator's portal key) when a redirect applies; passing
    // it + the adapter key lets resolvePortalCreds find the aggregator's row
    // instead of the member's own credentials. For direct portals routedVia is
    // null and adapterKey === universityKey, so behaviour is unchanged.
    const { adapterKey, routedVia } = await resolveAdapterKey(sub.universityKey);
    const creds = await resolvePortalCreds(routedVia ?? sub.universityKey, adapterKey);

    runResult = await runSubmission(
      sub,
      profileResult.profile,
      profileResult.files,
      profileResult.tempDir,
      creds,
    );

    console.log(
      `[portal-worker] Submission #${sub.id} run complete —` +
      ` submitted=${runResult.result.submitted}` +
      ` alreadyExists=${runResult.result.alreadyExists}` +
      ` programMissing=${runResult.result.programMissing}` +
      ` programFull=${runResult.result.programFull ?? false}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[portal-worker] Submission #${sub.id} failed: ${msg}`);
    await writebackResult(sub.id, null, msg);
    return;
  }

  await writebackResult(sub.id, runResult);

  // Program-fallback orchestrator: when the portal reports the requested
  // programme is full ("Kontenjan Dolu") OR the programme is not found in the
  // portal dropdown (but the dropdown WAS reached, so alternatives are known),
  // try to supersede it with a configured fallback. Fully self-gating
  // (kill-switch, mode=real, idempotency, loop guard) and best-effort — a
  // failure here must never break the worker loop.
  const needsFallback =
    runResult?.result?.programFull === true ||
    (runResult?.result?.programMissing === true &&
      runResult?.result?.resolution === "not_in_dropdown" &&
      (runResult?.result?.availablePrograms?.length ?? 0) > 0);
  if (needsFallback) {
    try {
      const outcome = await handleNeedsFallback(sub.id);
      const trigger = runResult?.result?.programFull ? "program_full" : "program_missing";
      console.log(
        `[portal-worker] Submission #${sub.id} ${trigger} → fallback outcome=${outcome.status}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[portal-worker] Submission #${sub.id} fallback orchestrator failed (non-fatal): ${msg}`,
      );
    }
  }
}

async function loop(): Promise<void> {
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error("[portal-worker] Unexpected tick error:", err);
    }
    await sleep(POLL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[portal-worker] SIGTERM received — shutting down");
  process.exit(0);
});

// Crash-loop containment: a stray async error (e.g. a Playwright fire-and-forget
// promise, a browser subprocess hiccup, or a throw outside the tick try/catch)
// must NOT take the whole worker down and trigger a PM2/pnpm ELIFECYCLE restart
// loop. Log it and keep polling — per-submission failures are already handled in
// tick() (marked as error via writebackResult), so staying up is always correct.
process.on("unhandledRejection", (reason) => {
  console.error(
    "[portal-worker] Unhandled promise rejection (contained — worker stays up):",
    reason,
  );
});
process.on("uncaughtException", (err) => {
  console.error(
    "[portal-worker] Uncaught exception (contained — worker stays up):",
    err,
  );
});

loop().catch((err) => {
  console.error("[portal-worker] Fatal loop error:", err);
  process.exit(1);
});
