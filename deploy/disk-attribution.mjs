#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const HARD_MAX_ENTRIES = 100_000;
const HARD_MAX_DURATION_MS = 30_000;
const CATEGORY_ORDER = ["releases", "logs", "storage", "database", "backups"];

function fail(message) {
  throw new Error(`[disk-attribution] BLOCKED: ${message}`);
}

function parseCanonicalPositiveInteger(name, value, hardMaximum) {
  if (!/^[1-9]\d*$/.test(value ?? "")) {
    fail(`${name} must be an explicit canonical positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > hardMaximum) {
    fail(`${name} must not exceed the hard maximum of ${hardMaximum}`);
  }
  return parsed;
}

export function parseDiskAttributionOptIn(value) {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  fail("ATTESTATION_INCLUDE_DISK_ATTRIBUTION must be exactly 0 or 1");
}

export function parseDiskAttributionLimits({ maxEntries, maxDurationMs }) {
  return {
    maxEntries: parseCanonicalPositiveInteger(
      "DISK_ATTRIBUTION_MAX_ENTRIES",
      maxEntries,
      HARD_MAX_ENTRIES,
    ),
    maxDurationMs: parseCanonicalPositiveInteger(
      "DISK_ATTRIBUTION_MAX_DURATION_MS",
      maxDurationMs,
      HARD_MAX_DURATION_MS,
    ),
  };
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function safeRealpath(category, configuredPath) {
  try {
    return fs.realpathSync(configuredPath);
  } catch {
    fail(`${category} root cannot be resolved`);
  }
}

function safeLstat(category, target) {
  try {
    return fs.lstatSync(target, { bigint: true });
  } catch {
    fail(`${category} metadata read failed`);
  }
}

function safeOpenDirectory(category, target) {
  try {
    return fs.opendirSync(target);
  } catch {
    fail(`${category} directory enumeration failed`);
  }
}

function safeReadDirectory(category, directory) {
  try {
    return directory.readSync();
  } catch {
    fail(`${category} directory enumeration failed`);
  }
}

function safeCloseDirectory(category, directory) {
  try {
    directory.closeSync();
  } catch {
    fail(`${category} directory close failed`);
  }
}

function safeStatfs(category, target) {
  if (typeof fs.statfsSync !== "function") {
    fail("filesystem capacity API is unavailable");
  }
  try {
    return fs.statfsSync(target, { bigint: true });
  } catch {
    fail(`${category} filesystem capacity read failed`);
  }
}

function pathDepth(resolvedPath) {
  const filesystemRoot = path.parse(resolvedPath).root;
  return resolvedPath
    .slice(filesystemRoot.length)
    .split(path.sep)
    .filter(Boolean).length;
}

export function validateDiskAttributionRoots(roots) {
  if (!roots || typeof roots !== "object" || Array.isArray(roots)) {
    fail("disk attribution roots must be a fixed category map");
  }
  for (const category of Object.keys(roots)) {
    if (!CATEGORY_ORDER.includes(category)) {
      fail("disk attribution contains an unsupported category");
    }
  }

  const validated = [];
  for (const category of CATEGORY_ORDER) {
    const configuredPath = roots[category];
    if (configuredPath === undefined || configuredPath === null) continue;
    if (
      typeof configuredPath !== "string" ||
      !path.isAbsolute(configuredPath)
    ) {
      fail(`${category} root must be an absolute path`);
    }
    const resolved = safeRealpath(category, configuredPath);
    if (resolved === path.parse(resolved).root || pathDepth(resolved) < 3) {
      fail(`${category} root is too broad for bounded attribution`);
    }
    const stat = safeLstat(category, resolved);
    if (!stat.isDirectory()) fail(`${category} root must be a directory`);
    validated.push({
      category,
      resolved,
      device: stat.dev.toString(),
    });
  }
  if (validated.length === 0) {
    fail("at least one fixed disk attribution root is required");
  }

  for (let left = 0; left < validated.length; left += 1) {
    for (let right = left + 1; right < validated.length; right += 1) {
      if (
        isWithin(validated[left].resolved, validated[right].resolved) ||
        isWithin(validated[right].resolved, validated[left].resolved)
      ) {
        fail("disk attribution roots must not overlap");
      }
    }
  }
  return validated;
}

function allocatedBytes(stat) {
  const blocks =
    typeof stat.blocks === "bigint"
      ? stat.blocks
      : BigInt(Number.isFinite(stat.blocks) ? stat.blocks : 0);
  return blocks * 512n;
}

function emptyCategoryInventory(root) {
  const filesystem = safeStatfs(root.category, root.resolved);
  const blockSize = BigInt(filesystem.bsize);
  return {
    entries: 0,
    directories: 0,
    files: 0,
    symlinks: 0,
    other: 0,
    hardLinkReferences: 0,
    logicalFileBytes: 0n,
    allocatedBytes: 0n,
    filesystemTotalBytes: BigInt(filesystem.blocks) * blockSize,
    filesystemAvailableBytes: BigInt(filesystem.bavail) * blockSize,
  };
}

function checkDeadline({ startedAt, maxDurationMs, now }) {
  const current = now();
  if (!Number.isFinite(current) || current < startedAt) {
    fail("disk attribution clock is not monotonic");
  }
  if (current - startedAt > maxDurationMs) {
    fail(`disk attribution exceeded the ${maxDurationMs}ms duration budget`);
  }
  return current;
}

export function collectDiskAttribution({
  roots,
  maxEntries,
  maxDurationMs,
  now = () => Date.now(),
}) {
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > HARD_MAX_ENTRIES
  ) {
    fail(`entry budget must be between 1 and ${HARD_MAX_ENTRIES}`);
  }
  if (
    !Number.isSafeInteger(maxDurationMs) ||
    maxDurationMs < 1 ||
    maxDurationMs > HARD_MAX_DURATION_MS
  ) {
    fail(`duration budget must be between 1 and ${HARD_MAX_DURATION_MS}ms`);
  }

  const startedAt = now();
  if (!Number.isFinite(startedAt)) fail("disk attribution clock is invalid");
  const validatedRoots = validateDiskAttributionRoots(roots);
  checkDeadline({ startedAt, maxDurationMs, now });
  if (validatedRoots.length > maxEntries) {
    fail(`disk attribution exceeded the ${maxEntries}-entry budget`);
  }
  const inventories = {};
  for (const root of validatedRoots) {
    checkDeadline({ startedAt, maxDurationMs, now });
    inventories[root.category] = emptyCategoryInventory(root);
    checkDeadline({ startedAt, maxDurationMs, now });
  }
  const pending = validatedRoots.map((root) => ({
    category: root.category,
    target: root.resolved,
    rootDevice: root.device,
  }));
  const seenFileInodes = new Set();
  let discoveredEntries = pending.length;
  let processedEntries = 0;

  while (pending.length > 0) {
    checkDeadline({ startedAt, maxDurationMs, now });
    const current = pending.pop();
    const inventory = inventories[current.category];
    const stat = safeLstat(current.category, current.target);
    if (stat.dev.toString() !== current.rootDevice) {
      fail(`${current.category} crosses a filesystem boundary`);
    }
    processedEntries += 1;
    inventory.entries += 1;

    if (stat.isSymbolicLink()) {
      inventory.symlinks += 1;
      inventory.allocatedBytes += allocatedBytes(stat);
      continue;
    }
    if (stat.isDirectory()) {
      inventory.directories += 1;
      inventory.allocatedBytes += allocatedBytes(stat);
      const directory = safeOpenDirectory(current.category, current.target);
      try {
        let entry;
        while (
          (entry = safeReadDirectory(current.category, directory)) !== null
        ) {
          checkDeadline({ startedAt, maxDurationMs, now });
          if (discoveredEntries >= maxEntries) {
            fail(`disk attribution exceeded the ${maxEntries}-entry budget`);
          }
          pending.push({
            category: current.category,
            target: path.join(current.target, entry.name),
            rootDevice: current.rootDevice,
          });
          discoveredEntries += 1;
        }
      } finally {
        safeCloseDirectory(current.category, directory);
      }
      continue;
    }
    if (stat.isFile()) {
      inventory.files += 1;
      inventory.logicalFileBytes += stat.size;
      const inode = `${stat.dev}:${stat.ino}`;
      if (seenFileInodes.has(inode)) {
        inventory.hardLinkReferences += 1;
      } else {
        seenFileInodes.add(inode);
        inventory.allocatedBytes += allocatedBytes(stat);
      }
      continue;
    }
    inventory.other += 1;
    inventory.allocatedBytes += allocatedBytes(stat);
  }

  const finishedAt = checkDeadline({ startedAt, maxDurationMs, now });
  return {
    complete: true,
    limits: { maxEntries, maxDurationMs },
    processedEntries,
    elapsedMs: Math.ceil(finishedAt - startedAt),
    categories: Object.fromEntries(
      CATEGORY_ORDER.filter((category) => inventories[category]).map(
        (category) => {
          const inventory = inventories[category];
          return [
            category,
            {
              ...inventory,
              logicalFileBytes: inventory.logicalFileBytes.toString(),
              allocatedBytes: inventory.allocatedBytes.toString(),
              filesystemTotalBytes: inventory.filesystemTotalBytes.toString(),
              filesystemAvailableBytes:
                inventory.filesystemAvailableBytes.toString(),
            },
          ];
        },
      ),
    ),
  };
}
