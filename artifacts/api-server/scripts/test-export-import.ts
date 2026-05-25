/**
 * Task #202 — Lossless JSON export/import for Embed widgets AND Web-to-Lead forms.
 *
 * Pure-unit tests for the helpers in `src/lib/exportImport.ts`. Covers the
 * envelope contract (kind / version / size cap), prototype-pollution guard,
 * field-picking, summary tallying, and slug renaming.
 *
 * The route-level integration is exercised in the existing inbox-suite and
 * webhook-dedup tests; this script keeps the helpers regression-locked
 * without a database dependency so it runs in any environment.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_VERSION,
  MAX_IMPORT_BYTES,
  buildEnvelope,
  parseEnvelope,
  pickFields,
  assertNoPrototypePollution,
  emptySummary,
  tallyResult,
  nextAvailableSlug,
  isValidConflictStrategy,
  ImportValidationError,
} from "../src/lib/exportImport";

test("buildEnvelope produces a v1 envelope of the given kind", () => {
  const env = buildEnvelope("embed_widgets", [{ slug: "a" }, { slug: "b" }]);
  assert.equal(env.kind, "embed_widgets");
  assert.equal(env.version, EXPORT_VERSION);
  assert.equal(env.items.length, 2);
  assert.ok(/\d{4}-\d{2}-\d{2}T/.test(env.exportedAt));
});

test("pickFields keeps only whitelisted keys and drops volatile ones", () => {
  const row = { id: 7, slug: "hello", name: "Hi", createdAt: "2026-01-01", secret: "x" };
  const picked = pickFields(row, ["name", "slug"]);
  assert.deepEqual(picked, { name: "Hi", slug: "hello" });
});

test("parseEnvelope round-trips a buildEnvelope output", () => {
  const env = buildEnvelope("website_forms", [{ slug: "contact" }]);
  const items = parseEnvelope<{ slug: string }>(env, { expectedKind: "website_forms" });
  assert.equal(items.length, 1);
  assert.equal(items[0].slug, "contact");
});

test("parseEnvelope rejects wrong kind", () => {
  const env = buildEnvelope("embed_widgets", []);
  assert.throws(
    () => parseEnvelope(env, { expectedKind: "website_forms" }),
    (e: unknown) => e instanceof ImportValidationError && /Wrong envelope kind/.test((e as Error).message),
  );
});

test("parseEnvelope rejects unsupported version", () => {
  const env = { kind: "embed_widgets", version: 99, exportedAt: "now", items: [] };
  assert.throws(
    () => parseEnvelope(env, { expectedKind: "embed_widgets" }),
    (e: unknown) => e instanceof ImportValidationError && /Unsupported envelope version/.test((e as Error).message),
  );
});

test("parseEnvelope rejects non-object payload", () => {
  assert.throws(() => parseEnvelope("not an envelope", { expectedKind: "embed_widgets" }), ImportValidationError);
  assert.throws(() => parseEnvelope(null, { expectedKind: "embed_widgets" }), ImportValidationError);
  assert.throws(() => parseEnvelope([], { expectedKind: "embed_widgets" }), ImportValidationError);
});

test("parseEnvelope rejects items that is not an array", () => {
  const bad = { kind: "embed_widgets", version: EXPORT_VERSION, exportedAt: "x", items: { 0: "a" } };
  assert.throws(() => parseEnvelope(bad, { expectedKind: "embed_widgets" }), ImportValidationError);
});

test("parseEnvelope enforces the size cap", () => {
  const huge = { kind: "embed_widgets", version: EXPORT_VERSION, exportedAt: "x", items: [{ blob: "a".repeat(MAX_IMPORT_BYTES + 1) }] };
  assert.throws(
    () => parseEnvelope(huge, { expectedKind: "embed_widgets" }),
    (e: unknown) => e instanceof ImportValidationError && (e as ImportValidationError).status === 413,
  );
});

test("assertNoPrototypePollution rejects __proto__ / constructor / prototype keys", () => {
  const polluted = JSON.parse('{"items":[{"__proto__":{"polluted":true}}]}');
  assert.throws(() => assertNoPrototypePollution(polluted), ImportValidationError);
  assert.throws(() => assertNoPrototypePollution({ x: { constructor: 1 } }), ImportValidationError);
  assert.throws(() => assertNoPrototypePollution({ a: [{ prototype: 1 }] }), ImportValidationError);
  // Safe values pass.
  assertNoPrototypePollution({ a: 1, b: [{ c: "ok" }] });
  assertNoPrototypePollution(null);
  assertNoPrototypePollution("string");
});

test("parseEnvelope rejects prototype pollution in items", () => {
  const env = JSON.parse(JSON.stringify({
    kind: "embed_widgets", version: EXPORT_VERSION, exportedAt: "x",
    items: [JSON.parse('{"slug":"bad","__proto__":{"polluted":1}}')],
  }));
  assert.throws(() => parseEnvelope(env, { expectedKind: "embed_widgets" }), ImportValidationError);
});

test("tallyResult accumulates counters and preserves order", () => {
  const s = emptySummary(4);
  tallyResult(s, { index: 0, slug: "a", status: "created" });
  tallyResult(s, { index: 1, slug: "b", status: "updated" });
  tallyResult(s, { index: 2, slug: "c", status: "renamed", finalSlug: "c-copy" });
  tallyResult(s, { index: 3, slug: "d", status: "skipped" });
  assert.equal(s.created, 1);
  assert.equal(s.updated, 1);
  assert.equal(s.renamed, 1);
  assert.equal(s.skipped, 1);
  assert.equal(s.errors, 0);
  assert.equal(s.results.length, 4);
  assert.equal(s.results[2].finalSlug, "c-copy");
});

test("nextAvailableSlug picks the first free suffix", async () => {
  const taken = new Set(["form-copy", "form-copy-2"]);
  const next = await nextAvailableSlug("form", async (c) => taken.has(c));
  assert.equal(next, "form-copy-3");
});

test("nextAvailableSlug collapses repeated -copy suffixes", async () => {
  const next = await nextAvailableSlug("form-copy-2", async () => false);
  assert.equal(next, "form-copy");
});

test("isValidConflictStrategy accepts the three known values", () => {
  assert.equal(isValidConflictStrategy("skip"), true);
  assert.equal(isValidConflictStrategy("overwrite"), true);
  assert.equal(isValidConflictStrategy("rename"), true);
  assert.equal(isValidConflictStrategy("nope"), false);
  assert.equal(isValidConflictStrategy(undefined), false);
});

test("round-trip: buildEnvelope -> JSON string -> parseEnvelope is lossless", () => {
  const original = [
    { name: "Widget A", slug: "widget-a", isActive: true, presetFilters: { country: "TR" }, allowedDomains: ["a.com"] },
    { name: "Widget B", slug: "widget-b", isActive: false, presetFilters: {}, allowedDomains: [] },
  ];
  const env = buildEnvelope("embed_widgets", original);
  const transported = JSON.parse(JSON.stringify(env));
  const items = parseEnvelope<typeof original[number]>(transported, { expectedKind: "embed_widgets" });
  assert.deepEqual(items, original);
});
