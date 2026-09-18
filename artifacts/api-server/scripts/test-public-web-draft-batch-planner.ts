import assert from "node:assert/strict";
import test from "node:test";

import {
  collectPublicWebDraftBatchApprovalTargets,
  isVerifiedPublicWebDraftBatchPlan,
  planPublicWebDraftBatch,
} from "../src/lib/publicWebDraftBatchPlanner.js";
import type { PublicWebDraftIntakeRequest } from "../src/lib/publicWebDraftIntakeBuilder.js";
import type { PublicWebEntityType } from "../src/lib/publicWebContentContract.js";

const TENANT_ID = "018fa500-0000-7000-8000-000000000001";
const ORGANIZATION_ID = "018fa500-0000-7000-8000-000000000002";
const SHA = "a".repeat(64);

function request(index: number, overrides: Partial<PublicWebDraftIntakeRequest> = {}) {
  return {
    entityType: "PROGRAM" as const,
    entityId: index,
    locale: "en" as const,
    canonicalSlug: `programme-${index}`,
    origin: "IMPORT" as const,
    title: `Programme ${index}`,
    summary: null,
    contentJson: { body: `Programme ${index}` },
    seoJson: {},
    structuredDataJson: { "@type": "Course" },
    generatorReceiptSha256: null,
    idempotencyKey: `public-web.batch.row-${String(index).padStart(4, "0")}`,
    ...overrides,
  };
}

const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID };

test("plans valid rows with bounded resolver concurrency and a stable hash", async () => {
  let active = 0;
  let peak = 0;
  const resolveSource = async (entityType: PublicWebEntityType, entityId: number) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return { entityType, entityId, sourceSha256: SHA };
  };
  const requests = Array.from({ length: 12 }, (_, index) => request(index + 1));
  const first = await planPublicWebDraftBatch({ scope, requests, resolveSource });
  const second = await planPublicWebDraftBatch({ scope, requests, resolveSource });
  assert.equal(first.accepted.length, 12);
  assert.equal(first.rejected.length, 0);
  assert.ok(peak <= 4);
  assert.equal(first.planSha256, second.planSha256);
  assert.match(first.planSha256, /^[0-9a-f]{64}$/);
});

test("shares one abort context and caps a longer caller deadline at 30 seconds", async () => {
  const contexts: Array<{ signal: AbortSignal; deadlineAt: number }> = [];
  const plan = await planPublicWebDraftBatch({
    scope,
    requests: Array.from({ length: 5 }, (_, index) => request(index + 1)),
    deadlineAt: 999_999,
    clock: () => 1_000,
    resolveSource: async (entityType, entityId, context) => {
      contexts.push(context);
      return { entityType, entityId, sourceSha256: SHA };
    },
  });
  assert.equal(plan.accepted.length, 5);
  assert.equal(contexts.length, 5);
  assert.ok(contexts.every((context) => context.signal === contexts[0]?.signal));
  assert.ok(contexts.every((context) => context.deadlineAt === 31_000));
  assert.equal(contexts[0]?.signal.aborted, false);
});

test("brands only genuine deep-frozen plans without changing their public JSON", async () => {
  const plan = await planPublicWebDraftBatch({
    scope,
    requests: [
      request(1, { contentJson: { sections: [{ text: "Frozen" }] } }),
      request(2),
    ],
    resolveSource: async (entityType, entityId) => (
      entityId === 2 ? null : { entityType, entityId, sourceSha256: SHA }
    ),
  });
  assert.equal(isVerifiedPublicWebDraftBatchPlan(plan), true);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.accepted), true);
  assert.equal(Object.isFrozen(plan.accepted[0]!), true);
  assert.equal(Object.isFrozen(plan.accepted[0]!.source), true);
  assert.equal(Object.isFrozen(plan.accepted[0]!.request), true);
  assert.equal(Object.isFrozen(plan.accepted[0]!.request.contentJson), true);
  assert.equal(Object.isFrozen(
    (plan.accepted[0]!.request.contentJson as { sections: unknown[] }).sections,
  ), true);
  assert.equal(Object.isFrozen(plan.rejected), true);
  assert.equal(Object.isFrozen(plan.rejected[0]!), true);

  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes("verified-draft-batch-plan"), false);
  assert.equal(isVerifiedPublicWebDraftBatchPlan(JSON.parse(serialized)), false);

  const brand = Reflect.ownKeys(plan).find((key) => typeof key === "symbol");
  assert.ok(brand);
  const forged = { ...plan };
  Object.defineProperty(forged, brand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  Object.freeze(forged);
  assert.equal(isVerifiedPublicWebDraftBatchPlan(forged), false);

  let getterReads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "schemaVersion", {
    get() {
      getterReads += 1;
      return 1;
    },
  });
  assert.equal(isVerifiedPublicWebDraftBatchPlan(accessor), false);
  assert.equal(getterReads, 0);

  let proxyReads = 0;
  const proxy = new Proxy(plan, {
    get(target, key, receiver) {
      proxyReads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  assert.equal(isVerifiedPublicWebDraftBatchPlan(proxy), false);
  assert.equal(proxyReads, 0);
});

test("rejects every duplicate target and idempotency key before source reads", async () => {
  let reads = 0;
  const plan = await planPublicWebDraftBatch({
    scope,
    requests: [
      request(1),
      request(1, { idempotencyKey: "public-web.batch.other-0001" }),
      request(2, { idempotencyKey: "public-web.batch.shared-0001" }),
      request(3, { idempotencyKey: "public-web.batch.shared-0001" }),
    ],
    resolveSource: async (entityType, entityId) => {
      reads += 1;
      return { entityType, entityId, sourceSha256: SHA };
    },
  });
  assert.equal(reads, 0);
  assert.deepEqual(plan.rejected, [
    { index: 0, reason: "duplicate_target" },
    { index: 1, reason: "duplicate_target" },
    { index: 2, reason: "duplicate_idempotency" },
    { index: 3, reason: "duplicate_idempotency" },
  ]);
});

test("shares the exact source-eligible entity and locale targets with approval", () => {
  const requests = [
    request(1),
    request(2),
    request(3, { entityType: "UNIVERSITY", locale: "tr" }),
    request(4, { entityType: "UNIVERSITY", locale: "tr" }),
    request(5, { idempotencyKey: "public-web.batch.shared-0001" }),
    request(6, { idempotencyKey: "public-web.batch.shared-0001" }),
    { ...request(7), tenantId: TENANT_ID },
  ];
  assert.deepEqual(collectPublicWebDraftBatchApprovalTargets(requests), [
    { entityType: "PROGRAM", locale: "en" },
    { entityType: "UNIVERSITY", locale: "tr" },
  ]);
});

test("isolates missing, unavailable and malformed rows without losing valid work", async () => {
  const plan = await planPublicWebDraftBatch({
    scope,
    requests: [request(1), request(2), request(3), { ...request(4), tenantId: TENANT_ID }],
    resolveSource: async (entityType, entityId) => {
      if (entityId === 2) return null;
      if (entityId === 3) throw new Error("private infrastructure detail");
      return { entityType, entityId, sourceSha256: SHA };
    },
  });
  assert.deepEqual(plan.accepted.map(({ index }) => index), [0]);
  assert.deepEqual(plan.rejected, [
    { index: 1, reason: "source_missing" },
    { index: 2, reason: "source_unavailable" },
    { index: 3, reason: "request_invalid" },
  ]);
  assert.equal(JSON.stringify(plan).includes("private infrastructure detail"), false);
});

test("binds planning to a canonical request snapshot across async source reads", async () => {
  const mutable = request(1);
  const plan = await planPublicWebDraftBatch({
    scope,
    requests: [mutable],
    resolveSource: async (entityType, entityId) => {
      mutable.title = "Mutated after intake";
      mutable.contentJson = { body: "Mutated after intake" };
      return { entityType, entityId, sourceSha256: SHA };
    },
  });
  assert.equal(plan.accepted.length, 1);
  assert.equal(plan.accepted[0]?.request.title, "Programme 1");
  assert.deepEqual(plan.accepted[0]?.request.contentJson, { body: "Programme 1" });
});

test("rejects resolver bindings with extra fields instead of projecting them", async () => {
  const plan = await planPublicWebDraftBatch({
    scope,
    requests: [request(1)],
    resolveSource: async (entityType, entityId) => ({
      entityType,
      entityId,
      sourceSha256: SHA,
      privateCredential: "must-not-cross-boundary",
    } as never),
  });
  assert.equal(plan.accepted.length, 0);
  assert.deepEqual(plan.rejected, [{ index: 0, reason: "source_unavailable" }]);
  assert.equal(JSON.stringify(plan).includes("privateCredential"), false);
});

test("never reads resolver accessors or Proxy properties", async () => {
  let getterReads = 0;
  const proxyReadKeys: PropertyKey[] = [];
  const accessorCandidate = {
    entityType: "PROGRAM",
    entityId: 1,
  } as Record<string, unknown>;
  Object.defineProperty(accessorCandidate, "sourceSha256", {
    enumerable: true,
    get() {
      getterReads += 1;
      return SHA;
    },
  });
  const proxyCandidate = new Proxy(
    { entityType: "PROGRAM", entityId: 2, sourceSha256: SHA },
    {
      get(target, key, receiver) {
        proxyReadKeys.push(key);
        return Reflect.get(target, key, receiver);
      },
      ownKeys(target) {
        proxyReadKeys.push("[[OwnKeys]]");
        return Reflect.ownKeys(target);
      },
    },
  );
  const plan = await planPublicWebDraftBatch({
    scope,
    requests: [request(1), request(2)],
    resolveSource: ((_entityType: PublicWebEntityType, entityId: number) => (
      entityId === 1 ? Promise.resolve(accessorCandidate) : proxyCandidate
    )) as never,
  });
  assert.equal(getterReads, 0);
  assert.deepEqual(proxyReadKeys, []);
  assert.deepEqual(plan.rejected, [
    { index: 0, reason: "source_unavailable" },
    { index: 1, reason: "source_unavailable" },
  ]);
});

test("rejects hostile native Promise and subclass surfaces without invoking getters", async () => {
  const source = { entityType: "PROGRAM" as const, entityId: 1, sourceSha256: SHA };
  let constructorReads = 0;
  const ownConstructor = Promise.resolve(source);
  Object.defineProperty(ownConstructor, "constructor", {
    configurable: true,
    get() {
      constructorReads += 1;
      return Promise;
    },
  });

  let thenReads = 0;
  const ownThen = Promise.resolve({ ...source, entityId: 2 });
  Object.defineProperty(ownThen, "then", {
    configurable: true,
    get() {
      thenReads += 1;
      return Promise.prototype.then;
    },
  });

  let speciesReads = 0;
  class HostilePromise<T> extends Promise<T> {
    static override get [Symbol.species]() {
      speciesReads += 1;
      return Promise;
    }
  }
  const subclass = new HostilePromise<typeof source>((resolve) => {
    resolve({ ...source, entityId: 3 });
  });
  const promises = [ownConstructor, ownThen, subclass];
  const plan = await planPublicWebDraftBatch({
    scope,
    requests: [request(1), request(2), request(3)],
    resolveSource: (_entityType, entityId) => promises[entityId - 1]!,
  });
  assert.equal(constructorReads, 0);
  assert.equal(thenReads, 0);
  assert.equal(speciesReads, 0);
  assert.deepEqual(plan.rejected, Array.from({ length: 3 }, (_, index) => ({
    index,
    reason: "source_unavailable",
  })));
});

test("makes the resolver-side Promise thenable-assimilation boundary explicit", async () => {
  const assimilationReads: PropertyKey[] = [];
  const candidate = new Proxy(
    { entityType: "PROGRAM" as const, entityId: 1, sourceSha256: SHA },
    {
      get(target, key, receiver) {
        assimilationReads.push(key);
        return Reflect.get(target, key, receiver);
      },
    },
  );
  const plan = await planPublicWebDraftBatch({
    scope,
    requests: [request(1)],
    // The async resolver performs the ECMAScript `then` lookup before its
    // Promise fulfills; the planner subsequently rejects the Proxy untouched.
    resolveSource: async () => candidate,
  });
  assert.deepEqual(assimilationReads, ["then"]);
  assert.deepEqual(plan.rejected, [{ index: 0, reason: "source_unavailable" }]);
});

test("rejects non-enumerable, symbol, wrong-scope and invalid-hash bindings", async () => {
  const hidden = { entityType: "PROGRAM", entityId: 1, sourceSha256: SHA };
  Object.defineProperty(hidden, "privateCredential", {
    enumerable: false,
    value: "secret",
  });
  const symbol = { entityType: "PROGRAM", entityId: 2, sourceSha256: SHA };
  Object.defineProperty(symbol, Symbol("private"), {
    enumerable: true,
    value: "secret",
  });
  const candidates: Record<number, unknown> = {
    1: hidden,
    2: symbol,
    3: { entityType: "UNIVERSITY", entityId: 3, sourceSha256: SHA },
    4: { entityType: "PROGRAM", entityId: 999, sourceSha256: SHA },
    5: { entityType: "PROGRAM", entityId: 5, sourceSha256: SHA.toUpperCase() },
  };
  const plan = await planPublicWebDraftBatch({
    scope,
    requests: [request(1), request(2), request(3), request(4), request(5)],
    resolveSource: async (_entityType, entityId) => candidates[entityId],
  });
  assert.equal(plan.accepted.length, 0);
  assert.deepEqual(plan.rejected, Array.from({ length: 5 }, (_, index) => ({
    index,
    reason: "source_unavailable",
  })));
});

test("binds the reviewed plan hash to the server-resolved tenant scope", async () => {
  const requests = [request(1)];
  const resolveSource = async (entityType: PublicWebEntityType, entityId: number) => ({
    entityType,
    entityId,
    sourceSha256: SHA,
  });
  const first = await planPublicWebDraftBatch({ scope, requests, resolveSource });
  const otherTenant = await planPublicWebDraftBatch({
    scope: {
      tenantId: "018fa500-0000-7000-8000-000000000003",
      organizationId: ORGANIZATION_ID,
    },
    requests,
    resolveSource,
  });
  const otherOrganization = await planPublicWebDraftBatch({
    scope: {
      tenantId: TENANT_ID,
      organizationId: "018fa500-0000-7000-8000-000000000004",
    },
    requests,
    resolveSource,
  });
  assert.notEqual(first.planSha256, otherTenant.planSha256);
  assert.notEqual(first.planSha256, otherOrganization.planSha256);
});

test("fails the whole plan when its wall-clock budget is exhausted", async () => {
  let clock = 1_000;
  let resolverCalls = 0;
  await assert.rejects(
    planPublicWebDraftBatch({
      scope,
      requests: [request(1)],
      deadlineAt: 31_000,
      clock: () => clock,
      resolveSource: async (entityType, entityId) => {
        resolverCalls += 1;
        clock = 31_000;
        return { entityType, entityId, sourceSha256: SHA };
      },
    }),
    /batch_deadline_exceeded/,
  );
  assert.equal(resolverCalls, 1);
});

test("counts request snapshot preparation against the caller deadline", async () => {
  const observations = [1_000, 1_020];
  let cursor = 0;
  let resolverCalls = 0;
  await assert.rejects(
    planPublicWebDraftBatch({
      scope,
      requests: [request(1)],
      deadlineAt: 1_010,
      clock: () => observations[Math.min(cursor++, observations.length - 1)]!,
      resolveSource: async () => {
        resolverCalls += 1;
        return null;
      },
    }),
    /batch_deadline_exceeded/,
  );
  assert.equal(resolverCalls, 0);
});

test("counts final freeze and branding against the caller deadline", async () => {
  const observations = [1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_020];
  let cursor = 0;
  await assert.rejects(
    planPublicWebDraftBatch({
      scope,
      requests: [request(1)],
      deadlineAt: 1_010,
      clock: () => observations[Math.min(cursor++, observations.length - 1)]!,
      resolveSource: async (entityType, entityId) => ({
        entityType,
        entityId,
        sourceSha256: SHA,
      }),
    }),
    /batch_deadline_exceeded/,
  );
  assert.equal(cursor, 7);
});

test("bounds a never-resolving source and aborts the shared resolver signal", async () => {
  let signal: AbortSignal | undefined;
  const startedAt = Date.now();
  await assert.rejects(
    planPublicWebDraftBatch({
      scope,
      requests: [request(1)],
      deadlineAt: 1_020,
      clock: () => 1_000,
      resolveSource: async (_entityType, _entityId, context) => {
        signal = context.signal;
        assert.equal(context.deadlineAt, 1_020);
        await new Promise(() => undefined);
      },
    }),
    /batch_deadline_exceeded/,
  );
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(signal?.aborted, true);
});

test("ignores a resolver result that settles after the hard deadline", async () => {
  let settle!: (value: unknown) => void;
  let lateGetterReads = 0;
  const lateSource = { entityType: "PROGRAM", entityId: 1 } as Record<string, unknown>;
  Object.defineProperty(lateSource, "sourceSha256", {
    enumerable: true,
    get() {
      lateGetterReads += 1;
      return SHA;
    },
  });
  const pending = new Promise<unknown>((resolve) => {
    settle = resolve;
  });
  await assert.rejects(
    planPublicWebDraftBatch({
      scope,
      requests: [request(1)],
      deadlineAt: 1_015,
      clock: () => 1_000,
      resolveSource: async () => pending,
    }),
    /batch_deadline_exceeded/,
  );
  settle(lateSource);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(lateGetterReads, 0);
});

test("fails the whole plan when its injected clock is invalid or moves backwards", async () => {
  let invalidResolverCalls = 0;
  await assert.rejects(
    planPublicWebDraftBatch({
      scope,
      requests: [request(1)],
      clock: () => Number.NaN,
      resolveSource: async () => {
        invalidResolverCalls += 1;
        return null;
      },
    }),
    /batch_deadline_exceeded/,
  );
  assert.equal(invalidResolverCalls, 0);

  const observations = [1_000, 1_000, 999];
  let cursor = 0;
  await assert.rejects(
    planPublicWebDraftBatch({
      scope,
      requests: [request(1)],
      deadlineAt: 1_100,
      clock: () => observations[Math.min(cursor++, observations.length - 1)]!,
      resolveSource: async (entityType, entityId) => ({
        entityType,
        entityId,
        sourceSha256: SHA,
      }),
    }),
    /batch_deadline_exceeded/,
  );
});

test("rejects empty, oversized-count and oversized-byte batches", async () => {
  const resolveSource = async (entityType: PublicWebEntityType, entityId: number) => ({
    entityType,
    entityId,
    sourceSha256: SHA,
  });
  await assert.rejects(
    planPublicWebDraftBatch({ scope, requests: [], resolveSource }),
    /batch_input_invalid/,
  );
  await assert.rejects(
    planPublicWebDraftBatch({
      scope,
      requests: Array.from({ length: 101 }, (_, index) => request(index + 1)),
      resolveSource,
    }),
    /batch_input_invalid/,
  );
  await assert.rejects(
    planPublicWebDraftBatch({
      scope,
      requests: [request(1, { contentJson: { body: "x".repeat(8 * 1024 * 1024) } })],
      resolveSource,
    }),
    /batch_oversized/,
  );
});
