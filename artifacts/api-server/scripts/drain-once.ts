/**
 * drain-once.ts — processes ALL queued portal_submissions sequentially and exits.
 *
 * Designed for use with Replit Scheduled Deployments (see SCHEDULED_DRAIN.md).
 *
 * Each submission:
 *   1. Claimed atomically (FOR UPDATE SKIP LOCKED — safe to run concurrently)
 *   2. Student profile built + docs downloaded to tmp dir
 *   3. Credentials resolved (DB-first, env fallback)
 *   4. Adapter login + submit (browser closed after each run — minimal memory)
 *   5. Result written back to portal_submissions + application stage updated
 *
 * Usage:
 *   DATABASE_URL=... ENCRYPTION_KEY=... \
 *   pnpm --filter @workspace/api-server exec tsx scripts/drain-once.ts
 *
 * Exit codes:
 *   0 — completed (even if some submissions failed — failures are recorded in DB)
 *   1 — fatal startup error (DB unreachable, etc.)
 */

import os from "node:os";
import {
  claimNext,
  releaseStale,
  buildStudentProfile,
  runSubmission,
  writebackResult,
} from "@workspace/portal-runner";
import { resolvePortalCreds } from "../src/lib/portalCreds.js";

const WORKER_ID  = `drain-once-${os.hostname()}-${process.pid}`;
const STALE_MS   = 5 * 60 * 1000; // 5 minutes

interface DrainResult {
  id: number;
  status: "submitted" | "already_exists" | "program_missing" | "failed" | "dry_run";
  error?: string;
}

async function drain(): Promise<void> {
  console.log(`[drain-once] Starting — id=${WORKER_ID}`);

  // Release stale locks first (crash recovery)
  const released = await releaseStale(STALE_MS);
  if (released > 0) {
    console.log(`[drain-once] Released ${released} stale submission(s)`);
  }

  const results: DrainResult[] = [];

  while (true) {
    const sub = await claimNext(WORKER_ID);
    if (!sub) break; // Queue drained

    console.log(
      `[drain-once] Processing #${sub.id} — uni=${sub.universityKey} mode=${sub.mode} attempt=${sub.attempts}/${sub.maxAttempts}`,
    );

    try {
      const profileResult = await buildStudentProfile(sub.id);

      // Resolve creds for both real and dry modes.
      // Dry mode uses the browser (doSubmit=false), so credentials are needed.
      // If no creds exist for dry mode, login will fail and be caught below.
      let creds: { user: string; password: string } | undefined;
      try {
        creds = await resolvePortalCreds(sub.universityKey, sub.universityKey);
      } catch (credsErr) {
        if (sub.mode === "real") throw credsErr; // required for real mode
        // dry mode: missing creds → adapter will throw at login → caught below
        console.warn(
          `[drain-once] No creds for "${sub.universityKey}" (dry mode — will attempt env fallback)`,
        );
      }

      const runResult = await runSubmission(
        sub,
        profileResult.profile,
        profileResult.files,
        profileResult.tempDir,
        creds,
      );

      await writebackResult(sub.id, runResult);

      const status = runResult.meta["dryRun"]
        ? "dry_run"
        : runResult.result.submitted
          ? "submitted"
          : runResult.result.alreadyExists
            ? "already_exists"
            : runResult.result.programMissing
              ? "program_missing"
              : "failed";

      results.push({ id: sub.id, status: status as DrainResult["status"] });
      console.log(`[drain-once] #${sub.id} → ${status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[drain-once] #${sub.id} failed: ${msg}`);
      await writebackResult(sub.id, null, msg);
      results.push({ id: sub.id, status: "failed", error: msg });
    }
  }

  console.log(`\n[drain-once] Done — ${results.length} submission(s) processed`);
  if (results.length > 0) {
    for (const r of results) {
      const suffix = r.error ? ` (${r.error.slice(0, 80)})` : "";
      console.log(`  #${r.id}: ${r.status}${suffix}`);
    }
  }
}

drain()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[drain-once] Fatal error:", err);
    process.exit(1);
  });
