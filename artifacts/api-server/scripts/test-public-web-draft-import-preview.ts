import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { canonicalJson } from "../src/lib/jsonCanonical.js";
import {
  previewPublicWebDraftImport,
  type PublicWebDraftImportAdapterApprovalResolver,
  type PublicWebDraftImportApprovalContext,
} from "../src/lib/publicWebDraftImportPreview.js";
import {
  resolvePublicWebImportAdapterApproval,
  type PublicWebImportAdapterApprovalRequest,
  type PublicWebImportAdapterApprovalSnapshot,
} from "../src/lib/publicWebImportAdapterApproval.js";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const SOURCE_SHA = "b".repeat(64);
const RUNTIME_RELEASE_ID = "20260909T120000Z-c9292077";
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
  otherActor: "018faa00-0000-7000-8000-00000000000d",
  otherRegistry: "018faa00-0000-7000-8000-00000000000e",
  otherValidation: "018faa00-0000-7000-8000-00000000000f",
  otherReview: "018faa00-0000-7000-8000-000000000010",
} as const;

type ApprovalVariant = {
  actorAuthorityExpiresAt?: string;
  makerAuthorityExpiresAt?: string;
  checkerAuthorityExpiresAt?: string;
  validationExpiresAt?: string;
  registryVersionId?: string;
  validationReceiptId?: string;
  reviewReceiptId?: string;
  compatibleTargets?: Array<{ entityType: string; locale: string }>;
};

function row(
  entityId: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    entityType: "PROGRAM",
    entityId,
    locale: "en",
    canonicalSlug: "programme-" + entityId,
    origin: "IMPORT",
    title: "Programme " + entityId,
    summary: null,
    contentJson: { body: "Private draft body " + entityId },
    seoJson: { internalKeyword: "private-" + entityId },
    structuredDataJson: { "@type": "Course" },
    generatorReceiptSha256: null,
    idempotencyKey: "public-web.preview.row-" + String(entityId).padStart(4, "0"),
    ...overrides,
  };
}

function manifest(rows: unknown[]) {
  return {
    schemaVersion: 1,
    kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT",
    adapter: {
      id: "catalog.program-import",
      version: "1.0.0",
      mappingSha256: "a".repeat(64),
    },
    generatedAt: "2026-09-09T11:55:00.000Z",
    expiresAt: "2026-09-10T11:55:00.000Z",
    rows,
  };
}

function approvalContext(
  overrides: Partial<PublicWebDraftImportApprovalContext> = {},
): PublicWebDraftImportApprovalContext {
  return {
    tenantId: ID.tenant,
    organizationId: ID.organization,
    actorPrincipalId: ID.actor,
    actorMembershipId: ID.actorMembership,
    selectionId: ID.selection,
    sessionGeneration: 7,
    contractVersion: "draft-import-v1",
    mappingSchemaVersion: 1,
    currentRuntimeReleaseId: RUNTIME_RELEASE_ID,
    registryGeneration: 3,
    ...overrides,
  };
}

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
  const registryVersionId = variant.registryVersionId ?? ID.registry;
  const validationReceiptId =
    variant.validationReceiptId ?? ID.validation;
  const reviewReceiptId = variant.reviewReceiptId ?? ID.review;
  const tuple = {
    tenantId: request.tenantId,
    organizationId: request.organizationId,
    adapterId: request.adapterId,
    adapterVersion: request.adapterVersion,
    mappingSha256: request.mappingSha256,
  };
  const currentRegistryVersion: Record<string, any> = {
    ...tuple,
    registryVersionId,
    contractVersion: request.contractVersion,
    mappingSchemaVersion: request.mappingSchemaVersion,
    runtimeReleaseId: request.runtimeReleaseId,
    generation: request.registryGeneration,
    status: "ACTIVE",
    quarantined: false,
    compatibleTargets: variant.compatibleTargets ?? [
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
      expiresAt:
        variant.actorAuthorityExpiresAt ?? "2026-09-09T13:00:00.000Z",
    },
    currentRegistryVersion,
    currentValidationReceipt: {
      ...tuple,
      registryVersionId,
      validationReceiptId,
      contractVersion: request.contractVersion,
      mappingSchemaVersion: request.mappingSchemaVersion,
      runtimeReleaseId: request.runtimeReleaseId,
      generation: request.registryGeneration,
      registryContentSha256: currentRegistryVersion.registryContentSha256,
      outcome: "PASS",
      status: "CURRENT",
      isLatestForRegistryGeneration: true,
      revoked: false,
      validatedAt: "2026-09-09T11:00:00.000Z",
      expiresAt:
        variant.validationExpiresAt ?? "2026-09-10T11:00:00.000Z",
    },
    currentReviewReceipt: {
      ...tuple,
      registryVersionId,
      validationReceiptId,
      reviewReceiptId,
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
      reviewedAt: "2026-09-09T11:30:00.000Z",
    },
    currentMakerAuthority: {
      tenantId: request.tenantId,
      organizationId: request.organizationId,
      principalId: ID.maker,
      membershipId: ID.makerMembership,
      principalType: "HUMAN",
      capability: "public_web.import_adapter.create",
      active: true,
      expiresAt:
        variant.makerAuthorityExpiresAt ?? "2026-09-09T14:00:00.000Z",
    },
    currentCheckerAuthority: {
      tenantId: request.tenantId,
      organizationId: request.organizationId,
      principalId: ID.checker,
      membershipId: ID.checkerMembership,
      principalType: "HUMAN",
      capability: "public_web.import_adapter.approve",
      active: true,
      expiresAt:
        variant.checkerAuthorityExpiresAt ?? "2026-09-09T14:00:00.000Z",
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

const resolveSource = async (
  entityType: Parameters<
    NonNullable<Parameters<typeof previewPublicWebDraftImport>[0]>["resolveSource"]
  >[0],
  entityId: number,
) => ({
  entityType,
  entityId,
  sourceSha256: SOURCE_SHA,
});

function aggregateFrom(
  approvals: readonly PublicWebImportAdapterApprovalSnapshot[],
): string {
  const uses = approvals
    .map((approval) => ({
      entityType: approval.requestedUse.entityType,
      locale: approval.requestedUse.locale,
      approvalSnapshotSha256: approval.approvalSnapshotSha256,
    }))
    .sort((left, right) => {
      const leftKey = `${left.entityType}\0${left.locale}`;
      const rightKey = `${right.entityType}\0${right.locale}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return crypto
    .createHash("sha256")
    .update("fas.public-web.import-adapter-approval-set.v1\0", "utf8")
    .update(canonicalJson(uses), "utf8")
    .digest("hex");
}

function baseOptions(rows: unknown[] = [row(41)]) {
  return {
    approvalContext: approvalContext(),
    manifest: manifest(rows),
    resolveAdapterApproval,
    resolveSource,
    now: NOW,
    approvalNow: () => NOW,
    clock: () => 1_000,
  };
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("returns only an aggregate approval root and redacted review projection", async () => {
  let perUse: PublicWebImportAdapterApprovalSnapshot | undefined;
  const preview = await previewPublicWebDraftImport({
    ...baseOptions(),
    resolveAdapterApproval: async (request) => {
      perUse = brandedApproval(request, {
        actorAuthorityExpiresAt: "2026-09-09T12:00:30.000Z",
      });
      return perUse;
    },
  });
  assert.equal(preview.ok, true);
  if (!preview.ok || !perUse) return;
  assert.equal(preview.plan.acceptedCount, 1);
  assert.equal(preview.plan.executionEligible, true);
  assert.equal(preview.plan.requiresPartialConfirmation, false);
  assert.equal(preview.accepted[0]?.canonicalPath, "/en/programs/programme-41-41");
  assert.deepEqual(preview.approval, {
    adapterApprovalSha256: aggregateFrom([perUse]),
    validUntil: NOW + 30_000,
  });
  assert.notEqual(
    preview.approval?.adapterApprovalSha256,
    perUse.approvalSnapshotSha256,
  );
  assert.deepEqual(Object.keys(preview.approval ?? {}).sort(), [
    "adapterApprovalSha256",
    "validUntil",
  ]);
  const serialized = JSON.stringify(preview);
  for (const forbidden of [
    "Private draft body",
    "internalKeyword",
    "idempotencyKey",
    SOURCE_SHA,
    ID.registry,
    ID.validation,
    ID.review,
    ID.maker,
    ID.checker,
    perUse.approvalSnapshotSha256,
    "compatibleTargets",
    "registryContentSha256",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("skips approval and source access for an invalid-only manifest", async () => {
  let approvalCalls = 0;
  let sourceCalls = 0;
  const privateMarker = "wrong-origin-private-content";
  const preview = await previewPublicWebDraftImport({
    ...baseOptions([{
      ...row(41),
      origin: "HUMAN",
      title: privateMarker,
      contentJson: { body: privateMarker },
    }]),
    resolveAdapterApproval: async () => {
      approvalCalls += 1;
      throw new Error("must not run");
    },
    resolveSource: async () => {
      sourceCalls += 1;
      throw new Error("must not run");
    },
  });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.deepEqual([approvalCalls, sourceCalls], [0, 0]);
  assert.equal(preview.approval, null);
  assert.deepEqual(preview.accepted, []);
  assert.deepEqual(preview.rejected, [{ index: 0, reason: "request_invalid" }]);
  assert.equal(JSON.stringify(preview).includes(privateMarker), false);
});

test("returns only generic invalid-manifest and invalid-plan failures", async () => {
  let approvalCalls = 0;
  assert.deepEqual(await previewPublicWebDraftImport({
    ...baseOptions(),
    manifest: { unsafe: true },
    resolveAdapterApproval: async () => {
      approvalCalls += 1;
      return null;
    },
  }), { ok: false, reason: "manifest_invalid" });
  assert.equal(approvalCalls, 0);

  assert.deepEqual(await previewPublicWebDraftImport({
    ...baseOptions(),
    clock: () => -1,
  }), { ok: false, reason: "plan_invalid" });
});

test("isolates missing rows and requires explicit partial confirmation", async () => {
  const preview = await previewPublicWebDraftImport({
    ...baseOptions([row(41), row(42), { ...row(43), tenantId: ID.tenant }]),
    resolveSource: async (entityType, entityId) => entityId === 42
      ? null
      : { entityType, entityId, sourceSha256: SOURCE_SHA },
  });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.deepEqual(preview.accepted.map(({ index }) => index), [0]);
  assert.deepEqual(preview.rejected, [
    { index: 1, reason: "source_missing" },
    { index: 2, reason: "request_invalid" },
  ]);
  assert.equal(preview.plan.requiresPartialConfirmation, true);
  assert.ok(preview.approval);
});

test("verifies every unique target before any source read and aggregates per-use proofs", async () => {
  const gates = new Map<string, () => void>();
  const snapshots: PublicWebImportAdapterApprovalSnapshot[] = [];
  let sourceCalls = 0;
  const previewPromise = previewPublicWebDraftImport({
    ...baseOptions([
      row(41),
      row(42, {
        entityType: "UNIVERSITY",
        locale: "tr",
        canonicalSlug: "university-42",
      }),
    ]),
    resolveAdapterApproval: async (request, runtime) => {
      assert.equal(Object.isFrozen(request), true);
      assert.equal(Object.isFrozen(runtime), true);
      assert.equal(runtime.deadlineAt, 31_000);
      const snapshot = brandedApproval(request);
      snapshots.push(snapshot);
      const key = `${request.entityType}:${request.locale}`;
      await new Promise<void>((resolve) => gates.set(key, resolve));
      assert.equal(runtime.signal.aborted, false);
      return snapshot;
    },
    resolveSource: async (entityType, entityId) => {
      sourceCalls += 1;
      assert.equal(gates.size, 2);
      return { entityType, entityId, sourceSha256: SOURCE_SHA };
    },
  });
  for (let count = 0; count < 10 && gates.size < 2; count += 1) {
    await nextTurn();
  }
  assert.equal(gates.size, 2);
  assert.equal(sourceCalls, 0);
  gates.get("PROGRAM:en")?.();
  await nextTurn();
  assert.equal(sourceCalls, 0);
  gates.get("UNIVERSITY:tr")?.();
  const preview = await previewPromise;
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(sourceCalls, 2);
  assert.equal(snapshots.length, 2);
  assert.notEqual(
    snapshots[0]?.approvalSnapshotSha256,
    snapshots[1]?.approvalSnapshotSha256,
  );
  assert.equal(
    preview.approval?.adapterApprovalSha256,
    aggregateFrom(snapshots),
  );

  const reversed = await previewPublicWebDraftImport(baseOptions([
    row(42, {
      entityType: "UNIVERSITY",
      locale: "tr",
      canonicalSlug: "university-42",
    }),
    row(41),
  ]));
  assert.equal(reversed.ok, true);
  if (reversed.ok) {
    assert.equal(
      reversed.approval?.adapterApprovalSha256,
      preview.approval?.adapterApprovalSha256,
    );
  }
});

test("rejects mixed approval lineage before resolving any source", async () => {
  let sourceCalls = 0;
  const preview = await previewPublicWebDraftImport({
    ...baseOptions([
      row(41),
      row(42, {
        entityType: "UNIVERSITY",
        locale: "tr",
        canonicalSlug: "university-42",
      }),
    ]),
    resolveAdapterApproval: async (request) => request.entityType === "PROGRAM"
      ? brandedApproval(request)
      : brandedApproval(request, {
          registryVersionId: ID.otherRegistry,
          validationReceiptId: ID.otherValidation,
          reviewReceiptId: ID.otherReview,
        }),
    resolveSource: async () => {
      sourceCalls += 1;
      throw new Error("source must not run");
    },
  });
  assert.deepEqual(preview, { ok: false, reason: "adapter_unapproved" });
  assert.equal(sourceCalls, 0);
});

test("rejects unbranded snapshots and structural clones before source access", async () => {
  for (const clone of [
    (snapshot: PublicWebImportAdapterApprovalSnapshot) =>
      JSON.parse(JSON.stringify(snapshot)),
    (snapshot: PublicWebImportAdapterApprovalSnapshot) =>
      Object.freeze({ ...snapshot }),
  ]) {
    let sourceCalls = 0;
    const preview = await previewPublicWebDraftImport({
      ...baseOptions(),
      resolveAdapterApproval: async (request) => clone(brandedApproval(request)),
      resolveSource: async () => {
        sourceCalls += 1;
        throw new Error("source must not run");
      },
    });
    assert.deepEqual(preview, { ok: false, reason: "adapter_unapproved" });
    assert.equal(sourceCalls, 0);
  }
});

test("does not inspect domain getters on an unbranded resolver result", async () => {
  let getterCalls = 0;
  let sourceCalls = 0;
  const hostile = Object.create(null);
  for (const key of [
    "actor",
    "adapter",
    "approvalSnapshotSha256",
    "compatibleTargets",
    "evidence",
    "requestedUse",
    "scope",
  ]) Object.defineProperty(hostile, key, {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error(`hostile ${key} getter must not execute`);
    },
  });
  const preview = await previewPublicWebDraftImport({
    ...baseOptions(),
    resolveAdapterApproval: async () => hostile,
    resolveSource: async () => {
      sourceCalls += 1;
      throw new Error("source must not run");
    },
  });
  assert.deepEqual(preview, { ok: false, reason: "adapter_unapproved" });
  assert.deepEqual([getterCalls, sourceCalls], [0, 0]);
});

test("rejects actor, mapping, runtime, schema, generation and requested-use drift", async () => {
  const drifted = [
    (request: PublicWebImportAdapterApprovalRequest) => ({
      ...request,
      actorPrincipalId: ID.otherActor,
    }),
    (request: PublicWebImportAdapterApprovalRequest) => ({
      ...request,
      mappingSha256: "f".repeat(64),
    }),
    (request: PublicWebImportAdapterApprovalRequest) => ({
      ...request,
      runtimeReleaseId: "20260909T120000Z-other",
    }),
    (request: PublicWebImportAdapterApprovalRequest) => ({
      ...request,
      mappingSchemaVersion: 2,
    }),
    (request: PublicWebImportAdapterApprovalRequest) => ({
      ...request,
      registryGeneration: 4,
    }),
    (request: PublicWebImportAdapterApprovalRequest) => ({
      ...request,
      entityType: "UNIVERSITY" as const,
      locale: "tr" as const,
    }),
  ];
  for (const mutate of drifted) {
    let sourceCalls = 0;
    const preview = await previewPublicWebDraftImport({
      ...baseOptions(),
      resolveAdapterApproval: async (request) =>
        brandedApproval(
          mutate(request) as PublicWebImportAdapterApprovalRequest,
        ),
      resolveSource: async () => {
        sourceCalls += 1;
        throw new Error("source must not run");
      },
    });
    assert.deepEqual(preview, { ok: false, reason: "adapter_unapproved" });
    assert.equal(sourceCalls, 0);
  }
});

test("rejects invalid or non-exact server approval context before dependencies", async () => {
  for (const context of [
    approvalContext({ currentRuntimeReleaseId: "bad release id" }),
    { ...approvalContext(), registryGeneration: 0 },
    { ...approvalContext(), injectedClientAuthority: true },
  ]) {
    let approvalCalls = 0;
    let sourceCalls = 0;
    const preview = await previewPublicWebDraftImport({
      ...baseOptions(),
      approvalContext: context as PublicWebDraftImportApprovalContext,
      resolveAdapterApproval: async () => {
        approvalCalls += 1;
        return null;
      },
      resolveSource: async () => {
        sourceCalls += 1;
        return null;
      },
    });
    assert.deepEqual(preview, { ok: false, reason: "adapter_unapproved" });
    assert.deepEqual([approvalCalls, sourceCalls], [0, 0]);
  }
});

test("maps resolver exceptions to a generic unapproved result without source access", async () => {
  let sourceCalls = 0;
  const preview = await previewPublicWebDraftImport({
    ...baseOptions(),
    resolveAdapterApproval: async () => {
      throw new Error("private adapter registry failure");
    },
    resolveSource: async () => {
      sourceCalls += 1;
      throw new Error("source must not run");
    },
  });
  assert.deepEqual(preview, { ok: false, reason: "adapter_unapproved" });
  assert.equal(sourceCalls, 0);
  assert.equal(
    JSON.stringify(preview).includes("private adapter registry failure"),
    false,
  );
});

test("hard-times out a pending approval promise and aborts its signal", async () => {
  let clockCalls = 0;
  let observedSignal: AbortSignal | undefined;
  let sourceCalls = 0;
  const started = Date.now();
  const preview = await previewPublicWebDraftImport({
    ...baseOptions(),
    clock: () => {
      clockCalls += 1;
      return clockCalls === 1 ? 1_000 : 30_999;
    },
    resolveAdapterApproval: async (_request, runtime) => {
      observedSignal = runtime.signal;
      return new Promise<never>(() => undefined);
    },
    resolveSource: async () => {
      sourceCalls += 1;
      throw new Error("source must not run");
    },
  });
  assert.deepEqual(preview, { ok: false, reason: "adapter_unapproved" });
  assert.equal(sourceCalls, 0);
  assert.equal(observedSignal?.aborted, true);
  assert.ok(Date.now() - started < 1_000);
});

test("rejects an approval that expires while its resolver is pending", async () => {
  let wallNow = NOW;
  let sourceCalls = 0;
  const preview = await previewPublicWebDraftImport({
    ...baseOptions(),
    approvalNow: () => wallNow,
    resolveAdapterApproval: async (request) => {
      const snapshot = brandedApproval(request, {
        actorAuthorityExpiresAt: "2026-09-09T12:00:30.000Z",
      });
      wallNow = NOW + 31_000;
      return snapshot;
    },
    resolveSource: async () => {
      sourceCalls += 1;
      throw new Error("source must not run");
    },
  });
  assert.deepEqual(preview, { ok: false, reason: "adapter_unapproved" });
  assert.equal(sourceCalls, 0);
});

test("fails closed when the shared 30-second budget expires during source resolution", async () => {
  let clock = 1_000;
  const preview = await previewPublicWebDraftImport({
    ...baseOptions(),
    clock: () => clock,
    resolveSource: async (entityType, entityId) => {
      clock = 31_000;
      return { entityType, entityId, sourceSha256: SOURCE_SHA };
    },
  });
  assert.deepEqual(preview, { ok: false, reason: "plan_invalid" });
});
