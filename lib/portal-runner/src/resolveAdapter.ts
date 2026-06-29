/**
 * resolveAdapter.ts — single source of truth for "which adapter runs a given
 * university's portal submission".
 *
 * Routing rule (multi-portal companies):
 *   - A row in portal_universities may have `routes_via` set to the
 *     `university_key` of a multi-portal company (is_multi_portal=true). When
 *     set, applications for that university are submitted THROUGH the company's
 *     panel, so the company's adapterKey (and credentials) must be used.
 *   - When `routes_via` is NULL the university uses its own adapter — behaviour
 *     is IDENTICAL to before this feature existed (no override is applied).
 *
 * Returned `routedVia` is non-null ONLY when an actual multi-portal redirect
 * happened, so callers can preserve the legacy (NULL) path byte-for-byte by
 * only overriding the adapter when `routedVia` is set.
 */

import { pool } from "@workspace/db";

export interface ResolvedAdapter {
  /** Effective adapter key to run (multi-portal company's when routed). */
  adapterKey: string;
  /** The multi-portal company's universityKey if routed, else null. */
  routedVia: string | null;
}

/**
 * Resolves the effective adapter key for a submission's universityKey.
 *
 * Falls back to the universityKey itself when no portal_universities row is
 * found (backward-compatible with adapterByKey/adapterForUniversity lookup).
 */
export async function resolveAdapterKey(
  universityKey: string,
): Promise<ResolvedAdapter> {
  try {
    const own = await pool.query<{
      adapter_key: string;
      routes_via: string | null;
    }>(
      `SELECT adapter_key, routes_via
         FROM portal_universities
        WHERE university_key = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [universityKey],
    );

    const ownRow = own.rows[0];
    if (!ownRow) {
      return { adapterKey: universityKey, routedVia: null };
    }

    if (!ownRow.routes_via) {
      return { adapterKey: ownRow.adapter_key, routedVia: null };
    }

    // Routed through a multi-portal company — use the company's adapter.
    const company = await pool.query<{ adapter_key: string }>(
      `SELECT adapter_key
         FROM portal_universities
        WHERE university_key = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [ownRow.routes_via],
    );

    const companyRow = company.rows[0];
    if (!companyRow) {
      // Dangling routes_via (company removed) — fail safe to own adapter,
      // exactly as the legacy NULL path would behave.
      return { adapterKey: ownRow.adapter_key, routedVia: null };
    }

    return { adapterKey: companyRow.adapter_key, routedVia: ownRow.routes_via };
  } catch {
    return { adapterKey: universityKey, routedVia: null };
  }
}
