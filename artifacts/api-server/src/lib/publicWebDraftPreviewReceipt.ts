import crypto from "node:crypto";

import { canonicalJson } from "./jsonCanonical.js";

export const PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_TYPE =
  "FAS_PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT";
export const PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM = "Ed25519";
export const PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_AUDIENCE =
  "fas.public-web.draft-preview.execute";
export const PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_DOMAIN =
  "fas.public-web.draft-preview-receipt.v1\0";
export const PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_DEFAULT_TTL_MS = 2 * 60 * 1000;
export const PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TTL_MS = 5 * 60 * 1000;
export const PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_CLOCK_SKEW_MS = 30 * 1000;
export const PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TOKEN_BYTES = 8 * 1024;

const VERIFIED_RECEIPT_CLAIM = Symbol("verified-public-web-draft-preview-receipt");
const VERIFIED_RECEIPT_CLAIMS = new WeakSet<object>();
const VERIFIED_RECEIPT_TOKEN_SHA256 = new WeakMap<object, string>();
const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_ENTITY_ID = 2_147_483_647;
const KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const DEPLOYMENT_ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const AUDIENCE_RE = /^[a-z][a-z0-9.-]{2,127}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const ADAPTER_ID_RE = /^[a-z][a-z0-9._-]{2,63}$/;
const ADAPTER_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RELEASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OPAQUE_SIGNER_REF_RE =
  /^(kms|hsm|test-memory):\/\/[A-Za-z0-9][A-Za-z0-9._:/-]{5,255}$/;

const HEADER_KEYS = [
  "algorithm",
  "envelopeVersion",
  "keyId",
  "type",
] as const;
const SUBJECT_KEYS = [
  "activeContextExpiresAt",
  "activeContextId",
  "actorLegacyUserId",
  "actorPrincipalId",
  "adapterApprovalSha256",
  "adapterId",
  "adapterVersion",
  "manifestSha256",
  "mappingSha256",
  "membershipId",
  "organizationId",
  "planSha256",
  "runtimeReleaseId",
  "selectionId",
  "sessionFingerprint",
  "sessionGeneration",
  "tenantId",
] as const;
const CLAIM_KEYS = [
  "activeContextExpiresAt",
  "activeContextId",
  "actorLegacyUserId",
  "actorPrincipalId",
  "adapterApprovalSha256",
  "adapterId",
  "adapterVersion",
  "algorithm",
  "audience",
  "cellId",
  "environmentId",
  "expiresAt",
  "issuedAt",
  "issuerId",
  "keyId",
  "manifestSha256",
  "mappingSha256",
  "membershipId",
  "nonce",
  "organizationId",
  "planSha256",
  "runtimeReleaseId",
  "schemaVersion",
  "selectionId",
  "sessionFingerprint",
  "sessionGeneration",
  "tenantId",
] as const;
const EXPECTED_KEYS = [
  ...SUBJECT_KEYS,
  "audience",
  "cellId",
  "environmentId",
  "issuerId",
] as const;
const KEY_KEYS = [
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
const ISSUANCE_KEYS = [
  "cellId",
  "environmentId",
  "issuerId",
  "keyId",
  "keyReference",
  "keyRing",
  "now",
  "signer",
  "subject",
  "ttlMs",
] as const;

type PublicWebDraftPreviewReceiptHeader = {
  type: typeof PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_TYPE;
  envelopeVersion: 1;
  algorithm: typeof PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM;
  keyId: string;
};

export type PublicWebDraftPreviewReceiptSubject = {
  tenantId: string;
  organizationId: string;
  actorLegacyUserId: number;
  actorPrincipalId: string;
  membershipId: string;
  selectionId: string;
  sessionGeneration: number;
  sessionFingerprint: string;
  activeContextId: string;
  activeContextExpiresAt: number;
  manifestSha256: string;
  adapterId: string;
  adapterVersion: string;
  adapterApprovalSha256: string;
  mappingSha256: string;
  planSha256: string;
  runtimeReleaseId: string;
};

export type PublicWebDraftPreviewReceiptClaims =
  PublicWebDraftPreviewReceiptSubject & {
    schemaVersion: 1;
    audience: typeof PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_AUDIENCE;
    environmentId: string;
    cellId: string;
    issuerId: string;
    keyId: string;
    algorithm: typeof PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM;
    issuedAt: number;
    expiresAt: number;
    nonce: string;
  };

export type VerifiedPublicWebDraftPreviewReceiptClaims =
  Readonly<PublicWebDraftPreviewReceiptClaims> & {
    readonly [VERIFIED_RECEIPT_CLAIM]: true;
  };

export type PublicWebDraftPreviewReceiptKeyState =
  | "ACTIVE"
  | "VERIFY_ONLY"
  | "REVOKED"
  | "COMPROMISED";

export type PublicWebDraftPreviewReceiptVerificationKey = {
  keyId: string;
  algorithm: typeof PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM;
  state: PublicWebDraftPreviewReceiptKeyState;
  issuerId: string;
  environmentId: string;
  cellId: string;
  publicKeyPem: string;
  publicKeyFingerprint: string;
  signFrom: number;
  signUntil: number;
  verifyUntil: number;
};

export type PublicWebDraftPreviewReceiptExternalSigner = {
  sign(input: {
    keyReference: string;
    algorithm: typeof PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM;
    signingInput: Buffer;
  }): Promise<Buffer>;
};

export type PublicWebDraftPreviewReceiptIssuanceOptions = {
  subject: PublicWebDraftPreviewReceiptSubject;
  environmentId: string;
  cellId: string;
  issuerId: string;
  keyId: string;
  keyReference: string;
  keyRing: readonly PublicWebDraftPreviewReceiptVerificationKey[];
  signer: PublicWebDraftPreviewReceiptExternalSigner;
  ttlMs?: number;
  now?: number;
};

export type PublicWebDraftPreviewReceiptExpected =
  PublicWebDraftPreviewReceiptSubject & {
    audience: string;
    environmentId: string;
    cellId: string;
    issuerId: string;
  };

export type PublicWebDraftPreviewReceiptVerificationFailure =
  | "missing_token"
  | "clock_invalid"
  | "expected_context_invalid"
  | "key_ring_invalid"
  | "malformed_token"
  | "unknown_key"
  | "algorithm_mismatch"
  | "key_inactive"
  | "key_window_invalid"
  | "invalid_signature"
  | "invalid_claims"
  | "audience_mismatch"
  | "environment_mismatch"
  | "cell_mismatch"
  | "issuer_mismatch"
  | "tenant_mismatch"
  | "organization_mismatch"
  | "actor_legacy_user_mismatch"
  | "actor_mismatch"
  | "membership_mismatch"
  | "selection_mismatch"
  | "session_generation_mismatch"
  | "session_fingerprint_mismatch"
  | "active_context_mismatch"
  | "active_context_expiry_mismatch"
  | "manifest_hash_mismatch"
  | "adapter_id_mismatch"
  | "adapter_version_mismatch"
  | "adapter_approval_hash_mismatch"
  | "mapping_hash_mismatch"
  | "plan_hash_mismatch"
  | "runtime_release_mismatch"
  | "not_yet_valid"
  | "expired";

export type PublicWebDraftPreviewReceiptVerificationResult =
  | { ok: true; claims: VerifiedPublicWebDraftPreviewReceiptClaims }
  | { ok: false; reason: PublicWebDraftPreviewReceiptVerificationFailure };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
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
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_RE.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

function publicKeyFingerprint(publicKeyPem: string): string | null {
  if (
    typeof publicKeyPem !== "string" ||
    Buffer.byteLength(publicKeyPem, "utf8") > 8 * 1024 ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(publicKeyPem)
  ) {
    return null;
  }
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      return null;
    }
    const der = key.export({ type: "spki", format: "der" });
    return crypto.createHash("sha256").update(der).digest("hex");
  } catch {
    return null;
  }
}

export function fingerprintPublicWebDraftPreviewReceiptPublicKey(
  publicKeyPem: string,
): string {
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  if (!fingerprint) {
    throw new Error("public_web_draft_preview_receipt_public_key_invalid");
  }
  return fingerprint;
}

function parseSubject(value: unknown): PublicWebDraftPreviewReceiptSubject | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, SUBJECT_KEYS)) return null;
  if (
    !isUuidV7(value.tenantId) ||
    !isUuidV7(value.organizationId) ||
    value.tenantId.toLowerCase() === value.organizationId.toLowerCase() ||
    !Number.isSafeInteger(value.actorLegacyUserId) ||
    Number(value.actorLegacyUserId) < 1 ||
    Number(value.actorLegacyUserId) > MAX_ENTITY_ID ||
    !isUuidV7(value.actorPrincipalId) ||
    !isUuidV7(value.membershipId) ||
    !isUuidV7(value.selectionId) ||
    !Number.isSafeInteger(value.sessionGeneration) ||
    Number(value.sessionGeneration) < 1 ||
    !isSha256(value.sessionFingerprint) ||
    !isUuidV7(value.activeContextId) ||
    !Number.isSafeInteger(value.activeContextExpiresAt) ||
    Number(value.activeContextExpiresAt) < 1 ||
    !isSha256(value.manifestSha256) ||
    typeof value.adapterId !== "string" ||
    !ADAPTER_ID_RE.test(value.adapterId) ||
    typeof value.adapterVersion !== "string" ||
    !ADAPTER_VERSION_RE.test(value.adapterVersion) ||
    !isSha256(value.adapterApprovalSha256) ||
    !isSha256(value.mappingSha256) ||
    !isSha256(value.planSha256) ||
    typeof value.runtimeReleaseId !== "string" ||
    !RELEASE_ID_RE.test(value.runtimeReleaseId)
  ) {
    return null;
  }
  return {
    tenantId: value.tenantId.toLowerCase(),
    organizationId: value.organizationId.toLowerCase(),
    actorLegacyUserId: Number(value.actorLegacyUserId),
    actorPrincipalId: value.actorPrincipalId.toLowerCase(),
    membershipId: value.membershipId.toLowerCase(),
    selectionId: value.selectionId.toLowerCase(),
    sessionGeneration: Number(value.sessionGeneration),
    sessionFingerprint: value.sessionFingerprint,
    activeContextId: value.activeContextId.toLowerCase(),
    activeContextExpiresAt: Number(value.activeContextExpiresAt),
    manifestSha256: value.manifestSha256,
    adapterId: value.adapterId,
    adapterVersion: value.adapterVersion,
    adapterApprovalSha256: value.adapterApprovalSha256,
    mappingSha256: value.mappingSha256,
    planSha256: value.planSha256,
    runtimeReleaseId: value.runtimeReleaseId,
  };
}

function parseClaims(value: unknown): PublicWebDraftPreviewReceiptClaims | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, CLAIM_KEYS)) return null;
  const subject = parseSubject({
    tenantId: value.tenantId,
    organizationId: value.organizationId,
    actorLegacyUserId: value.actorLegacyUserId,
    actorPrincipalId: value.actorPrincipalId,
    membershipId: value.membershipId,
    selectionId: value.selectionId,
    sessionGeneration: value.sessionGeneration,
    sessionFingerprint: value.sessionFingerprint,
    activeContextId: value.activeContextId,
    activeContextExpiresAt: value.activeContextExpiresAt,
    manifestSha256: value.manifestSha256,
    adapterId: value.adapterId,
    adapterVersion: value.adapterVersion,
    adapterApprovalSha256: value.adapterApprovalSha256,
    mappingSha256: value.mappingSha256,
    planSha256: value.planSha256,
    runtimeReleaseId: value.runtimeReleaseId,
  });
  if (
    !subject ||
    value.schemaVersion !== 1 ||
    value.audience !== PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_AUDIENCE ||
    value.algorithm !== PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM ||
    typeof value.environmentId !== "string" ||
    !DEPLOYMENT_ID_RE.test(value.environmentId) ||
    typeof value.cellId !== "string" ||
    !DEPLOYMENT_ID_RE.test(value.cellId) ||
    !isUuidV7(value.issuerId) ||
    typeof value.keyId !== "string" ||
    !KEY_ID_RE.test(value.keyId) ||
    typeof value.nonce !== "string" ||
    !NONCE_RE.test(value.nonce) ||
    !Number.isSafeInteger(value.issuedAt) ||
    Number(value.issuedAt) < 0 ||
    !Number.isSafeInteger(value.expiresAt) ||
    Number(value.expiresAt) <= Number(value.issuedAt) ||
    Number(value.expiresAt) - Number(value.issuedAt) >
      PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TTL_MS ||
    Number(value.expiresAt) > subject.activeContextExpiresAt
  ) {
    return null;
  }
  return {
    ...subject,
    schemaVersion: 1,
    audience: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_AUDIENCE,
    environmentId: value.environmentId,
    cellId: value.cellId,
    issuerId: value.issuerId.toLowerCase(),
    keyId: value.keyId,
    algorithm: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
    issuedAt: Number(value.issuedAt),
    expiresAt: Number(value.expiresAt),
    nonce: value.nonce,
  };
}

function previewReceiptTokenSha256(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function brandVerifiedClaims(
  claims: PublicWebDraftPreviewReceiptClaims,
  token: string,
): VerifiedPublicWebDraftPreviewReceiptClaims {
  const branded: VerifiedPublicWebDraftPreviewReceiptClaims = {
    ...claims,
    [VERIFIED_RECEIPT_CLAIM]: true,
  };
  Object.freeze(branded);
  VERIFIED_RECEIPT_CLAIMS.add(branded);
  VERIFIED_RECEIPT_TOKEN_SHA256.set(branded, previewReceiptTokenSha256(token));
  return branded;
}

export function isVerifiedPublicWebDraftPreviewReceiptClaims(
  value: unknown,
  input: { token: unknown; now?: number },
): value is VerifiedPublicWebDraftPreviewReceiptClaims {
  const now = input?.now ?? Date.now();
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !VERIFIED_RECEIPT_CLAIMS.has(value) ||
    (value as Partial<VerifiedPublicWebDraftPreviewReceiptClaims>)[VERIFIED_RECEIPT_CLAIM] !== true ||
    typeof input?.token !== "string" ||
    Buffer.byteLength(input.token, "utf8") >
      PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TOKEN_BYTES ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.token) ||
    VERIFIED_RECEIPT_TOKEN_SHA256.get(value) !== previewReceiptTokenSha256(input.token)
  ) {
    return false;
  }
  const normalized = parseClaims(value);
  if (
    !normalized ||
    normalized.issuedAt > now + PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_CLOCK_SKEW_MS ||
    now >= normalized.expiresAt ||
    now >= normalized.activeContextExpiresAt
  ) {
    return false;
  }
  return canonicalJson(value) === canonicalJson(normalized);
}

function parseExpected(value: unknown): PublicWebDraftPreviewReceiptExpected | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, EXPECTED_KEYS)) return null;
  const subject = parseSubject({
    tenantId: value.tenantId,
    organizationId: value.organizationId,
    actorLegacyUserId: value.actorLegacyUserId,
    actorPrincipalId: value.actorPrincipalId,
    membershipId: value.membershipId,
    selectionId: value.selectionId,
    sessionGeneration: value.sessionGeneration,
    sessionFingerprint: value.sessionFingerprint,
    activeContextId: value.activeContextId,
    activeContextExpiresAt: value.activeContextExpiresAt,
    manifestSha256: value.manifestSha256,
    adapterId: value.adapterId,
    adapterVersion: value.adapterVersion,
    adapterApprovalSha256: value.adapterApprovalSha256,
    mappingSha256: value.mappingSha256,
    planSha256: value.planSha256,
    runtimeReleaseId: value.runtimeReleaseId,
  });
  if (
    !subject ||
    typeof value.audience !== "string" ||
    !AUDIENCE_RE.test(value.audience) ||
    typeof value.environmentId !== "string" ||
    !DEPLOYMENT_ID_RE.test(value.environmentId) ||
    typeof value.cellId !== "string" ||
    !DEPLOYMENT_ID_RE.test(value.cellId) ||
    !isUuidV7(value.issuerId)
  ) {
    return null;
  }
  return {
    ...subject,
    audience: value.audience,
    environmentId: value.environmentId,
    cellId: value.cellId,
    issuerId: value.issuerId.toLowerCase(),
  };
}

function parseKeyRing(
  value: unknown,
): PublicWebDraftPreviewReceiptVerificationKey[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    return null;
  }
  const parsed: PublicWebDraftPreviewReceiptVerificationKey[] = [];
  const keyIds = new Set<string>();
  for (const candidate of value) {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, KEY_KEYS)) {
      return null;
    }
    if (
      typeof candidate.keyId !== "string" ||
      !KEY_ID_RE.test(candidate.keyId) ||
      candidate.algorithm !== PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM ||
      !["ACTIVE", "VERIFY_ONLY", "REVOKED", "COMPROMISED"].includes(
        String(candidate.state),
      ) ||
      !isUuidV7(candidate.issuerId) ||
      typeof candidate.environmentId !== "string" ||
      !DEPLOYMENT_ID_RE.test(candidate.environmentId) ||
      typeof candidate.cellId !== "string" ||
      !DEPLOYMENT_ID_RE.test(candidate.cellId) ||
      typeof candidate.publicKeyPem !== "string" ||
      typeof candidate.publicKeyFingerprint !== "string" ||
      !SHA256_RE.test(candidate.publicKeyFingerprint) ||
      !Number.isSafeInteger(candidate.signFrom) ||
      Number(candidate.signFrom) < 0 ||
      !Number.isSafeInteger(candidate.signUntil) ||
      Number(candidate.signUntil) <= Number(candidate.signFrom) ||
      !Number.isSafeInteger(candidate.verifyUntil) ||
      Number(candidate.verifyUntil) < Number(candidate.signUntil) ||
      keyIds.has(candidate.keyId)
    ) {
      return null;
    }
    const fingerprint = publicKeyFingerprint(candidate.publicKeyPem);
    if (!fingerprint || fingerprint !== candidate.publicKeyFingerprint) {
      return null;
    }
    keyIds.add(candidate.keyId);
    parsed.push({
      keyId: candidate.keyId,
      algorithm: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
      state: candidate.state as PublicWebDraftPreviewReceiptKeyState,
      issuerId: candidate.issuerId.toLowerCase(),
      environmentId: candidate.environmentId,
      cellId: candidate.cellId,
      publicKeyPem: candidate.publicKeyPem,
      publicKeyFingerprint: candidate.publicKeyFingerprint,
      signFrom: Number(candidate.signFrom),
      signUntil: Number(candidate.signUntil),
      verifyUntil: Number(candidate.verifyUntil),
    });
  }
  return parsed;
}

function parseHeader(value: unknown): PublicWebDraftPreviewReceiptHeader | null {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, HEADER_KEYS) ||
    value.type !== PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_TYPE ||
    value.envelopeVersion !== 1 ||
    value.algorithm !== PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM ||
    typeof value.keyId !== "string" ||
    !KEY_ID_RE.test(value.keyId)
  ) {
    return null;
  }
  return {
    type: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_TYPE,
    envelopeVersion: 1,
    algorithm: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
    keyId: value.keyId,
  };
}

function decodeCanonicalJson(segment: string): unknown {
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.toString("base64url") !== segment) {
    throw new Error("non_canonical_base64url");
  }
  const serialized = bytes.toString("utf8");
  const parsed = JSON.parse(serialized) as unknown;
  if (canonicalJson(parsed) !== serialized) {
    throw new Error("non_canonical_json");
  }
  return parsed;
}

function signingInput(encodedHeader: string, encodedPayload: string): Buffer {
  return Buffer.from(
    `${PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_DOMAIN}${encodedHeader}.${encodedPayload}`,
    "utf8",
  );
}

export async function issuePublicWebDraftPreviewReceipt(
  options: PublicWebDraftPreviewReceiptIssuanceOptions,
): Promise<{
  token: string;
  claims: VerifiedPublicWebDraftPreviewReceiptClaims;
}> {
  if (!isPlainRecord(options) || !hasExactKeys(
    options,
    Object.hasOwn(options, "ttlMs")
      ? Object.hasOwn(options, "now")
        ? ISSUANCE_KEYS
        : ISSUANCE_KEYS.filter((key) => key !== "now")
      : Object.hasOwn(options, "now")
        ? ISSUANCE_KEYS.filter((key) => key !== "ttlMs")
        : ISSUANCE_KEYS.filter((key) => key !== "ttlMs" && key !== "now"),
  )) {
    throw new Error("public_web_draft_preview_receipt_issuance_invalid");
  }
  const subject = parseSubject(options.subject);
  const now = options.now ?? Date.now();
  const ttlMs =
    options.ttlMs ?? PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_DEFAULT_TTL_MS;
  const keyRing = parseKeyRing(options.keyRing);
  if (
    !subject ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1 ||
    ttlMs > PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TTL_MS ||
    !Number.isSafeInteger(now + ttlMs) ||
    typeof options.environmentId !== "string" ||
    !DEPLOYMENT_ID_RE.test(options.environmentId) ||
    typeof options.cellId !== "string" ||
    !DEPLOYMENT_ID_RE.test(options.cellId) ||
    !isUuidV7(options.issuerId) ||
    typeof options.keyId !== "string" ||
    !KEY_ID_RE.test(options.keyId) ||
    typeof options.keyReference !== "string" ||
    !OPAQUE_SIGNER_REF_RE.test(options.keyReference) ||
    (options.keyReference.startsWith("test-memory://") &&
      (options.environmentId !== "test" || process.env.NODE_ENV === "production")) ||
    !keyRing ||
    !isPlainRecord(options.signer) ||
    typeof options.signer.sign !== "function"
  ) {
    throw new Error("public_web_draft_preview_receipt_issuance_invalid");
  }
  const issuerId = options.issuerId.toLowerCase();
  const key = keyRing.find((candidate) => candidate.keyId === options.keyId);
  if (!key) {
    throw new Error("public_web_draft_preview_receipt_signing_key_unknown");
  }
  if (
    key.state !== "ACTIVE" ||
    key.issuerId !== issuerId ||
    key.environmentId !== options.environmentId ||
    key.cellId !== options.cellId ||
    now < key.signFrom ||
    now >= key.signUntil ||
    now + ttlMs > key.verifyUntil ||
    now + ttlMs > subject.activeContextExpiresAt
  ) {
    throw new Error("public_web_draft_preview_receipt_signing_key_unavailable");
  }

  const claims = parseClaims({
    ...subject,
    schemaVersion: 1,
    audience: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_AUDIENCE,
    environmentId: options.environmentId,
    cellId: options.cellId,
    issuerId,
    keyId: key.keyId,
    algorithm: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: crypto.randomBytes(24).toString("base64url"),
  });
  if (!claims) {
    throw new Error("public_web_draft_preview_receipt_claims_invalid");
  }
  const header: PublicWebDraftPreviewReceiptHeader = {
    type: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_TYPE,
    envelopeVersion: 1,
    algorithm: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
    keyId: key.keyId,
  };
  const encodedHeader = Buffer.from(canonicalJson(header), "utf8").toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(canonicalJson(claims), "utf8").toString(
    "base64url",
  );
  const payloadToSign = signingInput(encodedHeader, encodedPayload);
  let signature: Buffer;
  try {
    signature = await options.signer.sign({
      keyReference: options.keyReference,
      algorithm: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
      signingInput: Buffer.from(payloadToSign),
    });
  } catch {
    throw new Error("public_web_draft_preview_receipt_signing_failed");
  }
  if (
    !Buffer.isBuffer(signature) ||
    signature.length !== 64 ||
    !crypto.verify(null, payloadToSign, key.publicKeyPem, signature)
  ) {
    throw new Error("public_web_draft_preview_receipt_signer_result_invalid");
  }
  const token = `${encodedHeader}.${encodedPayload}.${signature.toString(
    "base64url",
  )}`;
  if (
    Buffer.byteLength(token, "utf8") >
    PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TOKEN_BYTES
  ) {
    throw new Error("public_web_draft_preview_receipt_token_too_large");
  }
  return { token, claims: brandVerifiedClaims(claims, token) };
}

export function verifyPublicWebDraftPreviewReceipt(input: {
  token: string | null | undefined;
  keyRing: readonly PublicWebDraftPreviewReceiptVerificationKey[];
  expected: PublicWebDraftPreviewReceiptExpected;
  now?: number;
}): PublicWebDraftPreviewReceiptVerificationResult {
  if (!input?.token) return { ok: false, reason: "missing_token" };
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    return { ok: false, reason: "clock_invalid" };
  }
  const expected = parseExpected(input.expected);
  if (!expected) return { ok: false, reason: "expected_context_invalid" };
  const keyRing = parseKeyRing(input.keyRing);
  if (!keyRing) return { ok: false, reason: "key_ring_invalid" };
  if (
    typeof input.token !== "string" ||
    Buffer.byteLength(input.token, "utf8") >
      PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TOKEN_BYTES ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.token)
  ) {
    return { ok: false, reason: "malformed_token" };
  }

  try {
    const [encodedHeader, encodedPayload, encodedSignature] =
      input.token.split(".");
    const rawHeader = decodeCanonicalJson(encodedHeader);
    if (
      isPlainRecord(rawHeader) &&
      rawHeader.algorithm !== PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM
    ) {
      return { ok: false, reason: "algorithm_mismatch" };
    }
    const header = parseHeader(rawHeader);
    if (!header) return { ok: false, reason: "malformed_token" };
    const key = keyRing.find((candidate) => candidate.keyId === header.keyId);
    if (!key) return { ok: false, reason: "unknown_key" };
    if (key.algorithm !== header.algorithm) {
      return { ok: false, reason: "algorithm_mismatch" };
    }
    if (key.state === "REVOKED" || key.state === "COMPROMISED") {
      return { ok: false, reason: "key_inactive" };
    }
    if (now >= key.verifyUntil) {
      return { ok: false, reason: "key_window_invalid" };
    }
    const signature = Buffer.from(encodedSignature, "base64url");
    if (
      signature.toString("base64url") !== encodedSignature ||
      signature.length !== 64 ||
      !crypto.verify(
        null,
        signingInput(encodedHeader, encodedPayload),
        key.publicKeyPem,
        signature,
      )
    ) {
      return { ok: false, reason: "invalid_signature" };
    }
    const claims = parseClaims(decodeCanonicalJson(encodedPayload));
    if (!claims) return { ok: false, reason: "invalid_claims" };
    if (claims.keyId !== key.keyId) {
      return { ok: false, reason: "unknown_key" };
    }
    if (claims.audience !== expected.audience) {
      return { ok: false, reason: "audience_mismatch" };
    }
    if (
      claims.environmentId !== expected.environmentId ||
      key.environmentId !== expected.environmentId
    ) {
      return { ok: false, reason: "environment_mismatch" };
    }
    if (claims.cellId !== expected.cellId || key.cellId !== expected.cellId) {
      return { ok: false, reason: "cell_mismatch" };
    }
    if (
      claims.issuerId !== expected.issuerId ||
      key.issuerId !== expected.issuerId
    ) {
      return { ok: false, reason: "issuer_mismatch" };
    }
    if (claims.tenantId !== expected.tenantId) {
      return { ok: false, reason: "tenant_mismatch" };
    }
    if (claims.organizationId !== expected.organizationId) {
      return { ok: false, reason: "organization_mismatch" };
    }
    if (claims.actorLegacyUserId !== expected.actorLegacyUserId) {
      return { ok: false, reason: "actor_legacy_user_mismatch" };
    }
    if (claims.actorPrincipalId !== expected.actorPrincipalId) {
      return { ok: false, reason: "actor_mismatch" };
    }
    if (claims.membershipId !== expected.membershipId) {
      return { ok: false, reason: "membership_mismatch" };
    }
    if (claims.selectionId !== expected.selectionId) {
      return { ok: false, reason: "selection_mismatch" };
    }
    if (claims.sessionGeneration !== expected.sessionGeneration) {
      return { ok: false, reason: "session_generation_mismatch" };
    }
    if (claims.sessionFingerprint !== expected.sessionFingerprint) {
      return { ok: false, reason: "session_fingerprint_mismatch" };
    }
    if (claims.activeContextId !== expected.activeContextId) {
      return { ok: false, reason: "active_context_mismatch" };
    }
    if (claims.activeContextExpiresAt !== expected.activeContextExpiresAt) {
      return { ok: false, reason: "active_context_expiry_mismatch" };
    }
    if (claims.manifestSha256 !== expected.manifestSha256) {
      return { ok: false, reason: "manifest_hash_mismatch" };
    }
    if (claims.adapterId !== expected.adapterId) {
      return { ok: false, reason: "adapter_id_mismatch" };
    }
    if (claims.adapterVersion !== expected.adapterVersion) {
      return { ok: false, reason: "adapter_version_mismatch" };
    }
    if (claims.adapterApprovalSha256 !== expected.adapterApprovalSha256) {
      return { ok: false, reason: "adapter_approval_hash_mismatch" };
    }
    if (claims.mappingSha256 !== expected.mappingSha256) {
      return { ok: false, reason: "mapping_hash_mismatch" };
    }
    if (claims.planSha256 !== expected.planSha256) {
      return { ok: false, reason: "plan_hash_mismatch" };
    }
    if (claims.runtimeReleaseId !== expected.runtimeReleaseId) {
      return { ok: false, reason: "runtime_release_mismatch" };
    }
    if (
      claims.issuedAt < key.signFrom ||
      claims.issuedAt >= key.signUntil ||
      claims.expiresAt > key.verifyUntil
    ) {
      return { ok: false, reason: "key_window_invalid" };
    }
    if (
      claims.issuedAt >
      now + PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_CLOCK_SKEW_MS
    ) {
      return { ok: false, reason: "not_yet_valid" };
    }
    if (now >= claims.expiresAt) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, claims: brandVerifiedClaims(claims, input.token) };
  } catch {
    return { ok: false, reason: "malformed_token" };
  }
}
