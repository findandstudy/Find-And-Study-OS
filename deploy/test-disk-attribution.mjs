#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectDiskAttribution,
  parseDiskAttributionLimits,
  parseDiskAttributionOptIn,
  validateDiskAttributionRoots,
} from "./disk-attribution.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function createFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fasos-disk-attr-"));
  const categoryRoot = path.join(fixture, "categories");
  const roots = {
    releases: path.join(categoryRoot, "releases"),
    logs: path.join(categoryRoot, "logs"),
    storage: path.join(categoryRoot, "storage"),
  };
  for (const root of Object.values(roots))
    fs.mkdirSync(root, { recursive: true });
  return { fixture, roots };
}

test("disk attribution requires an exact opt-in and explicit bounded limits", () => {
  assert.equal(parseDiskAttributionOptIn(undefined), false);
  assert.equal(parseDiskAttributionOptIn(""), false);
  assert.equal(parseDiskAttributionOptIn("0"), false);
  assert.equal(parseDiskAttributionOptIn("1"), true);
  for (const value of ["true", "yes", "01", "2"]) {
    assert.throws(() => parseDiskAttributionOptIn(value));
  }
  assert.deepEqual(
    parseDiskAttributionLimits({
      maxEntries: "100000",
      maxDurationMs: "30000",
    }),
    { maxEntries: 100_000, maxDurationMs: 30_000 },
  );
  for (const limits of [
    { maxEntries: undefined, maxDurationMs: "1000" },
    { maxEntries: "0", maxDurationMs: "1000" },
    { maxEntries: "010", maxDurationMs: "1000" },
    { maxEntries: "100001", maxDurationMs: "1000" },
    { maxEntries: "100", maxDurationMs: "30001" },
    { maxEntries: "100", maxDurationMs: "1e3" },
  ]) {
    assert.throws(() => parseDiskAttributionLimits(limits));
  }
});

test("disk attribution accepts only fixed, non-overlapping, narrow roots", () => {
  const { fixture, roots } = createFixture();
  try {
    const validated = validateDiskAttributionRoots(roots);
    assert.deepEqual(
      validated.map(({ category }) => category),
      ["releases", "logs", "storage"],
    );
    assert.throws(
      () => validateDiskAttributionRoots({ ...roots, unknown: roots.logs }),
      /unsupported category/,
    );
    assert.throws(() => {
      const nested = path.join(roots.releases, "nested");
      fs.mkdirSync(nested);
      return validateDiskAttributionRoots({
        releases: roots.releases,
        logs: nested,
      });
    }, /must not overlap/);
    assert.throws(
      () =>
        validateDiskAttributionRoots({ releases: path.parse(fixture).root }),
      /too broad/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("disk attribution emits category aggregates without names or contents", () => {
  const { fixture, roots } = createFixture();
  const sensitiveName = "student-name-must-not-be-emitted.pdf";
  const sensitiveContent = "private-content-must-not-be-emitted";
  try {
    fs.mkdirSync(path.join(roots.releases, "release-a"));
    fs.writeFileSync(
      path.join(roots.releases, "release-a", "app.bin"),
      "release-bytes",
    );
    fs.writeFileSync(path.join(roots.logs, "api.log"), "log-bytes");
    fs.mkdirSync(path.join(roots.storage, "private"));
    const privateFile = path.join(roots.storage, "private", sensitiveName);
    fs.writeFileSync(privateFile, sensitiveContent);
    fs.linkSync(
      privateFile,
      path.join(roots.storage, "private", "second-hardlink-must-not-leak.bin"),
    );

    const result = collectDiskAttribution({
      roots,
      maxEntries: 20,
      maxDurationMs: 5_000,
    });
    assert.equal(result.complete, true);
    assert.equal(result.processedEntries, 9);
    assert.deepEqual(Object.keys(result.categories), [
      "releases",
      "logs",
      "storage",
    ]);
    assert.equal(result.categories.releases.files, 1);
    assert.equal(result.categories.logs.files, 1);
    assert.equal(result.categories.storage.files, 2);
    assert.equal(result.categories.storage.hardLinkReferences, 1);
    assert.equal(
      result.categories.storage.logicalFileBytes,
      String(Buffer.byteLength(sensitiveContent) * 2),
    );
    assert.match(result.categories.storage.allocatedBytes, /^\d+$/);
    assert.match(result.categories.storage.filesystemTotalBytes, /^[1-9]\d*$/);
    assert.doesNotMatch(
      JSON.stringify(result),
      /student-name|private-content|second-hardlink|app\.bin|api\.log|fasos-disk-attr/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("disk attribution fails before exceeding entry or duration budgets", () => {
  const { fixture, roots } = createFixture();
  const sensitiveName = "sensitive-filename-must-not-leak.txt";
  try {
    fs.writeFileSync(path.join(roots.logs, sensitiveName), "fixture");
    assert.throws(
      () =>
        collectDiskAttribution({
          roots,
          maxEntries: 3,
          maxDurationMs: 5_000,
        }),
      (error) => {
        assert.match(error.message, /entry budget/);
        assert.doesNotMatch(error.message, /sensitive-filename/);
        return true;
      },
    );
    let clock = 0;
    assert.throws(
      () =>
        collectDiskAttribution({
          roots,
          maxEntries: 20,
          maxDurationMs: 50,
          now: () => {
            clock += 100;
            return clock;
          },
        }),
      /duration budget/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("disk attribution is streaming and exposes no write, content-read or shell surface", () => {
  const source = fs.readFileSync(
    path.join(here, "disk-attribution.mjs"),
    "utf8",
  );
  assert.match(source, /opendirSync/);
  assert.match(source, /\.readSync\(\)/);
  assert.doesNotMatch(source, /readdirSync/);
  assert.doesNotMatch(source, /node:child_process|execFile|spawn/);
  assert.doesNotMatch(source, /\breadFile(?:Sync)?\s*\(/);
  assert.doesNotMatch(
    source,
    /\b(?:writeFile|appendFile|truncate|unlink|rename|chmod|chown|mkdir|rmdir)(?:Sync)?\s*\(/,
  );
});
