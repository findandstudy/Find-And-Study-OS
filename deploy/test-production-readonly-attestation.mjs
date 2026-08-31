#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertReadOnlyOptIn,
  collectPrivateTreeInventory,
  isWithin,
  parseProcessInventory,
  safeErrorMessage,
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
  assert.match(source, /method: "GET"/);
  assert.match(source, /execFileSync\("ps", \["-eo"/);
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
  assert.match(migrationVerifier, /ROLLBACK/);
  assert.doesNotMatch(
    migrationVerifier,
    /\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/,
  );
});
