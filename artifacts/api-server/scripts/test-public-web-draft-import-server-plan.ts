import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  planPublicWebDraftBatch,
  type PublicWebDraftBatchPlan,
} from "../src/lib/publicWebDraftBatchPlanner.js";
import type { PublicWebDraftIntakeRequest } from "../src/lib/publicWebDraftIntakeBuilder.js";
import {
  parsePublicWebDraftImportJobEnqueue,
} from "../src/lib/publicWebDraftImportJobContract.js";
import {
  getPublicWebDraftImportPrivateItems,
  materializePublicWebDraftImportServerPlan,
} from "../src/lib/publicWebDraftImportServerPlan.js";
import {
  PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
  fingerprintPublicWebDraftPreviewReceiptPublicKey,
  issuePublicWebDraftPreviewReceipt,
  type PublicWebDraftPreviewReceiptExternalSigner,
  type PublicWebDraftPreviewReceiptSubject,
  type PublicWebDraftPreviewReceiptVerificationKey,
} from "../src/lib/publicWebDraftPreviewReceipt.js";

const NOW = 2_000_000_000_000;
const ID = {
  tenant: "018fad00-0000-7000-8000-000000000001",
  organization: "018fad00-0000-7000-8000-000000000002",
  principal: "018fad00-0000-7000-8000-000000000003",
  membership: "018fad00-0000-7000-8000-000000000004",
  selection: "018fad00-0000-7000-8000-000000000005",
  activeContext: "018fad00-0000-7000-8000-000000000006",
  issuer: "018fad00-0000-7000-8000-000000000007",
} as const;
const HASH = {
  manifest: "a".repeat(64),
  mapping: "b".repeat(64),
  approval: "c".repeat(64),
  session: "d".repeat(64),
  source: "e".repeat(64),
  alternate: "f".repeat(64),
} as const;
const RELEASE_ID = "20260909T180000Z-c9292077";
const KEY_ID = "public-web-materializer-key-2026-09";
const KEY_REFERENCE = "test-memory://public-web/materializer-key";
const keyPair = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = keyPair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

function request(
  entityId: number,
  overrides: Partial<PublicWebDraftIntakeRequest> = {},
): PublicWebDraftIntakeRequest {
  return {
    entityType: "PROGRAM",
    entityId,
    locale: "en",
    canonicalSlug: `programme-${entityId}`,
    origin: "IMPORT",
    title: `Private programme ${entityId}`,
    summary: `Private summary ${entityId}`,
    contentJson: { body: `Private content ${entityId}` },
    seoJson: { description: `Private SEO ${entityId}` },
    structuredDataJson: { "@type": "Course", privateField: entityId },
    generatorReceiptSha256: null,
    idempotencyKey: `public-web.materialize-${String(entityId).padStart(4, "0")}`,
    ...overrides,
  };
}

async function createPlan(requests: unknown[]): Promise<PublicWebDraftBatchPlan> {
  return planPublicWebDraftBatch({
    scope: { tenantId: ID.tenant, organizationId: ID.organization },
    requests,
    resolveSource: async (entityType, entityId) => ({
      entityType,
      entityId,
      sourceSha256: HASH.source,
    }),
  });
}

function receiptKey(): PublicWebDraftPreviewReceiptVerificationKey {
  return {
    keyId: KEY_ID,
    algorithm: PUBLIC_WEB_DRAFT_PREVIEW_RECEIPT_ALGORITHM,
    state: "ACTIVE",
    issuerId: ID.issuer,
    environmentId: "test",
    cellId: "cell-a",
    publicKeyPem,
    publicKeyFingerprint:
      fingerprintPublicWebDraftPreviewReceiptPublicKey(publicKeyPem),
    signFrom: NOW - 60_000,
    signUntil: NOW + 10 * 60_000,
    verifyUntil: NOW + 20 * 60_000,
  };
}

const receiptSigner: PublicWebDraftPreviewReceiptExternalSigner = {
  async sign(input) {
    assert.equal(input.keyReference, KEY_REFERENCE);
    return crypto.sign(null, input.signingInput, keyPair.privateKey);
  },
};

function subject(
  plan: PublicWebDraftBatchPlan,
  overrides: Partial<PublicWebDraftPreviewReceiptSubject> = {},
): PublicWebDraftPreviewReceiptSubject {
  return {
    tenantId: ID.tenant,
    organizationId: ID.organization,
    actorLegacyUserId: 501,
    actorPrincipalId: ID.principal,
    membershipId: ID.membership,
    selectionId: ID.selection,
    sessionGeneration: 4,
    sessionFingerprint: HASH.session,
    activeContextId: ID.activeContext,
    activeContextExpiresAt: NOW + 10 * 60_000,
    manifestSha256: HASH.manifest,
    adapterId: "catalog.program-import",
    adapterVersion: "1.0.0",
    adapterApprovalSha256: HASH.approval,
    mappingSha256: HASH.mapping,
    planSha256: plan.planSha256,
    runtimeReleaseId: RELEASE_ID,
    ...overrides,
  };
}

async function issueReceipt(
  plan: PublicWebDraftBatchPlan,
  options: {
    subject?: Partial<PublicWebDraftPreviewReceiptSubject>;
    now?: number;
    ttlMs?: number;
  } = {},
) {
  return issuePublicWebDraftPreviewReceipt({
    subject: subject(plan, options.subject),
    environmentId: "test",
    cellId: "cell-a",
    issuerId: ID.issuer,
    keyId: KEY_ID,
    keyReference: KEY_REFERENCE,
    keyRing: [receiptKey()],
    signer: receiptSigner,
    ttlMs: options.ttlMs ?? 60_000,
    now: options.now ?? NOW,
  });
}

function uuidFor(value: number): string {
  return `018fad00-0000-7000-8000-${value.toString(16).padStart(12, "0")}`;
}

function uuidFactory(start = 1_000) {
  let next = start;
  return (_observedAt: number) => uuidFor(next++);
}

function identity() {
  return {
    tenantId: ID.tenant,
    organizationId: ID.organization,
    actorPrincipalId: ID.principal,
    actorLegacyUserId: 501,
    membershipId: ID.membership,
    selectionId: ID.selection,
    sessionGeneration: 4,
    sessionFingerprint: HASH.session,
    activeContextId: ID.activeContext,
    activeContextExpiresAt: NOW + 10 * 60_000,
  };
}

function clonePlan(plan: PublicWebDraftBatchPlan): PublicWebDraftBatchPlan {
  return structuredClone(plan);
}

test("materializes deterministic metadata plus private commands and satisfies enqueue", async () => {
  const plan = await createPlan([request(1), request(2)]);
  const receipt = await issueReceipt(plan);
  const first = materializePublicWebDraftImportServerPlan({
    verifiedReceiptClaims: receipt.claims,
    previewReceiptToken: receipt.token,
    batchPlan: plan,
    now: NOW,
    newUuidV7: uuidFactory(),
  });
  const second = materializePublicWebDraftImportServerPlan({
    verifiedReceiptClaims: receipt.claims,
    previewReceiptToken: receipt.token,
    batchPlan: plan,
    now: NOW,
    newUuidV7: uuidFactory(),
  });
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  if (!first.ok) assert.fail(first.reason);
  const privateItems = getPublicWebDraftImportPrivateItems(first);
  assert.ok(privateItems);

  assert.equal(first.serverPlan.acceptedItems.length, 2);
  assert.equal(privateItems.length, 2);
  for (const [position, metadata] of first.serverPlan.acceptedItems.entries()) {
    const privateItem = privateItems[position];
    assert.ok(privateItem);
    assert.equal(privateItem.itemId, metadata.itemId);
    assert.equal(privateItem.index, metadata.index);
    assert.equal(privateItem.requestHash, metadata.requestHash);
    assert.equal(privateItem.command.contentRecordId, metadata.contentRecordId);
    assert.equal(privateItem.command.revisionId, metadata.revisionId);
    assert.equal(privateItem.command.sourceSha256, metadata.sourceSha256);
    assert.equal(privateItem.command.idempotencyKey, metadata.idempotencyKey);
    assert.equal(privateItem.command.tenantId, ID.tenant);
    assert.equal(privateItem.command.organizationId, ID.organization);
    assert.equal(Object.isFrozen(privateItem.command.contentJson), true);
  }

  const publicResult = JSON.stringify(first);
  for (const privateKey of [
    "command",
    "contentJson",
    "seoJson",
    "structuredDataJson",
    "canonicalSlug",
    "canonicalPath",
    "title",
    "summary",
  ]) {
    assert.equal(publicResult.includes(privateKey), false, privateKey);
  }
  assert.equal(publicResult.includes("Private"), false);
  assert.deepEqual(Object.keys(first).sort(), ["ok", "serverPlan"]);
  assert.equal(getPublicWebDraftImportPrivateItems({ ...first }), null);
  assert.equal(
    getPublicWebDraftImportPrivateItems(JSON.parse(JSON.stringify(first))),
    null,
  );

  const enqueue = parsePublicWebDraftImportJobEnqueue({
    clientRequest: {
      schemaVersion: 1,
      kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT_JOB",
      requestKey: "public-web.materializer-job-0001",
      previewReceiptToken: receipt.token,
      confirmPartial: false,
    },
    serverIdentity: identity(),
    serverPlan: first.serverPlan,
    verifiedReceiptClaims: receipt.claims,
    now: NOW,
  });
  assert.equal(enqueue.ok, true);
  if (!enqueue.ok) assert.fail(enqueue.reason);
  assert.deepEqual(enqueue.command.acceptedItems, first.serverPlan.acceptedItems);
});

test("requires the exact branded token-bound live receipt before generating identities", async () => {
  const plan = await createPlan([request(1)]);
  const receipt = await issueReceipt(plan, { ttlMs: 1_000 });
  let generated = 0;
  const generate = () => {
    generated += 1;
    return uuidFor(2_000 + generated);
  };
  for (const input of [
    { claims: { ...receipt.claims }, token: receipt.token, now: NOW },
    { claims: receipt.claims, token: "header.payload.signature", now: NOW },
    { claims: receipt.claims, token: receipt.token, now: receipt.claims.expiresAt },
  ]) {
    assert.deepEqual(materializePublicWebDraftImportServerPlan({
      verifiedReceiptClaims: input.claims,
      previewReceiptToken: input.token,
      batchPlan: plan,
      now: input.now,
      newUuidV7: generate,
    }), { ok: false, reason: "preview_receipt_invalid" });
  }
  assert.equal(generated, 0);
});

test("rejects unbranded plan/request/source/hash clones and signed receipt drift", async () => {
  const plan = await createPlan([request(1)]);
  const receipt = await issueReceipt(plan);
  const cases: PublicWebDraftBatchPlan[] = [];

  const titleTamper = clonePlan(plan);
  titleTamper.accepted[0]!.request.title = "Tampered";
  cases.push(titleTamper);
  const sourceTamper = clonePlan(plan);
  sourceTamper.accepted[0]!.source.sourceSha256 = HASH.alternate;
  cases.push(sourceTamper);
  cases.push({ ...clonePlan(plan), planSha256: HASH.alternate });

  for (const candidate of cases) {
    assert.deepEqual(materializePublicWebDraftImportServerPlan({
      verifiedReceiptClaims: receipt.claims,
      previewReceiptToken: receipt.token,
      batchPlan: candidate,
      now: NOW,
      newUuidV7: uuidFactory(),
    }), { ok: false, reason: "batch_plan_invalid" });
  }

  const otherScopeReceipt = await issueReceipt(plan, {
    subject: { tenantId: "018fad00-0000-7000-8000-000000000099" },
  });
  assert.deepEqual(materializePublicWebDraftImportServerPlan({
    verifiedReceiptClaims: otherScopeReceipt.claims,
    previewReceiptToken: otherScopeReceipt.token,
    batchPlan: plan,
    now: NOW,
    newUuidV7: uuidFactory(),
  }), { ok: false, reason: "batch_plan_hash_mismatch" });

  const wrongPlanReceipt = await issueReceipt(plan, {
    subject: { planSha256: HASH.alternate },
  });
  assert.deepEqual(materializePublicWebDraftImportServerPlan({
    verifiedReceiptClaims: wrongPlanReceipt.claims,
    previewReceiptToken: wrongPlanReceipt.token,
    batchPlan: plan,
    now: NOW,
    newUuidV7: uuidFactory(),
  }), { ok: false, reason: "batch_plan_hash_mismatch" });
});

test("rejects sparse, duplicate, missing, unsorted, and extra-key plan shapes", async () => {
  const plan = await createPlan([request(1), request(2)]);
  const receipt = await issueReceipt(plan);
  const candidates: unknown[] = [];

  const duplicate = clonePlan(plan);
  duplicate.accepted[1]!.index = 0;
  candidates.push(duplicate);
  const sparse = clonePlan(plan);
  sparse.accepted[1]!.index = 2;
  candidates.push(sparse);
  const missing = clonePlan(plan);
  missing.accepted.pop();
  candidates.push(missing);
  const unsorted = clonePlan(plan);
  unsorted.accepted.reverse();
  candidates.push(unsorted);
  candidates.push({ ...clonePlan(plan), privateRows: [] });
  const extraAcceptedKey = clonePlan(plan) as PublicWebDraftBatchPlan & {
    accepted: Array<Record<string, unknown>>;
  };
  extraAcceptedKey.accepted[0]!.private = "forbidden";
  candidates.push(extraAcceptedKey);

  for (const candidate of candidates) {
    assert.deepEqual(materializePublicWebDraftImportServerPlan({
      verifiedReceiptClaims: receipt.claims,
      previewReceiptToken: receipt.token,
      batchPlan: candidate as PublicWebDraftBatchPlan,
      now: NOW,
      newUuidV7: uuidFactory(),
    }), { ok: false, reason: "batch_plan_invalid" });
  }
});

test("rejects accessors, proxies, symbols, and hidden plan state before reading it", async () => {
  const plan = await createPlan([request(1)]);
  const receipt = await issueReceipt(plan);
  let reads = 0;
  const candidates: unknown[] = [];

  const topAccessor = clonePlan(plan) as unknown as Record<string, unknown>;
  const accepted = topAccessor.accepted;
  Object.defineProperty(topAccessor, "accepted", {
    enumerable: true,
    get() {
      reads += 1;
      return accepted;
    },
  });
  candidates.push(topAccessor);

  const nestedProxy = clonePlan(plan);
  nestedProxy.accepted[0]!.request = new Proxy(
    nestedProxy.accepted[0]!.request,
    {
      get(target, property, receiver) {
        reads += 1;
        return Reflect.get(target, property, receiver);
      },
    },
  );
  candidates.push(nestedProxy);

  const symbolState = clonePlan(plan) as PublicWebDraftBatchPlan & {
    [key: symbol]: unknown;
  };
  symbolState[Symbol("private")] = "forbidden";
  candidates.push(symbolState);

  const hiddenState = clonePlan(plan);
  Object.defineProperty(hiddenState.accepted[0]!.source, "private", {
    enumerable: false,
    value: "forbidden",
  });
  candidates.push(hiddenState);

  let generated = 0;
  for (const candidate of candidates) {
    assert.deepEqual(materializePublicWebDraftImportServerPlan({
      verifiedReceiptClaims: receipt.claims,
      previewReceiptToken: receipt.token,
      batchPlan: candidate as PublicWebDraftBatchPlan,
      now: NOW,
      newUuidV7: () => {
        generated += 1;
        return uuidFor(30_000 + generated);
      },
    }), { ok: false, reason: "batch_plan_invalid" });
  }
  assert.equal(reads, 0);
  assert.equal(generated, 0);
});

test("permits only IMPORT rows and requires at least one accepted row", async () => {
  const humanPlan = await createPlan([request(1, { origin: "HUMAN" })]);
  const humanReceipt = await issueReceipt(humanPlan);
  assert.deepEqual(materializePublicWebDraftImportServerPlan({
    verifiedReceiptClaims: humanReceipt.claims,
    previewReceiptToken: humanReceipt.token,
    batchPlan: humanPlan,
    now: NOW,
    newUuidV7: uuidFactory(),
  }), { ok: false, reason: "non_import_origin_forbidden" });

  const rejectedPlan = await createPlan([{ invalid: true }]);
  const rejectedReceipt = await issueReceipt(rejectedPlan);
  assert.deepEqual(materializePublicWebDraftImportServerPlan({
    verifiedReceiptClaims: rejectedReceipt.claims,
    previewReceiptToken: rejectedReceipt.token,
    batchPlan: rejectedPlan,
    now: NOW,
    newUuidV7: uuidFactory(),
  }), { ok: false, reason: "batch_plan_has_no_accepted_items" });
});

test("fails closed on invalid, duplicate, thrown, and cross-item UUIDv7 identities", async () => {
  const plan = await createPlan([request(1), request(2)]);
  const receipt = await issueReceipt(plan);
  const factories = [
    () => "not-a-uuid",
    () => uuidFor(9_999),
    () => { throw new Error("private rng detail"); },
    (() => {
      let calls = 0;
      return () => {
        calls += 1;
        if (calls === 2) throw new Error("private rng detail after item id");
        return uuidFor(20 + calls);
      };
    })(),
    (() => {
      const values = [uuidFor(31), uuidFor(31), uuidFor(32)];
      return () => values.shift() ?? uuidFor(39);
    })(),
    (() => {
      const values = [
        uuidFor(1), uuidFor(2), uuidFor(3),
        uuidFor(4), uuidFor(2), uuidFor(5),
      ];
      return () => values.shift() ?? uuidFor(99);
    })(),
  ];
  for (const newUuidV7 of factories) {
    assert.deepEqual(materializePublicWebDraftImportServerPlan({
      verifiedReceiptClaims: receipt.claims,
      previewReceiptToken: receipt.token,
      batchPlan: plan,
      now: NOW,
      newUuidV7,
    }), { ok: false, reason: "generated_identity_invalid" });
  }
});

test("derives partial confirmation from rejected rows and keeps enqueue fail-closed", async () => {
  const plan = await createPlan([request(1), { invalid: true }]);
  const receipt = await issueReceipt(plan);
  const materialized = materializePublicWebDraftImportServerPlan({
    verifiedReceiptClaims: receipt.claims,
    previewReceiptToken: receipt.token,
    batchPlan: plan,
    now: NOW,
    newUuidV7: uuidFactory(),
  });
  assert.equal(materialized.ok, true);
  if (!materialized.ok) assert.fail(materialized.reason);
  assert.equal(materialized.serverPlan.requiresPartialConfirmation, true);

  const parse = (confirmPartial: boolean) => parsePublicWebDraftImportJobEnqueue({
    clientRequest: {
      schemaVersion: 1,
      kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT_JOB",
      requestKey: "public-web.materializer-job-0002",
      previewReceiptToken: receipt.token,
      confirmPartial,
    },
    serverIdentity: identity(),
    serverPlan: materialized.serverPlan,
    verifiedReceiptClaims: receipt.claims,
    now: NOW,
  });
  assert.deepEqual(parse(false), {
    ok: false,
    reason: "partial_confirmation_required",
  });
  assert.equal(parse(true).ok, true);
});

test("request/source changes alter the reviewed plan hash and never reuse request metadata", async () => {
  const originalPlan = await createPlan([request(1)]);
  const changedRequestPlan = await createPlan([request(1, { title: "Changed" })]);
  const changedSourcePlan = await planPublicWebDraftBatch({
    scope: { tenantId: ID.tenant, organizationId: ID.organization },
    requests: [request(1)],
    resolveSource: async (entityType, entityId) => ({
      entityType,
      entityId,
      sourceSha256: HASH.alternate,
    }),
  });
  assert.notEqual(originalPlan.planSha256, changedRequestPlan.planSha256);
  assert.notEqual(originalPlan.planSha256, changedSourcePlan.planSha256);

  const receipt = await issueReceipt(originalPlan);
  for (const changed of [changedRequestPlan, changedSourcePlan]) {
    assert.deepEqual(materializePublicWebDraftImportServerPlan({
      verifiedReceiptClaims: receipt.claims,
      previewReceiptToken: receipt.token,
      batchPlan: changed,
      now: NOW,
      newUuidV7: uuidFactory(),
    }), { ok: false, reason: "batch_plan_hash_mismatch" });
  }
});
