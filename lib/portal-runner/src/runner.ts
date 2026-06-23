/**
 * runner.ts — orchestrates the adapter login + submit flow for a single
 * portal submission.
 *
 * Dry mode  — skips the final portal submit click (doSubmit=false) but still
 *             performs a real browser login and fills every form step.
 *             Credentials are therefore required for dry mode as well.
 *
 * Real mode — caller resolves credentials (DB-first, env fallback) and
 *             passes them as `creds`. The runner injects them into the
 *             adapter via setCredsOverride() before calling adapter.login(),
 *             then clears the override in finally.
 *
 * Screenshot flow:
 *   Adapters capture per-step screenshots and return local /tmp paths in
 *   result.screenshots.  The runner reads each file, uploads it to Object
 *   Storage (PRIVATE_OBJECT_DIR), and stores the persistent /objects/…
 *   reference in RunResult.screenshotUrls.  Upload failures are non-fatal
 *   (e.g. when PRIVATE_OBJECT_DIR is not configured in dev environments).
 *   Local /tmp screenshot files are cleaned up in the finally block.
 *
 * Memory discipline:
 *   - Screenshots are written directly to /tmp by the adapter (no PNG buffer
 *     held in the JS heap during submission). The runner reads one at a time
 *     for upload, then deletes the local file.
 *   - session.close() closes page → context → browser in order.
 *   - tempDir (containing downloaded document files) is deleted in finally.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  adapterByKey,
  adapterForUniversity,
  setCredsOverride,
  clearCredsOverride,
} from "@workspace/portal-adapters";
import type { SubmitResult, SubmitProfile, SubmitFiles } from "@workspace/portal-adapters";
import {
  uploadBufferToGcs,
  resolveObjectPaths,
} from "@workspace/object-storage";
import type { ClaimedSubmission } from "./queue.js";
import { loadProgramMapping } from "./programMappingLoader.js";

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
 * @param creds       Resolved portal credentials.  Required for BOTH real and
 *                    dry mode — dry mode still performs a full browser login
 *                    and form-fill smoke test; only the final submit click is
 *                    skipped.
 * @param opts        Optional run options. `headless` defaults to true so the
 *                    production worker behaviour is unchanged; the local
 *                    dry-test CLI passes `headless:false` to drive a visible
 *                    browser (residential IP, no Cloudflare/bot block).
 */
export async function runSubmission(
  submission: Pick<ClaimedSubmission, "id" | "universityKey" | "universityName" | "mode">,
  profile: SubmitProfile,
  files: SubmitFiles,
  tempDir: string,
  creds?: ResolvedCreds,
  opts?: { headless?: boolean },
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
  const localScreenshots: string[] = [];
  let session: Awaited<ReturnType<typeof adapter.login>> | null = null;

  if (creds) {
    setCredsOverride(adapter.key, { user: creds.user, password: creds.password });
  }

  try {
    session = await adapter.login({ headless: opts?.headless ?? true });

    // Inject panel-managed mapping (synonyms / program & country overrides)
    // keyed by universityKey. Empty/missing row → fields omitted → the adapter
    // falls back to its built-in code defaults (no behaviour change). The DB
    // values, when present, are merged OVER the built-ins by the adapter.
    const mapping = await loadProgramMapping(submission.universityKey);
    const enrichedProfile: SubmitProfile = { ...profile, ...mapping };

    const result = await adapter.submit(session, enrichedProfile, files, !isDry);

    // ----- 4. Upload per-step screenshots to Object Storage ----------------
    // Adapters write screenshots to /tmp and return local paths in
    // result.screenshots.  We upload each one and store the /objects/…
    // reference.  Non-fatal: if PRIVATE_OBJECT_DIR is not set (dev
    // environments) or upload fails, screenshotUrls is simply empty.
    const rawShots = result.screenshots ?? [];
    const persistentUrls: string[] = [];

    for (let i = 0; i < rawShots.length; i++) {
      const shotPath = rawShots[i];
      if (!shotPath) continue;
      localScreenshots.push(shotPath);
      try {
        const buffer = await fs.readFile(shotPath);
        const basename = path.basename(shotPath);
        const { gcsPath, objectsRef } = resolveObjectPaths(
          `portal-submissions/${submission.id}/${i}-${basename}`,
        );
        await uploadBufferToGcs({ gcsPath, buffer, contentType: "image/png" });
        persistentUrls.push(objectsRef);
      } catch {
        // Non-fatal — PRIVATE_OBJECT_DIR not set, GCS unavailable, etc.
      }
    }

    return {
      result,
      screenshotUrls: persistentUrls,
      meta: {
        adapterKey: adapter.key,
        ...(isDry ? { dryRun: true } : {}),
      },
    };
  } finally {
    if (creds) clearCredsOverride(adapter.key);
    // Close page → context → browser in order (see browser.ts)
    await session?.close().catch(() => {});
    await cleanup(tempDir);
    // Clean up local /tmp screenshot files written by the adapter
    for (const p of localScreenshots) {
      await fs.unlink(p).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function cleanup(tempDir: string): Promise<void> {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
}
