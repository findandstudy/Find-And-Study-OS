/**
 * Playwright e2e database setup.
 *
 * Ensures the web_form integration is enabled and has NO shared secret so the
 * inbox-flow.spec.ts test can POST anonymously.  The original configuration is
 * serialized to `e2e-db-state.json` at the project root so that e2e-db-teardown
 * can restore it exactly.
 *
 * Run via playwright globalSetup (see playwright.config.ts).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, pool, integrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encryptConfig, decryptConfig } from "../src/lib/encryption";

const stateFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../e2e-db-state.json",
);

async function main() {
  const [existing] = await db
    .select()
    .from(integrationsTable)
    .where(eq(integrationsTable.key, "web_form"));

  fs.writeFileSync(stateFile, JSON.stringify(existing ?? null, null, 2), "utf8");

  if (!existing) {
    await db.insert(integrationsTable).values({
      key: "web_form",
      name: "Web Form",
      isEnabled: true,
      config: encryptConfig({}),
    });
    console.log("[e2e-setup] Created web_form integration (no secret, enabled)");
  } else {
    const cfg = decryptConfig((existing.config as Record<string, unknown>) || {});
    const cleanCfg = { ...cfg, secret: undefined };
    await db
      .update(integrationsTable)
      .set({
        isEnabled: true,
        config: encryptConfig(cleanCfg),
      })
      .where(eq(integrationsTable.key, "web_form"));
    console.log(
      "[e2e-setup] Ensured web_form integration is enabled with no secret",
    );
  }

  try {
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE '%login:%'`);
    console.log("[e2e-setup] Cleared login rate limits");
  } catch {
    console.log("[e2e-setup] rate_limits table not found, skipping clear");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[e2e-setup] error:", err);
  process.exit(1);
});
