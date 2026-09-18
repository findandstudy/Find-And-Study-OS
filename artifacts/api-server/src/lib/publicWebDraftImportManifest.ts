import crypto from "node:crypto";

import { canonicalJson } from "./jsonCanonical.js";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_ROWS = 100;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 200_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_MANIFEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const ADAPTER_ID_RE = /^[a-z][a-z0-9._-]{2,63}$/;
const ADAPTER_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type PublicWebDraftImportManifest = {
  schemaVersion: 1;
  kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT";
  adapter: {
    id: string;
    version: string;
    mappingSha256: string;
  };
  generatedAt: string;
  expiresAt: string;
  rows: unknown[];
};

export type ParsedPublicWebDraftImportManifest = {
  manifest: PublicWebDraftImportManifest;
  manifestSha256: string;
};

type JsonBudget = { nodes: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function validJson(value: unknown, depth: number, budget: JsonBudget): boolean {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => validJson(item, depth + 1, budget));
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, item]) =>
    key.length <= 256 &&
    !FORBIDDEN_JSON_KEYS.has(key) &&
    validJson(item, depth + 1, budget));
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  try {
    return new Date(parsed).toISOString() === value ? parsed : null;
  } catch {
    return null;
  }
}

export function parsePublicWebDraftImportManifest(
  value: unknown,
  options: { now?: number } = {},
): ParsedPublicWebDraftImportManifest | null {
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0 || !validJson(value, 0, { nodes: 0 })) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["adapter", "expiresAt", "generatedAt", "kind", "rows", "schemaVersion"]) ||
    value.schemaVersion !== 1 ||
    value.kind !== "FAS_PUBLIC_WEB_DRAFT_IMPORT" ||
    !isRecord(value.adapter) ||
    !hasExactKeys(value.adapter, ["id", "mappingSha256", "version"]) ||
    typeof value.adapter.id !== "string" ||
    !ADAPTER_ID_RE.test(value.adapter.id) ||
    typeof value.adapter.version !== "string" ||
    !ADAPTER_VERSION_RE.test(value.adapter.version) ||
    typeof value.adapter.mappingSha256 !== "string" ||
    !SHA256_RE.test(value.adapter.mappingSha256) ||
    !Array.isArray(value.rows) ||
    value.rows.length < 1 ||
    value.rows.length > MAX_MANIFEST_ROWS
  ) {
    return null;
  }
  const generatedAt = timestamp(value.generatedAt);
  const expiresAt = timestamp(value.expiresAt);
  if (
    generatedAt === null ||
    expiresAt === null ||
    generatedAt > now + MAX_CLOCK_SKEW_MS ||
    expiresAt <= now ||
    expiresAt <= generatedAt ||
    expiresAt - generatedAt > MAX_MANIFEST_LIFETIME_MS
  ) {
    return null;
  }

  let serialized: string;
  try {
    serialized = canonicalJson(value);
  } catch {
    return null;
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES) return null;
  const manifest = JSON.parse(serialized) as PublicWebDraftImportManifest;
  return {
    manifest,
    manifestSha256: crypto
      .createHash("sha256")
      .update("fas.public-web.draft-import-manifest.v1\0", "utf8")
      .update(serialized, "utf8")
      .digest("hex"),
  };
}
