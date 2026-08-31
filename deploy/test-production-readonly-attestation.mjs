#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertExpectedProductionState,
  assertReadOnlyOptIn,
  collectPrivateTreeInventory,
  isWithin,
  parseProductionExpectations,
  parseProcessInventory,
  safeErrorMessage,
  validateSourceProvenance,
} from "./production-readonly-attestation.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("explicit read-only production attestation opt-in is mandatory", () => {
  assert.throws(
    () => assertReadOnlyOptIn(undefined),
    /READ_ONLY=1 is required/,
  );
  assert.throws(() => assertReadOnlyOptIn("true"), /READ_ONLY=1 is required/);
  assert.doesNotThrow(() => assertReadOnlyOptIn("1"));
});

test("database connection strings are redacted from error output", () => {
  const databaseUrl =
    "postgresql://db_user:super-secret@example.invalid/fasos_apply";
  const message = safeErrorMessage(
    new Error(`connection failed: ${databaseUrl}`),
    databaseUrl,
  );
  assert.doesNotMatch(message, /super-secret|db_user/);
  assert.match(message, /REDACTED/);
});

test("production expectations require an exact release and canonical migration prefix", () => {
  assert.deepEqual(
    parseProductionExpectations({
      expectedReleaseId: "20260831T115424Z-6dca1f951590",
      expectedAppliedMigrations: "66",
      expectedDatabaseName: "fasos_apply",
      expectedDatabaseAddress: "127.0.0.1",
      expectedDatabasePort: "5432",
    }),
    {
      releaseId: "20260831T115424Z-6dca1f951590",
      appliedMigrations: 66,
      database: {
        name: "fasos_apply",
        address: "127.0.0.1",
        port: 5432,
      },
    },
  );
  for (const expectedReleaseId of ["", "../current", "/absolute", "a/b"]) {
    assert.throws(
      () =>
        parseProductionExpectations({
          expectedReleaseId,
          expectedAppliedMigrations: "66",
          expectedDatabaseName: "fasos_apply",
          expectedDatabaseAddress: "127.0.0.1",
          expectedDatabasePort: "5432",
        }),
      /EXPECTED_RELEASE_ID/,
    );
  }
  for (const expectedAppliedMigrations of ["", "066", "-1", "66.0", "1e2"]) {
    assert.throws(
      () =>
        parseProductionExpectations({
          expectedReleaseId: "release-1",
          expectedAppliedMigrations,
          expectedDatabaseName: "fasos_apply",
          expectedDatabaseAddress: "127.0.0.1",
          expectedDatabasePort: "5432",
        }),
      /EXPECTED_APPLIED_MIGRATIONS/,
    );
  }
});

test("database expectations reject ambiguous names, DNS aliases, and invalid ports", () => {
  const valid = {
    expectedReleaseId: "release-1",
    expectedAppliedMigrations: "66",
    expectedDatabaseName: "fasos_apply",
    expectedDatabaseAddress: "127.0.0.1",
    expectedDatabasePort: "5432",
  };
  for (const expectedDatabaseName of ["", "FASOS_APPLY", "fasos-apply"]) {
    assert.throws(
      () => parseProductionExpectations({ ...valid, expectedDatabaseName }),
      /EXPECTED_DATABASE_NAME/,
    );
  }
  for (const expectedDatabaseAddress of ["", "localhost", "db.internal"]) {
    assert.throws(
      () => parseProductionExpectations({ ...valid, expectedDatabaseAddress }),
      /EXPECTED_DATABASE_ADDRESS/,
    );
  }
  for (const expectedDatabasePort of ["", "05432", "0", "65536"]) {
    assert.throws(
      () => parseProductionExpectations({ ...valid, expectedDatabasePort }),
      /EXPECTED_DATABASE_PORT/,
    );
  }
});

test("attestation rejects unexpected live release or migration-prefix drift", () => {
  const expectations = {
    releaseId: "expected-release",
    appliedMigrations: 66,
    database: { name: "fasos_apply", address: "127.0.0.1", port: 5432 },
  };
  assert.doesNotThrow(() =>
    assertExpectedProductionState({
      expectations,
      actualReleaseId: "expected-release",
      actualAppliedMigrations: 66,
      repositoryMigrations: 82,
      actualDatabaseIdentity: expectations.database,
    }),
  );
  assert.throws(
    () =>
      assertExpectedProductionState({
        expectations,
        actualReleaseId: "unexpected-release",
        actualAppliedMigrations: 66,
        repositoryMigrations: 82,
        actualDatabaseIdentity: expectations.database,
      }),
    /does not match the explicitly expected release/,
  );
  assert.throws(
    () =>
      assertExpectedProductionState({
        expectations,
        actualReleaseId: "expected-release",
        actualAppliedMigrations: 67,
        repositoryMigrations: 82,
        actualDatabaseIdentity: expectations.database,
      }),
    /does not match the explicitly expected prefix/,
  );
  assert.throws(
    () =>
      assertExpectedProductionState({
        expectations: { ...expectations, appliedMigrations: 83 },
        actualReleaseId: "expected-release",
        actualAppliedMigrations: 83,
        repositoryMigrations: 82,
        actualDatabaseIdentity: expectations.database,
      }),
    /exceeds the reviewed source ledger/,
  );
});

test("attestation rejects a different database name, server address, or port", () => {
  const expectations = {
    releaseId: "expected-release",
    appliedMigrations: 66,
    database: { name: "fasos_apply", address: "127.0.0.1", port: 5432 },
  };
  for (const actualDatabaseIdentity of [
    { ...expectations.database, name: "postgres" },
    { ...expectations.database, address: "127.0.0.2" },
    { ...expectations.database, port: 5433 },
  ]) {
    assert.throws(
      () =>
        assertExpectedProductionState({
          expectations,
          actualReleaseId: expectations.releaseId,
          actualAppliedMigrations: expectations.appliedMigrations,
          repositoryMigrations: 82,
          actualDatabaseIdentity,
        }),
      /database identity does not match/,
    );
  }
});

test("source provenance requires the exact reviewed commit and a clean checkout", () => {
  const reviewedCommit = "a".repeat(40);
  assert.deepEqual(
    validateSourceProvenance({
      expectedCommit: reviewedCommit,
      actualCommit: reviewedCommit,
      porcelain: "",
    }),
    { commit: reviewedCommit, worktreeClean: true },
  );
  assert.throws(
    () =>
      validateSourceProvenance({
        expectedCommit: reviewedCommit,
        actualCommit: "b".repeat(40),
        porcelain: "",
      }),
    /does not match the reviewed commit/,
  );
  assert.throws(
    () =>
      validateSourceProvenance({
        expectedCommit: reviewedCommit,
        actualCommit: reviewedCommit,
        porcelain: " M deploy\/production-readonly-attestation.mjs\n",
      }),
    /source checkout is not clean/,
  );
});

test("source provenance rejects abbreviated, uppercase, or malformed commit identities", () => {
  for (const expectedCommit of [
    "a".repeat(12),
    "A".repeat(40),
    `${"a".repeat(39)}z`,
    "",
  ]) {
    assert.throws(
      () =>
        validateSourceProvenance({
          expectedCommit,
          actualCommit: "a".repeat(40),
          porcelain: "",
        }),
      /full lowercase commit SHA/,
    );
  }
});

test("release and process paths must remain under the resolved current release", () => {
  const separator = path.sep;
  const current = path.join(
    separator,
    "opt",
    "findandstudy",
    "releases",
    "release-1",
  );
  assert.equal(isWithin(current, current), true);
  assert.equal(
    isWithin(current, path.join(current, "artifacts", "api-server")),
    true,
  );
  assert.equal(isWithin(current, path.join(current, "..", "release-2")), false);
});

test("process inventory emits only exact API/worker pid and uid/gid metadata", () => {
  const parsed = parseProcessInventory(`
    101 0 0 node /opt/findandstudy/current/artifacts/api-server/dist/index.cjs
    202 0 0 node /opt/findandstudy/current/artifacts/portal-automation-worker/src/worker.ts
    303 999 999 node /srv/unrelated/index.cjs --secret=do-not-emit
  `);
  assert.deepEqual(parsed, [
    { kind: "api", pid: 101, uid: 0, gid: 0 },
    { kind: "portalWorker", pid: 202, uid: 0, gid: 0 },
  ]);
  assert.doesNotMatch(JSON.stringify(parsed), /secret|unrelated/);
  assert.throws(
    () =>
      parseProcessInventory(`
        101 0 0 node /a/artifacts/api-server/dist/index.cjs
        102 0 0 node /b/artifacts/api-server/dist/index.cjs
        202 0 0 node /a/artifacts/portal-automation-worker/src/worker.ts
      `),
    /expected exactly one api process/,
  );
});

test("private inventory reports aggregate metadata without file names or contents", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fasos-attestation-"));
  const privateRoot = path.join(fixture, "private");
  const studentName = "student-name-must-not-be-emitted.pdf";
  fs.mkdirSync(privateRoot, { mode: 0o700 });
  fs.writeFileSync(path.join(privateRoot, studentName), "private-fixture", {
    mode: 0o600,
  });
  try {
    const inventory = collectPrivateTreeInventory({
      privateRoot,
      maxEntries: 2,
    });
    assert.equal(inventory.entries, 2);
    assert.equal(inventory.directories, 1);
    assert.equal(inventory.files, 1);
    assert.equal(
      inventory.fileBytes,
      String(Buffer.byteLength("private-fixture")),
    );
    assert.doesNotMatch(
      JSON.stringify(inventory),
      /student-name|private-fixture/,
    );
    assert.throws(
      () => collectPrivateTreeInventory({ privateRoot, maxEntries: 1 }),
      /bounded limit/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("attestation implementation exposes no mutation command or file-write surface", () => {
  const source = fs.readFileSync(
    path.join(here, "production-readonly-attestation.mjs"),
    "utf8",
  );
  const migrationVerifier = fs.readFileSync(
    path.join(here, "..", "lib", "db", "verify-migration-state.mjs"),
    "utf8",
  );
  assert.match(source, /verifyDatabaseMigrationState/);
  assert.match(source, /PRODUCTION_ATTESTATION_READ_ONLY/);
  assert.match(source, /ATTESTATION_EXPECTED_RELEASE_ID/);
  assert.match(source, /ATTESTATION_EXPECTED_APPLIED_MIGRATIONS/);
  assert.match(source, /ATTESTATION_EXPECTED_DATABASE_NAME/);
  assert.match(source, /ATTESTATION_EXPECTED_DATABASE_ADDRESS/);
  assert.match(source, /ATTESTATION_EXPECTED_DATABASE_PORT/);
  assert.match(source, /method: "GET"/);
  assert.match(source, /execFileSync\("ps", \["-eo"/);
  assert.equal((source.match(/execFileSync\(\s*"git"/g) ?? []).length, 2);
  assert.match(source, /\["-C", sourceRoot, "rev-parse", "--verify", "HEAD"\]/);
  assert.match(source, /"status",\s*"--porcelain=v1"/);
  assert.match(source, /GIT_OPTIONAL_LOCKS: "0"/);
  assert.doesNotMatch(
    source,
    /"(?:checkout|switch|reset|clean|pull|fetch|merge|rebase|commit|push)"/,
  );
  assert.doesNotMatch(
    source,
    /execFileSync\("(?:pm2|systemctl|service|sudo|sh|bash)"/,
  );
  assert.doesNotMatch(
    source,
    /\b(?:writeFile|appendFile|truncate|unlink|rename|chmod|chown|mkdir|rmdir)Sync\s*\(/,
  );
  assert.doesNotMatch(
    source,
    /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/,
  );
  assert.match(migrationVerifier, /BEGIN READ ONLY/);
  assert.match(migrationVerifier, /current_database\(\)/);
  assert.match(migrationVerifier, /inet_server_addr\(\)/);
  assert.match(migrationVerifier, /inet_server_port\(\)/);
  assert.match(migrationVerifier, /ROLLBACK/);
  assert.doesNotMatch(
    migrationVerifier,
    /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/,
  );
});
