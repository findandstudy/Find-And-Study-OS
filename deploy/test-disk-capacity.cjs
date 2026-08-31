#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  MIN_AVAILABLE_BASIS_POINTS,
  MIN_AVAILABLE_BYTES,
  validateCapacity,
} = require("./disk-capacity-preflight.cjs");

const GIBIBYTE = 1024n * 1024n * 1024n;

test("hard deployment reserve is fixed at 15 GiB and 15 percent", () => {
  assert.equal(MIN_AVAILABLE_BYTES, 15n * GIBIBYTE);
  assert.equal(MIN_AVAILABLE_BASIS_POINTS, 1500n);
  assert.deepEqual(
    validateCapacity({
      label: "RELEASES_DIR",
      blockSize: 1n,
      totalBlocks: 100n * GIBIBYTE,
      availableBlocks: 15n * GIBIBYTE,
    }),
    {
      totalBytes: 100n * GIBIBYTE,
      availableBytes: 15n * GIBIBYTE,
      availableBasisPoints: 1500n,
    },
  );
});

test("capacity rejects insufficient absolute bytes or percentage", () => {
  assert.throws(
    () =>
      validateCapacity({
        label: "RELEASES_DIR",
        blockSize: 1n,
        totalBlocks: 100n * GIBIBYTE,
        availableBlocks: 15n * GIBIBYTE - 1n,
      }),
    /less than the hard 15 GiB/,
  );
  assert.throws(
    () =>
      validateCapacity({
        label: "STORAGE_LOCAL_DIR",
        blockSize: 1n,
        totalBlocks: 200n * GIBIBYTE,
        availableBlocks: 20n * GIBIBYTE,
      }),
    /less than the hard 15%/,
  );
});

test("capacity rejects malformed or impossible filesystem metadata", () => {
  for (const input of [
    {
      blockSize: 0n,
      totalBlocks: 100n,
      availableBlocks: 20n,
    },
    {
      blockSize: 1n,
      totalBlocks: 100n,
      availableBlocks: 101n,
    },
    {
      blockSize: 1,
      totalBlocks: 100n,
      availableBlocks: 20n,
    },
    {
      blockSize: 1n,
      totalBlocks: -1n,
      availableBlocks: 0n,
    },
  ]) {
    assert.throws(() => validateCapacity({ label: "LOG_DIR", ...input }));
  }
});

test("deploy invokes the non-bypassable disk gate before release creation and build", () => {
  const deploy = readFileSync(
    path.join(__dirname, "deploy.sh"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const gateIndex = deploy.indexOf("disk-capacity-preflight.cjs");
  assert.ok(gateIndex >= 0);
  assert.ok(gateIndex < deploy.indexOf('mkdir "$RELEASE_DIR"'));
  assert.ok(gateIndex < deploy.indexOf("bash deploy/build-production.sh"));
  assert.doesNotMatch(
    deploy,
    /SKIP_DISK_CAPACITY|BYPASS_DISK_CAPACITY|ALLOW_LOW_DISK/,
  );
});

test("disk gate reads only filesystem capacity metadata", () => {
  const source = readFileSync(
    path.join(__dirname, "disk-capacity-preflight.cjs"),
    "utf8",
  );
  assert.match(source, /statfsSync/);
  assert.doesNotMatch(
    source,
    /\b(?:writeFile|appendFile|truncate|unlink|rename|chmod|chown|mkdir|rmdir)Sync\s*\(/,
  );
  assert.doesNotMatch(source, /execFile|spawn|systemctl|pm2|sudo/);
  assert.doesNotMatch(source, /process\.env\.(?:MIN|SKIP|BYPASS|ALLOW)/);
});
