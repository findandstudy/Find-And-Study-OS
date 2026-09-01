#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_PRIVATE_ENTRIES = 100_000;

function fail(message) {
  throw new Error(`[runtime-boundary-preflight] ${message}`);
}

function permissionBits(stat) {
  return stat.mode & 0o777;
}

function formatMode(stat) {
  return permissionBits(stat).toString(8).padStart(3, "0");
}

function validateIdentity({ effectiveUid, expectedUid, serviceUser }) {
  if (!serviceUser || !/^[a-z_][a-z0-9_-]{0,31}$/i.test(serviceUser)) {
    fail("RUNTIME_SERVICE_USER must be an explicit Unix account name");
  }
  if (serviceUser === "root" || expectedUid === 0) {
    fail("RUNTIME_SERVICE_USER must not resolve to root");
  }
  if (!Number.isInteger(effectiveUid) || effectiveUid < 0) {
    fail("effective Unix uid could not be determined");
  }
  if (effectiveUid === 0) {
    fail("deployment and PM2 ownership must not run as root");
  }
  if (effectiveUid !== expectedUid) {
    fail(
      `deploy user uid ${effectiveUid} does not match RUNTIME_SERVICE_USER uid ${expectedUid}`,
    );
  }
}

function parsePrivateScanLimit(value) {
  const raw = value ?? String(DEFAULT_MAX_PRIVATE_ENTRIES);
  if (!/^[1-9]\d*$/.test(raw)) {
    fail(
      "RUNTIME_PRIVATE_SCAN_MAX_ENTRIES must be a canonical positive integer",
    );
  }
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit > DEFAULT_MAX_PRIVATE_ENTRIES) {
    fail(
      `RUNTIME_PRIVATE_SCAN_MAX_ENTRIES must not exceed the hard ${DEFAULT_MAX_PRIVATE_ENTRIES}-entry ceiling`,
    );
  }
  return limit;
}

function validateWritableDirectory({ label, stat, expectedUid, expectedGid }) {
  if (!stat.isDirectory()) fail(`${label} must be a directory`);
  if (stat.uid !== expectedUid || stat.gid !== expectedGid) {
    fail(`${label} must be owned by the runtime service uid/gid`);
  }
  const mode = permissionBits(stat);
  if ((stat.mode & 0o7000) !== 0) {
    fail(`${label} must not carry setuid/setgid/sticky bits`);
  }
  if ((mode & 0o700) !== 0o700) {
    fail(
      `${label} owner must have read/write/execute access; found ${formatMode(stat)}`,
    );
  }
  if ((mode & 0o022) !== 0) {
    fail(
      `${label} must not be group/world writable; found ${formatMode(stat)}`,
    );
  }
  if ((mode & 0o007) !== 0) {
    fail(
      `${label} must not grant access to other VPS users; found ${formatMode(stat)}`,
    );
  }
}

function validateRuntimeEnvFile({ stat, expectedUid, expectedGid }) {
  if (!stat.isFile()) fail("RUNTIME_ENV_FILE must be a regular file");
  const mode = permissionBits(stat);
  if ((stat.mode & 0o7000) !== 0)
    fail("RUNTIME_ENV_FILE must not carry special mode bits");
  if (stat.uid === expectedUid && stat.gid === expectedGid && mode === 0o600)
    return;
  if (stat.uid === 0 && stat.gid === expectedGid && mode === 0o640) return;
  fail(
    `RUNTIME_ENV_FILE must be service-owned 600 or root:service 640; found ${formatMode(stat)}`,
  );
}

function validatePrivateEntry({ label, stat, expectedUid, expectedGid }) {
  if (stat.isSymbolicLink()) fail(`${label} must not be a symbolic link`);
  if (!stat.isDirectory() && !stat.isFile()) {
    fail(`${label} must be a regular file or directory`);
  }
  if (stat.uid !== expectedUid || stat.gid !== expectedGid) {
    fail(`${label} must be owned by the runtime service uid/gid`);
  }
  const mode = permissionBits(stat);
  if ((stat.mode & 0o7000) !== 0)
    fail(`${label} must not carry special mode bits`);
  if ((mode & 0o077) !== 0) {
    fail(
      `${label} must not grant group/other access; found ${formatMode(stat)}`,
    );
  }
  if (stat.isDirectory() && (mode & 0o700) !== 0o700) {
    fail(
      `${label} directory owner must have read/write/execute access; found ${formatMode(stat)}`,
    );
  }
  if (stat.isFile()) {
    if ((mode & 0o600) !== 0o600) {
      fail(
        `${label} file owner must have read/write access; found ${formatMode(stat)}`,
      );
    }
    if ((mode & 0o111) !== 0) {
      fail(
        `${label} private object must not be executable; found ${formatMode(stat)}`,
      );
    }
  }
}

function scanPrivateTree({
  privateRoot,
  expectedUid,
  expectedGid,
  maxEntries,
}) {
  const pending = [privateRoot];
  let directories = 0;
  let files = 0;

  while (pending.length) {
    const target = pending.pop();
    const stat = fs.lstatSync(target);
    const label = path.relative(privateRoot, target) || "PRIVATE_OBJECT_DIR";
    validatePrivateEntry({ label, stat, expectedUid, expectedGid });
    if (stat.isDirectory()) {
      directories += 1;
      for (const entry of fs.readdirSync(target))
        pending.push(path.join(target, entry));
    } else {
      files += 1;
    }
    if (directories + files > maxEntries) {
      fail(
        `private object scan exceeded the bounded limit of ${maxEntries} entries`,
      );
    }
  }

  return { directories, files };
}

function requiredAbsoluteDirectory(name) {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value))
    fail(`${name} must be an absolute path`);
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isDirectory()) fail(`${name} must be a directory`);
  return resolved;
}

function requiredAbsoluteFile(name) {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value))
    fail(`${name} must be an absolute path`);
  return fs.realpathSync(value);
}

function resolveUnixId(flag, serviceUser) {
  const raw = execFileSync("id", [flag, serviceUser], {
    encoding: "utf8",
  }).trim();
  if (!/^\d+$/.test(raw))
    fail(`could not resolve ${flag} for RUNTIME_SERVICE_USER`);
  return Number(raw);
}

function main() {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail(
      "runtime identity preflight is supported only on the Linux production host",
    );
  }

  const serviceUser = process.env.RUNTIME_SERVICE_USER;
  if (!serviceUser || !/^[a-z_][a-z0-9_-]{0,31}$/i.test(serviceUser)) {
    fail("RUNTIME_SERVICE_USER must be an explicit Unix account name");
  }
  const expectedUid = resolveUnixId("-u", serviceUser);
  const expectedGid = resolveUnixId("-g", serviceUser);
  validateIdentity({
    effectiveUid: process.geteuid(),
    expectedUid,
    serviceUser,
  });

  const releasesDir = requiredAbsoluteDirectory("RELEASES_DIR");
  const logDir = requiredAbsoluteDirectory("LOG_DIR");
  const runtimeEnvFile = requiredAbsoluteFile("RUNTIME_ENV_FILE");
  validateWritableDirectory({
    label: "RELEASES_DIR",
    stat: fs.statSync(releasesDir),
    expectedUid,
    expectedGid,
  });
  validateWritableDirectory({
    label: "LOG_DIR",
    stat: fs.statSync(logDir),
    expectedUid,
    expectedGid,
  });
  validateRuntimeEnvFile({
    stat: fs.statSync(runtimeEnvFile),
    expectedUid,
    expectedGid,
  });

  let scan = { directories: 0, files: 0 };
  if ((process.env.STORAGE_DRIVER ?? "replit") === "local") {
    const storageDir = requiredAbsoluteDirectory("STORAGE_LOCAL_DIR");
    const privateRoot = requiredAbsoluteDirectory("PRIVATE_OBJECT_DIR");
    const relativePrivate = path.relative(storageDir, privateRoot);
    if (
      relativePrivate === "" ||
      relativePrivate === ".." ||
      relativePrivate.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePrivate)
    ) {
      fail("PRIVATE_OBJECT_DIR must be a child of STORAGE_LOCAL_DIR");
    }
    validateWritableDirectory({
      label: "STORAGE_LOCAL_DIR",
      stat: fs.statSync(storageDir),
      expectedUid,
      expectedGid,
    });
    const configuredLimit = parsePrivateScanLimit(
      process.env.RUNTIME_PRIVATE_SCAN_MAX_ENTRIES,
    );
    scan = scanPrivateTree({
      privateRoot,
      expectedUid,
      expectedGid,
      maxEntries: configuredLimit,
    });
  }

  console.log(
    `[runtime-boundary-preflight] OK: ${serviceUser} uid/gid ${expectedUid}/${expectedGid}; ` +
      `private ${scan.directories} directories/${scan.files} files`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  parsePrivateScanLimit,
  scanPrivateTree,
  validateIdentity,
  validatePrivateEntry,
  validateRuntimeEnvFile,
  validateWritableDirectory,
};
