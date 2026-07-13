/**
 * test-registry.ts — registry lookup and allowlist-count tests
 *
 * TR1 — adapterForUniversity("Istanbul Topkapi University") → key "topkapi"
 * TR2 — SIT allowlist length is exactly 12
 * TR3 — United allowlist length is exactly 3
 * TR4 — adapterByKey("topkapi") returns the same adapter as adapterForUniversity
 * TR5 — adapterMetadata() includes family field for all 4 code adapter families
 * TR6 — adapterMetadata() exposes allowlist for SIT and United
 * TR7 — adapterForUniversity("Haliç Üniversitesi") → key "sit"
 * TR8 — adapterForUniversity("Biruni Üniversitesi") → key "united"
 * TR9 — adapters list is non-empty and all entries have key + label
 *
 * Run with:
 *   pnpm --filter @workspace/portal-adapters run test:registry
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adapters,
  adapterForUniversity,
  adapterByKey,
  adapterMetadata,
  isExperimentalAdapterKey,
} from "../src/registry.js";
import { SIT_ALLOWLIST } from "../src/universities/sit/adapter.js";
import { UNITED_ALLOWLIST } from "../src/universities/united/adapter.js";

// ---------------------------------------------------------------------------
// TR1 — topkapi lookup by university name
// ---------------------------------------------------------------------------

test("TR1 — adapterForUniversity('Istanbul Topkapi University') → topkapi", () => {
  const adapter = adapterForUniversity("Istanbul Topkapi University");
  assert.ok(adapter !== null, "Expected a non-null adapter for Topkapi");
  assert.equal(adapter.key, "topkapi", `Expected key "topkapi", got "${adapter?.key}"`);
});

// ---------------------------------------------------------------------------
// TR2 — SIT allowlist count
// ---------------------------------------------------------------------------

test("TR2 — SIT allowlist length is exactly 12", () => {
  assert.equal(
    SIT_ALLOWLIST.length,
    12,
    `Expected 12 SIT universities, got ${SIT_ALLOWLIST.length}`,
  );
});

// ---------------------------------------------------------------------------
// TR3 — United allowlist count
// ---------------------------------------------------------------------------

test("TR3 — United allowlist length is exactly 3", () => {
  assert.equal(
    UNITED_ALLOWLIST.length,
    3,
    `Expected 3 United universities, got ${UNITED_ALLOWLIST.length}`,
  );
});

// ---------------------------------------------------------------------------
// TR4 — adapterByKey round-trip
// ---------------------------------------------------------------------------

test("TR4 — adapterByKey('topkapi') matches adapterForUniversity result", () => {
  const byName = adapterForUniversity("Istanbul Topkapi University");
  const byKey  = adapterByKey("topkapi");
  assert.ok(byKey !== null,                        "adapterByKey should find topkapi");
  assert.equal(byKey?.key, byName?.key,            "Both lookups must return the same key");
  assert.equal(byKey?.label, byName?.label,        "Both lookups must return the same label");
});

// ---------------------------------------------------------------------------
// TR5 — adapterMetadata includes all 4 code adapter families
// ---------------------------------------------------------------------------

test("TR5 — adapterMetadata() includes metronic, salesforce, sit, united families", () => {
  const meta = adapterMetadata();
  const families = new Set(meta.map(m => m.family));

  assert.ok(families.has("metronic"),   "Expected metronic family in metadata");
  assert.ok(families.has("salesforce"), "Expected salesforce family in metadata");
  assert.ok(families.has("sit"),        "Expected sit family in metadata");
  assert.ok(families.has("united"),     "Expected united family in metadata");
});

// ---------------------------------------------------------------------------
// TR6 — adapterMetadata exposes allowlist for SIT and United
// ---------------------------------------------------------------------------

test("TR6 — adapterMetadata() exposes allowlist for SIT (12) and United (3)", () => {
  const meta = adapterMetadata();

  const sitMeta = meta.find(m => m.family === "sit");
  assert.ok(sitMeta !== undefined,                      "SIT metadata entry must exist");
  assert.ok(Array.isArray(sitMeta?.allowlist),          "SIT allowlist must be an array");
  assert.equal(sitMeta?.allowlist?.length, 12,          `SIT allowlist must have 12 entries, got ${sitMeta?.allowlist?.length}`);

  const unitedMeta = meta.find(m => m.family === "united");
  assert.ok(unitedMeta !== undefined,                   "United metadata entry must exist");
  assert.ok(Array.isArray(unitedMeta?.allowlist),       "United allowlist must be an array");
  assert.equal(unitedMeta?.allowlist?.length, 3,        `United allowlist must have 3 entries, got ${unitedMeta?.allowlist?.length}`);
});

// ---------------------------------------------------------------------------
// TR7 — SIT matches one of its listed universities
// ---------------------------------------------------------------------------

test("TR7 — adapterForUniversity('Haliç Üniversitesi') → sit", () => {
  const adapter = adapterForUniversity("Haliç Üniversitesi");
  assert.ok(adapter !== null,    "Expected a non-null adapter for Haliç");
  assert.equal(adapter?.key, "sit", `Expected key "sit", got "${adapter?.key}"`);
});

// ---------------------------------------------------------------------------
// TR8 — United matches one of its listed universities
// ---------------------------------------------------------------------------

test("TR8 — adapterForUniversity('Biruni Üniversitesi') → united", () => {
  const adapter = adapterForUniversity("Biruni Üniversitesi");
  assert.ok(adapter !== null,       "Expected a non-null adapter for Biruni");
  assert.equal(adapter?.key, "united", `Expected key "united", got "${adapter?.key}"`);
});

// ---------------------------------------------------------------------------
// TR9 — adapters list integrity
// ---------------------------------------------------------------------------

test("TR9 — all registered adapters have non-empty key and label", () => {
  assert.ok(adapters.length > 0, "adapters list must be non-empty");
  for (const a of adapters) {
    assert.ok(typeof a.key   === "string" && a.key.length   > 0, `Adapter has empty key: ${JSON.stringify(a)}`);
    assert.ok(typeof a.label === "string" && a.label.length > 0, `Adapter has empty label for key "${a.key}"`);
    assert.ok(typeof a.matches   === "function", `Adapter "${a.key}" missing matches()`);
    assert.ok(typeof a.login     === "function", `Adapter "${a.key}" missing login()`);
    assert.ok(typeof a.submit    === "function", `Adapter "${a.key}" missing submit()`);
  }
});

// ---------------------------------------------------------------------------
// TR10 — experimental adapter classification (drives the worker auto-process
// guard: experimental families must NEVER be auto-submitted).
// ---------------------------------------------------------------------------

test("TR10 — isExperimentalAdapterKey flags salesforce/sit/united/emu and clears topkapi", () => {
  // Real adapter keys (not family names): uskudar is a salesforce-family key.
  for (const key of ["uskudar", "sit", "united", "emu"]) {
    assert.equal(
      isExperimentalAdapterKey(key),
      true,
      `Expected "${key}" to be classified experimental`,
    );
  }
  assert.equal(
    isExperimentalAdapterKey("topkapi"),
    false,
    'Expected "topkapi" to be non-experimental (production-proven)',
  );
  assert.equal(
    isExperimentalAdapterKey("does-not-exist"),
    false,
    "Unknown adapter keys must default to non-experimental=false",
  );
});

// ---------------------------------------------------------------------------
// TR11 — Altınbaş is now a declarative adapter (not imperative) and remains
// experimental. The panel must show it ONCE with family="declarative".
// ---------------------------------------------------------------------------

test("TR11 — altinbas resolves as declarative family and is experimental", () => {
  const meta = adapterMetadata();

  // Must appear exactly once
  const altinbasMeta = meta.filter(m => m.key === "altinbas");
  assert.equal(altinbasMeta.length, 1, "altinbas must appear exactly once in adapterMetadata()");

  const a = altinbasMeta[0];
  assert.equal(a.family, "declarative", "altinbas family must be 'declarative'");
  assert.equal(a.experimental, true,    "altinbas must remain experimental");

  // adapterForUniversity should resolve by Turkish name variants
  const byTr = adapterForUniversity("Altınbaş Üniversitesi");
  assert.ok(byTr !== null, "adapterForUniversity('Altınbaş Üniversitesi') must resolve");
  assert.equal(byTr?.key, "altinbas", `Expected key "altinbas", got "${byTr?.key}"`);

  const byEn = adapterForUniversity("Altinbas University");
  assert.ok(byEn !== null, "adapterForUniversity('Altinbas University') must resolve");
  assert.equal(byEn?.key, "altinbas");

  // isExperimentalAdapterKey must return true for the key
  assert.equal(
    isExperimentalAdapterKey("altinbas"),
    true,
    "isExperimentalAdapterKey('altinbas') must be true",
  );
});
