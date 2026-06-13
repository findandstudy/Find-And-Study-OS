/**
 * runner.ts — orchestrates the adapter login + submit flow for a single
 * portal submission.
 *
 * Dry mode  — skips login/submit entirely; returns a synthetic result with
 *             resultJson.dryRun:true so the writeback can record the attempt
 *             without touching the external portal.
 *
 * Real mode — resolves the adapter, reads credentials from .env, calls
 *             adapter.login() then adapter.submit(), captures screenshots.
 */

import fs from "node:fs/promises";
import {
  adapterByKey,
  adapterForUniversity,
  portalCreds,
} from "@workspace/portal-adapters";
import type { SubmitResult, SubmitProfile, SubmitFiles } from "@workspace/portal-adapters";
import type { ClaimedSubmission } from "./queue.js";

// ---------------------------------------------------------------------------
// Result shape returned to stageWriteback
// ---------------------------------------------------------------------------

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
 * `tempDir` is cleaned up inside this function (in the finally block).
 */
export async function runSubmission(
  submission: Pick<ClaimedSubmission, "id" | "universityKey" | "universityName" | "mode">,
  profile: SubmitProfile,
  files: SubmitFiles,
  tempDir: string,
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

  // ----- 2. Dry mode — no real browser interaction ------------------------
  if (submission.mode !== "real") {
    await cleanup(tempDir);
    return {
      result: {
        submitted:     false,
        alreadyExists: false,
        programMissing: false,
      },
      screenshotUrls: [],
      meta: { dryRun: true, adapterKey: adapter.key },
    };
  }

  // ----- 3. Real mode — validate credentials first ------------------------
  // portalCreds() throws when env vars are missing; let the error propagate
  // so the submission lands in "failed" with a clear message.
  portalCreds(adapter.key);

  // ----- 4. Login + submit -------------------------------------------------
  const screenshotUrls: string[] = [];
  let session: Awaited<ReturnType<typeof adapter.login>> | null = null;

  try {
    session = await adapter.login({ headless: true });

    const result = await adapter.submit(session, profile, files);

    // Capture post-submit screenshot
    try {
      const buf = await (session as unknown as { page: { screenshot(): Promise<Buffer> } })
        .page.screenshot();
      // In production the caller would upload buf to object storage and push
      // the URL; here we record a placeholder string so the shape is correct.
      screenshotUrls.push(`data:image/png;base64,${buf.toString("base64").slice(0, 64)}…`);
    } catch {
      // Screenshot failure is non-fatal
    }

    return {
      result,
      screenshotUrls,
      meta: { adapterKey: adapter.key },
    };
  } finally {
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
