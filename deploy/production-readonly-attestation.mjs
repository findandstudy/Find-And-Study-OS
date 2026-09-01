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
import {
  collectDiskAttribution,
  parseDiskAttributionLimits,
  parseDiskAttributionOptIn,
} from "./disk-attribution.mjs";

const modulePath = fileURLToPath(import.meta.url);
const sourceRoot = fs.realpathSync(
  path.resolve(path.dirname(modulePath), ".."),
);
const DEFAULT_MAX_PRIVATE_ENTRIES = 100_000;
const DEFAULT_MAX_PRIVATE_DURATION_MS = 30_000;
const READ_ONLY_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_HEALTH_BODY_BYTES = 64 * 1024;

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
      timeout: READ_ONLY_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
    },
  ).trim();
  const porcelain = execFileSync(
    "git",
    ["-C", sourceRoot, "status", "--porcelain=v1", "--untracked-files=normal"],
    {
      encoding: "utf8",
      env: gitEnvironment,
      maxBuffer: 1024 * 1024,
      timeout: READ_ONLY_PROBE_TIMEOUT_MS,
      killSignal: "SIGKILL",
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

export function parsePrivateInventoryDurationLimit(value) {
  const raw = value ?? String(DEFAULT_MAX_PRIVATE_DURATION_MS);
  if (!/^[1-9]\d*$/.test(raw)) {
    fail(
      "RUNTIME_PRIVATE_SCAN_MAX_DURATION_MS must be a canonical positive integer",
    );
  }
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit > DEFAULT_MAX_PRIVATE_DURATION_MS) {
    fail(
      `RUNTIME_PRIVATE_SCAN_MAX_DURATION_MS must not exceed the hard ${DEFAULT_MAX_PRIVATE_DURATION_MS}-millisecond ceiling`,
    );
  }
  return limit;
}

function enforcePrivateInventoryDeadline({ startedAt, maxDurationMs, now }) {
  const currentTime = now();
  if (!Number.isFinite(currentTime) || currentTime < startedAt) {
    fail("private inventory clock is invalid");
  }
  if (currentTime - startedAt >= maxDurationMs) {
    fail(
      `private inventory exceeded the bounded duration of ${maxDurationMs} milliseconds`,
    );
  }
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
  maxDurationMs = DEFAULT_MAX_PRIVATE_DURATION_MS,
  now = Date.now,
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
  if (
    !Number.isSafeInteger(maxDurationMs) ||
    maxDurationMs < 1 ||
    maxDurationMs > DEFAULT_MAX_PRIVATE_DURATION_MS
  ) {
    fail(
      `private inventory duration must be between 1 and the hard ${DEFAULT_MAX_PRIVATE_DURATION_MS}-millisecond ceiling`,
    );
  }
  const startedAt = now();
  if (!Number.isFinite(startedAt)) fail("private inventory clock is invalid");
  const resolvedRoot = fs.realpathSync(privateRoot);
  enforcePrivateInventoryDeadline({ startedAt, maxDurationMs, now });
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
    enforcePrivateInventoryDeadline({ startedAt, maxDurationMs, now });
    const target = pending.pop();
    const stat = fs.lstatSync(target);
    enforcePrivateInventoryDeadline({ startedAt, maxDurationMs, now });
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
          enforcePrivateInventoryDeadline({ startedAt, maxDurationMs, now });
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
      enforcePrivateInventoryDeadline({ startedAt, maxDurationMs, now });
      continue;
    }
    if (stat.isFile()) {
      inventory.files += 1;
      inventory.fileBytes += BigInt(stat.size);
      enforcePrivateInventoryDeadline({ startedAt, maxDurationMs, now });
      continue;
    }
    inventory.other += 1;
    enforcePrivateInventoryDeadline({ startedAt, maxDurationMs, now });
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

export function parseProcStatIdentity(raw, expectedPid) {
  if (!Number.isSafeInteger(expectedPid) || expectedPid < 1) {
    fail("process identity requires a canonical positive pid");
  }
  const text = String(raw).trim();
  const prefix = `${expectedPid} (`;
  const commandEnd = text.lastIndexOf(") ");
  if (!text.startsWith(prefix) || commandEnd < prefix.length) {
    fail("process identity changed during attestation");
  }
  const fields = text.slice(commandEnd + 2).split(/\s+/);
  const startTimeTicks = fields[19];
  if (fields.length < 20 || !/^(?:0|[1-9]\d*)$/.test(startTimeTicks ?? "")) {
    fail("process identity changed during attestation");
  }
  return { pid: expectedPid, startTimeTicks };
}

function readProcIdentity(pid) {
  return parseProcStatIdentity(
    fs.readFileSync(`/proc/${pid}/stat`, "utf8"),
    pid,
  );
}

function collectProcessMetadata() {
  const raw = execFileSync("ps", ["-eo", "pid=,uid=,gid=,args="], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: READ_ONLY_PROBE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return parseProcessInventory(raw).map((record) => {
    const before = readProcIdentity(record.pid);
    const procDirectoryStat = fs.statSync(`/proc/${record.pid}`);
    if (
      !procDirectoryStat.isDirectory() ||
      procDirectoryStat.uid !== record.uid ||
      procDirectoryStat.gid !== record.gid
    ) {
      fail("process identity changed during attestation");
    }
    const cwd = fs.realpathSync(`/proc/${record.pid}/cwd`);
    const after = readProcIdentity(record.pid);
    if (after.startTimeTicks !== before.startTimeTicks) {
      fail("process identity changed during attestation");
    }
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

function optionalAbsoluteDirectory(name) {
  if (process.env[name] === undefined || process.env[name] === "") return null;
  return requiredAbsolutePath(name, "directory");
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

export async function readBoundedHealthBody(
  response,
  { maxBytes = DEFAULT_MAX_HEALTH_BODY_BYTES } = {},
) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > DEFAULT_MAX_HEALTH_BODY_BYTES
  ) {
    fail(
      `health response limit must be between 1 and the hard ${DEFAULT_MAX_HEALTH_BODY_BYTES}-byte ceiling`,
    );
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(declaredLength)) {
      fail("local health endpoint returned an invalid Content-Length");
    }
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > maxBytes) {
      fail(`local health response exceeded the bounded ${maxBytes}-byte limit`);
    }
  }
  if (!response.body) fail("local health endpoint returned no response body");

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        fail("local health endpoint returned an invalid response body");
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        fail(
          `local health response exceeded the bounded ${maxBytes}-byte limit`,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

export function parseHealthPort(value) {
  const raw = value ?? "5000";
  if (!/^[1-9]\d{0,4}$/.test(raw)) {
    fail("PORT must be a canonical port from 1 through 65535");
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    fail("PORT must be a canonical port from 1 through 65535");
  }
  return port;
}

export function validateHealthResponseMetadata(response) {
  if (response.status !== 200) {
    fail(
      `local health endpoint returned HTTP ${response.status}; expected 200`,
    );
  }
  const contentType = response.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    fail("local health endpoint must return application/json");
  }
}

async function collectHealth() {
  const port = parseHealthPort(process.env.PORT);
  const healthUrl = new URL(`http://127.0.0.1:${port}/api/health`).href;
  const response = await fetch(healthUrl, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (response.url !== healthUrl) {
    fail("local health endpoint response URL changed unexpectedly");
  }
  validateHealthResponseMetadata(response);
  const body = await readBoundedHealthBody(response);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    fail("local health endpoint did not return valid bounded JSON");
  }
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
  let privateScanMaxEntries = null;
  let privateScanMaxDurationMs = null;
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
    privateScanMaxEntries = parsePrivateInventoryLimit(
      process.env.RUNTIME_PRIVATE_SCAN_MAX_ENTRIES,
    );
    privateScanMaxDurationMs = parsePrivateInventoryDurationLimit(
      process.env.RUNTIME_PRIVATE_SCAN_MAX_DURATION_MS,
    );
    privateStorage = {
      storageRoot: storageDir,
      privateRoot,
      inventory: null,
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

  if (privateStorage) {
    privateStorage = {
      ...privateStorage,
      inventory: collectPrivateTreeInventory({
        privateRoot: privateStorage.privateRoot.resolved,
        maxEntries: privateScanMaxEntries,
        maxDurationMs: privateScanMaxDurationMs,
      }),
    };
  }

  let diskAttribution = null;
  if (
    parseDiskAttributionOptIn(process.env.ATTESTATION_INCLUDE_DISK_ATTRIBUTION)
  ) {
    const limits = parseDiskAttributionLimits({
      maxEntries: process.env.DISK_ATTRIBUTION_MAX_ENTRIES,
      maxDurationMs: process.env.DISK_ATTRIBUTION_MAX_DURATION_MS,
    });
    const databaseDir = optionalAbsoluteDirectory(
      "DISK_ATTRIBUTION_DATABASE_DIR",
    );
    const backupDir = optionalAbsoluteDirectory("DISK_ATTRIBUTION_BACKUP_DIR");
    diskAttribution = collectDiskAttribution({
      roots: {
        releases: releasesDir.resolved,
        logs: logDir.resolved,
        storage: privateStorage?.storageRoot.resolved,
        database: databaseDir?.resolved,
        backups: backupDir?.resolved,
      },
      ...limits,
    });
  }

  return {
    schemaVersion: 4,
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
      diskAttribution,
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
