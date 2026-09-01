#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  parsePrivateScanDurationLimit,
  parsePrivateScanLimit,
  scanPrivateTree,
  validateIdentity,
  validatePrivateEntry,
  validateRuntimeEnvFile,
  validateWritableDirectory,
} = require("./runtime-boundary-preflight.cjs");

function fakeStat({ mode, uid = 1001, gid = 1001, type = "file" }) {
  return {
    mode,
    uid,
    gid,
    isDirectory: () => type === "directory",
    isFile: () => type === "file",
    isSymbolicLink: () => type === "symlink",
  };
}

test("runtime identity rejects root and actor substitution", () => {
  assert.throws(
    () =>
      validateIdentity({
        effectiveUid: 0,
        expectedUid: 0,
        serviceUser: "root",
      }),
    /must not resolve to root/,
  );
  assert.throws(
    () =>
      validateIdentity({
        effectiveUid: 1002,
        expectedUid: 1001,
        serviceUser: "findandstudy",
      }),
    /does not match/,
  );
  assert.doesNotThrow(() =>
    validateIdentity({
      effectiveUid: 1001,
      expectedUid: 1001,
      serviceUser: "findandstudy",
    }),
  );
});

test("private scan limit has a canonical non-bypassable 100000-entry ceiling", () => {
  assert.equal(parsePrivateScanLimit(undefined), 100_000);
  assert.equal(parsePrivateScanLimit("100000"), 100_000);
  assert.equal(parsePrivateScanLimit("1"), 1);
  for (const value of ["", "0", "0100", "1e5", "100000.0", "100001"]) {
    assert.throws(() => parsePrivateScanLimit(value));
  }
});

test("private scan duration has a canonical non-bypassable 30000ms ceiling", () => {
  assert.equal(parsePrivateScanDurationLimit(undefined), 30_000);
  assert.equal(parsePrivateScanDurationLimit("30000"), 30_000);
  assert.equal(parsePrivateScanDurationLimit("1"), 1);
  for (const value of ["", "0", "0300", "3e4", "30000.0", "30001"]) {
    assert.throws(() => parsePrivateScanDurationLimit(value));
  }
});

test("private scan streams directory entries within the discovery budget", () => {
  const source = readFileSync(
    path.join(__dirname, "runtime-boundary-preflight.cjs"),
    "utf8",
  );
  assert.match(source, /opendirSync/);
  assert.match(source, /\.readSync\(\)/);
  assert.doesNotMatch(source, /readdirSync/);
  assert.match(source, /directories \+ files \+ pending\.length >= maxEntries/);
  assert.match(source, /RUNTIME_PRIVATE_SCAN_MAX_DURATION_MS/);
});

test("deploy invokes the runtime boundary before release creation or build", () => {
  const deploy = readFileSync(
    path.join(__dirname, "deploy.sh"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const boundaryIndex = deploy.indexOf("runtime-boundary-preflight.cjs");
  assert.ok(boundaryIndex >= 0);
  assert.ok(boundaryIndex < deploy.indexOf('mkdir "$RELEASE_DIR"'));
  assert.ok(boundaryIndex < deploy.indexOf("bash deploy/build-production.sh"));
  assert.doesNotMatch(
    deploy,
    /ALLOW_ROOT|SKIP_RUNTIME_BOUNDARY|BYPASS_RUNTIME/,
  );
});

test("runtime directories reject foreign ownership and broad permissions", () => {
  assert.doesNotThrow(() =>
    validateWritableDirectory({
      label: "LOG_DIR",
      stat: fakeStat({ mode: 0o40750, type: "directory" }),
      expectedUid: 1001,
      expectedGid: 1001,
    }),
  );
  assert.throws(
    () =>
      validateWritableDirectory({
        label: "LOG_DIR",
        stat: fakeStat({ mode: 0o40755, type: "directory" }),
        expectedUid: 1001,
        expectedGid: 1001,
      }),
    /other VPS users/,
  );
  assert.throws(
    () =>
      validateWritableDirectory({
        label: "LOG_DIR",
        stat: fakeStat({ mode: 0o40750, uid: 0, type: "directory" }),
        expectedUid: 1001,
        expectedGid: 1001,
      }),
    /owned by the runtime service/,
  );
});

test("runtime env accepts only service-owned 0600 or root:service 0640", () => {
  assert.doesNotThrow(() =>
    validateRuntimeEnvFile({
      stat: fakeStat({ mode: 0o100600 }),
      expectedUid: 1001,
      expectedGid: 1001,
    }),
  );
  assert.doesNotThrow(() =>
    validateRuntimeEnvFile({
      stat: fakeStat({ mode: 0o100640, uid: 0 }),
      expectedUid: 1001,
      expectedGid: 1001,
    }),
  );
  assert.throws(
    () =>
      validateRuntimeEnvFile({
        stat: fakeStat({ mode: 0o100644, uid: 0 }),
        expectedUid: 1001,
        expectedGid: 1001,
      }),
    /service-owned 600 or root:service 640/,
  );
  assert.throws(() =>
    validateRuntimeEnvFile({
      stat: fakeStat({ mode: 0o100640 }),
      expectedUid: 1001,
      expectedGid: 1001,
    }),
  );
});

test("private objects reject 0644, 0755, executables, symlinks and foreign owners", () => {
  assert.doesNotThrow(() =>
    validatePrivateEntry({
      label: "document.pdf",
      stat: fakeStat({ mode: 0o100600 }),
      expectedUid: 1001,
      expectedGid: 1001,
    }),
  );
  for (const stat of [
    fakeStat({ mode: 0o100644 }),
    fakeStat({ mode: 0o40755, type: "directory" }),
    fakeStat({ mode: 0o100700 }),
    fakeStat({ mode: 0o120777, type: "symlink" }),
    fakeStat({ mode: 0o100600, uid: 0 }),
  ]) {
    assert.throws(() =>
      validatePrivateEntry({
        label: "unsafe-entry",
        stat,
        expectedUid: 1001,
        expectedGid: 1001,
      }),
    );
  }
});

test(
  "private tree scan is bounded and rejects links without following them",
  { skip: process.platform === "win32" },
  () => {
    const fixture = mkdtempSync(path.join(tmpdir(), "fasos-runtime-boundary-"));
    const nested = path.join(fixture, "nested");
    const document = path.join(nested, "document.pdf");
    mkdirSync(nested, { mode: 0o700 });
    writeFileSync(document, "fixture-only\n", { mode: 0o600 });
    chmodSync(fixture, 0o700);
    const expectedUid = process.geteuid();
    const expectedGid = process.getegid();
    try {
      assert.deepEqual(
        scanPrivateTree({
          privateRoot: fixture,
          expectedUid,
          expectedGid,
          maxEntries: 3,
        }),
        { directories: 2, files: 1 },
      );
      assert.throws(
        () =>
          scanPrivateTree({
            privateRoot: fixture,
            expectedUid,
            expectedGid,
            maxEntries: 2,
          }),
        /bounded limit/,
      );
      let currentTime = 0;
      assert.throws(
        () =>
          scanPrivateTree({
            privateRoot: fixture,
            expectedUid,
            expectedGid,
            maxEntries: 3,
            maxDurationMs: 50,
            now: () => {
              currentTime += 25;
              return currentTime;
            },
          }),
        /bounded duration/,
      );
      const link = path.join(fixture, "outside-link");
      symlinkSync(tmpdir(), link, "dir");
      assert.throws(
        () =>
          scanPrivateTree({
            privateRoot: fixture,
            expectedUid,
            expectedGid,
            maxEntries: 4,
          }),
        /must not be a symbolic link/,
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);
