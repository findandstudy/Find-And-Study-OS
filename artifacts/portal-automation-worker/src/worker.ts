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

async function tick(): Promise<void> {
  // Reset stale locks on every tick (cheap, idempotent)
  const released = await releaseStale(STALE_MS);
  if (released > 0) {
    console.log(`[portal-worker] Released ${released} stale submission(s)`);
  }

  const sub = await claimNext(WORKER_ID);
  if (!sub) return; // Nothing to do

  console.log(
    `[portal-worker] Claimed submission #${sub.id} (attempt ${sub.attempts}/${sub.maxAttempts})` +
    ` app=${sub.applicationId} uni=${sub.universityKey} mode=${sub.mode}`,
  );

  let runResult = null;

  try {
    const profileResult = await buildStudentProfile(sub.id);

    // Resolve credentials (DB-first, env fallback) — worker-specific resolver
    let creds: { user: string; password: string } | undefined;
    if (sub.mode === "real") {
      creds = await resolvePortalCreds(sub.universityKey, sub.universityKey);
    }

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
      ` programMissing=${runResult.result.programMissing}`,
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
