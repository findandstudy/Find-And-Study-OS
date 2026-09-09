import crypto from "node:crypto";

import { canonicalJson } from "./jsonCanonical.js";
import {
  buildServerBoundPublicWebDraftIntake,
  type PublicWebDraftIntakeRequest,
  type PublicWebDraftScope,
  type PublicWebDraftSourceBinding,
} from "./publicWebDraftIntakeBuilder.js";
import {
  PUBLIC_WEB_ENTITY_TYPES,
  type PublicWebEntityType,
  type PublicWebLocale,
} from "./publicWebContentContract.js";
import { PROGRAM_SUPPORTED_LOCALES } from "./programTranslationContract.js";

const MAX_BATCH_ITEMS = 100;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const MAX_RESOLVER_CONCURRENCY = 4;
const MAX_ENTITY_ID = 2_147_483_647;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEYS = [
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
] as const;

export type PublicWebDraftBatchRejectReason =
  | "request_invalid"
  | "duplicate_target"
  | "duplicate_idempotency"
  | "source_missing"
  | "source_unavailable";

export type PublicWebDraftBatchAccepted = {
  index: number;
  request: PublicWebDraftIntakeRequest;
  source: PublicWebDraftSourceBinding;
};

export type PublicWebDraftBatchRejected = {
  index: number;
  reason: PublicWebDraftBatchRejectReason;
};

export type PublicWebDraftBatchPlan = {
  schemaVersion: 1;
  total: number;
  accepted: PublicWebDraftBatchAccepted[];
  rejected: PublicWebDraftBatchRejected[];
  planSha256: string;
};

type SourceResolver = (
  entityType: PublicWebEntityType,
  entityId: number,
) => Promise<PublicWebDraftSourceBinding | null>;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRequestReference(value: unknown): {
  request: PublicWebDraftIntakeRequest;
  entityType: PublicWebEntityType;
  entityId: number;
  locale: PublicWebLocale;
  idempotencyKey: string;
} | null {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join("\0") !== [...REQUEST_KEYS].sort().join("\0") ||
    !PUBLIC_WEB_ENTITY_TYPES.includes(value.entityType as PublicWebEntityType) ||
    !Number.isSafeInteger(value.entityId) ||
    Number(value.entityId) < 1 ||
    Number(value.entityId) > MAX_ENTITY_ID ||
    !PROGRAM_SUPPORTED_LOCALES.includes(value.locale as PublicWebLocale) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY_RE.test(value.idempotencyKey)
  ) {
    return null;
  }
  return {
    request: value as PublicWebDraftIntakeRequest,
    entityType: value.entityType as PublicWebEntityType,
    entityId: Number(value.entityId),
    locale: value.locale as PublicWebLocale,
    idempotencyKey: value.idempotencyKey,
  };
}

function validationIdentities(index: number) {
  const prefix = String(index + 1).padStart(8, "0");
  return [
    `${prefix}-0000-7000-8000-000000000001`,
    `${prefix}-0000-7000-8000-000000000002`,
  ];
}

function count(values: Array<string | null>) {
  const result = new Map<string, number>();
  for (const value of values) {
    if (value !== null) result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

export async function planPublicWebDraftBatch(input: {
  scope: PublicWebDraftScope;
  requests: unknown[];
  resolveSource: SourceResolver;
}): Promise<PublicWebDraftBatchPlan> {
  if (
    !input ||
    !isRecord(input.scope) ||
    !UUID_V7_RE.test(String(input.scope.tenantId)) ||
    !UUID_V7_RE.test(String(input.scope.organizationId)) ||
    input.scope.tenantId.toLowerCase() === input.scope.organizationId.toLowerCase() ||
    !Array.isArray(input.requests) ||
    input.requests.length < 1 ||
    input.requests.length > MAX_BATCH_ITEMS ||
    typeof input.resolveSource !== "function"
  ) {
    throw new Error("public_web_draft_batch_input_invalid");
  }
  let serialized: string;
  try {
    serialized = canonicalJson(input.requests);
  } catch {
    throw new Error("public_web_draft_batch_input_invalid");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_BATCH_BYTES) {
    throw new Error("public_web_draft_batch_oversized");
  }

  const references = input.requests.map(exactRequestReference);
  const targetCounts = count(references.map((reference) => reference
    ? `${reference.entityType}:${reference.entityId}:${reference.locale}`
    : null));
  const keyCounts = count(references.map((reference) => reference?.idempotencyKey ?? null));
  const accepted: PublicWebDraftBatchAccepted[] = [];
  const rejected: PublicWebDraftBatchRejected[] = [];
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= input.requests.length) return;
      const reference = references[index];
      if (!reference) {
        rejected.push({ index, reason: "request_invalid" });
        continue;
      }
      const target = `${reference.entityType}:${reference.entityId}:${reference.locale}`;
      if ((targetCounts.get(target) ?? 0) > 1) {
        rejected.push({ index, reason: "duplicate_target" });
        continue;
      }
      if ((keyCounts.get(reference.idempotencyKey) ?? 0) > 1) {
        rejected.push({ index, reason: "duplicate_idempotency" });
        continue;
      }
      let source: PublicWebDraftSourceBinding | null;
      try {
        source = await input.resolveSource(reference.entityType, reference.entityId);
      } catch {
        rejected.push({ index, reason: "source_unavailable" });
        continue;
      }
      if (!source) {
        rejected.push({ index, reason: "source_missing" });
        continue;
      }
      const identities = validationIdentities(index);
      const built = buildServerBoundPublicWebDraftIntake({
        scope: input.scope,
        source,
        request: reference.request,
        now: 2_000_000_000_000,
        newUuidV7: () => identities.shift() ?? "",
      });
      if (!built.ok) {
        rejected.push({ index, reason: "request_invalid" });
        continue;
      }
      accepted.push({ index, request: reference.request, source });
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_RESOLVER_CONCURRENCY, input.requests.length) },
      () => worker(),
    ),
  );
  accepted.sort((left, right) => left.index - right.index);
  rejected.sort((left, right) => left.index - right.index);
  const planSha256 = crypto
    .createHash("sha256")
    .update("fas.public-web.draft-batch-plan.v1\0", "utf8")
    .update(canonicalJson({ accepted, rejected, total: input.requests.length }), "utf8")
    .digest("hex");
  return {
    schemaVersion: 1,
    total: input.requests.length,
    accepted,
    rejected,
    planSha256,
  };
}
