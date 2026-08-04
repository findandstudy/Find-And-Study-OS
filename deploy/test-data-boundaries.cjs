#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const preflight = path.join(__dirname, "data-path-preflight.cjs");

function runPreflight(releaseDir, storageDir) {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "fasos-data-preflight-"));
  const input = path.join(fixtureDir, "input.json");
  writeFileSync(input, JSON.stringify({ releaseDir, storageDir }));
  const result = spawnSync(process.execPath, [preflight, "--input", input], {
    cwd: root,
    encoding: "utf8",
  });
  rmSync(fixtureDir, { recursive: true, force: true });
  return result;
}

test("Git ignores runtime data and secret env fixtures but keeps examples trackable", () => {
  const fixture = mkdtempSync(path.join(root, ".data-boundary-test-"));
  const relative = path.relative(root, fixture);
  const ignored = [
    ".env",
    ".env.production",
    "storage/file.bin",
    "uploads/file.bin",
    "logs/app.log",
    "backups/db.dump",
    "dump/export.backup",
  ];
  const examples = [".env.example", "nested/.env.example"];
  try {
    for (const name of [...ignored, ...examples]) {
      const target = path.join(fixture, name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, "fixture-only\n");
    }
    for (const name of ignored) {
      const result = spawnSync("git", ["check-ignore", "-q", path.join(relative, name)], { cwd: root });
      assert.equal(result.status, 0, `${name} must be ignored`);
    }
    for (const name of examples) {
      const result = spawnSync("git", ["check-ignore", "-q", path.join(relative, name)], { cwd: root });
      assert.equal(result.status, 1, `${name} must remain trackable`);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("preflight rejects storage inside a release and accepts external absolute storage", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "fasos-data-paths-"));
  const release = path.join(fixture, "release");
  const nestedStorage = path.join(release, "storage");
  const externalStorage = path.join(fixture, "persistent-storage");
  mkdirSync(nestedStorage, { recursive: true });
  mkdirSync(externalStorage, { recursive: true });
  try {
    const rejected = runPreflight(release, nestedStorage);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /outside the code release directory/);
    const accepted = runPreflight(release, externalStorage);
    assert.equal(accepted.status, 0, accepted.stderr);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("deploy scripts contain no destructive clean or root rsync delete", () => {
  const scripts = execFileSync("rg", ["--files", "-g", "*.sh", "-g", "*.bash"], {
    cwd: root,
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);
  for (const script of scripts) {
    const source = readFileSync(path.join(root, script), "utf8");
    assert.doesNotMatch(source, /git\s+clean\s+[^\n]*-fdx/);
    assert.doesNotMatch(source, /rsync\s+[^\n]*--delete[^\n]*(?:\s\/\s|\s\$\{?HOME\}?\s)/);
  }
  const deploy = readFileSync(path.join(root, "deploy/deploy.sh"), "utf8");
  assert.ok(deploy.indexOf("node deploy/data-path-preflight.cjs") < deploy.indexOf("pnpm install"));
});
