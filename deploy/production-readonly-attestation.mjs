#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readExpectedMigrations,
  verifyDatabaseMigrationState,
} from "../lib/db/verify-migration-state.mjs";

const modulePath = fileURLToPath(import.meta.url);
const sourceRoot = fs.realpathSync(
  path.resolve(path.dirname(modulePath), ".."),
);
const DEFAULT_MAX_PRIVATE_ENTRIES = 100_000;

function fail(message) {
  throw new Error(`[production-readonly-attestation] BLOCKED: ${message}`);
}

export function safeErrorMessage(
  error,
  databaseUrl = process.env.DATABASE_URL,
) {
  let message = error instanceof Error ? error.message : String(error);
  if (databaseUrl)
    message = message.split(databaseUrl).join("[REDACTED_DATABASE_URL]");
  return message.replace(
    /postgres(?:ql)?:\/\/[^\s/@:]+(?::[^\s/@]*)?@/gi,
    "postgresql://[REDACTED]@",
  );
}

export function assertReadOnlyOptIn(value) {
  if (value !== "1") {
    fail("PRODUCTION_ATTESTATION_READ_ONLY=1 is required");
  }
}

export function parseProductionExpectations({
  expectedReleaseId,
  expectedAppliedMigrations,
  expectedDatabaseName,
  expectedDatabaseAddress,
  expectedDatabasePort,
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(expectedReleaseId ?? "")) {
    fail(
      "ATTESTATION_EXPECTED_RELEASE_ID must be a bounded release directory name",
    );
  }
  if (!/^(?:0|[1-9]\d*)$/.test(expectedAppliedMigrations ?? "")) {
    fail(
      "ATTESTATION_EXPECTED_APPLIED_MIGRATIONS must be a canonical non-negative integer",
    );
  }
  const appliedMigrations = Number(expectedAppliedMigrations);
  if (!Number.isSafeInteger(appliedMigrations)) {
    fail("expected applied migration count exceeds the safe integer range");
  }
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(expectedDatabaseName ?? "")) {
    fail(
      "ATTESTATION_EXPECTED_DATABASE_NAME must be a bounded lowercase PostgreSQL identifier",
    );
  }
  if (isIP(expectedDatabaseAddress ?? "") === 0) {
    fail(
      "ATTESTATION_EXPECTED_DATABASE_ADDRESS must be an exact IPv4 or IPv6 address",
    );
  }
  if (
    !/^(?:[1-9]\d{0,3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$/.test(
      expectedDatabasePort ?? "",
    )
  ) {
    fail(
      "ATTESTATION_EXPECTED_DATABASE_PORT must be a canonical port from 1 through 65535",
    );
  }
  return {
    releaseId: expectedReleaseId,
    appliedMigrations,
    database: {
      name: expectedDatabaseName,
      address: expectedDatabaseAddress,
      port: Number(expectedDatabasePort),
    },
  };
}

export function assertExpectedProductionState({
  expectations,
  actualReleaseId,
  actualAppliedMigrations,
  repositoryMigrations,
  actualDatabaseIdentity,
}) {
  if (
    !Number.isSafeInteger(repositoryMigrations) ||
    repositoryMigrations < 0 ||
    expectations.appliedMigrations > repositoryMigrations
  ) {
    fail("expected migration prefix exceeds the reviewed source ledger");
  }
  if (actualReleaseId !== expectations.releaseId) {
    fail(
      "live release identity does not match the explicitly expected release",
    );
  }
  if (actualAppliedMigrations !== expectations.appliedMigrations) {
    fail(
      "live applied migration count does not match the explicitly expected prefix",
    );
  }
  if (
    actualDatabaseIdentity?.name !== expectations.database.name ||
    actualDatabaseIdentity?.address !== expectations.database.address ||
    actualDatabaseIdentity?.port !== expectations.database.port
  ) {
    fail(
      "connected database identity does not match the explicitly expected target",
    );
  }
}

export function validateSourceProvenance({
  expectedCommit,
  actualCommit,
  porcelain,
}) {
  if (!/^[0-9a-f]{40}$/.test(expectedCommit ?? "")) {
    fail(
      "ATTESTATION_EXPECTED_SOURCE_COMMIT must be a full lowercase commit SHA",
    );
  }
  if (!/^[0-9a-f]{40}$/.test(actualCommit ?? "")) {
    fail("source checkout HEAD is not a full lowercase commit SHA");
  }
  if (actualCommit !== expectedCommit) {
    fail("source checkout HEAD does not match the reviewed commit");
  }
  if (String(porcelain).trim().length > 0) {
    fail("source checkout is not clean");
  }
  return { commit: actualCommit, worktreeClean: true };
}

function collectSourceProvenance() {
  const gitEnvironment = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
  };
  const actualCommit = execFileSync(
    "git",
    ["-C", sourceRoot, "rev-parse", "--verify", "HEAD"],
    {
      encoding: "utf8",
      env: gitEnvironment,
      maxBuffer: 1024 * 1024,
    },
  ).trim();
  const porcelain = execFileSync(
    "git",
    ["-C", sourceRoot, "status", "--porcelain=v1", "--untracked-files=normal"],
    {
      encoding: "utf8",
      env: gitEnvironment,
      maxBuffer: 1024 * 1024,
    },
  );
  return validateSourceProvenance({
    expectedCommit: process.env.ATTESTATION_EXPECTED_SOURCE_COMMIT,
    actualCommit,
    porcelain,
  });
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

export function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function parsePrivateInventoryLimit(value) {
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

function safeStat(stat) {
  return {
    uid: stat.uid,
    gid: stat.gid,
    mode: (stat.mode & 0o7777).toString(8).padStart(4, "0"),
    type: stat.isDirectory()
      ? "directory"
      : stat.isFile()
        ? "file"
        : stat.isSymbolicLink()
          ? "symlink"
          : "other",
  };
}

export function collectPrivateTreeInventory({
  privateRoot,
  maxEntries = DEFAULT_MAX_PRIVATE_ENTRIES,
}) {
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > DEFAULT_MAX_PRIVATE_ENTRIES
  ) {
    fail(
      `private inventory limit must be between 1 and the hard ${DEFAULT_MAX_PRIVATE_ENTRIES}-entry ceiling`,
    );
  }
  const resolvedRoot = fs.realpathSync(privateRoot);
  const pending = [resolvedRoot];
  const inventory = {
    entries: 0,
    directories: 0,
    files: 0,
    symlinks: 0,
    other: 0,
    fileBytes: 0n,
    byMode: {},
    byUid: {},
    byGid: {},
  };

  while (pending.length) {
    const target = pending.pop();
    const stat = fs.lstatSync(target);
    inventory.entries += 1;
    if (inventory.entries > maxEntries) {
      fail(
        `private inventory exceeded the bounded limit of ${maxEntries} entries`,
      );
    }
    increment(
      inventory.byMode,
      (stat.mode & 0o7777).toString(8).padStart(4, "0"),
    );
    increment(inventory.byUid, String(stat.uid));
    increment(inventory.byGid, String(stat.gid));

    if (stat.isSymbolicLink()) {
      inventory.symlinks += 1;
      continue;
    }
    if (stat.isDirectory()) {
      inventory.directories += 1;
      const directory = fs.opendirSync(target);
      try {
        let entry;
        while ((entry = directory.readSync()) !== null) {
          if (inventory.entries + pending.length >= maxEntries) {
            fail(
              `private inventory exceeded the bounded limit of ${maxEntries} entries`,
            );
          }
          pending.push(path.join(target, entry.name));
        }
      } finally {
        directory.closeSync();
      }
      continue;
    }
    if (stat.isFile()) {
      inventory.files += 1;
      inventory.fileBytes += BigInt(stat.size);
      continue;
    }
    inventory.other += 1;
  }

  return {
    ...inventory,
    fileBytes: inventory.fileBytes.toString(),
  };
}

export function parseProcessInventory(raw) {
  const records = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, pid, uid, gid, args] = match;
    let kind = null;
    if (/artifacts\/api-server\/dist\/index\.cjs(?:\s|$)/.test(args))
      kind = "api";
    if (
      /artifacts\/portal-automation-worker\/.*worker\.(?:ts|js)(?:\s|$)/.test(
        args,
      )
    ) {
      kind = "portalWorker";
    }
    if (kind)
      records.push({
        kind,
        pid: Number(pid),
        uid: Number(uid),
        gid: Number(gid),
      });
  }

  for (const kind of ["api", "portalWorker"]) {
    const matches = records.filter((record) => record.kind === kind);
    if (matches.length !== 1) {
      fail(`expected exactly one ${kind} process; found ${matches.length}`);
    }
  }
  return records.sort((left, right) => left.kind.localeCompare(right.kind));
}

function collectProcessMetadata() {
  const raw = execFileSync("ps", ["-eo", "pid=,uid=,gid=,args="], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseProcessInventory(raw).map((record) => {
    const cwd = fs.realpathSync(`/proc/${record.pid}/cwd`);
    return { ...record, cwd };
  });
}

function requiredAbsolutePath(name, expectedType) {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value))
    fail(`${name} must be an absolute path`);
  const resolved = fs.realpathSync(value);
  const stat = fs.statSync(resolved);
  if (expectedType === "directory" && !stat.isDirectory())
    fail(`${name} must be a directory`);
  if (expectedType === "file" && !stat.isFile())
    fail(`${name} must be a regular file`);
  return { configured: value, resolved, stat: safeStat(stat) };
}

function collectDiskInventory() {
  if (typeof fs.statfsSync !== "function")
    fail("filesystem capacity API is unavailable");
  const stat = fs.statfsSync("/");
  const blockSize = BigInt(stat.bsize);
  const totalBytes = BigInt(stat.blocks) * blockSize;
  const availableBytes = BigInt(stat.bavail) * blockSize;
  return {
    totalBytes: totalBytes.toString(),
    availableBytes: availableBytes.toString(),
    usedBytes: (totalBytes - availableBytes).toString(),
  };
}

async function collectHealth() {
  const rawPort = process.env.PORT ?? "5000";
  if (!/^\d{2,5}$/.test(rawPort)) fail("PORT must be numeric");
  const response = await fetch(`http://127.0.0.1:${rawPort}/api/health`, {
    method: "GET",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok)
    fail(`local health endpoint returned HTTP ${response.status}`);
  const payload = await response.json();
  if (
    payload.status !== "ok" ||
    payload.dbConnected !== true ||
    typeof payload.releaseId !== "string" ||
    payload.releaseId.length === 0
  ) {
    fail("local health endpoint is not fully ready or has no release identity");
  }
  return {
    httpStatus: response.status,
    status: payload.status,
    dbConnected: payload.dbConnected,
    releaseId: payload.releaseId,
  };
}

export async function createProductionAttestation() {
  assertReadOnlyOptIn(process.env.PRODUCTION_ATTESTATION_READ_ONLY);
  if (process.platform !== "linux")
    fail("production attestation runs only on Linux");
  if (!process.env.DATABASE_URL)
    fail("DATABASE_URL is required but is never emitted");
  const source = collectSourceProvenance();
  const expectedProductionState = parseProductionExpectations({
    expectedReleaseId: process.env.ATTESTATION_EXPECTED_RELEASE_ID,
    expectedAppliedMigrations:
      process.env.ATTESTATION_EXPECTED_APPLIED_MIGRATIONS,
    expectedDatabaseName: process.env.ATTESTATION_EXPECTED_DATABASE_NAME,
    expectedDatabaseAddress: process.env.ATTESTATION_EXPECTED_DATABASE_ADDRESS,
    expectedDatabasePort: process.env.ATTESTATION_EXPECTED_DATABASE_PORT,
  });

  const releasesDir = requiredAbsolutePath("RELEASES_DIR", "directory");
  const currentRelease = requiredAbsolutePath(
    "CURRENT_RELEASE_LINK",
    "directory",
  );
  if (!isWithin(releasesDir.resolved, currentRelease.resolved)) {
    fail("CURRENT_RELEASE_LINK target must be inside RELEASES_DIR");
  }
  const logDir = requiredAbsolutePath("LOG_DIR", "directory");
  const runtimeEnv = requiredAbsolutePath("RUNTIME_ENV_FILE", "file");
  const paths = { releasesDir, currentRelease, logDir, runtimeEnv };

  let privateStorage = null;
  if ((process.env.STORAGE_DRIVER ?? "replit") === "local") {
    const storageDir = requiredAbsolutePath("STORAGE_LOCAL_DIR", "directory");
    const privateRoot = requiredAbsolutePath("PRIVATE_OBJECT_DIR", "directory");
    const relativePrivate = path.relative(
      storageDir.resolved,
      privateRoot.resolved,
    );
    if (
      relativePrivate === "" ||
      relativePrivate === ".." ||
      relativePrivate.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePrivate)
    ) {
      fail("PRIVATE_OBJECT_DIR must be a child of STORAGE_LOCAL_DIR");
    }
    const maxEntries = parsePrivateInventoryLimit(
      process.env.RUNTIME_PRIVATE_SCAN_MAX_ENTRIES,
    );
    privateStorage = {
      storageRoot: storageDir,
      privateRoot,
      inventory: collectPrivateTreeInventory({
        privateRoot: privateRoot.resolved,
        maxEntries,
      }),
    };
  }

  const migration = await verifyDatabaseMigrationState();
  const repositoryMigrations = readExpectedMigrations().length;
  const health = await collectHealth();
  if (health.releaseId !== path.basename(currentRelease.resolved)) {
    fail(
      "localhost health releaseId does not match CURRENT_RELEASE_LINK target",
    );
  }
  assertExpectedProductionState({
    expectations: expectedProductionState,
    actualReleaseId: health.releaseId,
    actualAppliedMigrations: migration.applied,
    repositoryMigrations,
    actualDatabaseIdentity: migration.databaseIdentity,
  });
  const processes = collectProcessMetadata();
  for (const processInfo of processes) {
    if (!isWithin(currentRelease.resolved, processInfo.cwd)) {
      fail(
        `${processInfo.kind} process cwd is outside CURRENT_RELEASE_LINK target`,
      );
    }
  }

  return {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    source,
    expectedProductionState,
    release: {
      currentReleasePath: currentRelease.resolved,
      releaseDirectoryName: path.basename(currentRelease.resolved),
      health,
    },
    migration: {
      ...migration,
      repositoryMigrations,
      unappliedRepositoryMigrations: repositoryMigrations - migration.applied,
    },
    runtime: {
      effectiveUid: process.geteuid(),
      effectiveGid: process.getegid(),
      processes,
      paths,
      privateStorage,
      rootFilesystem: collectDiskInventory(),
    },
  };
}

if (process.argv[1] === modulePath) {
  try {
    const result = await createProductionAttestation();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(safeErrorMessage(error));
    process.exit(1);
  }
}
