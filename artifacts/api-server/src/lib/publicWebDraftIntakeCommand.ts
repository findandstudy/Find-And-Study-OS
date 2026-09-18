import crypto from "node:crypto";

import {
  evaluateActiveTenantCapability,
  isSelectionBoundActiveTenantContext,
  type ActiveContextDecision,
  type ResolvedActiveContextState,
  type VerifiedActiveTenantContext,
} from "./activeTenantContext.js";
import { canonicalJson } from "./jsonCanonical.js";
import {
  PUBLIC_WEB_ENTITY_TYPES,
  buildPublicWebCanonicalPath,
  normalizePublicWebLocale,
  normalizePublicWebSlug,
  type PublicWebEntityType,
  type PublicWebLocale,
  type PublicWebRevisionOrigin,
} from "./publicWebContentContract.js";
import { isReservedPublicPageSlug } from "./publicCatalogRenderContract.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const SESSION_ID_RE = /^[0-9a-f]{64}$/;
const MAX_ENTITY_ID = 2_147_483_647;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 20_000;
const FORBIDDEN_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type PublicWebDraftIntakeCommand = {
  tenantId: string;
  organizationId: string;
  contentRecordId: string;
  revisionId: string;
  entityType: PublicWebEntityType;
  entityId: number;
  locale: PublicWebLocale;
  canonicalSlug: string;
  canonicalPath: string;
  origin: PublicWebRevisionOrigin;
  title: string;
  summary: string | null;
  contentJson: Record<string, unknown>;
  seoJson: Record<string, unknown>;
  structuredDataJson: Record<string, unknown>;
  sourceSha256: string;
  contentSha256: string;
  generatorReceiptSha256: string | null;
  idempotencyKey: string;
};

export type AuthorizedPublicWebDraftIntakeCommand = {
  command: PublicWebDraftIntakeCommand;
  capabilityKey: "public_web.content.write";
  requestHash: string;
  decisionReceipt: ActiveContextDecision["receipt"];
  executionBinding: {
    contextId: string;
    contextIssuedAt: number;
    contextExpiresAt: number;
    sessionId: string;
    sessionFingerprint: string;
    selectionId: string;
    sessionGeneration: number;
  };
};

export type PublicWebDraftSessionBinding = {
  sessionId: string;
  sessionFingerprint: string;
};

export type PublicWebDraftIntakeAuthorizationResult =
  | { ok: true; value: AuthorizedPublicWebDraftIntakeCommand }
  | {
      ok: false;
      reason:
        | "invalid_command"
        | "context_not_selection_bound"
        | "impersonation_forbidden"
        | "authorization_denied";
      detail?: string;
      decisionReceipt?: ActiveContextDecision["receipt"];
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

function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_RE.test(value);
}

function isJsonValue(value: unknown, depth: number, budget: JsonBudget): boolean {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= MAX_JSON_NODES && value.every((item) => isJsonValue(item, depth + 1, budget));
  }
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_JSON_NODES && entries.every(([key, item]) =>
    key.length <= 256 && !FORBIDDEN_JSON_KEYS.has(key) && isJsonValue(item, depth + 1, budget));
}

function validJsonDocument(value: unknown, maxBytes: number): value is Record<string, unknown> {
  if (!isRecord(value) || !isJsonValue(value, 0, { nodes: 0 })) return false;
  return Buffer.byteLength(canonicalJson(value), "utf8") <= maxBytes;
}

function revisionDigestPayload(input: Pick<
  PublicWebDraftIntakeCommand,
  "title" | "summary" | "contentJson" | "seoJson" | "structuredDataJson"
>) {
  return {
    contentJson: input.contentJson,
    seoJson: input.seoJson,
    structuredDataJson: input.structuredDataJson,
    summary: input.summary,
    title: input.title,
  };
}

export function hashPublicWebDraftRevision(input: Pick<
  PublicWebDraftIntakeCommand,
  "title" | "summary" | "contentJson" | "seoJson" | "structuredDataJson"
>): string {
  return crypto
    .createHash("sha256")
    .update(canonicalJson(revisionDigestPayload(input)), "utf8")
    .digest("hex");
}

export function hashPublicWebDraftIntakeCommand(
  command: PublicWebDraftIntakeCommand,
): string {
  // The request hash is the semantic identity of the write. Server-generated
  // UUIDs and the caller retry key are transport identities, so including
  // either would make an ambiguous-COMMIT retry look like different content.
  const {
    contentRecordId: _contentRecordId,
    idempotencyKey: _idempotencyKey,
    revisionId: _revisionId,
    ...payload
  } = command;
  return crypto
    .createHash("sha256")
    .update("fas.public-web.draft-intake.semantic.v2\0", "utf8")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

export function parsePublicWebDraftIntakeCommand(
  value: unknown,
): PublicWebDraftIntakeCommand | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "canonicalPath",
      "canonicalSlug",
      "contentJson",
      "contentRecordId",
      "contentSha256",
      "entityId",
      "entityType",
      "generatorReceiptSha256",
      "idempotencyKey",
      "locale",
      "organizationId",
      "origin",
      "revisionId",
      "seoJson",
      "sourceSha256",
      "structuredDataJson",
      "summary",
      "tenantId",
      "title",
    ]) ||
    !isUuidV7(value.tenantId) ||
    !isUuidV7(value.organizationId) ||
    !isUuidV7(value.contentRecordId) ||
    !isUuidV7(value.revisionId) ||
    value.contentRecordId.toLowerCase() === value.revisionId.toLowerCase() ||
    !PUBLIC_WEB_ENTITY_TYPES.includes(value.entityType as PublicWebEntityType) ||
    !Number.isSafeInteger(value.entityId) ||
    Number(value.entityId) < 1 ||
    Number(value.entityId) > MAX_ENTITY_ID ||
    typeof value.locale !== "string" ||
    normalizePublicWebLocale(value.locale) !== value.locale ||
    typeof value.canonicalSlug !== "string" ||
    typeof value.canonicalPath !== "string" ||
    !["HUMAN", "AI_ASSISTED", "IMPORT"].includes(String(value.origin)) ||
    typeof value.title !== "string" ||
    value.title !== value.title.trim() ||
    value.title.length < 1 ||
    value.title.length > 500 ||
    !(value.summary === null || (typeof value.summary === "string" && value.summary.length <= 4_000)) ||
    !validJsonDocument(value.contentJson, 1_048_576) ||
    !validJsonDocument(value.seoJson, 65_536) ||
    !validJsonDocument(value.structuredDataJson, 262_144) ||
    typeof value.sourceSha256 !== "string" ||
    !SHA256_RE.test(value.sourceSha256) ||
    typeof value.contentSha256 !== "string" ||
    !SHA256_RE.test(value.contentSha256) ||
    !(
      value.generatorReceiptSha256 === null ||
      (typeof value.generatorReceiptSha256 === "string" && SHA256_RE.test(value.generatorReceiptSha256))
    ) ||
    ((value.origin === "AI_ASSISTED") !== (value.generatorReceiptSha256 !== null)) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY_RE.test(value.idempotencyKey)
  ) {
    return null;
  }

  const entityType = value.entityType as PublicWebEntityType;
  const locale = value.locale as PublicWebLocale;
  let slug: string;
  let expectedPath: string;
  try {
    slug = normalizePublicWebSlug(value.canonicalSlug);
    expectedPath = buildPublicWebCanonicalPath({
      entityType,
      entityId: Number(value.entityId),
      locale,
      slug,
    });
  } catch {
    return null;
  }
  if (
    slug !== value.canonicalSlug ||
    expectedPath !== value.canonicalPath ||
    (entityType === "PAGE" && isReservedPublicPageSlug(slug))
  ) {
    return null;
  }

  const command: PublicWebDraftIntakeCommand = {
    tenantId: value.tenantId.toLowerCase(),
    organizationId: value.organizationId.toLowerCase(),
    contentRecordId: value.contentRecordId.toLowerCase(),
    revisionId: value.revisionId.toLowerCase(),
    entityType,
    entityId: Number(value.entityId),
    locale,
    canonicalSlug: slug,
    canonicalPath: expectedPath,
    origin: value.origin as PublicWebRevisionOrigin,
    title: value.title,
    summary: value.summary,
    contentJson: value.contentJson,
    seoJson: value.seoJson,
    structuredDataJson: value.structuredDataJson,
    sourceSha256: value.sourceSha256,
    contentSha256: value.contentSha256,
    generatorReceiptSha256: value.generatorReceiptSha256,
    idempotencyKey: value.idempotencyKey,
  };
  if (hashPublicWebDraftRevision(command) !== command.contentSha256) return null;
  return command;
}

export function authorizePublicWebDraftIntakeCommand(input: {
  context: VerifiedActiveTenantContext;
  state: ResolvedActiveContextState;
  sessionBinding: PublicWebDraftSessionBinding;
  command: unknown;
  impersonating: boolean;
  now?: number;
}): PublicWebDraftIntakeAuthorizationResult {
  const now = input.now ?? Date.now();
  const command = parsePublicWebDraftIntakeCommand(input.command);
  if (!command || typeof input.impersonating !== "boolean" || !Number.isSafeInteger(now) || now < 0) {
    return { ok: false, reason: "invalid_command" };
  }
  if (!isSelectionBoundActiveTenantContext(input.context, now)) {
    return { ok: false, reason: "context_not_selection_bound" };
  }
  if (
    !isRecord(input.sessionBinding) ||
    !hasExactKeys(input.sessionBinding, ["sessionFingerprint", "sessionId"]) ||
    typeof input.sessionBinding.sessionId !== "string" ||
    !SESSION_ID_RE.test(input.sessionBinding.sessionId) ||
    typeof input.sessionBinding.sessionFingerprint !== "string" ||
    !SESSION_ID_RE.test(input.sessionBinding.sessionFingerprint) ||
    crypto.createHash("sha256").update(input.sessionBinding.sessionId, "utf8").digest("hex") !==
      input.sessionBinding.sessionFingerprint
  ) {
    return { ok: false, reason: "context_not_selection_bound" };
  }
  if (input.impersonating) return { ok: false, reason: "impersonation_forbidden" };
  if (
    input.context.legacyBranchId !== null ||
    input.state.membership?.legacyBranchId !== null
  ) {
    return {
      ok: false,
      reason: "authorization_denied",
      detail: "legacy_branch_scope_forbidden",
    };
  }

  const decision = evaluateActiveTenantCapability({
    context: input.context,
    state: input.state,
    capabilityKey: "public_web.content.write",
    resource: {
      type: "PUBLIC_WEB_CONTENT",
      id: command.contentRecordId,
      tenantId: command.tenantId,
      organizationId: command.organizationId,
      legacyBranchId: input.context.legacyBranchId,
    },
    stepUpSatisfied: false,
    approvalSatisfied: false,
    now,
  });
  if (!decision.allowed) {
    return {
      ok: false,
      reason: "authorization_denied",
      detail: decision.reason,
      decisionReceipt: decision.receipt,
    };
  }
  return {
    ok: true,
    value: {
      command,
      capabilityKey: "public_web.content.write",
      requestHash: hashPublicWebDraftIntakeCommand(command),
      decisionReceipt: decision.receipt,
      executionBinding: {
        contextId: input.context.contextId,
        contextIssuedAt: input.context.issuedAt,
        contextExpiresAt: input.context.expiresAt,
        sessionId: input.sessionBinding.sessionId,
        sessionFingerprint: input.sessionBinding.sessionFingerprint,
        selectionId: input.context.selectionId,
        sessionGeneration: input.context.sessionGeneration,
      },
    },
  };
}
