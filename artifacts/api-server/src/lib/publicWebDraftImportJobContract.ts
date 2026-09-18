import crypto from "node:crypto";
import { types as utilTypes } from "node:util";

import { canonicalJson } from "./jsonCanonical.js";
import {
  PUBLIC_WEB_ENTITY_TYPES,
  type PublicWebEntityType,
  type PublicWebLocale,
} from "./publicWebContentContract.js";
import { PROGRAM_SUPPORTED_LOCALES } from "./programTranslationContract.js";
import {
  isVerifiedPublicWebDraftPreviewReceiptClaims,
  type VerifiedPublicWebDraftPreviewReceiptClaims,
} from "./publicWebDraftPreviewReceipt.js";
import {
  getPublicWebDraftImportPrivateItemsForServerPlan,
  isVerifiedPublicWebDraftImportMaterializedServerPlan,
  type PublicWebDraftImportPrivateItemPayload,
} from "./publicWebDraftImportServerPlan.js";

const MAX_JOB_ITEMS = 100;
const MAX_SERVER_PLAN_BYTES = 256 * 1024;
const MAX_PREVIEW_RECEIPT_TOKEN_BYTES = 8 * 1024;
const MAX_ENTITY_ID = 2_147_483_647;
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const REQUEST_KEY_RE = /^[a-z0-9][a-z0-9._:-]{7,159}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const ADAPTER_ID_RE = /^[a-z][a-z0-9._-]{2,63}$/;
const ADAPTER_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PREVIEW_NONCE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const PREVIEW_RECEIPT_TOKEN_RE =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const RELEASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const SERVER_IDENTITY_KEYS = [
  "activeContextExpiresAt",
  "activeContextId",
  "actorLegacyUserId",
  "actorPrincipalId",
  "membershipId",
  "organizationId",
  "selectionId",
  "sessionFingerprint",
  "sessionGeneration",
  "tenantId",
] as const;
const CLIENT_REQUEST_KEYS = [
  "confirmPartial",
  "kind",
  "previewReceiptToken",
  "requestKey",
  "schemaVersion",
] as const;
const SERVER_PLAN_KEYS = [
  "acceptedItems",
  "adapterApprovalSha256",
  "adapterId",
  "adapterVersion",
  "manifestSha256",
  "mappingSha256",
  "planSha256",
  "previewNonce",
  "previewReceiptTokenSha256",
  "requiresPartialConfirmation",
  "runtimeReleaseId",
] as const;
const ITEM_KEYS = [
  "contentRecordId",
  "entityId",
  "entityType",
  "idempotencyKey",
  "index",
  "itemId",
  "locale",
  "requestHash",
  "revisionId",
  "sourceSha256",
] as const;
const EXPECTED_STATUS_ITEM_KEYS = ["index", "itemId"] as const;
const STATUS_ITEM_KEYS = ["index", "itemId", "state"] as const;
const ENQUEUE_INPUT_KEYS = [
  "clientRequest",
  "serverIdentity",
  "serverPlan",
  "verifiedReceiptClaims",
] as const;
const ENQUEUE_INPUT_KEYS_WITH_NOW = [...ENQUEUE_INPUT_KEYS, "now"] as const;
const STATUS_INPUT_KEYS = [
  "expectedItems",
  "expectedItemSetSha256",
  "items",
  "jobId",
  "state",
] as const;
const PRIVATE_ITEMS_BY_ENQUEUE_RESULT = new WeakMap<
  object,
  ReadonlyArray<PublicWebDraftImportPrivateItemPayload>
>();

export const PUBLIC_WEB_DRAFT_IMPORT_DURABILITY_REQUIREMENTS = Object.freeze({
  schemaVersion: 1 as const,
  enforcedByThisPureContract: false as const,
  nonceConsumption: "REQUIRED_ATOMIC_SINGLE_USE_DATABASE_CONSUMPTION" as const,
  leaseFencing: "REQUIRED_MONOTONIC_DATABASE_LEASE_TOKEN" as const,
  statusItemSet: "REQUIRED_EXACT_DATABASE_ITEM_SET" as const,
});

export const PUBLIC_WEB_DRAFT_IMPORT_JOB_STATES = [
  "QUEUED",
  "RUNNING",
  "RETRY_WAIT",
  "CANCEL_REQUESTED",
  "SUCCEEDED",
  "PARTIALLY_SUCCEEDED",
  "DEAD_LETTER",
  "CANCELED",
] as const;

export type PublicWebDraftImportJobState =
  (typeof PUBLIC_WEB_DRAFT_IMPORT_JOB_STATES)[number];

export const PUBLIC_WEB_DRAFT_IMPORT_ITEM_STATES = [
  "PENDING",
  "RUNNING",
  "RETRY_WAIT",
  "APPLIED",
  "REPLAY",
  "TERMINAL_FAILED",
  "CANCELED",
] as const;

export type PublicWebDraftImportItemState =
  (typeof PUBLIC_WEB_DRAFT_IMPORT_ITEM_STATES)[number];

export type PublicWebDraftImportJobServerIdentity = {
  tenantId: string;
  organizationId: string;
  actorPrincipalId: string;
  actorLegacyUserId: number;
  membershipId: string;
  selectionId: string;
  sessionGeneration: number;
  sessionFingerprint: string;
  activeContextId: string;
  activeContextExpiresAt: number;
};

export type PublicWebDraftImportAcceptedItem = {
  itemId: string;
  index: number;
  entityType: PublicWebEntityType;
  entityId: number;
  locale: PublicWebLocale;
  contentRecordId: string;
  revisionId: string;
  sourceSha256: string;
  requestHash: string;
  idempotencyKey: string;
};

export type PublicWebDraftImportJobEnqueueCommand = {
  schemaVersion: 1;
  kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT_JOB";
  requestKey: string;
  manifestSha256: string;
  planSha256: string;
  adapterId: string;
  adapterVersion: string;
  adapterApprovalSha256: string;
  mappingSha256: string;
  runtimeReleaseId: string;
  confirmPartial: boolean;
  acceptedItems: ReadonlyArray<Readonly<PublicWebDraftImportAcceptedItem>>;
  expectedItemSetSha256: string;
  identity: Readonly<PublicWebDraftImportJobServerIdentity>;
  receipt: Readonly<{
    keyId: string;
    issuedAt: number;
    expiresAt: number;
    nonce: string;
    tokenSha256: string;
  }>;
  requestDigestSha256: string;
  commandSha256: string;
};

export type PublicWebDraftImportJobEnqueueResult =
  | {
      ok: true;
      command: Readonly<PublicWebDraftImportJobEnqueueCommand>;
      durabilityRequirements: typeof PUBLIC_WEB_DRAFT_IMPORT_DURABILITY_REQUIREMENTS;
    }
  | {
      ok: false;
      reason:
        | "server_identity_invalid"
        | "server_plan_invalid"
        | "enqueue_invalid"
        | "server_clock_invalid"
        | "preview_receipt_mismatch"
        | "partial_confirmation_required"
        | "partial_confirmation_unexpected";
    };

/**
 * Returns persistence-only commands solely for the exact successful enqueue
 * result produced in this process. They are never enumerable or serialized as
 * part of the public enqueue result.
 */
export function getPublicWebDraftImportEnqueuePrivateItems(
  result: unknown,
): ReadonlyArray<PublicWebDraftImportPrivateItemPayload> | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  return PRIVATE_ITEMS_BY_ENQUEUE_RESULT.get(result) ?? null;
}

type PublicWebDraftImportClientRequest = {
  schemaVersion: 1;
  kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT_JOB";
  requestKey: string;
  previewReceiptToken: string;
  confirmPartial: boolean;
};

type PublicWebDraftImportServerPlan = {
  manifestSha256: string;
  planSha256: string;
  adapterId: string;
  adapterVersion: string;
  adapterApprovalSha256: string;
  mappingSha256: string;
  runtimeReleaseId: string;
  previewNonce: string;
  previewReceiptTokenSha256: string;
  acceptedItems: ReadonlyArray<Readonly<PublicWebDraftImportAcceptedItem>>;
  requiresPartialConfirmation: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = descriptors[key];
      return descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.enumerable === true &&
        descriptor.get === undefined &&
        descriptor.set === undefined;
    });
  } catch {
    return false;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isDenseDataArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >;
    const lengthDescriptor = descriptors["length"];
    const lengthValue = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      !lengthDescriptor ||
      typeof lengthValue !== "number" ||
      !Number.isSafeInteger(lengthValue) ||
      lengthValue < minimumLength ||
      lengthValue > maximumLength
    ) {
      return false;
    }
    const length = lengthValue;
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.some((key) => typeof key !== "string") ||
      ownKeys.length !== length + 1
    ) {
      return false;
    }
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        return false;
      }
    }
    return ownKeys.every((key) => key === "length" ||
      /^(0|[1-9][0-9]*)$/.test(String(key)));
  } catch {
    return false;
  }
}

function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_RE.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

function parseServerIdentity(
  value: unknown,
): PublicWebDraftImportJobServerIdentity | null {
  if (!isRecord(value) || !hasExactKeys(value, SERVER_IDENTITY_KEYS)) return null;
  if (
    !isUuidV7(value.tenantId) ||
    !isUuidV7(value.organizationId) ||
    value.tenantId.toLowerCase() === value.organizationId.toLowerCase() ||
    !isUuidV7(value.actorPrincipalId) ||
    !Number.isSafeInteger(value.actorLegacyUserId) ||
    Number(value.actorLegacyUserId) < 1 ||
    Number(value.actorLegacyUserId) > MAX_ENTITY_ID ||
    !isUuidV7(value.membershipId) ||
    !isUuidV7(value.selectionId) ||
    !Number.isSafeInteger(value.sessionGeneration) ||
    Number(value.sessionGeneration) < 1 ||
    !isSha256(value.sessionFingerprint) ||
    !isUuidV7(value.activeContextId) ||
    !Number.isSafeInteger(value.activeContextExpiresAt) ||
    Number(value.activeContextExpiresAt) < 1
  ) {
    return null;
  }
  return {
    tenantId: value.tenantId.toLowerCase(),
    organizationId: value.organizationId.toLowerCase(),
    actorPrincipalId: value.actorPrincipalId.toLowerCase(),
    actorLegacyUserId: Number(value.actorLegacyUserId),
    membershipId: value.membershipId.toLowerCase(),
    selectionId: value.selectionId.toLowerCase(),
    sessionGeneration: Number(value.sessionGeneration),
    sessionFingerprint: value.sessionFingerprint,
    activeContextId: value.activeContextId.toLowerCase(),
    activeContextExpiresAt: Number(value.activeContextExpiresAt),
  };
}

function parseAcceptedItem(
  value: unknown,
): PublicWebDraftImportAcceptedItem | null {
  if (!isRecord(value) || !hasExactKeys(value, ITEM_KEYS)) return null;
  if (
    !isUuidV7(value.itemId) ||
    !Number.isSafeInteger(value.index) ||
    Number(value.index) < 0 ||
    Number(value.index) > 99 ||
    !PUBLIC_WEB_ENTITY_TYPES.includes(value.entityType as PublicWebEntityType) ||
    !Number.isSafeInteger(value.entityId) ||
    Number(value.entityId) < 1 ||
    Number(value.entityId) > MAX_ENTITY_ID ||
    !PROGRAM_SUPPORTED_LOCALES.includes(value.locale as PublicWebLocale) ||
    !isUuidV7(value.contentRecordId) ||
    !isUuidV7(value.revisionId) ||
    value.itemId.toLowerCase() === value.contentRecordId.toLowerCase() ||
    value.itemId.toLowerCase() === value.revisionId.toLowerCase() ||
    value.contentRecordId.toLowerCase() === value.revisionId.toLowerCase() ||
    !isSha256(value.sourceSha256) ||
    !isSha256(value.requestHash) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY_RE.test(value.idempotencyKey)
  ) {
    return null;
  }
  return {
    itemId: value.itemId.toLowerCase(),
    index: Number(value.index),
    entityType: value.entityType as PublicWebEntityType,
    entityId: Number(value.entityId),
    locale: value.locale as PublicWebLocale,
    contentRecordId: value.contentRecordId.toLowerCase(),
    revisionId: value.revisionId.toLowerCase(),
    sourceSha256: value.sourceSha256,
    requestHash: value.requestHash,
    idempotencyKey: value.idempotencyKey,
  };
}

function parseClientRequest(value: unknown): PublicWebDraftImportClientRequest | null {
  if (!isRecord(value) || !hasExactKeys(value, CLIENT_REQUEST_KEYS)) return null;
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "FAS_PUBLIC_WEB_DRAFT_IMPORT_JOB" ||
    typeof value.requestKey !== "string" ||
    !REQUEST_KEY_RE.test(value.requestKey) ||
    typeof value.previewReceiptToken !== "string" ||
    Buffer.byteLength(value.previewReceiptToken, "utf8") < 1 ||
    Buffer.byteLength(value.previewReceiptToken, "utf8") > MAX_PREVIEW_RECEIPT_TOKEN_BYTES ||
    !PREVIEW_RECEIPT_TOKEN_RE.test(value.previewReceiptToken) ||
    typeof value.confirmPartial !== "boolean"
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT_JOB",
    requestKey: value.requestKey,
    previewReceiptToken: value.previewReceiptToken,
    confirmPartial: value.confirmPartial,
  };
}

function parseServerPlan(value: unknown): PublicWebDraftImportServerPlan | null {
  if (!isVerifiedPublicWebDraftImportMaterializedServerPlan(value)) return null;
  if (!isRecord(value) || !hasExactKeys(value, SERVER_PLAN_KEYS)) return null;
  if (
    !isSha256(value.manifestSha256) ||
    !isSha256(value.planSha256) ||
    typeof value.adapterId !== "string" ||
    !ADAPTER_ID_RE.test(value.adapterId) ||
    typeof value.adapterVersion !== "string" ||
    !ADAPTER_VERSION_RE.test(value.adapterVersion) ||
    !isSha256(value.adapterApprovalSha256) ||
    !isSha256(value.mappingSha256) ||
    typeof value.runtimeReleaseId !== "string" ||
    !RELEASE_ID_RE.test(value.runtimeReleaseId) ||
    typeof value.previewNonce !== "string" ||
    !PREVIEW_NONCE_RE.test(value.previewNonce) ||
    !isSha256(value.previewReceiptTokenSha256) ||
    typeof value.requiresPartialConfirmation !== "boolean" ||
    !isDenseDataArray(value.acceptedItems, 1, MAX_JOB_ITEMS)
  ) {
    return null;
  }
  const acceptedItems = value.acceptedItems.map(parseAcceptedItem);
  if (acceptedItems.some((item) => item === null)) return null;
  const items = acceptedItems as PublicWebDraftImportAcceptedItem[];
  const indexes = new Set<number>();
  const targets = new Set<string>();
  const contentIds = new Set<string>();
  const revisionIds = new Set<string>();
  const itemIds = new Set<string>();
  const requestHashes = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const item of items) {
    const target = `${item.entityType}:${item.entityId}:${item.locale}`;
    if (
      indexes.has(item.index) ||
      itemIds.has(item.itemId) ||
      targets.has(target) ||
      contentIds.has(item.contentRecordId) ||
      revisionIds.has(item.revisionId) ||
      requestHashes.has(item.requestHash) ||
      idempotencyKeys.has(item.idempotencyKey)
    ) {
      return null;
    }
    indexes.add(item.index);
    itemIds.add(item.itemId);
    targets.add(target);
    contentIds.add(item.contentRecordId);
    revisionIds.add(item.revisionId);
    requestHashes.add(item.requestHash);
    idempotencyKeys.add(item.idempotencyKey);
  }
  let serialized: string;
  try {
    serialized = canonicalJson(value);
  } catch {
    return null;
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_SERVER_PLAN_BYTES) return null;
  return {
    manifestSha256: value.manifestSha256,
    planSha256: value.planSha256,
    adapterId: value.adapterId,
    adapterVersion: value.adapterVersion,
    adapterApprovalSha256: value.adapterApprovalSha256,
    mappingSha256: value.mappingSha256,
    runtimeReleaseId: value.runtimeReleaseId,
    previewNonce: value.previewNonce,
    previewReceiptTokenSha256: value.previewReceiptTokenSha256,
    requiresPartialConfirmation: value.requiresPartialConfirmation,
    acceptedItems: Object.freeze(
      items
        .sort((left, right) => left.index - right.index)
        .map((item) => Object.freeze(item)),
    ),
  };
}

function domainSeparatedSha256(domain: string, value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function receiptMatchesServerState(
  claims: VerifiedPublicWebDraftPreviewReceiptClaims,
  identity: PublicWebDraftImportJobServerIdentity,
  plan: PublicWebDraftImportServerPlan,
  tokenSha256: string,
): boolean {
  return claims.tenantId === identity.tenantId &&
    claims.organizationId === identity.organizationId &&
    claims.actorLegacyUserId === identity.actorLegacyUserId &&
    claims.actorPrincipalId === identity.actorPrincipalId &&
    claims.membershipId === identity.membershipId &&
    claims.selectionId === identity.selectionId &&
    claims.sessionGeneration === identity.sessionGeneration &&
    claims.sessionFingerprint === identity.sessionFingerprint &&
    claims.activeContextId === identity.activeContextId &&
    claims.activeContextExpiresAt === identity.activeContextExpiresAt &&
    claims.manifestSha256 === plan.manifestSha256 &&
    claims.planSha256 === plan.planSha256 &&
    claims.adapterId === plan.adapterId &&
    claims.adapterVersion === plan.adapterVersion &&
    claims.adapterApprovalSha256 === plan.adapterApprovalSha256 &&
    claims.mappingSha256 === plan.mappingSha256 &&
    claims.runtimeReleaseId === plan.runtimeReleaseId &&
    claims.nonce === plan.previewNonce &&
    tokenSha256 === plan.previewReceiptTokenSha256;
}

export function parsePublicWebDraftImportJobEnqueue(input: {
  clientRequest: unknown;
  serverIdentity: unknown;
  serverPlan: unknown;
  verifiedReceiptClaims: unknown;
  now?: number;
}): PublicWebDraftImportJobEnqueueResult {
  if (
    !isRecord(input) ||
    (
      !hasExactKeys(input, ENQUEUE_INPUT_KEYS) &&
      !hasExactKeys(input, ENQUEUE_INPUT_KEYS_WITH_NOW)
    )
  ) {
    return { ok: false, reason: "enqueue_invalid" };
  }
  const identity = parseServerIdentity(input.serverIdentity);
  if (!identity) return { ok: false, reason: "server_identity_invalid" };
  const request = parseClientRequest(input?.clientRequest);
  if (!request) return { ok: false, reason: "enqueue_invalid" };
  const serverPlanCandidate = input?.serverPlan;
  const privateItems = getPublicWebDraftImportPrivateItemsForServerPlan(
    serverPlanCandidate,
  );
  if (!privateItems) return { ok: false, reason: "server_plan_invalid" };
  const plan = parseServerPlan(serverPlanCandidate);
  if (!plan) return { ok: false, reason: "server_plan_invalid" };
  const now = input?.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    return { ok: false, reason: "server_clock_invalid" };
  }
  if (!isVerifiedPublicWebDraftPreviewReceiptClaims(
    input?.verifiedReceiptClaims,
    { token: request.previewReceiptToken, now },
  )) {
    return { ok: false, reason: "preview_receipt_mismatch" };
  }
  const claims = input.verifiedReceiptClaims;
  const tokenSha256 = crypto
    .createHash("sha256")
    .update(request.previewReceiptToken, "utf8")
    .digest("hex");
  if (!receiptMatchesServerState(claims, identity, plan, tokenSha256)) {
    return { ok: false, reason: "preview_receipt_mismatch" };
  }
  if (plan.requiresPartialConfirmation && !request.confirmPartial) {
    return { ok: false, reason: "partial_confirmation_required" };
  }
  if (!plan.requiresPartialConfirmation && request.confirmPartial) {
    return { ok: false, reason: "partial_confirmation_unexpected" };
  }
  const frozenIdentity = Object.freeze(identity);
  const receipt = Object.freeze({
    keyId: claims.keyId,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    nonce: claims.nonce,
    tokenSha256,
  });
  const requestDigestSha256 = domainSeparatedSha256(
    "fas.public-web.draft-import-job-request.v1\0",
    {
      schemaVersion: request.schemaVersion,
      kind: request.kind,
      requestKey: request.requestKey,
      confirmPartial: request.confirmPartial,
      scope: {
        tenantId: identity.tenantId,
        organizationId: identity.organizationId,
      },
      actor: {
        actorLegacyUserId: identity.actorLegacyUserId,
        actorPrincipalId: identity.actorPrincipalId,
        membershipId: identity.membershipId,
      },
      manifestSha256: plan.manifestSha256,
      planSha256: plan.planSha256,
      adapterId: plan.adapterId,
      adapterVersion: plan.adapterVersion,
      adapterApprovalSha256: plan.adapterApprovalSha256,
      mappingSha256: plan.mappingSha256,
      runtimeReleaseId: plan.runtimeReleaseId,
    },
  );
  const expectedItemSetSha256 = domainSeparatedSha256(
    "fas.public-web.draft-import-job-item-set.v1\0",
    plan.acceptedItems.map(({ itemId, index }) => ({ itemId, index })),
  );
  const commandWithoutHash: Omit<
    PublicWebDraftImportJobEnqueueCommand,
    "commandSha256"
  > = {
    schemaVersion: request.schemaVersion,
    kind: request.kind,
    requestKey: request.requestKey,
    manifestSha256: plan.manifestSha256,
    planSha256: plan.planSha256,
    adapterId: plan.adapterId,
    adapterVersion: plan.adapterVersion,
    adapterApprovalSha256: plan.adapterApprovalSha256,
    mappingSha256: plan.mappingSha256,
    runtimeReleaseId: plan.runtimeReleaseId,
    confirmPartial: request.confirmPartial,
    acceptedItems: plan.acceptedItems,
    expectedItemSetSha256,
    identity: frozenIdentity,
    receipt,
    requestDigestSha256,
  };
  const commandSha256 = domainSeparatedSha256(
    "fas.public-web.draft-import-job-command.v1\0",
    commandWithoutHash,
  );
  const result = Object.freeze({
    ok: true,
    command: Object.freeze({ ...commandWithoutHash, commandSha256 }),
    durabilityRequirements: PUBLIC_WEB_DRAFT_IMPORT_DURABILITY_REQUIREMENTS,
  });
  PRIVATE_ITEMS_BY_ENQUEUE_RESULT.set(result, privateItems);
  return result;
}

const JOB_TRANSITIONS: Readonly<Record<PublicWebDraftImportJobState, readonly PublicWebDraftImportJobState[]>> = {
  QUEUED: ["RUNNING", "CANCEL_REQUESTED"],
  RUNNING: ["RETRY_WAIT", "CANCEL_REQUESTED", "SUCCEEDED", "PARTIALLY_SUCCEEDED", "DEAD_LETTER"],
  RETRY_WAIT: ["RUNNING", "CANCEL_REQUESTED"],
  CANCEL_REQUESTED: ["CANCELED"],
  SUCCEEDED: [],
  PARTIALLY_SUCCEEDED: [],
  DEAD_LETTER: [],
  CANCELED: [],
};

const ITEM_TRANSITIONS: Readonly<Record<PublicWebDraftImportItemState, readonly PublicWebDraftImportItemState[]>> = {
  PENDING: ["RUNNING", "CANCELED"],
  RUNNING: ["RETRY_WAIT", "APPLIED", "REPLAY", "TERMINAL_FAILED", "CANCELED"],
  RETRY_WAIT: ["RUNNING", "CANCELED"],
  APPLIED: [],
  REPLAY: [],
  TERMINAL_FAILED: [],
  CANCELED: [],
};

export function canTransitionPublicWebDraftImportJob(
  from: PublicWebDraftImportJobState,
  to: PublicWebDraftImportJobState,
): boolean {
  return PUBLIC_WEB_DRAFT_IMPORT_JOB_STATES.includes(from) &&
    PUBLIC_WEB_DRAFT_IMPORT_JOB_STATES.includes(to) &&
    JOB_TRANSITIONS[from].includes(to);
}

export function canTransitionPublicWebDraftImportItem(
  from: PublicWebDraftImportItemState,
  to: PublicWebDraftImportItemState,
): boolean {
  return PUBLIC_WEB_DRAFT_IMPORT_ITEM_STATES.includes(from) &&
    PUBLIC_WEB_DRAFT_IMPORT_ITEM_STATES.includes(to) &&
    ITEM_TRANSITIONS[from].includes(to);
}

const TRANSIENT_CONNECTION_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08006",
  "08007",
  "57P01",
  "57P02",
  "57P03",
]);

export type PublicWebDraftImportRetryDecision = {
  retryable: boolean;
  category:
    | "transaction"
    | "lock"
    | "connection"
    | "source_changed"
    | "authority"
    | "idempotency"
    | "unknown";
  publicCode: string;
};

function failureFields(error: unknown): Readonly<{
  code: string | null;
  message: string | null;
}> {
  if (typeof error === "string" && error.length <= 64) {
    return { code: error, message: null };
  }
  if (
    error === null ||
    (typeof error !== "object" && typeof error !== "function") ||
    utilTypes.isProxy(error)
  ) {
    return { code: null, message: null };
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(error);
    const codeDescriptor = descriptors.code;
    const messageDescriptor = descriptors.message;
    const code = codeDescriptor &&
      "value" in codeDescriptor &&
      typeof codeDescriptor.value === "string" &&
      codeDescriptor.value.length <= 64
      ? codeDescriptor.value
      : null;
    const message = messageDescriptor &&
      "value" in messageDescriptor &&
      typeof messageDescriptor.value === "string" &&
      messageDescriptor.value.length <= 256
      ? messageDescriptor.value
      : null;
    return { code, message };
  } catch {
    return { code: null, message: null };
  }
}

export function classifyPublicWebDraftImportFailure(
  error: unknown,
): PublicWebDraftImportRetryDecision {
  const fields = failureFields(error);
  const code = fields.code;
  // The database intentionally uses 40001 to abort a stale source snapshot.
  // That semantic conflict must be re-previewed, never retried as a normal
  // serialization failure.
  if (
    code === "40001" &&
    fields.message === "public web draft intake source changed"
  ) {
    return { retryable: false, category: "source_changed", publicCode: "source_changed" };
  }
  if (code === "40001" || code === "40P01") {
    return { retryable: true, category: "transaction", publicCode: "transient_transaction" };
  }
  if (code === "55P03") {
    return { retryable: true, category: "lock", publicCode: "transient_lock" };
  }
  if (code !== null && TRANSIENT_CONNECTION_CODES.has(code)) {
    return { retryable: true, category: "connection", publicCode: "transient_connection" };
  }
  const normalized = code?.toLowerCase() ?? "";
  if (normalized === "source_changed" || normalized === "public_web_source_changed") {
    return { retryable: false, category: "source_changed", publicCode: "source_changed" };
  }
  if (
    normalized === "authority_changed" ||
    normalized === "authority_denied" ||
    normalized === "authorization_denied" ||
    normalized === "session_stale"
  ) {
    return { retryable: false, category: "authority", publicCode: "authority_invalid" };
  }
  if (
    normalized === "idempotency_conflict" ||
    normalized === "public_web_draft_intake_conflict"
  ) {
    return { retryable: false, category: "idempotency", publicCode: "idempotency_conflict" };
  }
  return { retryable: false, category: "unknown", publicCode: "terminal_failure" };
}

export type PublicWebDraftImportStatusProjection = {
  schemaVersion: 1;
  jobId: string;
  state: PublicWebDraftImportJobState;
  counts: {
    total: number;
    pending: number;
    running: number;
    retryWait: number;
    applied: number;
    replay: number;
    terminalFailed: number;
    canceled: number;
    completed: number;
  };
  percentComplete: number;
};

export type PublicWebDraftImportExpectedStatusItem = {
  itemId: string;
  index: number;
};

export function projectPublicWebDraftImportJobStatus(input: {
  jobId: unknown;
  state: unknown;
  expectedItemSetSha256: unknown;
  expectedItems: unknown;
  items: unknown;
}): PublicWebDraftImportStatusProjection | null {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, STATUS_INPUT_KEYS) ||
    !isUuidV7(input.jobId) ||
    !PUBLIC_WEB_DRAFT_IMPORT_JOB_STATES.includes(input.state as PublicWebDraftImportJobState) ||
    !isSha256(input.expectedItemSetSha256) ||
    !isDenseDataArray(input.expectedItems, 1, MAX_JOB_ITEMS) ||
    !isDenseDataArray(input.items, 1, MAX_JOB_ITEMS) ||
    input.items.length !== input.expectedItems.length
  ) {
    return null;
  }

  const expectedById = new Map<string, number>();
  const expectedByIndex = new Map<number, string>();
  for (const expected of input.expectedItems) {
    if (
      !isRecord(expected) ||
      !hasExactKeys(expected, EXPECTED_STATUS_ITEM_KEYS) ||
      !isUuidV7(expected.itemId) ||
      !Number.isSafeInteger(expected.index) ||
      Number(expected.index) < 0 ||
      Number(expected.index) > 99
    ) {
      return null;
    }
    const itemId = expected.itemId.toLowerCase();
    const index = Number(expected.index);
    if (expectedById.has(itemId) || expectedByIndex.has(index)) return null;
    expectedById.set(itemId, index);
    expectedByIndex.set(index, itemId);
  }
  const normalizedExpectedItems = [...expectedById.entries()]
    .map(([itemId, index]) => ({ itemId, index }))
    .sort((left, right) => left.index - right.index);
  if (
    domainSeparatedSha256(
      "fas.public-web.draft-import-job-item-set.v1\0",
      normalizedExpectedItems,
    ) !== input.expectedItemSetSha256
  ) {
    return null;
  }

  const states: PublicWebDraftImportItemState[] = [];
  const observedIds = new Set<string>();
  const observedIndexes = new Set<number>();
  for (const item of input.items) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, STATUS_ITEM_KEYS) ||
      !isUuidV7(item.itemId) ||
      !Number.isSafeInteger(item.index) ||
      Number(item.index) < 0 ||
      Number(item.index) > 99 ||
      !PUBLIC_WEB_DRAFT_IMPORT_ITEM_STATES.includes(item.state as PublicWebDraftImportItemState)
    ) {
      return null;
    }
    const itemId = item.itemId.toLowerCase();
    const index = Number(item.index);
    if (
      observedIds.has(itemId) ||
      observedIndexes.has(index) ||
      expectedById.get(itemId) !== index ||
      expectedByIndex.get(index) !== itemId
    ) {
      return null;
    }
    observedIds.add(itemId);
    observedIndexes.add(index);
    states.push(item.state as PublicWebDraftImportItemState);
  }
  if (
    observedIds.size !== expectedById.size ||
    observedIndexes.size !== expectedByIndex.size
  ) {
    return null;
  }
  const count = (state: PublicWebDraftImportItemState) =>
    states.filter((candidate) => candidate === state).length;
  const pending = count("PENDING");
  const running = count("RUNNING");
  const retryWait = count("RETRY_WAIT");
  const applied = count("APPLIED");
  const replay = count("REPLAY");
  const terminalFailed = count("TERMINAL_FAILED");
  const canceled = count("CANCELED");
  const succeeded = applied + replay;
  const completed = succeeded + terminalFailed + canceled;
  const total = states.length;
  const state = input.state as PublicWebDraftImportJobState;
  const consistent =
    (state === "QUEUED" && pending === total) ||
    (state === "RUNNING" && running > 0 && completed < total) ||
    (state === "RETRY_WAIT" && retryWait > 0 && running === 0 && completed < total) ||
    (state === "CANCEL_REQUESTED" && completed < total) ||
    (state === "SUCCEEDED" && completed === total && succeeded === total) ||
    (
      state === "PARTIALLY_SUCCEEDED" &&
      completed === total &&
      succeeded > 0 &&
      terminalFailed + canceled > 0
    ) ||
    (
      state === "DEAD_LETTER" &&
      completed === total &&
      succeeded === 0 &&
      terminalFailed > 0
    ) ||
    (state === "CANCELED" && completed === total && canceled > 0);
  if (!consistent) return null;
  return {
    schemaVersion: 1,
    jobId: input.jobId.toLowerCase(),
    state,
    counts: {
      total,
      pending,
      running,
      retryWait,
      applied,
      replay,
      terminalFailed,
      canceled,
      completed,
    },
    percentComplete: Math.floor((completed * 10_000) / total) / 100,
  };
}

export type PublicWebDraftImportCancellationDecision =
  | {
      accepted: true;
      nextState: "CANCEL_REQUESTED";
      directive: "STOP_BEFORE_NEXT_ITEM" | "FINISH_CURRENT_ITEM_THEN_STOP" | "ALREADY_REQUESTED";
    }
  | { accepted: false; nextState: null; directive: "TERMINAL_NO_ACTION" };

export function decidePublicWebDraftImportCancellation(
  state: PublicWebDraftImportJobState,
): PublicWebDraftImportCancellationDecision {
  if (state === "CANCEL_REQUESTED") {
    return { accepted: true, nextState: "CANCEL_REQUESTED", directive: "ALREADY_REQUESTED" };
  }
  if (state === "RUNNING") {
    return {
      accepted: true,
      nextState: "CANCEL_REQUESTED",
      directive: "FINISH_CURRENT_ITEM_THEN_STOP",
    };
  }
  if (state === "QUEUED" || state === "RETRY_WAIT") {
    return {
      accepted: true,
      nextState: "CANCEL_REQUESTED",
      directive: "STOP_BEFORE_NEXT_ITEM",
    };
  }
  return { accepted: false, nextState: null, directive: "TERMINAL_NO_ACTION" };
}
