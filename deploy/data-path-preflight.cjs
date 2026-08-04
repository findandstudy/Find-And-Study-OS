#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  throw new Error(`[data-path-preflight] ${message}`);
}

function existingRealpath(target, label) {
  if (!fs.existsSync(target)) fail(`${label} does not exist`);
  return fs.realpathSync(target);
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateDataPaths({ releaseDir, storageDir }) {
  const release = existingRealpath(path.resolve(releaseDir), "release directory");
  if (!storageDir) fail("STORAGE_LOCAL_DIR is required when STORAGE_DRIVER=local");
  if (!path.isAbsolute(storageDir)) fail("STORAGE_LOCAL_DIR must be an absolute path");
  const storage = existingRealpath(storageDir, "storage directory");
  if (storage === release || isWithin(release, storage)) {
    fail("STORAGE_LOCAL_DIR must be outside the code release directory");
  }
  return { release, storage };
}

function main() {
  const inputIndex = process.argv.indexOf("--input");
  const inputPath = inputIndex === -1 ? undefined : process.argv[inputIndex + 1];
  let releaseDir = path.resolve(__dirname, "..");
  let storageDir = process.env.STORAGE_LOCAL_DIR;

  if (inputPath) {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
    releaseDir = fixture.releaseDir;
    storageDir = fixture.storageDir;
  } else if ((process.env.STORAGE_DRIVER ?? "replit") !== "local") {
    console.log("[data-path-preflight] OK: non-local storage driver; no release-local persistent path");
    return;
  }

  validateDataPaths({ releaseDir, storageDir });
  console.log("[data-path-preflight] OK: persistent storage is absolute and outside the release directory");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { isWithin, validateDataPaths };
