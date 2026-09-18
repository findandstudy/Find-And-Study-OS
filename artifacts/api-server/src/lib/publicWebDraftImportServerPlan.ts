import crypto from "node:crypto";

import { canonicalJson } from "./jsonCanonical.js";
import {
  isVerifiedPublicWebDraftBatchPlan,
  type PublicWebDraftBatchPlan,
  type PublicWebDraftBatchRejectReason,
} from "./publicWebDraftBatchPlanner.js";
import {
  buildServerBoundPublicWebDraftIntake,
} from "./publicWebDraftIntakeBuilder.js";
import type { PublicWebDraftIntakeCommand } from "./publicWebDraftIntakeCommand.js";
import type {
  PublicWebDraftImportAcceptedItem,
} from "./publicWebDraftImportJobContract.js";
import {
  isVerifiedPublicWebDraftPreviewReceiptClaims,
  type VerifiedPublicWebDraftPreviewReceiptClaims,
} from "./publicWebDraftPreviewReceipt.js";

const MAX_BATCH_ITEMS = 100;
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PLAN_KEYS = [
  "accepted",
  "planSha256",
  "rejected",
  "schemaVersion",
  "total",
] as const;
const ACCEPTED_KEYS = ["index", "request", "source"] as const;
const REJECTED_KEYS = ["index", "reason"] as const;
const SOURCE_KEYS = ["entityId", "entityType", "sourceSha256"] as const;
const REJECT_REASONS = new Set<PublicWebDraftBatchRejectReason>([
  "request_invalid",
  "duplicate_target",
  "duplicate_idempotency",
  "source_missing",
  "source_unavailable",
]);
const PRIVATE_ITEMS_BY_RESULT = new WeakMap<
  object,
  ReadonlyArray<PublicWebDraftImportPrivateItemPayload>
>();
const PRIVATE_ITEMS_BY_SERVER_PLAN = new WeakMap<
  object,
  ReadonlyArray<PublicWebDraftImportPrivateItemPayload>
>();
const VERIFIED_SERVER_PLANS = new WeakSet<object>();

export type PublicWebDraftImportMaterializedServerPlan = Readonly<{
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
}>;

/**
 * Persistence-only payload. This object is not a response projection and must
 * never cross a public API, log, metric, receipt, or audit-detail boundary.
 * The public server plan deliberately contains only bounded item metadata.
 */
export type PublicWebDraftImportPrivateItemPayload = Readonly<{
  itemId: string;
  index: number;
  command: Readonly<PublicWebDraftIntakeCommand>;
  requestHash: string;
}>;

export type PublicWebDraftImportServerPlanMaterializationResult =
  | Readonly<{
      ok: true;
      serverPlan: PublicWebDraftImportMaterializedServerPlan;
    }>
  | Readonly<{
      ok: false;
      reason:
        | "materialization_invalid"
        | "preview_receipt_invalid"
        | "batch_plan_invalid"
        | "batch_plan_hash_mismatch"
        | "batch_plan_has_no_accepted_items"
        | "non_import_origin_forbidden"
        | "command_build_failed"
        | "generated_identity_invalid";
    }>;

export type PublicWebDraftImportUuidV7Factory = (observedAt: number) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_RE.test(value);
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function planSha256(
  plan: Pick<PublicWebDraftBatchPlan, "accepted" | "rejected" | "total">,
  claims: VerifiedPublicWebDraftPreviewReceiptClaims,
): string {
  return crypto
    .createHash("sha256")
    .update("fas.public-web.draft-batch-plan.v1\0", "utf8")
    .update(canonicalJson({
      accepted: plan.accepted,
      rejected: plan.rejected,
      scope: {
        tenantId: claims.tenantId,
        organizationId: claims.organizationId,
      },
      total: plan.total,
    }), "utf8")
    .digest("hex");
}

function hasExactIndexCoverage(value: {
  total: number;
  accepted: ReadonlyArray<{ index: number }>;
  rejected: ReadonlyArray<{ index: number }>;
}): boolean {
  if (value.accepted.length + value.rejected.length !== value.total) return false;
  const indexes = [...value.accepted, ...value.rejected]
    .map(({ index }) => index)
    .sort((left, right) => left - right);
  return indexes.every((index, expected) => index === expected);
}

function deepFreezeJson<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Returns persistence-only payloads solely for the exact in-process success
 * object produced by materializePublicWebDraftImportServerPlan. Clones, JSON
 * round-trips and caller-constructed lookalikes intentionally return null.
 */
export function getPublicWebDraftImportPrivateItems(
  result: unknown,
): ReadonlyArray<PublicWebDraftImportPrivateItemPayload> | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  return PRIVATE_ITEMS_BY_RESULT.get(result) ?? null;
}

/**
 * Brand-first guard for the exact immutable plan produced in this process.
 * Structural lookalikes, proxies and serialized/cloned plans are deliberately
 * rejected before any caller-controlled plan property can be read.
 */
export function isVerifiedPublicWebDraftImportMaterializedServerPlan(
  value: unknown,
): value is PublicWebDraftImportMaterializedServerPlan {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    VERIFIED_SERVER_PLANS.has(value);
}

/**
 * Persistence-only payload lookup for an exact branded server plan. This lets
 * the enqueue boundary carry the same private payload capability without ever
 * adding those values to its public command or JSON projection.
 */
export function getPublicWebDraftImportPrivateItemsForServerPlan(
  serverPlan: unknown,
): ReadonlyArray<PublicWebDraftImportPrivateItemPayload> | null {
  if (!isVerifiedPublicWebDraftImportMaterializedServerPlan(serverPlan)) {
    return null;
  }
  return PRIVATE_ITEMS_BY_SERVER_PLAN.get(serverPlan) ?? null;
}

function validPlanEnvelope(value: unknown): value is PublicWebDraftBatchPlan {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PLAN_KEYS) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.total) ||
    Number(value.total) < 1 ||
    Number(value.total) > MAX_BATCH_ITEMS ||
    !Array.isArray(value.accepted) ||
    !Array.isArray(value.rejected) ||
    typeof value.planSha256 !== "string" ||
    !SHA256_RE.test(value.planSha256)
  ) {
    return false;
  }

  let lastAcceptedIndex = -1;
  for (const accepted of value.accepted) {
    if (
      !isRecord(accepted) ||
      !hasExactKeys(accepted, ACCEPTED_KEYS) ||
      !Number.isSafeInteger(accepted.index) ||
      Number(accepted.index) < 0 ||
      Number(accepted.index) >= Number(value.total) ||
      Number(accepted.index) <= lastAcceptedIndex ||
      !isRecord(accepted.request) ||
      !isRecord(accepted.source) ||
      !hasExactKeys(accepted.source, SOURCE_KEYS)
    ) {
      return false;
    }
    lastAcceptedIndex = Number(accepted.index);
  }

  let lastRejectedIndex = -1;
  for (const rejected of value.rejected) {
    if (
      !isRecord(rejected) ||
      !hasExactKeys(rejected, REJECTED_KEYS) ||
      !Number.isSafeInteger(rejected.index) ||
      Number(rejected.index) < 0 ||
      Number(rejected.index) >= Number(value.total) ||
      Number(rejected.index) <= lastRejectedIndex ||
      typeof rejected.reason !== "string" ||
      !REJECT_REASONS.has(rejected.reason as PublicWebDraftBatchRejectReason)
    ) {
      return false;
    }
    lastRejectedIndex = Number(rejected.index);
  }

  return hasExactIndexCoverage(value as PublicWebDraftBatchPlan);
}

export function materializePublicWebDraftImportServerPlan(input: {
  verifiedReceiptClaims: unknown;
  previewReceiptToken: unknown;
  batchPlan: PublicWebDraftBatchPlan;
  now: number;
  newUuidV7: PublicWebDraftImportUuidV7Factory;
}): PublicWebDraftImportServerPlanMaterializationResult {
  const verifiedReceiptClaims = input?.verifiedReceiptClaims;
  const previewReceiptTokenCandidate = input?.previewReceiptToken;
  const batchPlan = input?.batchPlan;
  const now = input?.now;
  const newUuidV7 = input?.newUuidV7;
  if (
    !input ||
    !Number.isSafeInteger(now) ||
    Number(now) < 0 ||
    typeof newUuidV7 !== "function"
  ) {
    return { ok: false, reason: "materialization_invalid" };
  }
  if (typeof previewReceiptTokenCandidate !== "string") {
    return { ok: false, reason: "preview_receipt_invalid" };
  }
  const previewReceiptToken = previewReceiptTokenCandidate;
  if (!isVerifiedPublicWebDraftPreviewReceiptClaims(
    verifiedReceiptClaims,
    { token: previewReceiptToken, now: Number(now) },
  )) {
    return { ok: false, reason: "preview_receipt_invalid" };
  }
  const claims = verifiedReceiptClaims;
  const trustedNow = Number(now);
  if (!isVerifiedPublicWebDraftBatchPlan(batchPlan)) {
    return { ok: false, reason: "batch_plan_invalid" };
  }
  const planSnapshot = batchPlan;
  if (!validPlanEnvelope(planSnapshot)) {
    return { ok: false, reason: "batch_plan_invalid" };
  }
  const recomputedPlanSha256 = planSha256(planSnapshot, claims);
  if (
    recomputedPlanSha256 !== planSnapshot.planSha256 ||
    recomputedPlanSha256 !== claims.planSha256
  ) {
    return { ok: false, reason: "batch_plan_hash_mismatch" };
  }
  if (planSnapshot.accepted.length < 1) {
    return { ok: false, reason: "batch_plan_has_no_accepted_items" };
  }

  const generatedIds = new Set<string>();
  const acceptedItems: PublicWebDraftImportAcceptedItem[] = [];
  const privateItems: PublicWebDraftImportPrivateItemPayload[] = [];
  const requestHashes = new Set<string>();
  const idempotencyKeys = new Set<string>();
  const targets = new Set<string>();

  for (const accepted of planSnapshot.accepted) {
    if (accepted.request.origin !== "IMPORT") {
      return { ok: false, reason: "non_import_origin_forbidden" };
    }
    let itemId: string;
    try {
      itemId = newUuidV7(trustedNow).toLowerCase();
    } catch {
      return { ok: false, reason: "generated_identity_invalid" };
    }
    if (!isUuidV7(itemId)) {
      return { ok: false, reason: "generated_identity_invalid" };
    }
    let built: ReturnType<typeof buildServerBoundPublicWebDraftIntake>;
    try {
      built = buildServerBoundPublicWebDraftIntake({
        scope: {
          tenantId: claims.tenantId,
          organizationId: claims.organizationId,
        },
        source: accepted.source,
        request: accepted.request,
        now: trustedNow,
        newUuidV7,
      });
    } catch {
      return { ok: false, reason: "generated_identity_invalid" };
    }
    if (!built.ok) {
      return {
        ok: false,
        reason: built.reason === "generated_identity_invalid"
          ? "generated_identity_invalid"
          : "command_build_failed",
      };
    }
    const command = deepFreezeJson(built.command);
    const ids = [itemId, command.contentRecordId, command.revisionId];
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => generatedIds.has(id))
    ) {
      return { ok: false, reason: "generated_identity_invalid" };
    }
    ids.forEach((id) => generatedIds.add(id));
    const target = `${command.entityType}:${command.entityId}:${command.locale}`;
    if (
      targets.has(target) ||
      requestHashes.has(built.requestHash) ||
      idempotencyKeys.has(command.idempotencyKey)
    ) {
      return { ok: false, reason: "batch_plan_invalid" };
    }
    targets.add(target);
    requestHashes.add(built.requestHash);
    idempotencyKeys.add(command.idempotencyKey);

    const metadata = Object.freeze({
      itemId,
      index: accepted.index,
      entityType: command.entityType,
      entityId: command.entityId,
      locale: command.locale,
      contentRecordId: command.contentRecordId,
      revisionId: command.revisionId,
      sourceSha256: command.sourceSha256,
      requestHash: built.requestHash,
      idempotencyKey: command.idempotencyKey,
    });
    acceptedItems.push(metadata);
    privateItems.push(Object.freeze({
      itemId,
      index: accepted.index,
      command,
      requestHash: built.requestHash,
    }));
  }

  const serverPlan = Object.freeze({
    manifestSha256: claims.manifestSha256,
    planSha256: claims.planSha256,
    adapterId: claims.adapterId,
    adapterVersion: claims.adapterVersion,
    adapterApprovalSha256: claims.adapterApprovalSha256,
    mappingSha256: claims.mappingSha256,
    runtimeReleaseId: claims.runtimeReleaseId,
    previewNonce: claims.nonce,
    previewReceiptTokenSha256: sha256(previewReceiptToken),
    requiresPartialConfirmation: planSnapshot.rejected.length > 0,
    acceptedItems: Object.freeze(acceptedItems),
  });
  const result = Object.freeze({
    ok: true,
    serverPlan,
  });
  const frozenPrivateItems = Object.freeze(privateItems);
  VERIFIED_SERVER_PLANS.add(serverPlan);
  PRIVATE_ITEMS_BY_SERVER_PLAN.set(serverPlan, frozenPrivateItems);
  PRIVATE_ITEMS_BY_RESULT.set(result, frozenPrivateItems);
  return result;
}
