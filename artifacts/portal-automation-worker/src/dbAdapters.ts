import { pool } from "@workspace/db";
import { createDeclarativeAdapter, type DeclarativeConfig } from "@workspace/portal-adapters";

/**
 * Loads DB-stored declarative adapters (portal_adapters, kind='declarative')
 * and builds a runnable UniversityAdapter from each row's config_json.
 *
 * Code adapters in the static registry always take priority; this is the
 * fallback so that adapters CREATED/UPLOADED via the admin panel actually run.
 *
 * config_json should be a DeclarativeConfig (loginUrl, credentials, steps,
 * submitCheck). key/label/matches fall back to the row's own columns.
 */
export async function loadDbAdapter(
  key: string,
  universityName: string,
): Promise<ReturnType<typeof createDeclarativeAdapter> | null> {
  try {
    const { rows } = await pool.query(
      "SELECT key, label, base_url, match_names, config_json FROM portal_adapters WHERE kind='declarative' AND is_active=true AND deleted_at IS NULL",
    );
    for (const r of rows as any[]) {
      const cfg = (r.config_json ?? {}) as Record<string, unknown>;
      const config = {
        key: r.key,
        label: r.label,
        matches: String(r.match_names ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        loginUrl: r.base_url,
        ...cfg,
      } as DeclarativeConfig;
      let adapter;
      try {
        adapter = createDeclarativeAdapter(config);
      } catch (e) {
        console.error(`[db-adapter] invalid config for '${r.key}':`, e instanceof Error ? e.message : String(e));
        continue;
      }
      if (r.key === key || adapter.matches(universityName)) {
        console.log(`[db-adapter] using declarative adapter '${r.key}' for submission`);
        return adapter;
      }
    }
  } catch (e) {
    console.error("[db-adapter] load failed:", e instanceof Error ? e.message : String(e));
  }
  return null;
}
