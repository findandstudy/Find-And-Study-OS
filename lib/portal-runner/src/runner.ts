/**
 * runner.ts — orchestrates the adapter login + submit flow for a single
 * portal submission.
 *
 * Dry mode  — skips login/submit entirely; returns a synthetic result with
 *             resultJson.dryRun:true so the writeback can record the attempt
 *             without touching the external portal.
 *
 * Real mode — caller resolves credentials (DB-first, env fallback) and
 *             passes them as `creds`. The runner injects them into the
 *             adapter via setCredsOverride() before calling adapter.login(),
 *             then clears the override in finally.
 *
 * NOTE: The browser is launched and closed INSIDE this function for each
 * submission. Callers processing multiple submissions sequentially should
 * call runSubmission once per submission — this keeps peak memory minimal.
 */

import fs from "node:fs/promises";
import {
  adapterByKey,
  adapterForUniversity,
  setCredsOverride,
  clearCredsOverride,
} from "@workspace/portal-adapters";
import type { SubmitResult, SubmitProfile, SubmitFiles } from "@workspace/portal-adapters";
import type { ClaimedSubmission } from "./queue.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedCreds {
  user: string;
  password: string;
}

export interface RunResult {
  result: SubmitResult;
  screenshotUrls: string[];
  /** Extra metadata (dryRun flag, adapter key used, etc.) */
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// runSubmission
// ---------------------------------------------------------------------------

/**
 * Runs the adapter flow for a claimed submission.
 *
 * @param submission  Claimed submission row (id, universityKey, mode …)
 * @param profile     Built student profile
 * @param files       Downloaded document paths
 * @param tempDir     Temp directory to clean up in finally
 * @param creds       Resolved portal credentials (required when mode='real';
 *                    ignored for dry runs). Caller is responsible for resolution.
 */
export async function runSubmission(
  submission: Pick<ClaimedSubmission, "id" | "universityKey" | "universityName" | "mode">,
  profile: SubmitProfile,
  files: SubmitFiles,
  tempDir: string,
  creds?: ResolvedCreds,
): Promise<RunResult> {
  // ----- 1. Resolve adapter -----------------------------------------------
  const adapter =
    adapterByKey(submission.universityKey) ??
    adapterForUniversity(submission.universityName);

  if (!adapter) {
    await cleanup(tempDir);
    throw new Error(
      `NO_ADAPTER: no adapter found for key="${submission.universityKey}" / name="${submission.universityName}"`,
    );
  }

  // ----- 2. Creds required for real mode; optional for dry (browser dry run) --
  const isDry = submission.mode !== "real";

  if (!isDry && !creds) {
    await cleanup(tempDir);
    throw new Error(
      `MISSING_CREDS: real mode requires resolved credentials for key="${submission.universityKey}"`,
    );
  }

  // ----- 3. Login + submit -------------------------------------------------
  // doSubmit=true for real mode; doSubmit=false for dry mode (fill form, no click)
  const screenshotUrls: string[] = [];
  let session: Awaited<ReturnType<typeof adapter.login>> | null = null;

  if (creds) {
    setCredsOverride(adapter.key, { user: creds.user, password: creds.password });
  }

  try {
    session = await adapter.login({ headless: true });

    const result = await adapter.submit(session, profile, files, !isDry);

    // Capture post-submit screenshot (best-effort)
    try {
      const buf = await (session as unknown as { page: { screenshot(): Promise<Buffer> } })
        .page.screenshot();
      screenshotUrls.push(`data:image/png;base64,${buf.toString("base64").slice(0, 64)}…`);
    } catch {
      // Screenshot failure is non-fatal
    }

    return {
      result,
      screenshotUrls,
      meta: {
        adapterKey: adapter.key,
        ...(isDry ? { dryRun: true } : {}),
      },
    };
  } finally {
    if (creds) clearCredsOverride(adapter.key);
    await session?.close().catch(() => {});
    await cleanup(tempDir);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function cleanup(tempDir: string): Promise<void> {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
