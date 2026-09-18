import assert from "node:assert/strict";
import test from "node:test";

import { parsePublicWebDraftImportManifest } from "../src/lib/publicWebDraftImportManifest.js";
import { planPublicWebDraftBatch } from "../src/lib/publicWebDraftBatchPlanner.js";

const NOW = Date.parse("2026-09-09T10:00:00.000Z");

function manifest() {
  return {
    schemaVersion: 1,
    kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT",
    adapter: {
      id: "catalog.program-import",
      version: "1.0.0",
      mappingSha256: "a".repeat(64),
    },
    generatedAt: "2026-09-09T09:55:00.000Z",
    expiresAt: "2026-09-10T09:55:00.000Z",
    rows: [{ entityType: "PROGRAM", entityId: 41 }],
  } as const;
}

test("parses one declarative manifest into a stable canonical snapshot", () => {
  const input = structuredClone(manifest()) as Record<string, unknown>;
  const first = parsePublicWebDraftImportManifest(input, { now: NOW });
  const second = parsePublicWebDraftImportManifest({
    rows: [{ entityId: 41, entityType: "PROGRAM" }],
    expiresAt: "2026-09-10T09:55:00.000Z",
    generatedAt: "2026-09-09T09:55:00.000Z",
    adapter: {
      mappingSha256: "a".repeat(64),
      version: "1.0.0",
      id: "catalog.program-import",
    },
    kind: "FAS_PUBLIC_WEB_DRAFT_IMPORT",
    schemaVersion: 1,
  }, { now: NOW });
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.manifestSha256, second.manifestSha256);
  (input.rows as Array<Record<string, unknown>>)[0]!.entityId = 99;
  assert.equal((first.manifest.rows[0] as Record<string, unknown>).entityId, 41);
});

test("rejects client scope, executable values and prototype-polluting keys", () => {
  assert.equal(parsePublicWebDraftImportManifest({ ...manifest(), tenantId: "client-chosen" }, { now: NOW }), null);
  assert.equal(parsePublicWebDraftImportManifest({ ...manifest(), execute: "module.exports = true" }, { now: NOW }), null);
  assert.equal(parsePublicWebDraftImportManifest({ ...manifest(), rows: [{ handler: () => true }] }, { now: NOW }), null);
  const polluted = JSON.parse(JSON.stringify(manifest())) as Record<string, unknown>;
  polluted.rows = [JSON.parse('{"__proto__":{"polluted":true}}')];
  assert.equal(parsePublicWebDraftImportManifest(polluted, { now: NOW }), null);
});

test("rejects expired, future-skewed and overlong manifest lifetimes", () => {
  assert.equal(parsePublicWebDraftImportManifest({
    ...manifest(),
    expiresAt: "2026-09-09T09:59:59.999Z",
  }, { now: NOW }), null);
  assert.equal(parsePublicWebDraftImportManifest({
    ...manifest(),
    generatedAt: "2026-09-09T10:05:00.001Z",
    expiresAt: "2026-09-10T10:05:00.001Z",
  }, { now: NOW }), null);
  assert.equal(parsePublicWebDraftImportManifest({
    ...manifest(),
    expiresAt: "2026-09-16T09:55:00.001Z",
  }, { now: NOW }), null);
});

test("rejects empty, over-count and oversized manifests", () => {
  assert.equal(parsePublicWebDraftImportManifest({ ...manifest(), rows: [] }, { now: NOW }), null);
  assert.equal(parsePublicWebDraftImportManifest({
    ...manifest(),
    rows: Array.from({ length: 101 }, (_, entityId) => ({ entityId })),
  }, { now: NOW }), null);
  assert.equal(parsePublicWebDraftImportManifest({
    ...manifest(),
    rows: [{ body: "x".repeat(8 * 1024 * 1024) }],
  }, { now: NOW }), null);
});

test("feeds validated rows into the governed batch planner without client scope", async () => {
  const parsed = parsePublicWebDraftImportManifest({
    ...manifest(),
    rows: [{
      entityType: "PROGRAM",
      entityId: 41,
      locale: "en",
      canonicalSlug: "safe-programme",
      origin: "IMPORT",
      title: "Safe programme",
      summary: null,
      contentJson: { body: "Reviewed draft content" },
      seoJson: {},
      structuredDataJson: { "@type": "Course" },
      generatorReceiptSha256: null,
      idempotencyKey: "public-web.manifest.row-0041",
    }],
  }, { now: NOW });
  assert.ok(parsed);
  const plan = await planPublicWebDraftBatch({
    scope: {
      tenantId: "018fa900-0000-7000-8000-000000000001",
      organizationId: "018fa900-0000-7000-8000-000000000002",
    },
    requests: parsed.manifest.rows,
    resolveSource: async (entityType, entityId) => ({
      entityType,
      entityId,
      sourceSha256: "b".repeat(64),
    }),
  });
  assert.equal(plan.accepted.length, 1);
  assert.equal(plan.rejected.length, 0);
  assert.equal(plan.accepted[0]?.request.entityId, 41);
});
