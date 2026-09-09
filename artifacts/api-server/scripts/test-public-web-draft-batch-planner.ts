import assert from "node:assert/strict";
import test from "node:test";

import { planPublicWebDraftBatch } from "../src/lib/publicWebDraftBatchPlanner.js";
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
