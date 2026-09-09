import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  ACTIVE_CONTEXT_V2_ALGORITHM,
  fingerprintActiveContextPublicKey,
  issueVersionedActiveTenantContext,
  type ActiveContextVerificationKey,
  type ActiveContextVersionedSubject,
  type ResolvedActiveContextState,
} from "../src/lib/activeTenantContext.js";
import { canonicalJson } from "../src/lib/jsonCanonical.js";
import { preflightPublicWebDraftImport } from "../src/lib/publicWebDraftImportPreflight.js";
import type {
  PublicWebDraftImportAdapterApprovalResolver,
} from "../src/lib/publicWebDraftImportPreview.js";
import {
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_AUDIENCE,
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TTL_MS,
  fingerprintPublicWebDraftPreviewReceiptPublicKey,
  verifyPublicWebDraftPreviewReceipt,
  type PublicWebDraftPreviewReceiptExternalSigner,
  type PublicWebDraftPreviewReceiptVerificationKey,
} from "../src/lib/publicWebDraftPreviewReceipt.js";
import {
  resolvePublicWebImportAdapterApproval,
  type PublicWebImportAdapterApprovalRequest,
  type PublicWebImportAdapterApprovalSnapshot,
} from "../src/lib/publicWebImportAdapterApproval.js";
import {
  PUBLIC_WEB_PUBLICATION_CACHE_CONTROL,
  PUBLIC_WEB_PUBLICATION_WRITE_CAPABILITY,
  type PublicWebPublicationCurrentAuthority,
} from "../src/lib/publicWebPublicationRuntimeBoundary.js";
import { ABSOLUTE_SESSION_TTL } from "../src/lib/sessionLifetime.js";

const NOW = Date.parse("2026-09-09T10:00:00.000Z");
const SID = "a".repeat(64);
const CSRF = "b".repeat(64);
const SOURCE_SHA = "c".repeat(64);
const SESSION_FINGERPRINT = crypto.createHash("sha256").update(SID, "ascii").digest("hex");
const RUNTIME_RELEASE_ID = "20260909T120000Z-c9292077";
const CONTRACT_VERSION = "draft-import-v1";
const MAPPING_SCHEMA_VERSION = 1;
const REGISTRY_GENERATION = 3;
const SECRET = "private-signer-secret-must-never-leak";
const ORIGIN = "https://staging.findandstudy.test";
const USER_ID = 501;
const ID = {
  context: "018fad00-0000-7000-8000-000000000001",
  tenant: "018fad00-0000-7000-8000-000000000002",
  otherTenant: "018fad00-0000-7000-8000-000000000003",
  organization: "018fad00-0000-7000-8000-000000000004",
  principal: "018fad00-0000-7000-8000-000000000005",
  membership: "018fad00-0000-7000-8000-000000000006",
  assignment: "018fad00-0000-7000-8000-000000000007",
  package: "018fad00-0000-7000-8000-000000000008",
  policy: "018fad00-0000-7000-8000-000000000009",
  selection: "018fad00-0000-7000-8000-00000000000a",
  contextIssuer: "018fad00-0000-7000-8000-00000000000b",
  receiptIssuer: "018fad00-0000-7000-8000-00000000000c",
  registry: "018fad00-0000-7000-8000-00000000000d",
  validation: "018fad00-0000-7000-8000-00000000000e",
  review: "018fad00-0000-7000-8000-00000000000f",
  maker: "018fad00-0000-7000-8000-000000000010",
  makerMembership: "018fad00-0000-7000-8000-000000000011",
  checker: "018fad00-0000-7000-8000-000000000012",
  checkerMembership: "018fad00-0000-7000-8000-000000000013",
} as const;
const CONTEXT_AUDIENCE = "fas.public-web.publication-runtime";
const ENVIRONMENT = "test";
const CELL = "cell-a";
const CONTEXT_KEY_ID = "public-web-runtime-key-2026-09";
const CONTEXT_KEY_REFERENCE = "test-memory://public-web/runtime-key";
const RECEIPT_KEY_ID = "public-web-preview-key-2026-09";
const RECEIPT_KEY_REFERENCE = "test-memory://public-web/preview-key";

const contextPair = crypto.generateKeyPairSync("ed25519");
const receiptPair = crypto.generateKeyPairSync("ed25519");
const contextPublicKeyPem = contextPair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const receiptPublicKeyPem = receiptPair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

function contextKey(): ActiveContextVerificationKey {
  return {
    keyId: CONTEXT_KEY_ID,
    algorithm: ACTIVE_CONTEXT_V2_ALGORITHM,
    state: "ACTIVE",
    issuerId: ID.contextIssuer,
    environmentId: ENVIRONMENT,
    cellId: CELL,
    publicKeyPem: contextPublicKeyPem,
    publicKeyFingerprint: fingerprintActiveContextPublicKey(contextPublicKeyPem),
    signFrom: NOW - 60_000,
    signUntil: NOW + 60_000,
    verifyUntil: NOW + 120_000,
  };
}

function receiptKey(): PublicWebDraftPreviewReceiptVerificationKey {
  return {
    keyId: RECEIPT_KEY_ID,
    algorithm: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
    state: "ACTIVE",
    issuerId: ID.receiptIssuer,
    environmentId: ENVIRONMENT,
    cellId: CELL,
    publicKeyPem: receiptPublicKeyPem,
    publicKeyFingerprint:
      fingerprintPublicWebDraftPreviewReceiptPublicKey(receiptPublicKeyPem),
    signFrom: NOW - 60_000,
    signUntil: NOW + 60_000,
    verifyUntil: NOW + 120_000,
  };
}

const receiptSigner: PublicWebDraftPreviewReceiptExternalSigner = {
  async sign(input) {
    assert.equal(input.keyReference, RECEIPT_KEY_REFERENCE);
    assert.equal(input.algorithm, PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM);
    return crypto.sign(null, input.signingInput, receiptPair.privateKey);
  },
};

function subject(): ActiveContextVersionedSubject {
  return {
    contextId: ID.context,
    tenantId: ID.tenant,
    organizationId: ID.organization,
    legacyBranchId: null,
    principalId: ID.principal,
    membershipId: ID.membership,
    assignmentIds: [ID.assignment],
    policyVersionId: ID.policy,
    policyVersion: 4,
    selectionId: ID.selection,
    sessionGeneration: 4,
  };
}

async function activeContextToken(): Promise<string> {
  return issueVersionedActiveTenantContext({
    subject: subject(),
    audience: CONTEXT_AUDIENCE,
    environmentId: ENVIRONMENT,
    cellId: CELL,
    issuerId: ID.contextIssuer,
    keyId: CONTEXT_KEY_ID,
    keyReference: CONTEXT_KEY_REFERENCE,
    keyRing: [contextKey()],
    signer: {
      async sign(input) {
        return crypto.sign(null, input.signingInput, contextPair.privateKey);
      },
    },
    ttlMs: 60_000,
    now: NOW,
  });
}

function state(): ResolvedActiveContextState {
  return {
    tenant: { id: ID.tenant, status: "ACTIVE", policyVersion: 4 },
    principal: {
      id: ID.principal,
      principalType: "HUMAN",
      status: "ACTIVE",
      riskState: "NORMAL",
    },
    membership: {
      id: ID.membership,
      tenantId: ID.tenant,
      organizationId: ID.organization,
      legacyBranchId: null,
      principalId: ID.principal,
      status: "ACTIVE",
      validFrom: NOW - 60_000,
      validUntil: NOW + 60_000,
    },
    policy: {
      id: ID.policy,
      tenantId: ID.tenant,
      version: 4,
      state: "ACTIVE",
      effectiveAt: NOW - 60_000,
      revokedAt: null,
    },
    assignments: [{
      id: ID.assignment,
      tenantId: ID.tenant,
      membershipId: ID.membership,
      status: "ACTIVE",
      validFrom: NOW - 60_000,
      validUntil: NOW + 60_000,
      scopeType: "ORGANIZATION",
      organizationId: ID.organization,
      legacyBranchId: null,
      constraintDocument: {},
      rolePackageVersionId: ID.package,
      rolePackageStatus: "ACTIVE",
      rolePackagePrincipalType: "HUMAN",
      rolePackageEffectiveAt: NOW - 60_000,
      rolePackageDeprecatedAt: null,
      capabilities: [{
        key: PUBLIC_WEB_PUBLICATION_WRITE_CAPABILITY,
        effect: "ALLOW",
        status: "ACTIVE",
        stepUpRequired: false,
        approvalRequired: false,
      }],
    }],
  };
}

function authority(): PublicWebPublicationCurrentAuthority {
  const issuedAt = NOW - 60_000;
  return {
    principalLegacyUserId: USER_ID,
    session: {
      selectionId: ID.selection,
      sessionFingerprint: SESSION_FINGERPRINT,
      sessionGeneration: 4,
      status: "ACTIVE",
      accountStatus: "ACTIVE",
      authenticatedPrincipalId: ID.principal,
      tenantId: ID.tenant,
      organizationId: ID.organization,
      legacyBranchId: null,
      issuedAt,
      idleExpiresAt: NOW + 60_000,
      absoluteExpiresAt: issuedAt + ABSOLUTE_SESSION_TTL,
      impersonatorPrincipalId: null,
      originalSessionFingerprint: null,
    },
    selection: {
      id: ID.selection,
      tenantId: ID.tenant,
      organizationId: ID.organization,
      legacyBranchId: null,
      principalId: ID.principal,
      membershipId: ID.membership,
      legacyUserId: USER_ID,
      sessionGeneration: 4,
      status: "ACTIVE",
      impersonatorPrincipalId: null,
    },
    state: state(),
  };
}

function row(entityId: number) {
  return {
    entityType: "PROGRAM",
    entityId,
    locale: "en",
    canonicalSlug: `programme-${entityId}`,
    origin: "IMPORT",
    title: `Programme ${entityId}`,
    summary: null,
    contentJson: { body: `private-draft-body-${entityId}` },
    seoJson: { internalKeyword: `private-keyword-${entityId}` },
    structuredDataJson: { "@type": "Course" },
    generatorReceiptSha256: null,
    idempotencyKey: `public-web.preflight.row-${entityId}`,
  };
}

function manifest(rows: unknown[]) {
  return {
    schemaVersion: 1,
    kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT",
    adapter: {
      id: "catalog.program-import",
      version: "1.0.0",
      mappingSha256: "d".repeat(64),
    },
    generatedAt: "2026-09-09T09:55:00.000Z",
    expiresAt: "2026-09-10T09:55:00.000Z",
    rows,
  };
}

type ApprovalVariant = {
  actorAuthorityExpiresAt?: string;
  validationExpiresAt?: string;
};

function registryContentSha256(value: Record<string, any>): string {
  const compatibleTargets = [...value.compatibleTargets]
    .map((target: Record<string, unknown>) => ({
      entityType: target.entityType,
      locale: target.locale,
    }))
    .sort((left, right) => {
      const leftKey = `${String(left.entityType)}\0${String(left.locale)}`;
      const rightKey = `${String(right.entityType)}\0${String(right.locale)}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return crypto
    .createHash("sha256")
    .update("fas.public-web.import-adapter-registry-content.v1\0", "utf8")
    .update(canonicalJson({
      tenantId: value.tenantId,
      organizationId: value.organizationId,
      registryVersionId: value.registryVersionId,
      adapterId: value.adapterId,
      adapterVersion: value.adapterVersion,
      mappingSha256: value.mappingSha256,
      contractVersion: value.contractVersion,
      mappingSchemaVersion: value.mappingSchemaVersion,
      runtimeReleaseId: value.runtimeReleaseId,
      generation: value.generation,
      compatibleTargets,
      createdByPrincipalId: value.createdByPrincipalId,
      createdByMembershipId: value.createdByMembershipId,
    }), "utf8")
    .digest("hex");
}

function approvalFixture(
  request: PublicWebImportAdapterApprovalRequest,
  variant: ApprovalVariant = {},
) {
  const tuple = {
    tenantId: request.tenantId,
    organizationId: request.organizationId,
    adapterId: request.adapterId,
    adapterVersion: request.adapterVersion,
    mappingSha256: request.mappingSha256,
  };
  const currentRegistryVersion: Record<string, any> = {
    ...tuple,
    registryVersionId: ID.registry,
    contractVersion: request.contractVersion,
    mappingSchemaVersion: request.mappingSchemaVersion,
    runtimeReleaseId: request.runtimeReleaseId,
    generation: request.registryGeneration,
    status: "ACTIVE",
    quarantined: false,
    compatibleTargets: [
      { entityType: "PROGRAM", locale: "en" },
      { entityType: "UNIVERSITY", locale: "tr" },
    ],
    createdByPrincipalId: ID.maker,
    createdByMembershipId: ID.makerMembership,
  };
  currentRegistryVersion.registryContentSha256 =
    registryContentSha256(currentRegistryVersion);
  return {
    request: { ...request },
    currentActorAuthority: {
      tenantId: request.tenantId,
      organizationId: request.organizationId,
      actorPrincipalId: request.actorPrincipalId,
      actorMembershipId: request.actorMembershipId,
      selectionId: request.selectionId,
      sessionGeneration: request.sessionGeneration,
      principalType: "HUMAN",
      capability: "public_web.import_adapter.use",
      active: true,
      expiresAt: variant.actorAuthorityExpiresAt ??
        new Date(NOW + 60 * 60 * 1000).toISOString(),
    },
    currentRegistryVersion,
    currentValidationReceipt: {
      ...tuple,
      registryVersionId: ID.registry,
      validationReceiptId: ID.validation,
      contractVersion: request.contractVersion,
      mappingSchemaVersion: request.mappingSchemaVersion,
      runtimeReleaseId: request.runtimeReleaseId,
      generation: request.registryGeneration,
      registryContentSha256: currentRegistryVersion.registryContentSha256,
      outcome: "PASS",
      status: "CURRENT",
      isLatestForRegistryGeneration: true,
      revoked: false,
      validatedAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
      expiresAt: variant.validationExpiresAt ??
        new Date(NOW + 24 * 60 * 60 * 1000).toISOString(),
    },
    currentReviewReceipt: {
      ...tuple,
      registryVersionId: ID.registry,
      validationReceiptId: ID.validation,
      reviewReceiptId: ID.review,
      generation: request.registryGeneration,
      registryContentSha256: currentRegistryVersion.registryContentSha256,
      makerPrincipalId: ID.maker,
      makerMembershipId: ID.makerMembership,
      checkerPrincipalId: ID.checker,
      checkerMembershipId: ID.checkerMembership,
      decision: "APPROVED",
      status: "CURRENT",
      isLatestForRegistryGeneration: true,
      revoked: false,
      reviewedAt: new Date(NOW - 20 * 60 * 1000).toISOString(),
    },
    currentMakerAuthority: {
      tenantId: request.tenantId,
      organizationId: request.organizationId,
      principalId: ID.maker,
      membershipId: ID.makerMembership,
      principalType: "HUMAN",
      capability: "public_web.import_adapter.create",
      active: true,
      expiresAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
    },
    currentCheckerAuthority: {
      tenantId: request.tenantId,
      organizationId: request.organizationId,
      principalId: ID.checker,
      membershipId: ID.checkerMembership,
      principalType: "HUMAN",
      capability: "public_web.import_adapter.approve",
      active: true,
      expiresAt: new Date(NOW + 2 * 60 * 60 * 1000).toISOString(),
    },
  };
}

function brandedApproval(
  request: PublicWebImportAdapterApprovalRequest,
  variant: ApprovalVariant = {},
): PublicWebImportAdapterApprovalSnapshot {
  const approval = resolvePublicWebImportAdapterApproval(
    approvalFixture(request, variant),
    {
      now: NOW,
      supportedContractVersion: request.contractVersion,
      supportedMappingSchemaVersion: request.mappingSchemaVersion,
      currentRuntimeReleaseId: request.runtimeReleaseId,
    },
  );
  assert.ok(approval);
  return approval;
}

const resolveAdapterApproval: PublicWebDraftImportAdapterApprovalResolver =
  async (request) => brandedApproval(request);

function serverAuth(token: string, overrides: Record<string, unknown> = {}) {
  return {
    activeContextToken: token,
    apiTokenAuth: false,
    authorizationHeader: null,
    csrfCookie: CSRF,
    csrfHeader: CSRF,
    impersonating: false,
    origin: ORIGIN,
    rawCookieHeader: `sid=${SID}; csrf_token=${CSRF}`,
    requestUserLegacyId: USER_ID,
    sessionCookie: SID,
    ...overrides,
  };
}

async function options(overrides: Record<string, unknown> = {}) {
  const token = await activeContextToken();
  return {
    serverAuth: serverAuth(token),
    requestBody: { manifest: manifest([row(41)]), confirmPartial: false },
    trustedOrigins: [ORIGIN],
    versionedActiveContext: {
      audience: CONTEXT_AUDIENCE,
      environmentId: ENVIRONMENT,
      cellId: CELL,
      issuerId: ID.contextIssuer,
      keyRing: [contextKey()],
    },
    resolveCurrentAuthority: async () => authority(),
    resolveAdapterApproval,
    adapterRuntime: {
      contractVersion: CONTRACT_VERSION,
      mappingSchemaVersion: MAPPING_SCHEMA_VERSION,
      currentRuntimeReleaseId: RUNTIME_RELEASE_ID,
      registryGeneration: REGISTRY_GENERATION,
    },
    resolveSource: async (entityType: "PROGRAM", entityId: number) => ({
      entityType,
      entityId,
      sourceSha256: SOURCE_SHA,
    }),
    receipt: {
      environmentId: ENVIRONMENT,
      cellId: CELL,
      issuerId: ID.receiptIssuer,
      keyId: RECEIPT_KEY_ID,
      keyReference: RECEIPT_KEY_REFERENCE,
      keyRing: [receiptKey()],
      signer: receiptSigner,
      ttlMs: 60_000,
    },
    runtimeNow: () => NOW,
    ...overrides,
  };
}

test("issues a scope-bound Ed25519 receipt for a successful redacted preview", async () => {
  const result = await preflightPublicWebDraftImport(await options());
  assert.equal(result.ok, true);
  if (!result.ok || result.status !== "READY") return;
  assert.equal(result.responsePolicy.cacheControl, PUBLIC_WEB_PUBLICATION_CACHE_CONTROL);
  assert.equal(result.preview.plan.acceptedCount, 1);
  assert.equal(result.receipt.issuedAt, NOW);
  assert.equal(result.receipt.expiresAt, NOW + 60_000);

  const verified = verifyPublicWebDraftPreviewReceipt({
    token: result.receipt.token,
    keyRing: [receiptKey()],
    expected: {
      audience: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_AUDIENCE,
      environmentId: ENVIRONMENT,
      cellId: CELL,
      issuerId: ID.receiptIssuer,
      tenantId: ID.tenant,
      organizationId: ID.organization,
      actorLegacyUserId: USER_ID,
      actorPrincipalId: ID.principal,
      membershipId: ID.membership,
      selectionId: ID.selection,
      sessionGeneration: 4,
      sessionFingerprint: SESSION_FINGERPRINT,
      activeContextId: ID.context,
      activeContextExpiresAt: NOW + 60_000,
      manifestSha256: result.preview.manifest.manifestSha256,
      adapterId: result.preview.manifest.adapterId,
      adapterVersion: result.preview.manifest.adapterVersion,
      adapterApprovalSha256:
        result.preview.approval?.adapterApprovalSha256 ?? "",
      mappingSha256: result.preview.manifest.mappingSha256,
      planSha256: result.preview.plan.planSha256,
      runtimeReleaseId: RUNTIME_RELEASE_ID,
    },
    now: NOW,
  });
  assert.equal(verified.ok, true);
});

test("caps receipt expiry at the remaining adapter approval lifetime", async () => {
  const base = await options();
  const result = await preflightPublicWebDraftImport({
    ...base,
    resolveAdapterApproval: async (request) => brandedApproval(request, {
      actorAuthorityExpiresAt: new Date(NOW + 30_000).toISOString(),
    }),
    receipt: {
      ...base.receipt,
      ttlMs: 60_000,
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok || result.status !== "READY") return;
  assert.equal(result.receipt.issuedAt, NOW);
  assert.equal(result.receipt.expiresAt, NOW + 30_000);
  assert.equal(result.preview.approval?.validUntil, NOW + 30_000);
});

test("rejects an over-maximum requested TTL before signing even when approval expires sooner", async () => {
  let signerCalls = 0;
  const base = await options();
  const result = await preflightPublicWebDraftImport({
    ...base,
    resolveAdapterApproval: async (request) => brandedApproval(request, {
      actorAuthorityExpiresAt: new Date(NOW + 30_000).toISOString(),
    }),
    receipt: {
      ...base.receipt,
      ttlMs: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_MAX_TTL_MS + 1,
      signer: {
        async sign() {
          signerCalls += 1;
          return Buffer.alloc(64);
        },
      },
    },
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "receipt_unavailable",
    responsePolicy: { cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL },
  });
  assert.equal(signerCalls, 0);
});

test("does not return READY when trusted time crosses approval and receipt expiry during signing", async () => {
  let observedAt = NOW;
  let signerCalls = 0;
  const base = await options();
  const result = await preflightPublicWebDraftImport({
    ...base,
    runtimeNow: () => observedAt,
    resolveAdapterApproval: async (request) => brandedApproval(request, {
      actorAuthorityExpiresAt: new Date(NOW + 30_000).toISOString(),
    }),
    receipt: {
      ...base.receipt,
      ttlMs: 60_000,
      signer: {
        async sign(input) {
          signerCalls += 1;
          const signature = await receiptSigner.sign(input);
          observedAt = NOW + 30_000;
          return signature;
        },
      },
    },
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "receipt_unavailable",
    responsePolicy: { cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL },
  });
  assert.equal(signerCalls, 1);
});

test("fails generically without signing when the single trusted clock regresses or becomes fractional", async () => {
  for (const invalidObservedAt of [NOW - 1, NOW + 0.5]) {
    let observedAt = NOW;
    let sourceCalls = 0;
    let signerCalls = 0;
    const base = await options();
    const result = await preflightPublicWebDraftImport({
      ...base,
      runtimeNow: () => observedAt,
      resolveAdapterApproval: async (request) => {
        const approval = brandedApproval(request);
        observedAt = invalidObservedAt;
        return approval;
      },
      resolveSource: async () => {
        sourceCalls += 1;
        return null;
      },
      receipt: {
        ...base.receipt,
        signer: {
          async sign() {
            signerCalls += 1;
            return Buffer.alloc(64);
          },
        },
      },
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "preview_unavailable",
      responsePolicy: { cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL },
    });
    assert.deepEqual([sourceCalls, signerCalls], [0, 0]);
  }
});

test("short-circuits all downstream dependencies when the runtime boundary fails", async () => {
  let authorityCalls = 0;
  let adapterCalls = 0;
  let sourceCalls = 0;
  let signerCalls = 0;
  const base = await options();
  const result = await preflightPublicWebDraftImport({
    ...base,
    serverAuth: serverAuth(await activeContextToken(), {
      authorizationHeader: "Bearer should-not-be-accepted",
    }),
    resolveCurrentAuthority: async () => {
      authorityCalls += 1;
      return authority();
    },
    resolveAdapterApproval: async () => {
      adapterCalls += 1;
      throw new Error("must not run");
    },
    resolveSource: async () => {
      sourceCalls += 1;
      return null;
    },
    receipt: {
      ...base.receipt,
      signer: {
        async sign() {
          signerCalls += 1;
          throw new Error("must not run");
        },
      },
    },
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "authorization_failed",
    responsePolicy: { cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL },
  });
  assert.deepEqual([authorityCalls, adapterCalls, sourceCalls, signerCalls], [0, 0, 0, 0]);
});

test("maps adapter refusal and invalid manifests to generic preview failure", async () => {
  let sourceCalls = 0;
  let signerCalls = 0;
  const base = await options();
  const refused = await preflightPublicWebDraftImport({
    ...base,
    resolveAdapterApproval: async () => null,
    resolveSource: async () => {
      sourceCalls += 1;
      return null;
    },
    receipt: {
      ...base.receipt,
      signer: { async sign() { signerCalls += 1; return Buffer.alloc(64); } },
    },
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.reason, "preview_unavailable");
  assert.deepEqual([sourceCalls, signerCalls], [0, 0]);

  const invalid = await preflightPublicWebDraftImport({
    ...base,
    requestBody: { manifest: { privateFailure: "raw-manifest-secret" }, confirmPartial: false },
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.reason, "preview_unavailable");
  assert.equal(JSON.stringify(invalid).includes("raw-manifest-secret"), false);
});

test("returns only a generic no-store failure when the external signer fails", async () => {
  const base = await options();
  const result = await preflightPublicWebDraftImport({
    ...base,
    receipt: {
      ...base.receipt,
      signer: {
        async sign() {
          throw new Error(SECRET);
        },
      },
    },
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "receipt_unavailable",
    responsePolicy: { cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL },
  });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("fails before preview when the server-only adapter runtime tuple is invalid", async () => {
  const base = await options();
  for (const invalid of [
    {
      adapterRuntime: {
        ...base.adapterRuntime,
        contractVersion: "invalid version with spaces",
      },
    },
    {
      adapterRuntime: {
        ...base.adapterRuntime,
        currentRuntimeReleaseId: "invalid release with spaces",
      },
    },
    {
      adapterRuntime: {
        ...base.adapterRuntime,
        registryGeneration: 0,
      },
    },
  ]) {
    let adapterCalls = 0;
    let sourceCalls = 0;
    const result = await preflightPublicWebDraftImport({
      ...base,
      ...invalid,
      resolveAdapterApproval: async (request) => {
        adapterCalls += 1;
        return brandedApproval(request);
      },
      resolveSource: async () => {
        sourceCalls += 1;
        return null;
      },
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "receipt_unavailable",
      responsePolicy: { cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL },
    });
    assert.deepEqual([adapterCalls, sourceCalls], [0, 0]);
  }
});

test("shows a partial preview but requires exact explicit confirmation before signing", async () => {
  let signerCalls = 0;
  const base = await options();
  const partialBody = { manifest: manifest([row(41), row(42)]), confirmPartial: false };
  const partialOptions = {
    ...base,
    requestBody: partialBody,
    resolveSource: async (entityType: "PROGRAM", entityId: number) => entityId === 42
      ? null
      : { entityType, entityId, sourceSha256: SOURCE_SHA },
    receipt: {
      ...base.receipt,
      signer: {
        async sign(input: Parameters<PublicWebDraftPreviewReceiptExternalSigner["sign"]>[0]) {
          signerCalls += 1;
          return receiptSigner.sign(input);
        },
      },
    },
  };
  const needsConfirmation = await preflightPublicWebDraftImport(partialOptions);
  assert.equal(needsConfirmation.ok, true);
  if (needsConfirmation.ok) {
    assert.equal(needsConfirmation.status, "PARTIAL_CONFIRMATION_REQUIRED");
    assert.equal(needsConfirmation.receipt, null);
    assert.deepEqual(needsConfirmation.preview.rejected, [{ index: 1, reason: "source_missing" }]);
  }
  assert.equal(signerCalls, 0);

  const confirmed = await preflightPublicWebDraftImport({
    ...partialOptions,
    requestBody: { ...partialBody, confirmPartial: true },
  });
  assert.equal(confirmed.ok, true);
  if (confirmed.ok) assert.equal(confirmed.status, "READY");
  assert.equal(signerCalls, 1);
});

test("snapshots confirmPartial before authority and adapter awaits", async () => {
  for (const mutationPhase of ["authority", "adapter"] as const) {
    let signerCalls = 0;
    const body = {
      manifest: manifest([row(41), row(42)]),
      confirmPartial: false,
    };
    const base = await options();
    const result = await preflightPublicWebDraftImport({
      ...base,
      requestBody: body,
      resolveCurrentAuthority: async () => {
        await Promise.resolve();
        if (mutationPhase === "authority") body.confirmPartial = true;
        return authority();
      },
      resolveAdapterApproval: async (request) => {
        await Promise.resolve();
        if (mutationPhase === "adapter") body.confirmPartial = true;
        return brandedApproval(request);
      },
      resolveSource: async (entityType: "PROGRAM", entityId: number) => entityId === 42
        ? null
        : { entityType, entityId, sourceSha256: SOURCE_SHA },
      receipt: {
        ...base.receipt,
        signer: {
          async sign() {
            signerCalls += 1;
            return Buffer.alloc(64);
          },
        },
      },
    });
    assert.equal(body.confirmPartial, true);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.status, "PARTIAL_CONFIRMATION_REQUIRED");
      assert.equal(result.receipt, null);
    }
    assert.equal(signerCalls, 0);
  }
});

test("rejects a request-body accessor without invoking it or downstream work", async () => {
  const base = await options();
  let getterCalls = 0;
  let authorityCalls = 0;
  let adapterCalls = 0;
  let sourceCalls = 0;
  let signerCalls = 0;
  const body: Record<string, unknown> = {
    manifest: manifest([row(41)]),
  };
  Object.defineProperty(body, "confirmPartial", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return false;
    },
  });
  const result = await preflightPublicWebDraftImport({
    ...base,
    requestBody: body,
    resolveCurrentAuthority: async () => {
      authorityCalls += 1;
      return authority();
    },
    resolveAdapterApproval: async () => {
      adapterCalls += 1;
      return null;
    },
    resolveSource: async () => {
      sourceCalls += 1;
      return null;
    },
    receipt: {
      ...base.receipt,
      signer: {
        async sign() {
          signerCalls += 1;
          return Buffer.alloc(64);
        },
      },
    },
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "authorization_failed",
    responsePolicy: { cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL },
  });
  assert.deepEqual(
    [getterCalls, authorityCalls, adapterCalls, sourceCalls, signerCalls],
    [0, 0, 0, 0, 0],
  );
});

test("rejects an unexpected partial confirmation for a complete plan", async () => {
  const base = await options();
  const result = await preflightPublicWebDraftImport({
    ...base,
    requestBody: {
      manifest: manifest([row(41)]),
      confirmPartial: true,
    },
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "request_invalid",
    responsePolicy: { cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL },
  });
});

test("rejects non-exact bodies and top-level client authority before preview", async () => {
  let adapterCalls = 0;
  const base = await options();
  const nonExact = await preflightPublicWebDraftImport({
    ...base,
    requestBody: {
      manifest: manifest([row(41)]),
      confirmPartial: false,
      displayMode: "unsafe-extra-field",
    },
    resolveAdapterApproval: async (request) => {
      adapterCalls += 1;
      return brandedApproval(request);
    },
  });
  assert.equal(nonExact.ok, false);
  if (!nonExact.ok) assert.equal(nonExact.reason, "request_invalid");

  const authorityOverride = await preflightPublicWebDraftImport({
    ...base,
    requestBody: {
      manifest: manifest([row(41)]),
      confirmPartial: false,
      tenantId: ID.otherTenant,
    },
    resolveAdapterApproval: async (request) => {
      adapterCalls += 1;
      return brandedApproval(request);
    },
  });
  assert.equal(authorityOverride.ok, false);
  if (!authorityOverride.ok) assert.equal(authorityOverride.reason, "authorization_failed");
  assert.equal(adapterCalls, 0);
});

test("binds receipt identity to the server session scope, not manifest content", async () => {
  const result = await preflightPublicWebDraftImport(await options());
  assert.equal(result.ok, true);
  if (!result.ok || result.status !== "READY") return;
  const wrongScope = verifyPublicWebDraftPreviewReceipt({
    token: result.receipt.token,
    keyRing: [receiptKey()],
    expected: {
      audience: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_AUDIENCE,
      environmentId: ENVIRONMENT,
      cellId: CELL,
      issuerId: ID.receiptIssuer,
      tenantId: ID.otherTenant,
      organizationId: ID.organization,
      actorLegacyUserId: USER_ID,
      actorPrincipalId: ID.principal,
      membershipId: ID.membership,
      selectionId: ID.selection,
      sessionGeneration: 4,
      sessionFingerprint: SESSION_FINGERPRINT,
      activeContextId: ID.context,
      activeContextExpiresAt: NOW + 60_000,
      manifestSha256: result.preview.manifest.manifestSha256,
      adapterId: result.preview.manifest.adapterId,
      adapterVersion: result.preview.manifest.adapterVersion,
      adapterApprovalSha256:
        result.preview.approval?.adapterApprovalSha256 ?? "",
      mappingSha256: result.preview.manifest.mappingSha256,
      planSha256: result.preview.plan.planSha256,
      runtimeReleaseId: RUNTIME_RELEASE_ID,
    },
    now: NOW,
  });
  assert.deepEqual(wrongScope, { ok: false, reason: "tenant_mismatch" });
});

test("rejects structural adapterRuntime tricks without invoking accessors or downstream work", async () => {
  const base = await options();
  let getterCalls = 0;
  const getterRuntime: Record<PropertyKey, unknown> = {
    ...base.adapterRuntime,
  };
  delete getterRuntime.contractVersion;
  Object.defineProperty(getterRuntime, "contractVersion", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return CONTRACT_VERSION;
    },
  });

  let proxyGetterCalls = 0;
  const proxyRuntime = new Proxy({ ...base.adapterRuntime }, {
    get(target, property, receiver) {
      proxyGetterCalls += 1;
      return Reflect.get(target, property, receiver);
    },
  });

  const symbolRuntime: Record<PropertyKey, unknown> = {
    ...base.adapterRuntime,
  };
  Object.defineProperty(symbolRuntime, Symbol("hidden-authority"), {
    enumerable: true,
    value: "must-not-be-accepted",
  });

  const nonEnumerableRuntime: Record<PropertyKey, unknown> = {
    ...base.adapterRuntime,
  };
  Object.defineProperty(nonEnumerableRuntime, "hiddenAuthority", {
    enumerable: false,
    value: "must-not-be-accepted",
  });

  const extraRuntime = {
    ...base.adapterRuntime,
    hiddenAuthority: "must-not-be-accepted",
  };

  for (const invalidRuntime of [
    getterRuntime,
    proxyRuntime,
    symbolRuntime,
    nonEnumerableRuntime,
    extraRuntime,
  ]) {
    let adapterCalls = 0;
    let sourceCalls = 0;
    let signerCalls = 0;
    const result = await preflightPublicWebDraftImport({
      ...base,
      adapterRuntime: invalidRuntime as never,
      resolveAdapterApproval: async () => {
        adapterCalls += 1;
        throw new Error("must not run");
      },
      resolveSource: async () => {
        sourceCalls += 1;
        return null;
      },
      receipt: {
        ...base.receipt,
        signer: {
          async sign() {
            signerCalls += 1;
            return Buffer.alloc(64);
          },
        },
      },
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "receipt_unavailable",
      responsePolicy: { cacheControl: PUBLIC_WEB_PUBLICATION_CACHE_CONTROL },
    });
    assert.deepEqual([adapterCalls, sourceCalls, signerCalls], [0, 0, 0]);
  }
  assert.deepEqual([getterCalls, proxyGetterCalls], [0, 0]);
});

test("rejects unbranded adapter resolver candidates before source resolution and signing", async () => {
  const base = await options();
  let candidateGetterCalls = 0;
  const getterCandidate = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(getterCandidate, "approvalSnapshotSha256", {
    enumerable: true,
    get() {
      candidateGetterCalls += 1;
      return "e".repeat(64);
    },
  });
  const candidates: Array<{
    label: string;
    resolve(request: PublicWebImportAdapterApprovalRequest): unknown;
  }> = [
    { label: "null", resolve: () => null },
    {
      label: "plain clone",
      resolve: (request) => JSON.parse(JSON.stringify(brandedApproval(request))),
    },
    { label: "boolean", resolve: () => true },
    { label: "getter candidate", resolve: () => getterCandidate },
  ];

  for (const candidate of candidates) {
    let sourceCalls = 0;
    let signerCalls = 0;
    const result = await preflightPublicWebDraftImport({
      ...base,
      resolveAdapterApproval: async (request) => candidate.resolve(request),
      resolveSource: async () => {
        sourceCalls += 1;
        return null;
      },
      receipt: {
        ...base.receipt,
        signer: {
          async sign() {
            signerCalls += 1;
            return Buffer.alloc(64);
          },
        },
      },
    });
    assert.equal(result.ok, false, candidate.label);
    if (!result.ok) assert.equal(result.reason, "preview_unavailable", candidate.label);
    assert.deepEqual([sourceCalls, signerCalls], [0, 0], candidate.label);
  }
  assert.equal(candidateGetterCalls, 0);
});

test("rejects client injection of adapter approval and runtime authority before resolver work", async () => {
  const base = await options();
  const injections: Array<[string, unknown, "authorization_failed" | "request_invalid"]> = [
    ["adapterApprovalSha256", "e".repeat(64), "authorization_failed"],
    ["runtimeReleaseId", "attacker-release", "authorization_failed"],
    ["contractVersion", CONTRACT_VERSION, "request_invalid"],
    ["mappingSchemaVersion", MAPPING_SCHEMA_VERSION, "request_invalid"],
    ["registryGeneration", REGISTRY_GENERATION, "request_invalid"],
  ];
  for (const [field, injectedValue, expectedReason] of injections) {
    let adapterCalls = 0;
    let sourceCalls = 0;
    let signerCalls = 0;
    const result = await preflightPublicWebDraftImport({
      ...base,
      requestBody: {
        manifest: manifest([row(41)]),
        confirmPartial: false,
        [field]: injectedValue,
      },
      resolveAdapterApproval: async () => {
        adapterCalls += 1;
        throw new Error("must not run");
      },
      resolveSource: async () => {
        sourceCalls += 1;
        return null;
      },
      receipt: {
        ...base.receipt,
        signer: {
          async sign() {
            signerCalls += 1;
            return Buffer.alloc(64);
          },
        },
      },
    });
    assert.equal(result.ok, false, field);
    if (!result.ok) assert.equal(result.reason, expectedReason, field);
    assert.deepEqual([adapterCalls, sourceCalls, signerCalls], [0, 0, 0], field);
  }
});

test("never returns raw content, source hashes, request secrets, or signer material", async () => {
  const result = await preflightPublicWebDraftImport(await options());
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "private-draft-body-41",
    "private-keyword-41",
    "public-web.preflight.row-41",
    SOURCE_SHA,
    SID,
    CSRF,
    CONTEXT_KEY_REFERENCE,
    RECEIPT_KEY_REFERENCE,
    "PRIVATE KEY",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
