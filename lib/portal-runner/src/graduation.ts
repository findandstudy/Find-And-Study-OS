/**
 * graduation.ts — adapter auto-graduation (shared core).
 *
 * An adapter whose family requires graduation (explicitly experimental code
 * families plus every unknown/uploaded declarative key) "graduates" once it
 * has GRADUATION_THRESHOLD portal submissions with a durable success proof. A
 * submitted status alone is intentionally insufficient: historical adapters
 * could report submitted before the portal outcome was positively verified.
 * Graduation is computed LIVE from the DB per adapter_key — no persisted flag.
 * For an uploaded spec, only proofs created after the currently enabled
 * version's activation epoch count:
 *
 *   experimental(key) = graduationRequiredFamily(key)
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

export interface GraduationProofCandidate {
  externalRef?: unknown;
  resultJson?: unknown;
}

/**
 * Pure mirror of the SQL graduation predicate. Kept exported so regression
 * tests and audit tooling can validate persisted result shapes without a DB.
 */
export function hasDurableGraduationProof(
  candidate: GraduationProofCandidate,
): boolean {
  if (
    typeof candidate.externalRef === "string" &&
    candidate.externalRef.trim() !== ""
  ) {
    return true;
  }

  if (!candidate.resultJson || typeof candidate.resultJson !== "object") {
    return false;
  }
  const root = candidate.resultJson as Record<string, unknown>;
  const topLevelProof = root.successProof;
  const nestedResult =
    root.result && typeof root.result === "object"
      ? (root.result as Record<string, unknown>)
      : null;
  const nestedMeta =
    nestedResult?.meta && typeof nestedResult.meta === "object"
      ? (nestedResult.meta as Record<string, unknown>)
      : null;
  const nestedProof = nestedMeta?.successProof;

  return [topLevelProof, nestedProof].some(
    (proof) =>
      proof != null &&
      typeof proof === "object" &&
      (proof as Record<string, unknown>).verified === true,
  );
}

/**
 * Live, current-behavior verified-success counts per adapter key (one GROUP
 * BY query). Every requested key is present in the map (0 when no proven
 * successful rows). Uploaded spec proofs are activation-epoch-bound.
 */
export async function getAdapterSuccessCounts(
  adapterKeys: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(adapterKeys)];
  const result = new Map<string, number>(unique.map((k) => [k, 0]));
  if (unique.length === 0) return result;

  const res = await pool.query<{ adapter_key: string; n: string }>(
    `SELECT submission.adapter_key, COUNT(*)::int AS n
     FROM portal_submissions submission
     LEFT JOIN portal_adapter_specs active_spec
       ON active_spec.key = submission.adapter_key
      AND active_spec.enabled = TRUE
     WHERE submission.adapter_key = ANY($1::text[])
       AND submission.status = 'submitted'
       AND submission.deleted_at IS NULL
       -- Uploaded adapter evidence is version-epoch bound. Enabling or
       -- rolling back a spec refreshes updated_at, so proofs produced by a
       -- previous behavior cannot silently graduate the new behavior.
       AND (
         active_spec.id IS NULL
         OR submission.created_at >= active_spec.updated_at
       )
       AND (
         NULLIF(BTRIM(submission.external_ref), '') IS NOT NULL
         OR submission.result_json #>> '{successProof,verified}' = 'true'
         OR submission.result_json #>> '{result,meta,successProof,verified}' = 'true'
       )
     GROUP BY submission.adapter_key`,
    [unique],
  );
  for (const row of res.rows) {
    result.set(row.adapter_key, Number(row.n));
  }
  return result;
}

/**
 * Subset of the given adapter keys that are STILL experimental: a family that
 * requires graduation AND a durable-success count below the threshold.
 * Production-proven code families are never returned regardless of count.
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
