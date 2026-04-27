/**
 * Playwright e2e database teardown.
 *
 * Restores the web_form integration to the state that was saved by
 * e2e-db-setup.ts. If the integration did not exist before the test run it is
 * deleted; otherwise its previous config/isEnabled are restored.
 *
 * Run via playwright globalTeardown (see playwright.config.ts).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, integrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const stateFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../e2e-db-state.json",
);

async function main() {
  if (!fs.existsSync(stateFile)) {
    console.log("[e2e-teardown] No saved state found — skipping restore");
    process.exit(0);
  }

  const raw = fs.readFileSync(stateFile, "utf8");
  const original = JSON.parse(raw);
  fs.unlinkSync(stateFile);

  if (original === null) {
    await db
      .delete(integrationsTable)
      .where(eq(integrationsTable.key, "web_form"));
    console.log("[e2e-teardown] Removed web_form integration (it did not exist before the test)");
  } else {
    await db
      .update(integrationsTable)
      .set({
        isEnabled: original.isEnabled,
        config: original.config,
      })
      .where(eq(integrationsTable.key, "web_form"));
    console.log("[e2e-teardown] Restored web_form integration to pre-test state");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[e2e-teardown] error:", err);
  process.exit(1);
});
