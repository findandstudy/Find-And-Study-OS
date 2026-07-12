/**
 * graduation.ts — adapter auto-graduation (shared core).
 *
 * An adapter whose family is statically experimental (EXPERIMENTAL_FAMILIES
 * in @workspace/portal-adapters) "graduates" once it has GRADUATION_THRESHOLD
 * portal submissions with status='submitted'. Graduation is computed LIVE
 * from the DB per adapter_key — no persisted flag:
 *
 *   experimental(key) = staticExperimentalFamily(key)
 *                       && successCount(key) < GRADUATION_THRESHOLD
 *
 * This module is the SINGLE counting implementation shared by:
 *   - api-server (auto-process toggle guard, /portal-adapters metadata,
 *     scheduled auto-drain exclusion) via lib/adapterGraduation.ts wrappers
 *   - portal-automation-worker (allowlist filter in loadAutoProcessKeys)
 *   - api-server/scripts/drain-once.ts (cron drain allowlist filter)
 *
 * Manual single-submission of experimental adapters is ALWAYS allowed — only
 * automatic processing paths consult these helpers.
 */

import { pool } from "@workspace/db";
import {
  isExperimentalAdapterKey,
  GRADUATION_THRESHOLD,
} from "@workspace/portal-adapters";

export { GRADUATION_THRESHOLD };

/**
 * Live 'submitted' counts per adapter key (one GROUP BY query). Every
 * requested key is present in the map (0 when no successful rows).
 */
export async function getAdapterSuccessCounts(
  adapterKeys: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(adapterKeys)];
  const result = new Map<string, number>(unique.map((k) => [k, 0]));
  if (unique.length === 0) return result;

  const res = await pool.query<{ adapter_key: string; n: string }>(
    `SELECT adapter_key, COUNT(*)::int AS n
     FROM portal_submissions
     WHERE adapter_key = ANY($1::text[])
       AND status = 'submitted'
       AND deleted_at IS NULL
     GROUP BY adapter_key`,
    [unique],
  );
  for (const row of res.rows) {
    result.set(row.adapter_key, Number(row.n));
  }
  return result;
}

/**
 * Subset of the given adapter keys that are STILL experimental: statically
 * experimental family AND below the graduation threshold. Non-experimental
 * families are never returned regardless of count.
 */
export async function getNonGraduatedExperimentalAdapterKeys(
  adapterKeys: string[],
): Promise<Set<string>> {
  const experimental = [...new Set(adapterKeys)].filter(isExperimentalAdapterKey);
  if (experimental.length === 0) return new Set();
  const counts = await getAdapterSuccessCounts(experimental);
  return new Set(
    experimental.filter((k) => (counts.get(k) ?? 0) < GRADUATION_THRESHOLD),
  );
}

/**
 * University keys whose portal adapter is still experimental (non-graduated)
 * — the exclusion list the api-server scheduled auto-drain passes to
 * claimNext(excludeUniversityKeys). Active + deleted rows both included:
 * excluding a key that has no queued rows is harmless, missing one is not.
 */
export async function getExperimentalExcludedUniversityKeys(): Promise<string[]> {
  const res = await pool.query<{ university_key: string; adapter_key: string }>(
    `SELECT university_key, adapter_key
     FROM portal_universities
     WHERE deleted_at IS NULL`,
  );
  const nonGraduated = await getNonGraduatedExperimentalAdapterKeys(
    res.rows.map((r) => r.adapter_key),
  );
  return res.rows
    .filter((r) => nonGraduated.has(r.adapter_key))
    .map((r) => r.university_key);
}
