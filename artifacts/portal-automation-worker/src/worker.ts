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
import { and, eq, isNull } from "drizzle-orm";
import { db, portalUniversitiesTable } from "@workspace/db";
import { isExperimentalAdapterKey } from "@workspace/portal-adapters";
import {
  claimNext,
  releaseStale,
  buildStudentProfile,
  runSubmission,
  writebackResult,
} from "@workspace/portal-runner";
import { resolvePortalCreds } from "./credResolver.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POLL_MS   = parseInt(process.env.WORKER_POLL_MS   ?? "5000",   10);
const STALE_MS  = parseInt(process.env.WORKER_STALE_MS  ?? "300000", 10);
const WORKER_ID = `${os.hostname()}-${process.pid}`;

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

console.log(`[portal-worker] Starting — id=${WORKER_ID} poll=${POLL_MS}ms stale=${STALE_MS}ms`);

/**
 * Loads the allowlist of university keys eligible for auto-processing:
 * autoProcess=true AND isActive=true AND not soft-deleted.
 *
 * Experimental adapter families (salesforce/sit/united/emu) are EXCLUDED here
 * as a hard runtime guard — even if a row somehow has autoProcess=true, the
 * worker will never auto-submit it. Manual single-submission via the API still
 * works. This mirrors the same guard in api-server/scripts/drain-once.ts.
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

  const experimentalSkipped = unis
    .filter((u) => isExperimentalAdapterKey(u.adapterKey))
    .map((u) => u.universityKey);
  if (experimentalSkipped.length > 0) {
    console.log(
      `[portal-worker] Experimental adapters excluded from auto-process: ${experimentalSkipped.join(", ")}`,
    );
  }

  return unis
    .filter((u) => !isExperimentalAdapterKey(u.adapterKey))
    .map((u) => u.universityKey);
}

async function tick(): Promise<void> {
  // Reset stale locks on every tick (cheap, idempotent)
  const released = await releaseStale(STALE_MS);
  if (released.length > 0) {
    console.log(`[portal-worker] Released ${released.length} stale submission(s)`);
  }

  // Only claim submissions for autoProcess+active+non-experimental universities.
  // An empty allowlist means there is nothing to auto-process this tick.
  const autoProcessKeys = await loadAutoProcessKeys();
  if (autoProcessKeys.length === 0) return;

  const sub = await claimNext(WORKER_ID, autoProcessKeys);
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
    const creds = await resolvePortalCreds(sub.universityKey, sub.universityKey);

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

loop().catch((err) => {
  console.error("[portal-worker] Fatal loop error:", err);
  process.exit(1);
});
