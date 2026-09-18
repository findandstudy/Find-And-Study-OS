import { types as utilTypes } from "node:util";

import {
  previewPublicWebDraftImport,
  type PublicWebDraftImportAdapterApprovalResolver,
  type PublicWebDraftImportPreviewSuccess,
} from "./publicWebDraftImportPreview.js";
import {
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_DEFAULT_TTL_MS,
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TTL_MS,
  issuePublicWebDraftPreviewReceipt,
  type PublicWebDraftPreviewReceiptExternalSigner,
  type PublicWebDraftPreviewReceiptVerificationKey,
} from "./publicWebDraftPreviewReceipt.js";
import {
  PUBLIC_WEB_PUBLICATION_CACHE_CONTROL,
  resolvePublicWebPublicationExecutionIdentity,
  type PublicWebPublicationAuthorityResolver,
  type PublicWebPublicationVersionedContextConfig,
} from "./publicWebPublicationRuntimeBoundary.js";
import type {
  PublicWebDraftBatchSourceResolver,
} from "./publicWebDraftBatchPlanner.js";

const REQUEST_BODY_KEYS = ["confirmPartial", "manifest"] as const;
const ADAPTER_RUNTIME_KEYS = [
  "contractVersion",
  "currentRuntimeReleaseId",
  "mappingSchemaVersion",
  "registryGeneration",
] as const;
const RECEIPT_CONFIG_KEYS = [
  "cellId",
  "environmentId",
  "issuerId",
  "keyId",
  "keyReference",
  "keyRing",
  "signer",
] as const;
const RECEIPT_CONFIG_WITH_TTL_KEYS = [
  ...RECEIPT_CONFIG_KEYS,
  "ttlMs",
] as const;
const RECEIPT_KEY_KEYS = [
  "algorithm",
  "cellId",
  "environmentId",
  "issuerId",
  "keyId",
  "publicKeyFingerprint",
  "publicKeyPem",
  "signFrom",
  "signUntil",
  "state",
  "verifyUntil",
] as const;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RELEASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type PublicWebDraftImportPreflightOptions = {
  serverAuth: unknown;
  requestBody: unknown;
  trustedOrigins: readonly string[];
  versionedActiveContext: PublicWebPublicationVersionedContextConfig;
  resolveCurrentAuthority: PublicWebPublicationAuthorityResolver;
  resolveAdapterApproval: PublicWebDraftImportAdapterApprovalResolver;
  /** Server-only compatibility tuple for the current immutable registry generation. */
  adapterRuntime: {
    contractVersion: string;
    mappingSchemaVersion: number;
    currentRuntimeReleaseId: string;
    registryGeneration: number;
  };
  resolveSource: PublicWebDraftBatchSourceResolver;
  receipt: {
    environmentId: string;
    cellId: string;
    issuerId: string;
    keyId: string;
    keyReference: string;
    keyRing: readonly PublicWebDraftPreviewReceiptVerificationKey[];
    signer: PublicWebDraftPreviewReceiptExternalSigner;
    ttlMs?: number;
  };
  runtimeNow?: () => number;
  previewClock?: () => number;
};

export type PublicWebDraftImportPreflightReady = {
  ok: true;
  schemaVersion: 1;
  status: "READY";
  preview: PublicWebDraftImportPreviewSuccess;
  receipt: {
    token: string;
    issuedAt: number;
    expiresAt: number;
  };
  responsePolicy: {
    cacheControl: typeof PUBLIC_WEB_PUBLICATION_CACHE_CONTROL;
  };
};

export type PublicWebDraftImportPreflightReview = {
  ok: true;
  schemaVersion: 1;
  status: "PARTIAL_CONFIRMATION_REQUIRED" | "NOT_EXECUTABLE";
  preview: PublicWebDraftImportPreviewSuccess;
  receipt: null;
  responsePolicy: {
    cacheControl: typeof PUBLIC_WEB_PUBLICATION_CACHE_CONTROL;
  };
};

export type PublicWebDraftImportPreflightFailure = {
  ok: false;
  reason:
    | "authorization_failed"
    | "request_invalid"
    | "preview_unavailable"
    | "receipt_unavailable";
  responsePolicy: {
    cacheControl: typeof PUBLIC_WEB_PUBLICATION_CACHE_CONTROL;
  };
};

export type PublicWebDraftImportPreflightResult =
  | PublicWebDraftImportPreflightReady
  | PublicWebDraftImportPreflightReview
  | PublicWebDraftImportPreflightFailure;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotExactDataRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (!isPlainRecord(value)) return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return null;
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) return null;
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
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

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function parseAdapterRuntime(value: unknown):
  PublicWebDraftImportPreflightOptions["adapterRuntime"] | null {
  const record = snapshotExactDataRecord(value);
  if (!record || !hasExactKeys(record, ADAPTER_RUNTIME_KEYS)) {
    return null;
  }
  if (
    typeof record.contractVersion !== "string" ||
    !VERSION_RE.test(record.contractVersion) ||
    !positiveInteger(record.mappingSchemaVersion) ||
    typeof record.currentRuntimeReleaseId !== "string" ||
    !RELEASE_ID_RE.test(record.currentRuntimeReleaseId) ||
    !positiveInteger(record.registryGeneration)
  ) return null;
  return Object.freeze({
    contractVersion: record.contractVersion,
    mappingSchemaVersion: record.mappingSchemaVersion,
    currentRuntimeReleaseId: record.currentRuntimeReleaseId,
    registryGeneration: record.registryGeneration,
  });
}

function snapshotReceiptConfig(
  value: unknown,
): PublicWebDraftImportPreflightOptions["receipt"] | null {
  const record = snapshotExactDataRecord(value);
  if (
    !record ||
    !hasExactKeys(
      record,
      Object.hasOwn(record, "ttlMs")
        ? RECEIPT_CONFIG_WITH_TTL_KEYS
        : RECEIPT_CONFIG_KEYS,
    ) ||
    !Array.isArray(record.keyRing) ||
    utilTypes.isProxy(record.keyRing)
  ) return null;
  const signerRecord = snapshotExactDataRecord(record.signer);
  if (
    !signerRecord ||
    !hasExactKeys(signerRecord, ["sign"]) ||
    typeof signerRecord.sign !== "function"
  ) return null;
  const keys: PublicWebDraftPreviewReceiptVerificationKey[] = [];
  for (const candidate of record.keyRing) {
    const key = snapshotExactDataRecord(candidate);
    if (!key || !hasExactKeys(key, RECEIPT_KEY_KEYS)) return null;
    keys.push(key as unknown as PublicWebDraftPreviewReceiptVerificationKey);
  }
  const capturedSign = signerRecord.sign;
  const signer: PublicWebDraftPreviewReceiptExternalSigner = Object.freeze({
    async sign(input) {
      return Reflect.apply(capturedSign, undefined, [input]);
    },
  });
  return Object.freeze({
    environmentId: record.environmentId as string,
    cellId: record.cellId as string,
    issuerId: record.issuerId as string,
    keyId: record.keyId as string,
    keyReference: record.keyReference as string,
    keyRing: Object.freeze(keys),
    signer,
    ...(Object.hasOwn(record, "ttlMs")
      ? { ttlMs: record.ttlMs as number }
      : {}),
  });
}

type RequestBodySnapshot = Readonly<{
  boundaryBody: Readonly<Record<string, null>>;
  confirmPartial: boolean;
  manifest: unknown;
  valid: boolean;
}>;

function snapshotRequestBody(value: unknown): RequestBodySnapshot {
  const record = snapshotExactDataRecord(value);
  if (!record) {
    return Object.freeze({
      boundaryBody: Object.freeze({ tenantId: null }),
      confirmPartial: false,
      manifest: null,
      valid: false,
    });
  }
  const boundaryBody = Object.freeze(Object.fromEntries(
    Object.keys(record).map((key) => [key, null] as const),
  ));
  if (
    !hasExactKeys(record, REQUEST_BODY_KEYS) ||
    typeof record.confirmPartial !== "boolean"
  ) {
    return Object.freeze({
      boundaryBody,
      confirmPartial: false,
      manifest: null,
      valid: false,
    });
  }
  return Object.freeze({
    boundaryBody,
    confirmPartial: record.confirmPartial,
    // The manifest parser snapshots/canonicalizes synchronously at the start of
    // preview, after the runtime boundary succeeds and before any adapter/source
    // await. Avoid parsing an up-to-8MiB manifest on an unauthorized request.
    manifest: record.manifest,
    valid: true,
  });
}

function failure(
  reason: PublicWebDraftImportPreflightFailure["reason"],
): PublicWebDraftImportPreflightFailure {
  return {
    ok: false,
    reason,
    responsePolicy: { cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL },
  };
}

export async function preflightPublicWebDraftImport(
  options: PublicWebDraftImportPreflightOptions,
): Promise<PublicWebDraftImportPreflightResult> {
  const rawNow = options?.runtimeNow ?? Date.now;
  let lastObservedAt = -1;
  const trustedNow = () => {
    const observedAt = rawNow();
    if (
      !Number.isSafeInteger(observedAt) ||
      observedAt < 0 ||
      observedAt < lastObservedAt
    ) throw new Error("public_web_draft_import_clock_invalid");
    lastObservedAt = observedAt;
    return observedAt;
  };
  let requestSnapshot: RequestBodySnapshot;
  try {
    requestSnapshot = snapshotRequestBody(options?.requestBody);
  } catch {
    return failure("authorization_failed");
  }
  // Capture the server-owned compatibility tuple before the first await so a
  // mutable options object cannot switch registry generation or runtime release
  // between authorization, approval resolution and receipt issuance.
  const adapterRuntime = parseAdapterRuntime(options?.adapterRuntime);
  const receiptConfig = snapshotReceiptConfig(options?.receipt);
  const resolveCurrentAuthority = options?.resolveCurrentAuthority;
  const resolveAdapterApproval = options?.resolveAdapterApproval;
  const resolveSource = options?.resolveSource;
  const previewClock = options?.previewClock;
  let boundary: Awaited<
    ReturnType<typeof resolvePublicWebPublicationExecutionIdentity>
  >;
  try {
    boundary = await resolvePublicWebPublicationExecutionIdentity({
      serverAuth: options?.serverAuth,
      requestBody: requestSnapshot.boundaryBody,
      trustedOrigins: options?.trustedOrigins,
      versionedActiveContext: options?.versionedActiveContext,
      resolveCurrentAuthority,
      now: trustedNow,
    });
  } catch {
    return failure("authorization_failed");
  }
  if (!boundary.ok) return failure("authorization_failed");
  if (!adapterRuntime || !receiptConfig) {
    return failure("receipt_unavailable");
  }

  if (!requestSnapshot.valid) {
    return failure("request_invalid");
  }

  let preview: Awaited<ReturnType<typeof previewPublicWebDraftImport>>;
  try {
    const previewObservedAt = trustedNow();
    preview = await previewPublicWebDraftImport({
      approvalContext: {
        tenantId: boundary.identity.tenantId,
        organizationId: boundary.identity.organizationId,
        actorPrincipalId: boundary.identity.principalId,
        actorMembershipId: boundary.identity.membershipId,
        selectionId: boundary.identity.selectionId,
        sessionGeneration: boundary.identity.sessionGeneration,
        contractVersion: adapterRuntime.contractVersion,
        mappingSchemaVersion: adapterRuntime.mappingSchemaVersion,
        currentRuntimeReleaseId: adapterRuntime.currentRuntimeReleaseId,
        registryGeneration: adapterRuntime.registryGeneration,
      },
      manifest: requestSnapshot.manifest,
      resolveAdapterApproval,
      resolveSource,
      now: previewObservedAt,
      approvalNow: trustedNow,
      clock: previewClock,
    });
  } catch {
    return failure("preview_unavailable");
  }
  if (!preview.ok) return failure("preview_unavailable");
  if (preview.plan.executionEligible && preview.approval === null) {
    return failure("preview_unavailable");
  }

  // Confirmation is meaningful only for the exact partial plan shown to the
  // operator. Accepting it on a complete (or empty) plan would make the next
  // enqueue contract disagree with the signed preflight state.
  if (
    !preview.plan.requiresPartialConfirmation &&
    requestSnapshot.confirmPartial
  ) {
    return failure("request_invalid");
  }

  if (!preview.plan.executionEligible) {
    return {
      ok: true,
      schemaVersion: 1,
      status: "NOT_EXECUTABLE",
      preview,
      receipt: null,
      responsePolicy: boundary.identity.responsePolicy,
    };
  }
  if (
    preview.plan.requiresPartialConfirmation &&
    requestSnapshot.confirmPartial !== true
  ) {
    return {
      ok: true,
      schemaVersion: 1,
      status: "PARTIAL_CONFIRMATION_REQUIRED",
      preview,
      receipt: null,
      responsePolicy: boundary.identity.responsePolicy,
    };
  }

  try {
    if (preview.approval === null) return failure("receipt_unavailable");
    const receiptNow = trustedNow();
    const requestedReceiptTtl =
      receiptConfig.ttlMs ?? PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_DEFAULT_TTL_MS;
    if (
      !Number.isSafeInteger(receiptNow) ||
      receiptNow < 0 ||
      !Number.isSafeInteger(requestedReceiptTtl) ||
      requestedReceiptTtl < 1 ||
      requestedReceiptTtl > PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TTL_MS ||
      !Number.isSafeInteger(preview.approval.validUntil) ||
      preview.approval.validUntil <= receiptNow
    ) return failure("receipt_unavailable");
    const approvalBoundTtl = Math.min(
      requestedReceiptTtl,
      preview.approval.validUntil - receiptNow,
    );
    if (approvalBoundTtl < 1) return failure("receipt_unavailable");
    const issued = await issuePublicWebDraftPreviewReceipt({
      subject: {
        tenantId: boundary.identity.tenantId,
        organizationId: boundary.identity.organizationId,
        actorLegacyUserId: boundary.identity.actorLegacyUserId,
        actorPrincipalId: boundary.identity.principalId,
        membershipId: boundary.identity.membershipId,
        selectionId: boundary.identity.selectionId,
        sessionGeneration: boundary.identity.sessionGeneration,
        sessionFingerprint: boundary.identity.sessionFingerprint,
        activeContextId: boundary.identity.activeContextId,
        activeContextExpiresAt: boundary.identity.activeContextExpiresAt,
        manifestSha256: preview.manifest.manifestSha256,
        adapterId: preview.manifest.adapterId,
        adapterVersion: preview.manifest.adapterVersion,
        adapterApprovalSha256: preview.approval.adapterApprovalSha256,
        mappingSha256: preview.manifest.mappingSha256,
        planSha256: preview.plan.planSha256,
        runtimeReleaseId: adapterRuntime.currentRuntimeReleaseId,
      },
      environmentId: receiptConfig.environmentId,
      cellId: receiptConfig.cellId,
      issuerId: receiptConfig.issuerId,
      keyId: receiptConfig.keyId,
      keyReference: receiptConfig.keyReference,
      keyRing: receiptConfig.keyRing,
      signer: receiptConfig.signer,
      ttlMs: approvalBoundTtl,
      now: receiptNow,
    });
    if (
      issued.claims.issuedAt !== receiptNow ||
      issued.claims.expiresAt > preview.approval.validUntil
    ) throw new Error("public_web_draft_preview_receipt_expiry_unbound");
    const completedAt = trustedNow();
    if (
      completedAt >= issued.claims.expiresAt ||
      completedAt >= preview.approval.validUntil ||
      completedAt >= boundary.identity.activeContextExpiresAt
    ) throw new Error("public_web_draft_preview_receipt_expired_during_signing");
    return {
      ok: true,
      schemaVersion: 1,
      status: "READY",
      preview,
      receipt: {
        token: issued.token,
        issuedAt: issued.claims.issuedAt,
        expiresAt: issued.claims.expiresAt,
      },
      responsePolicy: boundary.identity.responsePolicy,
    };
  } catch {
    return failure("receipt_unavailable");
  }
}
