#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const GIBIBYTE = 1024n * 1024n * 1024n;
const MIN_AVAILABLE_BYTES = 15n * GIBIBYTE;
const MIN_AVAILABLE_BASIS_POINTS = 1500n;

function fail(message) {
  throw new Error(`[disk-capacity-preflight] ${message}`);
}

function validateCapacity({ label, blockSize, totalBlocks, availableBlocks }) {
  for (const [field, value] of Object.entries({
    blockSize,
    totalBlocks,
    availableBlocks,
  })) {
    if (typeof value !== "bigint" || value < 0n) {
      fail(`${label} ${field} must be a non-negative bigint`);
    }
  }
  if (blockSize === 0n || totalBlocks === 0n) {
    fail(`${label} filesystem capacity is unavailable`);
  }
  if (availableBlocks > totalBlocks) {
    fail(`${label} available blocks exceed total blocks`);
  }

  const totalBytes = totalBlocks * blockSize;
  const availableBytes = availableBlocks * blockSize;
  const availableBasisPoints = (availableBytes * 10_000n) / totalBytes;
  if (availableBytes < MIN_AVAILABLE_BYTES) {
    fail(`${label} has less than the hard 15 GiB deployment reserve`);
  }
  if (availableBasisPoints < MIN_AVAILABLE_BASIS_POINTS) {
    fail(`${label} has less than the hard 15% deployment reserve`);
  }
  return { totalBytes, availableBytes, availableBasisPoints };
}

function requiredAbsoluteDirectory(name) {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value))
    fail(`${name} must be an absolute path`);
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isDirectory()) fail(`${name} must be a directory`);
  return resolved;
}

function main() {
  if (process.platform !== "linux" || typeof fs.statfsSync !== "function") {
    fail(
      "disk capacity preflight is supported only on the Linux production host",
    );
  }

  const targets = [
    ["RELEASES_DIR", requiredAbsoluteDirectory("RELEASES_DIR")],
    ["LOG_DIR", requiredAbsoluteDirectory("LOG_DIR")],
  ];
  if ((process.env.STORAGE_DRIVER ?? "replit") === "local") {
    targets.push([
      "STORAGE_LOCAL_DIR",
      requiredAbsoluteDirectory("STORAGE_LOCAL_DIR"),
    ]);
  }

  for (const [label, target] of targets) {
    const stat = fs.statfsSync(target, { bigint: true });
    const result = validateCapacity({
      label,
      blockSize: stat.bsize,
      totalBlocks: stat.blocks,
      availableBlocks: stat.bavail,
    });
    console.log(
      `[disk-capacity-preflight] OK: ${label} available ${result.availableBytes} bytes/${result.availableBasisPoints} basis points`,
    );
  }
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
  MIN_AVAILABLE_BASIS_POINTS,
  MIN_AVAILABLE_BYTES,
  validateCapacity,
};
