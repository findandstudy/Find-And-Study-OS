#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateMigrationLedger } from "./validate-migrations.mjs";
import { verifyDatabaseMigrationState } from "./verify-migration-state.mjs";

if (process.env.ALLOW_REVIEWED_MIGRATIONS !== "true") {
  console.error(
    "[migration] BLOCKED: ALLOW_REVIEWED_MIGRATIONS=true is required",
  );
  process.exit(1);
}
validateMigrationLedger();
const state = await verifyDatabaseMigrationState();
console.log(
  `[migration] Database preflight: ${state.state}; ${state.applied} applied migrations`,
);
const cwd = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(
  "pnpm",
  ["exec", "drizzle-kit", "migrate", "--config", "./drizzle.config.ts"],
  {
    cwd,
    stdio: "inherit",
    env: process.env,
  },
);
process.exit(result.status ?? 1);
