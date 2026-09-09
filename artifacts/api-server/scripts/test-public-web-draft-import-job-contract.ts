import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { DatabaseError } from "pg";

import { canonicalJson } from "../src/lib/jsonCanonical.js";
import {
  planPublicWebDraftBatch,
} from "../src/lib/publicWebDraftBatchPlanner.js";
import type { PublicWebDraftIntakeRequest } from "../src/lib/publicWebDraftIntakeBuilder.js";
import {
  PUBLIC_WEB_DRAFT_IMPORT_DURABILITY_REQUIREMENTS,
  canTransitionPublicWebDraftImportItem,
  canTransitionPublicWebDraftImportJob,
  classifyPublicWebDraftImportFailure,
  decidePublicWebDraftImportCancellation,
  getPublicWebDraftImportEnqueuePrivateItems,
  parsePublicWebDraftImportJobEnqueue,
  projectPublicWebDraftImportJobStatus,
} from "../src/lib/publicWebDraftImportJobContract.js";
import {
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
  tenant: "018fac00-0000-7000-8000-000000000001",
  organization: "018fac00-0000-7000-8000-000000000002",
  principal: "018fac00-0000-7000-8000-000000000003",
  membership: "018fac00-0000-7000-8000-000000000004",
  selection: "018fac00-0000-7000-8000-000000000005",
  activeContext: "018fac00-0000-7000-8000-000000000006",
  issuer: "018fac00-0000-7000-8000-000000000007",
  job: "018fac00-0000-7000-8000-000000000008",
  alternate: "018fac00-0000-7000-8000-000000000009",
} as const;
const HASH = {
  manifest: "a".repeat(64),
  plan: "b".repeat(64),
  mapping: "c".repeat(64),
  approval: "d".repeat(64),
  session: "e".repeat(64),
  alternate: "f".repeat(64),
} as const;
const RELEASE_ID = "20260909T120000Z-c9292077";
const KEY_ID = "public-web-preview-key-2026-09";
const KEY_REFERENCE = "test-memory://public-web/job-preview-key";
const pair = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
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
    return crypto.sign(null, input.signingInput, pair.privateKey);
  },
};

function subject(
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
    planSha256: HASH.plan,
    runtimeReleaseId: RELEASE_ID,
    ...overrides,
  };
}

async function issueReceipt(
  overrides: Partial<PublicWebDraftPreviewReceiptSubject> = {},
  issuanceOverrides: {
    now?: number;
    ttlMs?: number;
    requests?: unknown[];
  } = {},
) {
  const batchPlan = await planPublicWebDraftBatch({
    scope: { tenantId: ID.tenant, organizationId: ID.organization },
    requests: issuanceOverrides.requests ?? [draftRequest(1)],
    resolveSource: async (entityType, entityId) => ({
      entityType,
      entityId,
      sourceSha256: "0".repeat(64),
    }),
  });
  const issued = await issuePublicWebDraftPreviewReceipt({
    subject: subject({ planSha256: batchPlan.planSha256, ...overrides }),
    environmentId: "test",
    cellId: "cell-a",
    issuerId: ID.issuer,
    keyId: KEY_ID,
    keyReference: KEY_REFERENCE,
    keyRing: [receiptKey()],
    signer: receiptSigner,
    ttlMs: issuanceOverrides.ttlMs ?? 60_000,
    now: issuanceOverrides.now ?? NOW,
  });
  const materialized = materializePublicWebDraftImportServerPlan({
    verifiedReceiptClaims: issued.claims,
    previewReceiptToken: issued.token,
    batchPlan,
    now: issuanceOverrides.now ?? NOW,
    newUuidV7: (() => {
      let next = 1_000;
      return () => uuidFor(next++);
    })(),
  });
  if (!materialized.ok) {
    throw new Error(`test server plan materialization failed: ${materialized.reason}`);
  }
  return {
    ...issued,
    batchPlan,
    materializationResult: materialized,
    serverPlan: materialized.serverPlan,
  };
}

function draftRequest(
  entityId: number,
  overrides: Partial<PublicWebDraftIntakeRequest> = {},
): PublicWebDraftIntakeRequest {
  return {
    entityType: "PROGRAM",
    entityId,
    locale: "en",
    canonicalSlug: `programme-${entityId}`,
    origin: "IMPORT",
    title: `Programme ${entityId}`,
    summary: `Summary ${entityId}`,
    contentJson: { body: `Body ${entityId}` },
    seoJson: { description: `SEO ${entityId}` },
    structuredDataJson: { "@type": "Course" },
    generatorReceiptSha256: null,
    idempotencyKey: `public-web.import-item-${String(entityId - 1).padStart(4, "0")}`,
    ...overrides,
  };
}

function identity(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

function uuidFor(value: number): string {
  return `018fac00-0000-7000-8000-${value.toString(16).padStart(12, "0")}`;
}

function item(index = 0, overrides: Record<string, unknown> = {}) {
  const base = 1_000 + index * 3;
  return {
    itemId: uuidFor(base),
    index,
    entityType: "PROGRAM",
    entityId: index + 1,
    locale: "en",
    contentRecordId: uuidFor(base + 1),
    revisionId: uuidFor(base + 2),
    sourceSha256: index.toString(16).padStart(64, "0"),
    requestHash: (index + 1_000).toString(16).padStart(64, "0"),
    idempotencyKey: `public-web.import-item-${String(index).padStart(4, "0")}`,
    ...overrides,
  };
}

function clientRequest(token: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT_JOB",
    requestKey: "public-web.import-job-0001",
    previewReceiptToken: token,
    confirmPartial: false,
    ...overrides,
  };
}

function serverPlan(
  issued: Awaited<ReturnType<typeof issueReceipt>>,
  overrides: Record<string, unknown> = {},
) {
  if (Object.keys(overrides).length === 0) return issued.serverPlan;
  return {
    ...issued.serverPlan,
    ...overrides,
  };
}

function parse(
  issued: Awaited<ReturnType<typeof issueReceipt>>,
  overrides: {
    clientRequest?: unknown;
    serverIdentity?: unknown;
    serverPlan?: unknown;
    verifiedReceiptClaims?: unknown;
    now?: number;
  } = {},
) {
  return parsePublicWebDraftImportJobEnqueue({
    clientRequest: overrides.clientRequest ?? clientRequest(issued.token),
    serverIdentity: overrides.serverIdentity ?? identity(),
    serverPlan: overrides.serverPlan ?? serverPlan(issued),
    verifiedReceiptClaims:
      overrides.verifiedReceiptClaims ?? issued.claims,
    now: overrides.now ?? NOW,
  });
}

test("binds client intent to branded receipt, exact server identity, plan, and release", async () => {
  const issued = await issueReceipt();
  const result = parse(issued);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.command.identity, identity());
  assert.deepEqual(result.command.acceptedItems, issued.serverPlan.acceptedItems);
  assert.equal(result.command.manifestSha256, HASH.manifest);
  assert.equal(result.command.adapterApprovalSha256, HASH.approval);
  assert.equal(result.command.runtimeReleaseId, RELEASE_ID);
  assert.deepEqual(result.command.receipt, {
    keyId: KEY_ID,
    issuedAt: NOW,
    expiresAt: NOW + 60_000,
    nonce: issued.claims.nonce,
    tokenSha256: sha256(issued.token),
  });
  assert.match(result.command.requestDigestSha256, /^[0-9a-f]{64}$/);
  assert.match(result.command.commandSha256, /^[0-9a-f]{64}$/);
  assert.match(result.command.expectedItemSetSha256, /^[0-9a-f]{64}$/);
  assert.equal(parse(issued).ok, true);
  const repeated = parse(issued);
  assert.equal(repeated.ok, true);
  if (repeated.ok) {
    assert.equal(repeated.command.commandSha256, result.command.commandSha256);
    assert.equal(repeated.command.requestDigestSha256, result.command.requestDigestSha256);
  }
  assert.deepEqual(result.durabilityRequirements, PUBLIC_WEB_DRAFT_IMPORT_DURABILITY_REQUIREMENTS);
  assert.equal(result.durabilityRequirements.enforcedByThisPureContract, false);
  assert.match(result.durabilityRequirements.nonceConsumption, /^REQUIRED_/);
  assert.match(result.durabilityRequirements.leaseFencing, /^REQUIRED_/);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(issued.token), false);
  assert.equal(serialized.includes("raw manifest body"), false);
  assert.equal(Object.isFrozen(result.command), true);
  assert.equal(Object.isFrozen(result.command.identity), true);
  assert.equal(Object.isFrozen(result.command.receipt), true);
  assert.equal(Object.isFrozen(result.command.acceptedItems), true);
  assert.equal(Object.isFrozen(result.command.acceptedItems[0]), true);
  const privateItems = getPublicWebDraftImportEnqueuePrivateItems(result);
  assert.ok(privateItems);
  assert.equal(privateItems.length, result.command.acceptedItems.length);
  assert.equal(privateItems[0]?.itemId, result.command.acceptedItems[0]?.itemId);
  assert.equal(getPublicWebDraftImportEnqueuePrivateItems({ ...result }), null);
  assert.equal(
    getPublicWebDraftImportEnqueuePrivateItems(JSON.parse(JSON.stringify(result))),
    null,
  );
});

test("rejects fake raw tokens, unbranded claims, token swapping, and expiry", async () => {
  const issued = await issueReceipt();
  const fakeToken = "header.payload.signature";
  assert.deepEqual(parse(issued, {
    clientRequest: clientRequest(fakeToken),
  }), { ok: false, reason: "preview_receipt_mismatch" });
  assert.deepEqual(parse(issued, {
    verifiedReceiptClaims: { ...issued.claims },
  }), { ok: false, reason: "preview_receipt_mismatch" });
  const other = await issueReceipt();
  assert.deepEqual(parse(issued, {
    verifiedReceiptClaims: other.claims,
  }), { ok: false, reason: "preview_receipt_mismatch" });
  assert.deepEqual(parse(issued, { now: issued.claims.expiresAt }), {
    ok: false,
    reason: "preview_receipt_mismatch",
  });
});

test("rejects all client authority, plan, release, accepted-item, and raw-manifest injection", async () => {
  const issued = await issueReceipt();
  for (const injected of [
    { tenantId: ID.tenant },
    { actor: { principalId: ID.principal } },
    { acceptedItems: [item()] },
    { contentRecordId: ID.alternate },
    { requestHash: HASH.alternate },
    { sourceSha256: HASH.alternate },
    { idempotencyKey: "client-item-key" },
    { manifestSha256: HASH.manifest },
    { requestedReleaseId: RELEASE_ID },
    { runtimeReleaseId: RELEASE_ID },
    { manifest: { raw: "forbidden" } },
  ]) {
    assert.deepEqual(parse(issued, {
      clientRequest: { ...clientRequest(issued.token), ...injected },
    }), { ok: false, reason: "enqueue_invalid" });
  }
  assert.deepEqual(parse(issued, {
    clientRequest: clientRequest(issued.token, {
      requestKey: "Public-Web.Import-Job-0001",
    }),
  }), { ok: false, reason: "enqueue_invalid" });
});

test("rejects accessor, proxy, symbol, and hidden input state without invoking traps", async () => {
  const issued = await issueReceipt();
  let reads = 0;
  const accessorRequest = {
    ...clientRequest(issued.token),
  } as Record<string, unknown>;
  delete accessorRequest.requestKey;
  Object.defineProperty(accessorRequest, "requestKey", {
    enumerable: true,
    get() {
      reads += 1;
      return "public-web.import-job-0001";
    },
  });
  assert.deepEqual(parse(issued, { clientRequest: accessorRequest }), {
    ok: false,
    reason: "enqueue_invalid",
  });
  assert.equal(reads, 0);

  const proxiedRequest = new Proxy(clientRequest(issued.token), {
    get(target, property, receiver) {
      reads += 1;
      return Reflect.get(target, property, receiver);
    },
    ownKeys(target) {
      reads += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(parse(issued, { clientRequest: proxiedRequest }), {
    ok: false,
    reason: "enqueue_invalid",
  });
  assert.equal(reads, 0);

  const symbolRequest = clientRequest(issued.token) as Record<PropertyKey, unknown>;
  symbolRequest[Symbol("authority")] = ID.tenant;
  assert.deepEqual(parse(issued, { clientRequest: symbolRequest }), {
    ok: false,
    reason: "enqueue_invalid",
  });
  const hiddenRequest = clientRequest(issued.token);
  Object.defineProperty(hiddenRequest, "tenantId", {
    enumerable: false,
    value: ID.tenant,
  });
  assert.deepEqual(parse(issued, { clientRequest: hiddenRequest }), {
    ok: false,
    reason: "enqueue_invalid",
  });

  const proxiedItems = new Proxy([item()], {
    get(target, property, receiver) {
      reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.deepEqual(parse(issued, {
    serverPlan: serverPlan(issued, { acceptedItems: proxiedItems }),
  }), { ok: false, reason: "server_plan_invalid" });
  assert.equal(reads, 0);

  const outerProxy = new Proxy({
    clientRequest: clientRequest(issued.token),
    serverIdentity: identity(),
    serverPlan: serverPlan(issued),
    verifiedReceiptClaims: issued.claims,
    now: NOW,
  }, {
    get(target, property, receiver) {
      reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.deepEqual(parsePublicWebDraftImportJobEnqueue(outerProxy), {
    ok: false,
    reason: "enqueue_invalid",
  });
  assert.equal(reads, 0);
});

test("bounds the raw receipt token and requires its server token hash", async () => {
  const issued = await issueReceipt();
  assert.deepEqual(parse(issued, {
    clientRequest: clientRequest(`${"a".repeat(8189)}.b.c`),
  }), { ok: false, reason: "enqueue_invalid" });
  assert.deepEqual(parse(issued, {
    clientRequest: clientRequest("not-a-signed-envelope"),
  }), { ok: false, reason: "enqueue_invalid" });
  assert.deepEqual(parse(issued, {
    serverPlan: serverPlan(issued, {
      previewReceiptTokenSha256: HASH.alternate,
    }),
  }), { ok: false, reason: "server_plan_invalid" });
});

test("rejects malformed identities and every receipt-to-server drift", async () => {
  const issued = await issueReceipt();
  assert.deepEqual(parse(issued, {
    serverIdentity: identity({ tenantId: "client-selected" }),
  }), { ok: false, reason: "server_identity_invalid" });
  assert.deepEqual(parse(issued, {
    serverIdentity: identity({ extra: true }),
  }), { ok: false, reason: "server_identity_invalid" });

  for (const override of [
    { tenantId: ID.alternate },
    { actorLegacyUserId: 502 },
    { actorPrincipalId: ID.alternate },
    { membershipId: ID.alternate },
    { selectionId: ID.alternate },
    { sessionGeneration: 5 },
    { sessionFingerprint: HASH.alternate },
    { activeContextId: ID.alternate },
    { activeContextExpiresAt: NOW + 9 * 60_000 },
  ]) {
    assert.deepEqual(parse(issued, {
      serverIdentity: identity(override),
    }), { ok: false, reason: "preview_receipt_mismatch" });
  }

  for (const override of [
    { manifestSha256: HASH.alternate },
    { planSha256: HASH.alternate },
    { adapterId: "catalog.other-import" },
    { adapterVersion: "2.0.0" },
    { adapterApprovalSha256: HASH.alternate },
    { mappingSha256: HASH.alternate },
    { runtimeReleaseId: "20260909T120500Z-deadbeef" },
    { previewNonce: "alternate_preview_nonce_0123456789abcdef" },
  ]) {
    assert.deepEqual(parse(issued, {
      serverPlan: serverPlan(issued, override),
    }), { ok: false, reason: "server_plan_invalid" });
  }
});

test("requires explicit partial confirmation for the exact signed plan", async () => {
  const issued = await issueReceipt();
  assert.deepEqual(parse(issued, {
    clientRequest: clientRequest(issued.token, { confirmPartial: true }),
  }), { ok: false, reason: "partial_confirmation_unexpected" });
  const partial = await issueReceipt({}, {
    requests: [draftRequest(1), { invalid: true }],
  });
  assert.deepEqual(parse(partial), {
    ok: false,
    reason: "partial_confirmation_required",
  });
  assert.equal(parse(partial, {
    clientRequest: clientRequest(partial.token, { confirmPartial: true }),
  }).ok, true);
});

test("accepts branded capacity and sparse source indices, but rejects every plain/fake plan", async () => {
  const issued = await issueReceipt();
  const hundred = await issueReceipt({}, {
    requests: Array.from({ length: 100 }, (_, index) => draftRequest(index + 1)),
  });
  assert.equal(parse(hundred).ok, true);
  const sparse = await issueReceipt({}, {
    requests: [draftRequest(1), { invalid: true }, draftRequest(3)],
  });
  assert.equal(parse(sparse, {
    clientRequest: clientRequest(sparse.token, { confirmPartial: true }),
  }).ok, true);
  assert.deepEqual(sparse.serverPlan.acceptedItems.map(({ index }) => index), [0, 2]);

  const attackerPlan = {
    ...issued.serverPlan,
    acceptedItems: [item(0, {
      entityId: 2_147_483_647,
      sourceSha256: HASH.alternate,
      requestHash: HASH.alternate,
      idempotencyKey: "attacker.controlled-item",
    })],
  };
  assert.deepEqual(parse(issued, { serverPlan: attackerPlan }), {
    ok: false,
    reason: "server_plan_invalid",
  });
  assert.deepEqual(parse(issued, {
    serverPlan: structuredClone(issued.serverPlan),
  }), { ok: false, reason: "server_plan_invalid" });
  let planReads = 0;
  const proxyAroundGenuinePlan = new Proxy(issued.serverPlan, {
    get(target, property, receiver) {
      planReads += 1;
      return Reflect.get(target, property, receiver);
    },
    ownKeys(target) {
      planReads += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(parse(issued, { serverPlan: proxyAroundGenuinePlan }), {
    ok: false,
    reason: "server_plan_invalid",
  });
  assert.equal(planReads, 0);
  for (const duplicate of [
    { itemId: item(0).itemId },
    { requestHash: item(0).requestHash },
    { idempotencyKey: item(0).idempotencyKey },
  ]) {
    assert.equal(parse(issued, {
      serverPlan: serverPlan(issued, {
        acceptedItems: [item(0), item(1, duplicate)],
      }),
    }).ok, false);
  }
});

test("uses scope and actor in the deterministic request digest", async () => {
  const issued = await issueReceipt();
  const first = parse(issued);
  const renewedReceipt = await issueReceipt({}, { ttlMs: 59_000 });
  const renewed = parse(renewedReceipt);
  const otherActorReceipt = await issueReceipt({ actorLegacyUserId: 502 });
  const second = parse(otherActorReceipt, {
    serverIdentity: identity({ actorLegacyUserId: 502 }),
  });
  assert.equal(first.ok, true);
  assert.equal(renewed.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && renewed.ok && second.ok) {
    assert.equal(
      first.command.requestDigestSha256,
      renewed.command.requestDigestSha256,
    );
    assert.notEqual(first.command.commandSha256, renewed.command.commandSha256);
    assert.notEqual(
      first.command.requestDigestSha256,
      second.command.requestDigestSha256,
    );
  }
});

test("allows only explicit audit-semantic job and item transitions", () => {
  assert.equal(canTransitionPublicWebDraftImportJob("QUEUED", "RUNNING"), true);
  assert.equal(canTransitionPublicWebDraftImportJob("RUNNING", "RETRY_WAIT"), true);
  assert.equal(canTransitionPublicWebDraftImportJob("RUNNING", "DEAD_LETTER"), true);
  assert.equal(canTransitionPublicWebDraftImportJob("CANCEL_REQUESTED", "CANCELED"), true);
  assert.equal(canTransitionPublicWebDraftImportJob("SUCCEEDED", "RUNNING"), false);
  assert.equal(canTransitionPublicWebDraftImportJob("RUNNING", "RUNNING"), false);
  assert.equal(canTransitionPublicWebDraftImportItem("PENDING", "RUNNING"), true);
  assert.equal(canTransitionPublicWebDraftImportItem("RUNNING", "APPLIED"), true);
  assert.equal(canTransitionPublicWebDraftImportItem("RUNNING", "REPLAY"), true);
  assert.equal(canTransitionPublicWebDraftImportItem("TERMINAL_FAILED", "RUNNING"), false);
});

test("retries only explicit transaction, lock, and connection failures", () => {
  for (const code of ["40001", "40P01", "55P03", "08006", "57P03"]) {
    assert.equal(classifyPublicWebDraftImportFailure({ code }).retryable, true, code);
  }
  assert.deepEqual(classifyPublicWebDraftImportFailure({
    code: "40001",
    message: "public web draft intake source changed",
  }), { retryable: false, category: "source_changed", publicCode: "source_changed" });
  for (const code of [
    "source_changed",
    "authority_denied",
    "idempotency_conflict",
    "23505",
    "ETIMEDOUT",
  ]) {
    assert.equal(classifyPublicWebDraftImportFailure({ code }).retryable, false, code);
  }

  const serializationError = Object.assign(new Error("serialization"), {
    code: "40001",
  });
  assert.equal(classifyPublicWebDraftImportFailure(serializationError).retryable, true);
  const sourceChangedError = Object.assign(
    new Error("public web draft intake source changed"),
    { code: "40001" },
  );
  assert.deepEqual(classifyPublicWebDraftImportFailure(sourceChangedError), {
    retryable: false,
    category: "source_changed",
    publicCode: "source_changed",
  });
  const postgresSourceChangedError = new DatabaseError(
    "public web draft intake source changed",
    0,
    "error",
  );
  postgresSourceChangedError.code = "40001";
  assert.deepEqual(classifyPublicWebDraftImportFailure(postgresSourceChangedError), {
    retryable: false,
    category: "source_changed",
    publicCode: "source_changed",
  });
  let reads = 0;
  const accessorError = Object.defineProperty({}, "code", {
    enumerable: true,
    get() {
      reads += 1;
      return "40001";
    },
  });
  assert.equal(classifyPublicWebDraftImportFailure(accessorError).retryable, false);
  assert.equal(reads, 0);
  const symbolError = Object.assign({}, { code: "40001" }) as Record<PropertyKey, unknown>;
  Object.defineProperty(symbolError, Symbol("private"), {
    enumerable: false,
    get() {
      reads += 1;
      return "private";
    },
  });
  assert.equal(classifyPublicWebDraftImportFailure(symbolError).retryable, true);
  assert.equal(reads, 0);
  const hiddenCodeError = new Error("serialization");
  Object.defineProperty(hiddenCodeError, "code", {
    enumerable: false,
    value: "40001",
  });
  assert.equal(classifyPublicWebDraftImportFailure(hiddenCodeError).retryable, true);
  const proxiedError = new Proxy(postgresSourceChangedError, {
    get(target, property, receiver) {
      reads += 1;
      return Reflect.get(target, property, receiver);
    },
    ownKeys(target) {
      reads += 1;
      return Reflect.ownKeys(target);
    },
  });
  assert.deepEqual(classifyPublicWebDraftImportFailure(proxiedError), {
    retryable: false,
    category: "unknown",
    publicCode: "terminal_failure",
  });
  assert.equal(reads, 0);
});

function expectedStatusItem(index: number) {
  return { itemId: item(index).itemId, index };
}

function statusItem(index: number, state: string) {
  return { ...expectedStatusItem(index), state };
}

function expectedStatusSetSha256(
  expectedItems: Array<{ itemId: string; index: number }>,
): string {
  return crypto
    .createHash("sha256")
    .update("fas.public-web.draft-import-job-item-set.v1\0", "utf8")
    .update(canonicalJson(
      [...expectedItems].sort((left, right) => left.index - right.index),
    ), "utf8")
    .digest("hex");
}

test("derives redacted counts only from the exact expected itemId/index set", () => {
  const expectedItems = [0, 2, 5, 9].map(expectedStatusItem);
  const projection = projectPublicWebDraftImportJobStatus({
    jobId: ID.job,
    state: "RUNNING",
    expectedItemSetSha256: expectedStatusSetSha256(expectedItems),
    expectedItems,
    items: [
      statusItem(0, "APPLIED"),
      statusItem(2, "REPLAY"),
      statusItem(5, "TERMINAL_FAILED"),
      statusItem(9, "RUNNING"),
    ],
  });
  assert.deepEqual(projection, {
    schemaVersion: 1,
    jobId: ID.job,
    state: "RUNNING",
    counts: {
      total: 4,
      pending: 0,
      running: 1,
      retryWait: 0,
      applied: 1,
      replay: 1,
      terminalFailed: 1,
      canceled: 0,
      completed: 3,
    },
    percentComplete: 75,
  });
  assert.equal(JSON.stringify(projection).includes("private SQL detail"), false);

  for (const items of [
    [statusItem(0, "APPLIED"), statusItem(2, "REPLAY"), statusItem(5, "TERMINAL_FAILED")],
    [statusItem(0, "APPLIED"), statusItem(2, "REPLAY"), statusItem(5, "TERMINAL_FAILED"), statusItem(5, "RUNNING")],
    [statusItem(0, "APPLIED"), statusItem(2, "REPLAY"), statusItem(5, "TERMINAL_FAILED"), statusItem(8, "RUNNING")],
  ]) {
    assert.equal(projectPublicWebDraftImportJobStatus({
      jobId: ID.job,
      state: "RUNNING",
      expectedItemSetSha256: expectedStatusSetSha256(expectedItems),
      expectedItems,
      items,
    }), null);
  }
  assert.equal(projectPublicWebDraftImportJobStatus({
    jobId: ID.job,
    state: "SUCCEEDED",
    expectedItemSetSha256: expectedStatusSetSha256(expectedItems),
    expectedItems: expectedItems.slice(0, 2),
    items: [statusItem(0, "APPLIED"), statusItem(2, "REPLAY")],
  }), null);
  assert.equal(projectPublicWebDraftImportJobStatus({
    jobId: ID.job,
    state: "RUNNING",
    expectedItemSetSha256: expectedStatusSetSha256(expectedItems),
    expectedItems,
    items: [
      statusItem(0, "APPLIED"),
      statusItem(2, "REPLAY"),
      statusItem(5, "TERMINAL_FAILED"),
      { ...statusItem(9, "RUNNING"), errorMessage: "private" },
    ],
  }), null);

  let reads = 0;
  const proxiedProjection = new Proxy({
    jobId: ID.job,
    state: "RUNNING",
    expectedItemSetSha256: expectedStatusSetSha256(expectedItems),
    expectedItems,
    items: [
      statusItem(0, "APPLIED"),
      statusItem(2, "REPLAY"),
      statusItem(5, "TERMINAL_FAILED"),
      statusItem(9, "RUNNING"),
    ],
  }, {
    get(target, property, receiver) {
      reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.equal(projectPublicWebDraftImportJobStatus(proxiedProjection), null);
  assert.equal(reads, 0);
});

test("fails closed when terminal job state contradicts exact item states", () => {
  const cases: Array<[string, string[], boolean]> = [
    ["SUCCEEDED", ["APPLIED", "REPLAY"], true],
    ["PARTIALLY_SUCCEEDED", ["APPLIED", "TERMINAL_FAILED"], true],
    ["DEAD_LETTER", ["TERMINAL_FAILED", "CANCELED"], true],
    ["CANCELED", ["APPLIED", "CANCELED"], true],
    ["SUCCEEDED", ["APPLIED", "TERMINAL_FAILED"], false],
    ["PARTIALLY_SUCCEEDED", ["APPLIED", "PENDING"], false],
    ["DEAD_LETTER", ["REPLAY", "TERMINAL_FAILED"], false],
    ["CANCELED", ["CANCELED", "PENDING"], false],
  ];
  for (const [state, states, valid] of cases) {
    const expectedItems = states.map((_, index) => expectedStatusItem(index));
    const projection = projectPublicWebDraftImportJobStatus({
      jobId: ID.job,
      state,
      expectedItemSetSha256: expectedStatusSetSha256(expectedItems),
      expectedItems,
      items: states.map((itemState, index) => statusItem(index, itemState)),
    });
    assert.equal(projection !== null, valid, `${state}:${states.join(",")}`);
  }
});

test("cooperative cancellation never claims to kill the current operation", () => {
  assert.deepEqual(decidePublicWebDraftImportCancellation("QUEUED"), {
    accepted: true,
    nextState: "CANCEL_REQUESTED",
    directive: "STOP_BEFORE_NEXT_ITEM",
  });
  assert.deepEqual(decidePublicWebDraftImportCancellation("RUNNING"), {
    accepted: true,
    nextState: "CANCEL_REQUESTED",
    directive: "FINISH_CURRENT_ITEM_THEN_STOP",
  });
  assert.deepEqual(decidePublicWebDraftImportCancellation("CANCEL_REQUESTED"), {
    accepted: true,
    nextState: "CANCEL_REQUESTED",
    directive: "ALREADY_REQUESTED",
  });
  assert.deepEqual(decidePublicWebDraftImportCancellation("DEAD_LETTER"), {
    accepted: false,
    nextState: null,
    directive: "TERMINAL_NO_ACTION",
  });
});
