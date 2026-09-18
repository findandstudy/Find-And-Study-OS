import crypto from "node:crypto";

import {
  hashPublicWebDraftIntakeCommand,
  hashPublicWebDraftRevision,
  parsePublicWebDraftIntakeCommand,
  type PublicWebDraftIntakeCommand,
} from "./publicWebDraftIntakeCommand.js";
import {
  buildPublicWebCanonicalPath,
  type PublicWebEntityType,
  type PublicWebLocale,
  type PublicWebRevisionOrigin,
} from "./publicWebContentContract.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

export type PublicWebDraftIntakeRequest = {
  entityType: PublicWebEntityType;
  entityId: number;
  locale: PublicWebLocale;
  canonicalSlug: string;
  origin: PublicWebRevisionOrigin;
  title: string;
  summary: string | null;
  contentJson: Record<string, unknown>;
  seoJson: Record<string, unknown>;
  structuredDataJson: Record<string, unknown>;
  generatorReceiptSha256: string | null;
  idempotencyKey: string;
};

export type PublicWebDraftSourceBinding = {
  entityType: PublicWebEntityType;
  entityId: number;
  sourceSha256: string;
};

export type PublicWebDraftScope = {
  tenantId: string;
  organizationId: string;
};

export type PublicWebDraftIntakeBuildResult =
  | {
      ok: true;
      command: PublicWebDraftIntakeCommand;
      requestHash: string;
    }
  | {
      ok: false;
      reason:
        | "request_invalid"
        | "source_binding_invalid"
        | "scope_invalid"
        | "generated_identity_invalid";
    };

type BuildOptions = {
  scope: PublicWebDraftScope;
  source: PublicWebDraftSourceBinding;
  request: unknown;
  now?: number;
  newUuidV7?: (observedAt: number) => string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function uuidV7(observedAt: number): string {
  const bytes = crypto.randomBytes(16);
  const timestamp = BigInt(observedAt);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validRequestShape(value: unknown): value is PublicWebDraftIntakeRequest {
  return isRecord(value) && hasExactKeys(value, [
    "canonicalSlug",
    "contentJson",
    "entityId",
    "entityType",
    "generatorReceiptSha256",
    "idempotencyKey",
    "locale",
    "origin",
    "seoJson",
    "structuredDataJson",
    "summary",
    "title",
  ]);
}

export function buildServerBoundPublicWebDraftIntake(
  options: BuildOptions,
): PublicWebDraftIntakeBuildResult {
  if (!validRequestShape(options?.request)) return { ok: false, reason: "request_invalid" };
  if (
    !isRecord(options.scope) ||
    !UUID_V7_RE.test(String(options.scope.tenantId)) ||
    !UUID_V7_RE.test(String(options.scope.organizationId)) ||
    options.scope.tenantId.toLowerCase() === options.scope.organizationId.toLowerCase()
  ) {
    return { ok: false, reason: "scope_invalid" };
  }
  if (
    !isRecord(options.source) ||
    options.source.entityType !== options.request.entityType ||
    options.source.entityId !== options.request.entityId ||
    !SHA256_RE.test(String(options.source.sourceSha256))
  ) {
    return { ok: false, reason: "source_binding_invalid" };
  }
  const observedAt = options.now ?? Date.now();
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
    return { ok: false, reason: "generated_identity_invalid" };
  }
  const generate = options.newUuidV7 ?? uuidV7;
  const contentRecordId = generate(observedAt).toLowerCase();
  const revisionId = generate(observedAt).toLowerCase();
  if (
    !UUID_V7_RE.test(contentRecordId) ||
    !UUID_V7_RE.test(revisionId) ||
    contentRecordId === revisionId
  ) {
    return { ok: false, reason: "generated_identity_invalid" };
  }

  let canonicalPath: string;
  try {
    canonicalPath = buildPublicWebCanonicalPath({
      entityType: options.source.entityType,
      entityId: options.source.entityId,
      locale: options.request.locale,
      slug: options.request.canonicalSlug,
    });
  } catch {
    return { ok: false, reason: "request_invalid" };
  }
  const unsignedCommand = {
    tenantId: options.scope.tenantId.toLowerCase(),
    organizationId: options.scope.organizationId.toLowerCase(),
    contentRecordId,
    revisionId,
    entityType: options.source.entityType,
    entityId: options.source.entityId,
    locale: options.request.locale,
    canonicalSlug: options.request.canonicalSlug,
    canonicalPath,
    origin: options.request.origin,
    title: options.request.title,
    summary: options.request.summary,
    contentJson: options.request.contentJson,
    seoJson: options.request.seoJson,
    structuredDataJson: options.request.structuredDataJson,
    sourceSha256: options.source.sourceSha256,
    contentSha256: "",
    generatorReceiptSha256: options.request.generatorReceiptSha256,
    idempotencyKey: options.request.idempotencyKey,
  } satisfies PublicWebDraftIntakeCommand;
  const candidate: PublicWebDraftIntakeCommand = {
    ...unsignedCommand,
    contentSha256: hashPublicWebDraftRevision(unsignedCommand),
  };
  const command = parsePublicWebDraftIntakeCommand(candidate);
  if (!command) return { ok: false, reason: "request_invalid" };
  return {
    ok: true,
    command,
    requestHash: hashPublicWebDraftIntakeCommand(command),
  };
}
