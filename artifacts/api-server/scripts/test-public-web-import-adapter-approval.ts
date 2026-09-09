import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { canonicalJson } from "../src/lib/jsonCanonical.js";
import { PUBLIC_WEB_ENTITY_TYPES } from "../src/lib/publicWebContentContract.js";
import {
  isVerifiedPublicWebImportAdapterApprovalSnapshot,
  isVerifiedPublicWebImportAdapterApprovalSnapshotForRequest,
  resolvePublicWebImportAdapterApproval,
} from "../src/lib/publicWebImportAdapterApproval.js";
import { PROGRAM_SUPPORTED_LOCALES } from "../src/lib/programTranslationContract.js";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const ID = {
  tenant: "018faa00-0000-7000-8000-000000000001",
  organization: "018faa00-0000-7000-8000-000000000002",
  actor: "018faa00-0000-7000-8000-000000000003",
  actorMembership: "018faa00-0000-7000-8000-000000000004",
  selection: "018faa00-0000-7000-8000-000000000005",
  registry: "018faa00-0000-7000-8000-000000000006",
  validation: "018faa00-0000-7000-8000-000000000007",
  review: "018faa00-0000-7000-8000-000000000008",
  maker: "018faa00-0000-7000-8000-000000000009",
  makerMembership: "018faa00-0000-7000-8000-00000000000a",
  checker: "018faa00-0000-7000-8000-00000000000b",
  checkerMembership: "018faa00-0000-7000-8000-00000000000c",
} as const;

const POLICY = Object.freeze({
  now: NOW,
  supportedContractVersion: "draft-import-v1",
  supportedMappingSchemaVersion: 1,
  currentRuntimeReleaseId: "20260909T120000Z-c9292077",
});

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

function fixture() {
  const tuple = {
    tenantId: ID.tenant,
    organizationId: ID.organization,
    adapterId: "catalog.program-import",
    adapterVersion: "1.0.0",
    mappingSha256: "a".repeat(64),
  };
  const currentRegistryVersion: Record<string, any> = {
    ...tuple,
    registryVersionId: ID.registry,
    contractVersion: "draft-import-v1",
    mappingSchemaVersion: 1,
    runtimeReleaseId: "20260909T120000Z-c9292077",
    generation: 3,
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
    request: {
      ...tuple,
      actorPrincipalId: ID.actor,
      actorMembershipId: ID.actorMembership,
      selectionId: ID.selection,
      sessionGeneration: 7,
      contractVersion: "draft-import-v1",
      mappingSchemaVersion: 1,
      runtimeReleaseId: "20260909T120000Z-c9292077",
      registryGeneration: 3,
      entityType: "PROGRAM",
      locale: "en",
    },
    currentActorAuthority: {
      tenantId: ID.tenant,
      organizationId: ID.organization,
      actorPrincipalId: ID.actor,
      actorMembershipId: ID.actorMembership,
      selectionId: ID.selection,
      sessionGeneration: 7,
      principalType: "HUMAN",
      capability: "public_web.import_adapter.use",
      active: true,
      expiresAt: "2026-09-09T13:00:00.000Z",
    },
    currentRegistryVersion,
    currentValidationReceipt: {
      ...tuple,
      registryVersionId: ID.registry,
      validationReceiptId: ID.validation,
      contractVersion: "draft-import-v1",
      mappingSchemaVersion: 1,
      runtimeReleaseId: "20260909T120000Z-c9292077",
      generation: 3,
      registryContentSha256: currentRegistryVersion.registryContentSha256,
      outcome: "PASS",
      status: "CURRENT",
      isLatestForRegistryGeneration: true,
      revoked: false,
      validatedAt: "2026-09-09T11:00:00.000Z",
      expiresAt: "2026-09-10T11:00:00.000Z",
    },
    currentReviewReceipt: {
      ...tuple,
      registryVersionId: ID.registry,
      validationReceiptId: ID.validation,
      reviewReceiptId: ID.review,
      generation: 3,
      registryContentSha256: currentRegistryVersion.registryContentSha256,
      makerPrincipalId: ID.maker,
      makerMembershipId: ID.makerMembership,
      checkerPrincipalId: ID.checker,
      checkerMembershipId: ID.checkerMembership,
      decision: "APPROVED",
      status: "CURRENT",
      isLatestForRegistryGeneration: true,
      revoked: false,
      reviewedAt: "2026-09-09T11:30:00.000Z",
    },
    currentMakerAuthority: {
      tenantId: ID.tenant,
      organizationId: ID.organization,
      principalId: ID.maker,
      membershipId: ID.makerMembership,
      principalType: "HUMAN",
      capability: "public_web.import_adapter.create",
      active: true,
      expiresAt: "2026-09-09T14:00:00.000Z",
    },
    currentCheckerAuthority: {
      tenantId: ID.tenant,
      organizationId: ID.organization,
      principalId: ID.checker,
      membershipId: ID.checkerMembership,
      principalType: "HUMAN",
      capability: "public_web.import_adapter.approve",
      active: true,
      expiresAt: "2026-09-09T14:00:00.000Z",
    },
  };
}

function refreshRegistryBinding(input: ReturnType<typeof fixture>): void {
  input.currentRegistryVersion.registryContentSha256 =
    registryContentSha256(input.currentRegistryVersion);
  input.currentValidationReceipt.registryContentSha256 =
    input.currentRegistryVersion.registryContentSha256;
  input.currentReviewReceipt.registryContentSha256 =
    input.currentRegistryVersion.registryContentSha256;
}

function resolve(
  value: unknown,
  policy: Record<string, unknown> = POLICY,
) {
  return resolvePublicWebImportAdapterApproval(value, policy as never);
}

function expectation(input: ReturnType<typeof fixture> = fixture()) {
  return {
    tenantId: ID.tenant,
    organizationId: ID.organization,
    actorPrincipalId: ID.actor,
    actorMembershipId: ID.actorMembership,
    selectionId: ID.selection,
    sessionGeneration: 7,
    actorAuthorityExpiresAt: input.currentActorAuthority.expiresAt,
    registryVersionId: ID.registry,
    adapterId: "catalog.program-import",
    adapterVersion: "1.0.0",
    mappingSha256: "a".repeat(64),
    contractVersion: "draft-import-v1",
    mappingSchemaVersion: 1,
    runtimeReleaseId: "20260909T120000Z-c9292077",
    generation: 3,
    registryContentSha256:
      input.currentRegistryVersion.registryContentSha256 as string,
    entityType: "PROGRAM",
    locale: "en",
    validationReceiptId: ID.validation,
    reviewReceiptId: ID.review,
  };
}

function verify(
  value: unknown,
  expected: Record<string, unknown> = expectation(),
  now = NOW,
) {
  return isVerifiedPublicWebImportAdapterApprovalSnapshot(
    value,
    { now, expected } as never,
  );
}

function verifyForRequest(
  value: unknown,
  input: ReturnType<typeof fixture> = fixture(),
  now = NOW,
) {
  return isVerifiedPublicWebImportAdapterApprovalSnapshotForRequest(
    value,
    { now, request: input.request } as never,
  );
}

test("returns an immutable, redacted and deterministic exact approval snapshot", () => {
  const input = fixture();
  const approval = resolve(input);
  assert.ok(approval);
  assert.equal(approval.kind, "FAS_PUBLIC_WEB_IMPORT_ADAPTER_APPROVAL");
  assert.equal(approval.adapter.registryVersionId, ID.registry);
  assert.equal(approval.actor.capability, "public_web.import_adapter.use");
  assert.match(approval.approvalSnapshotSha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(approval), true);
  assert.equal(Object.isFrozen(approval.adapter), true);
  assert.equal(Object.isFrozen(approval.compatibleTargets), true);
  assert.equal(Object.isFrozen(approval.compatibleTargets[0]), true);
  assert.deepEqual(approval.compatibleTargets, [
    { entityType: "PROGRAM", locale: "en" },
    { entityType: "UNIVERSITY", locale: "tr" },
  ]);
  assert.equal(verify(approval), true);
  const serialized = JSON.stringify(approval);
  for (const forbidden of ["mappingJson", "rawMapping", "content", "script", "http", "secret", "checkerPrincipalId"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  const reordered = fixture();
  reordered.currentRegistryVersion.compatibleTargets.reverse();
  assert.equal(resolve(reordered)?.approvalSnapshotSha256, approval.approvalSnapshotSha256);
  input.currentRegistryVersion.mappingSha256 = "b".repeat(64);
  assert.equal(approval.adapter.mappingSha256, "a".repeat(64));
});

test("rejects shape clones, JSON round-trips and frozen structural forgeries", () => {
  const approval = resolve(fixture());
  assert.ok(approval);
  const shallowClone = Object.freeze({ ...approval });
  const jsonClone = JSON.parse(JSON.stringify(approval));
  const forged = JSON.parse(JSON.stringify(approval));
  forged.adapter.mappingSha256 = "b".repeat(64);
  forged.approvalSnapshotSha256 = "c".repeat(64);
  Object.freeze(forged.scope);
  Object.freeze(forged.actor);
  Object.freeze(forged.requestedUse);
  Object.freeze(forged.adapter);
  for (const target of forged.compatibleTargets) Object.freeze(target);
  Object.freeze(forged.compatibleTargets);
  Object.freeze(forged.evidence);
  Object.freeze(forged);
  assert.equal(verify(shallowClone), false);
  assert.equal(verify(jsonClone), false);
  assert.equal(verify(forged), false);
});

test("request-only guard verifies the brand before touching an unknown candidate", () => {
  const input = fixture();
  const approval = resolve(input);
  assert.ok(approval);
  assert.equal(verifyForRequest(approval, input), true);

  const mismatched = fixture();
  mismatched.request.registryGeneration += 1;
  assert.equal(verifyForRequest(approval, mismatched), false);

  const unbrandedClone = Object.freeze({ ...approval });
  assert.equal(verifyForRequest(unbrandedClone, input), false);

  let getterReads = 0;
  const maliciousCandidate: Record<string, unknown> = {};
  Object.defineProperty(maliciousCandidate, "scope", {
    enumerable: true,
    get() {
      getterReads += 1;
      return approval.scope;
    },
  });
  Object.freeze(maliciousCandidate);
  assert.equal(verifyForRequest(maliciousCandidate, input), false);
  assert.equal(getterReads, 0);

  let proxyTraps = 0;
  const maliciousProxy = new Proxy({}, {
    get() {
      proxyTraps += 1;
      return undefined;
    },
    getOwnPropertyDescriptor() {
      proxyTraps += 1;
      return undefined;
    },
    getPrototypeOf() {
      proxyTraps += 1;
      return Object.prototype;
    },
    ownKeys() {
      proxyTraps += 1;
      return [];
    },
  });
  assert.equal(verifyForRequest(maliciousProxy, input), false);
  assert.equal(proxyTraps, 0);
});

test("request-only guard rejects request accessors and expires at the earliest authority boundary", () => {
  const input: any = fixture();
  const approval = resolve(input);
  assert.ok(approval);

  let requestGetterReads = 0;
  const accessorRequest = { ...input.request };
  Object.defineProperty(accessorRequest, "adapterId", {
    enumerable: true,
    configurable: true,
    get() {
      requestGetterReads += 1;
      return input.request.adapterId;
    },
  });
  assert.equal(
    isVerifiedPublicWebImportAdapterApprovalSnapshotForRequest(
      approval,
      { now: NOW, request: accessorRequest } as never,
    ),
    false,
  );
  assert.equal(requestGetterReads, 0);
  assert.equal(
    verifyForRequest(
      approval,
      input,
      Date.parse(input.currentActorAuthority.expiresAt),
    ),
    false,
  );
});

test("rejects mutation attempts and mismatched or non-exact expected bindings", () => {
  const approval = resolve(fixture());
  assert.ok(approval);
  assert.throws(() => {
    (approval.adapter as { mappingSha256: string }).mappingSha256 = "b".repeat(64);
  }, TypeError);
  assert.equal(verify(approval), true);
  const wrongGeneration = { ...expectation(), generation: 4 };
  assert.equal(verify(approval, wrongGeneration), false);
  const extraKey = { ...expectation(), rawMapping: {} };
  assert.equal(verify(approval, extraKey), false);
});

test("rejects extra keys and executable or raw adapter material at every boundary", () => {
  for (const mutate of [
    (value: any) => { value.execute = true; },
    (value: any) => { value.request.rawMapping = { source: "title" }; },
    (value: any) => { value.currentRegistryVersion.script = "process.exit(1)"; },
    (value: any) => { value.currentValidationReceipt.http = "https://example.com"; },
    (value: any) => { value.currentReviewReceipt.secretReference = "vault:key"; },
    (value: any) => { value.currentActorAuthority.env = { TOKEN: "secret" }; },
  ]) {
    const input: any = fixture();
    mutate(input);
    assert.equal(resolve(input), null);
  }
  const input: any = fixture();
  input.request.adapterId = () => "code";
  assert.equal(resolve(input), null);
});

test("fails closed on tenant, organization and actor authority drift", () => {
  for (const mutate of [
    (value: any) => { value.currentActorAuthority.tenantId = "018faa00-0000-7000-8000-00000000000d"; },
    (value: any) => { value.currentRegistryVersion.organizationId = "018faa00-0000-7000-8000-00000000000d"; },
    (value: any) => { value.currentValidationReceipt.tenantId = "018faa00-0000-7000-8000-00000000000d"; },
    (value: any) => { value.currentReviewReceipt.organizationId = "018faa00-0000-7000-8000-00000000000d"; },
    (value: any) => { value.currentActorAuthority.actorPrincipalId = ID.checker; },
    (value: any) => { value.currentActorAuthority.actorMembershipId = ID.checkerMembership; },
    (value: any) => { value.currentActorAuthority.selectionId = ID.registry; },
  ]) {
    const input: any = fixture();
    mutate(input);
    assert.equal(resolve(input), null);
  }
});

test("requires the current exact capability and session generation", () => {
  for (const mutate of [
    (value: any) => { value.currentActorAuthority.capability = "public_web.content.write"; },
    (value: any) => { value.currentActorAuthority.active = false; },
    (value: any) => { value.currentActorAuthority.sessionGeneration = 8; },
    (value: any) => { value.currentActorAuthority.expiresAt = "2026-09-09T12:00:00.000Z"; },
  ]) {
    const input: any = fixture();
    mutate(input);
    assert.equal(resolve(input), null);
  }
});

test("rejects inactive or quarantined registry versions", () => {
  const inactive: any = fixture();
  inactive.currentRegistryVersion.status = "RETIRED";
  assert.equal(resolve(inactive), null);
  const quarantined: any = fixture();
  quarantined.currentRegistryVersion.quarantined = true;
  assert.equal(resolve(quarantined), null);
});

test("rejects adapter, SHA, generation and receipt drift", () => {
  for (const mutate of [
    (value: any) => { value.request.adapterVersion = "1.0.1"; },
    (value: any) => { value.currentValidationReceipt.mappingSha256 = "b".repeat(64); },
    (value: any) => { value.currentReviewReceipt.generation = 4; },
    (value: any) => { value.currentReviewReceipt.validationReceiptId = ID.registry; },
    (value: any) => { value.currentValidationReceipt.registryVersionId = ID.review; },
    (value: any) => { value.currentReviewReceipt.reviewReceiptId = ID.registry; },
  ]) {
    const input: any = fixture();
    mutate(input);
    assert.equal(resolve(input), null);
  }
});

test("enforces independent maker-checker and binds the review maker to the creator", () => {
  for (const mutate of [
    (value: any) => { value.currentReviewReceipt.checkerPrincipalId = ID.maker; },
    (value: any) => { value.currentReviewReceipt.checkerMembershipId = ID.makerMembership; },
    (value: any) => { value.currentReviewReceipt.makerPrincipalId = ID.actor; },
    (value: any) => { value.currentReviewReceipt.decision = "REJECTED"; },
  ]) {
    const input: any = fixture();
    mutate(input);
    assert.equal(resolve(input), null);
  }
});

test("rejects failed, expired, overlong, future and review-stale validation evidence", () => {
  for (const mutate of [
    (value: any) => { value.currentValidationReceipt.outcome = "FAIL"; },
    (value: any) => { value.currentValidationReceipt.expiresAt = "2026-09-09T12:00:00.000Z"; },
    (value: any) => { value.currentValidationReceipt.expiresAt = "2026-09-17T11:00:00.000Z"; },
    (value: any) => { value.currentValidationReceipt.validatedAt = "2026-09-09T12:05:00.001Z"; },
    (value: any) => { value.currentReviewReceipt.reviewedAt = "2026-09-09T10:59:59.999Z"; },
    (value: any) => { value.currentReviewReceipt.reviewedAt = "2026-09-10T11:00:00.000Z"; },
  ]) {
    const input: any = fixture();
    mutate(input);
    assert.equal(resolve(input), null);
  }
});

test("fails closed for unsupported entity, locale, runtime, contract and schema", () => {
  for (const mutate of [
    (value: any) => { value.request.entityType = "ARTICLE"; },
    (value: any) => { value.request.locale = "fr"; },
    (value: any) => { value.request.runtimeReleaseId = "20260909T120000Z-other"; },
    (value: any) => { value.request.contractVersion = "draft-import-v2"; },
    (value: any) => { value.request.mappingSchemaVersion = 2; },
    (value: any) => { value.currentValidationReceipt.runtimeReleaseId = "20260909T120000Z-other"; },
  ]) {
    const input: any = fixture();
    mutate(input);
    assert.equal(resolve(input), null);
  }
});

test("rejects coherent but server-unsupported contract, schema and runtime tuples", () => {
  for (const mutate of [
    (value: any) => {
      value.request.contractVersion = "draft-import-v2";
      value.currentRegistryVersion.contractVersion = "draft-import-v2";
      value.currentValidationReceipt.contractVersion = "draft-import-v2";
    },
    (value: any) => {
      value.request.mappingSchemaVersion = 2;
      value.currentRegistryVersion.mappingSchemaVersion = 2;
      value.currentValidationReceipt.mappingSchemaVersion = 2;
    },
    (value: any) => {
      value.request.runtimeReleaseId = "20260909T120000Z-other";
      value.currentRegistryVersion.runtimeReleaseId = "20260909T120000Z-other";
      value.currentValidationReceipt.runtimeReleaseId = "20260909T120000Z-other";
    },
  ]) {
    const input: any = fixture();
    mutate(input);
    refreshRegistryBinding(input);
    assert.equal(resolve(input), null);
  }
});

test("requires an exact target pair and binds compatibility to both receipts", () => {
  const crossProduct: any = fixture();
  crossProduct.request.locale = "tr";
  assert.equal(
    crossProduct.currentRegistryVersion.compatibleTargets.some(
      (target: any) => target.entityType === "PROGRAM" && target.locale === "en",
    ),
    true,
  );
  assert.equal(
    crossProduct.currentRegistryVersion.compatibleTargets.some(
      (target: any) => target.entityType === "UNIVERSITY" && target.locale === "tr",
    ),
    true,
  );
  assert.equal(resolve(crossProduct), null);

  const contentTamper: any = fixture();
  contentTamper.currentRegistryVersion.compatibleTargets.push({
    entityType: "PROGRAM",
    locale: "tr",
  });
  assert.equal(resolve(contentTamper), null);

  const receiptBindingTamper: any = fixture();
  receiptBindingTamper.currentRegistryVersion.compatibleTargets.push({
    entityType: "PROGRAM",
    locale: "tr",
  });
  receiptBindingTamper.currentRegistryVersion.registryContentSha256 =
    registryContentSha256(receiptBindingTamper.currentRegistryVersion);
  assert.equal(resolve(receiptBindingTamper), null);

  const tooMany: any = fixture();
  tooMany.currentRegistryVersion.compatibleTargets =
    PUBLIC_WEB_ENTITY_TYPES.flatMap((entityType) =>
      PROGRAM_SUPPORTED_LOCALES.map((locale) => ({ entityType, locale }))
    ).slice(0, 101);
  assert.equal(
    new Set(
      tooMany.currentRegistryVersion.compatibleTargets.map(
        (target: any) => `${target.entityType}\0${target.locale}`,
      ),
    ).size,
    101,
  );
  assert.equal(resolve(tooMany), null);
});

test("approval use expires fail-closed after actor, validation, maker or checker authority expires", () => {
  const actorInput = fixture();
  const actorApproval = resolve(actorInput);
  assert.ok(actorApproval);
  assert.equal(
    verify(
      actorApproval,
      expectation(actorInput),
      Date.parse("2026-09-09T12:59:59.999Z"),
    ),
    true,
  );
  assert.equal(
    verify(
      actorApproval,
      expectation(actorInput),
      Date.parse(actorInput.currentActorAuthority.expiresAt),
    ),
    false,
  );

  const validationInput = fixture();
  validationInput.currentActorAuthority.expiresAt = "2026-09-11T12:00:00.000Z";
  validationInput.currentMakerAuthority.expiresAt = "2026-09-11T12:00:00.000Z";
  validationInput.currentCheckerAuthority.expiresAt = "2026-09-11T12:00:00.000Z";
  const validationApproval = resolve(validationInput);
  assert.ok(validationApproval);
  assert.equal(
    verify(
      validationApproval,
      expectation(validationInput),
      Date.parse(validationInput.currentValidationReceipt.expiresAt),
    ),
    false,
  );

  for (const authorityName of [
    "currentMakerAuthority",
    "currentCheckerAuthority",
  ] as const) {
    const input = fixture();
    input.currentActorAuthority.expiresAt = "2026-09-11T12:00:00.000Z";
    input[authorityName].expiresAt = "2026-09-09T12:30:00.000Z";
    const approval = resolve(input);
    assert.ok(approval);
    assert.equal(
      verify(
        approval,
        expectation(input),
        Date.parse(input[authorityName].expiresAt),
      ),
      false,
    );
  }
});

test("rejects accessors, hidden or symbol keys and proxies without executing getters", () => {
  const accessorInput: any = fixture();
  let getterReads = 0;
  Object.defineProperty(accessorInput.request, "adapterId", {
    enumerable: true,
    configurable: true,
    get() {
      getterReads += 1;
      return "catalog.program-import";
    },
  });
  assert.equal(resolve(accessorInput), null);
  assert.equal(getterReads, 0);

  const hiddenInput: any = fixture();
  Object.defineProperty(hiddenInput.request, "hidden", {
    value: true,
    enumerable: false,
  });
  assert.equal(resolve(hiddenInput), null);

  const symbolInput: any = fixture();
  Object.defineProperty(symbolInput.request, Symbol("smuggled"), {
    value: true,
    enumerable: true,
  });
  assert.equal(resolve(symbolInput), null);

  let proxyReads = 0;
  const proxyInput: any = fixture();
  proxyInput.request = new Proxy(proxyInput.request, {
    get(target, property, receiver) {
      proxyReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.equal(resolve(proxyInput), null);
  assert.equal(proxyReads, 0);
});

test("requires current non-revoked latest validation and review receipts", () => {
  for (const mutate of [
    (value: any) => { value.currentValidationReceipt.status = "SUPERSEDED"; },
    (value: any) => { value.currentValidationReceipt.isLatestForRegistryGeneration = false; },
    (value: any) => { value.currentValidationReceipt.revoked = true; },
    (value: any) => { value.currentReviewReceipt.status = "SUPERSEDED"; },
    (value: any) => { value.currentReviewReceipt.isLatestForRegistryGeneration = false; },
    (value: any) => { value.currentReviewReceipt.revoked = true; },
  ]) {
    const input: any = fixture();
    mutate(input);
    assert.equal(resolve(input), null);
  }
});

test("requires live human maker/checker memberships, exact capabilities and separation of duties", () => {
  for (const mutate of [
    (value: any) => { value.currentMakerAuthority.principalType = "SERVICE"; },
    (value: any) => { value.currentCheckerAuthority.principalType = "AI"; },
    (value: any) => { value.currentMakerAuthority.active = false; },
    (value: any) => { value.currentCheckerAuthority.active = false; },
    (value: any) => { value.currentMakerAuthority.capability = "public_web.import_adapter.approve"; },
    (value: any) => { value.currentCheckerAuthority.capability = "public_web.import_adapter.create"; },
    (value: any) => { value.currentMakerAuthority.principalId = ID.actor; },
    (value: any) => { value.currentCheckerAuthority.membershipId = ID.actorMembership; },
    (value: any) => { value.currentMakerAuthority.tenantId = "018faa00-0000-7000-8000-00000000000d"; },
    (value: any) => { value.currentCheckerAuthority.organizationId = "018faa00-0000-7000-8000-00000000000d"; },
    (value: any) => { value.currentMakerAuthority.expiresAt = "2026-09-09T12:00:00.000Z"; },
  ]) {
    const input: any = fixture();
    mutate(input);
    assert.equal(resolve(input), null);
  }

  const samePrincipal: any = fixture();
  samePrincipal.currentReviewReceipt.checkerPrincipalId = ID.maker;
  samePrincipal.currentCheckerAuthority.principalId = ID.maker;
  assert.equal(resolve(samePrincipal), null);

  const sameMembership: any = fixture();
  sameMembership.currentReviewReceipt.checkerMembershipId = ID.makerMembership;
  sameMembership.currentCheckerAuthority.membershipId = ID.makerMembership;
  assert.equal(resolve(sameMembership), null);
});

test("rejects malformed identifiers, duplicate compatibility targets and non-plain objects", () => {
  const malformed: any = fixture();
  malformed.currentRegistryVersion.registryVersionId = "not-a-uuid";
  assert.equal(resolve(malformed), null);
  const duplicate: any = fixture();
  duplicate.currentRegistryVersion.compatibleTargets.push({
    entityType: "PROGRAM",
    locale: "en",
  });
  assert.equal(resolve(duplicate), null);
  const nonPlain: any = fixture();
  nonPlain.request = new (class RequestRecord {})();
  Object.assign(nonPlain.request, fixture().request);
  assert.equal(resolve(nonPlain), null);
});
