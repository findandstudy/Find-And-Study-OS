#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { validateMigrationLedger } from "./validate-migrations.mjs";
import {
  readExpectedMigrations,
  verifyDatabaseMigrationState,
} from "./verify-migration-state.mjs";

const EXPECTED_PNPM_VERSION = "10.33.2";
const SOURCE_PROBE_TIMEOUT_MS = 10_000;
const ADVISORY_LOCK_KEY = "fasos-staging-reviewed-migrations-v1";

function fail(message) {
  throw new Error(`[staging-migration] BLOCKED: ${message}`);
}

function canonicalCount(value, label) {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value ?? "")) {
    fail(`${label} must be a canonical non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(`${label} is outside the safe range`);
  return parsed;
}

function parseStagingTarget(rawUrl) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    fail("DATABASE_URL is malformed");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol)) {
    fail("DATABASE_URL must use PostgreSQL");
  }
  if ([...target.searchParams.keys()].length > 0) {
    fail("DATABASE_URL query parameters are forbidden");
  }
  const port = Number(target.port || "5432");
  if (
    target.hostname !== "127.0.0.1" ||
    target.pathname !== "/fasos_staging" ||
    target.username !== "fas_migrator" ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    fail(
      "staging migrations require fas_migrator on 127.0.0.1 and the exact fasos_staging database",
    );
  }
  return { target, port };
}

function exactSourceCommit(expectedCommit) {
  if (!/^[0-9a-f]{40}$/.test(expectedCommit ?? "")) {
    fail("MIGRATION_EXPECTED_SOURCE_COMMIT must be a lowercase 40-character commit");
  }
  let head;
  let trackedStatus;
  try {
    head = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      encoding: "utf8",
      timeout: SOURCE_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    trackedStatus = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=no"],
      {
        encoding: "utf8",
        timeout: SOURCE_PROBE_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    fail("exact source provenance could not be read within the hard timeout");
  }
  if (head !== expectedCommit) fail("source HEAD does not match the approved commit");
  if (trackedStatus) fail("tracked source worktree is not clean");
  return head;
}

function pnpmInvocation(args) {
  const explicitCli = process.env.FAS_REVIEWED_PNPM_CLI?.trim();
  if (explicitCli) {
    if (
      !path.isAbsolute(explicitCli) ||
      path.basename(explicitCli).toLowerCase() !== "pnpm.cjs"
    ) {
      fail("FAS_REVIEWED_PNPM_CLI must be an absolute pnpm.cjs path");
    }
    return { command: process.execPath, args: [explicitCli, ...args] };
  }
  return { command: "pnpm", args };
}

function runPnpm(args, options = {}) {
  const invocation = pnpmInvocation(args);
  return spawnSync(invocation.command, invocation.args, {
    ...options,
    env: process.env,
  });
}

async function run() {
  if (process.env.ALLOW_STAGING_MIGRATIONS !== "true") {
    fail("ALLOW_STAGING_MIGRATIONS=true is required");
  }
  if (process.env.MIGRATION_TARGET_ENV !== "staging") {
    fail("MIGRATION_TARGET_ENV=staging is required");
  }
  if (
    !/^stg-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$/.test(
      process.env.MIGRATION_STAGING_CHANGE_ID ?? "",
    )
  ) {
    fail("MIGRATION_STAGING_CHANGE_ID must bind the UTC change and source commit");
  }
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is required");
  const { port } = parseStagingTarget(process.env.DATABASE_URL);
  if (
    process.env.MIGRATION_CONFIRMED_HOST !== "127.0.0.1" ||
    process.env.MIGRATION_CONFIRMED_PORT !== String(port) ||
    process.env.MIGRATION_CONFIRMED_DATABASE !== "fasos_staging" ||
    process.env.MIGRATION_CONFIRMED_USER !== "fas_migrator"
  ) {
    fail("confirmed client target identity does not match DATABASE_URL exactly");
  }
  const expectedCommit = exactSourceCommit(
    process.env.MIGRATION_EXPECTED_SOURCE_COMMIT,
  );
  if (!process.env.MIGRATION_STAGING_CHANGE_ID.endsWith(expectedCommit.slice(0, 12))) {
    fail("MIGRATION_STAGING_CHANGE_ID is not bound to the approved source commit");
  }

  const expectedBefore = canonicalCount(
    process.env.MIGRATION_EXPECTED_APPLIED_COUNT,
    "MIGRATION_EXPECTED_APPLIED_COUNT",
  );
  const expectedMigrations = readExpectedMigrations();
  if (expectedBefore > expectedMigrations.length) {
    fail("expected applied count exceeds the reviewed ledger");
  }
  if (
    expectedBefore > 0 &&
    !/^staging-backup-[0-9]{8}T[0-9]{6}Z-[a-zA-Z0-9._-]{8,80}$/.test(
      process.env.MIGRATION_STAGING_BACKUP_ID ?? "",
    )
  ) {
    fail("an exact staging backup attestation is required for non-fresh adoption");
  }

  validateMigrationLedger();
  const cwd = path.dirname(fileURLToPath(import.meta.url));
  const versionResult = runPnpm(["--version"], { cwd, encoding: "utf8" });
  if (
    versionResult.status !== 0 ||
    versionResult.stdout?.trim() !== EXPECTED_PNPM_VERSION
  ) {
    fail(`reviewed staging migrations require pnpm ${EXPECTED_PNPM_VERSION}`);
  }

  const identityClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "fasos-staging-migration-adoption",
  });
  await identityClient.connect();
  let lockHeld = false;
  try {
    const identity = await identityClient.query(
      "SELECT current_database() AS database_name, current_user AS user_name, host(inet_server_addr()) AS server_address, inet_server_port()::integer AS server_port, role_row.rolsuper, role_row.rolcreatedb, role_row.rolcreaterole, role_row.rolinherit, role_row.rolreplication, role_row.rolbypassrls, role_row.rolcanlogin, EXISTS (SELECT 1 FROM pg_auth_members AS membership WHERE membership.member = role_row.oid) AS has_role_membership FROM pg_roles AS role_row WHERE role_row.rolname = current_user",
    );
    const row = identity.rows[0];
    if (
      row?.database_name !== "fasos_staging" ||
      row?.user_name !== "fas_migrator" ||
      row?.server_address !== process.env.MIGRATION_CONFIRMED_SERVER_ADDRESS ||
      String(row?.server_port) !== process.env.MIGRATION_CONFIRMED_SERVER_PORT
    ) {
      fail("PostgreSQL-reported database identity does not match the confirmation");
    }
    if (
      row?.rolsuper !== false ||
      row?.rolcreatedb !== false ||
      row?.rolcreaterole !== false ||
      row?.rolinherit !== false ||
      row?.rolreplication !== false ||
      row?.rolbypassrls !== false ||
      row?.rolcanlogin !== true ||
      row?.has_role_membership !== false
    ) {
      fail("migrator must be a direct least-privilege LOGIN with no memberships");
    }
    const lock = await identityClient.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [ADVISORY_LOCK_KEY],
    );
    if (lock.rows[0]?.locked !== true) fail("another staging migration holds the lock");
    lockHeld = true;

    const before = await verifyDatabaseMigrationState();
    if (before.applied !== expectedBefore) {
      fail("database ledger count does not match the approved pre-state");
    }
    if (before.databaseIdentity.name !== "fasos_staging") {
      fail("pre-state verification resolved a different database");
    }

    const result = runPnpm(
      ["exec", "drizzle-kit", "migrate", "--config", "./drizzle.config.ts"],
      { cwd, stdio: "inherit" },
    );
    if (result.error || result.status !== 0) {
      fail("reviewed migration process failed");
    }

    const after = await verifyDatabaseMigrationState();
    if (
      after.state !== "compatible" ||
      after.applied !== expectedMigrations.length ||
      after.databaseIdentity.name !== "fasos_staging"
    ) {
      fail("post-state is not the exact reviewed migration ledger");
    }
    const sameExecutor = await identityClient.query(
      "SELECT current_database() AS database_name, current_user AS user_name, host(inet_server_addr()) AS server_address, inet_server_port()::integer AS server_port",
    );
    const finalIdentity = sameExecutor.rows[0];
    if (
      finalIdentity?.database_name !== "fasos_staging" ||
      finalIdentity?.user_name !== "fas_migrator" ||
      finalIdentity?.server_address !==
        process.env.MIGRATION_CONFIRMED_SERVER_ADDRESS ||
      String(finalIdentity?.server_port) !==
        process.env.MIGRATION_CONFIRMED_SERVER_PORT
    ) {
      fail("migration executor identity changed during adoption");
    }
    console.log(
      `[staging-migration] PASS: ${after.applied}/${expectedMigrations.length} migrations at ${expectedCommit}`,
    );
  } finally {
    if (lockHeld) {
      try {
        await identityClient.query("SELECT pg_advisory_unlock(hashtext($1))", [
          ADVISORY_LOCK_KEY,
        ]);
      } catch {}
    }
    await identityClient.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { canonicalCount, parseStagingTarget, run };
