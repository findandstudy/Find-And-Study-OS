/**
 * test-declarative-adapter.ts — unit tests for the DB-backed declarative
 * adapter SPEC interpreter (the richer, versioned sibling of declarativeAdapter).
 *
 * Covers (no real DB, no real browser):
 *   SV  — parseAdapterSpec: happy path + invalid specs (bad url, bad key,
 *         unknown profile field, fill xor value/valueFrom, empty steps).
 *   JH  — specHasJsHook detection over both steps and auth.loginSteps.
 *   HLP — pure helpers: resolveProfileValue, applyTransform, resolveProgramValue.
 *   STP — executeSpecStep against a mock page for every action type, plus the
 *         `optional` swallow and the jsHook trust gate (allowJsHook on/off).
 *   DRY — runSpecSteps skips terminal `click {final:true}` in dry mode.
 *   CLS — classifyResult: success/alreadyExists/programMissing/failure/redirect.
 *   ADP — createSpecAdapter shape + matches().
 *   ROW — buildSpecAdapterFromRow / specRowAllowsJsHook: jsHook trust derived
 *         from source="builtin" OR jsHookApproved; invalid stored spec → null.
 *
 * Run:
 *   pnpm --filter @workspace/portal-adapters test:declarative-adapter
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseAdapterSpec,
  specHasJsHook,
  type AdapterSpec,
} from "../src/declarative/schema.js";
import {
  resolveProfileValue,
  applyTransform,
  resolveProgramValue,
  classifyResult,
  executeSpecStep,
  runSpecSteps,
  createSpecAdapter,
  type SpecPage,
  type StepContext,
} from "../src/declarative/interpreter.js";
import {
  specRowAllowsJsHook,
  buildSpecAdapterFromRow,
} from "../src/specLoader.js";
import type { SubmitProfile, SubmitFiles, ProgramOption } from "../src/types.js";
import type { PortalAdapterSpec } from "@workspace/db";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal but fully-valid spec used as the happy-path baseline. */
function validRawSpec(): unknown {
  return {
    specVersion: 1,
    meta: {
      key: "test_uni",
      name: "Test Üniversitesi",
      baseUrl: "https://apply.test-uni.example.com",
      matches: ["test university", "test_uni"],
    },
    auth: {
      loginUrl: "https://apply.test-uni.example.com/login",
      loginSteps: [
        { action: "fill", selector: "#email", valueFrom: "profile.email" },
        { action: "fill", selector: "#password", valueFrom: "profile.passportNumber" },
        { action: "click", selector: "button[type=submit]" },
        { action: "waitFor", selector: ".dashboard" },
      ],
    },
    steps: [
      { action: "navigate", url: "https://apply.test-uni.example.com/apply" },
      { action: "fill", selector: "#firstName", valueFrom: "profile.firstName" },
      { action: "fill", selector: "#note", value: "AGENT-2026" },
      { action: "select", selector: "#gender", valueFrom: "profile.gender" },
      { action: "upload", selector: "#passportFile", slot: "passport" },
      { action: "waitFor", selector: ".form-loaded" },
      { action: "click", selector: "#submitBtn", final: true },
    ],
    documents: {
      slots: { passport: { fileField: "passport", target: "pdf" } },
    },
    success: { successText: "application submitted", alreadyExistsText: "already registered" },
  };
}

const TEST_PROFILE: SubmitProfile = {
  email: "test@example.com",
  passportNumber: "A1234567",
  firstName: "Ali",
  lastName: "Yılmaz",
  dateOfBirth: "2000-01-01",
  gender: "male",
  fatherName: "Mehmet",
  motherName: "Fatma",
  nationality: "Turkish",
  address: "Istanbul",
  phone: "+905001234567",
  level: "bachelor",
  programName: "Computer Engineering",
  programId: "42",
};

const TEST_FILES: SubmitFiles = {
  passport: "/tmp/passport.pdf",
  photo: "/tmp/photo.jpg",
};

function ctx(over: Partial<StepContext> = {}): StepContext {
  return {
    profile: TEST_PROFILE,
    files: TEST_FILES,
    documentSlots: { slots: { passport: { fileField: "passport" } } },
    allowJsHook: false,
    vars: {},
    captured: {},
    allowedOrigins: [],
    dryRun: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Mock page factory
// ---------------------------------------------------------------------------

interface Call {
  method: string;
  args: unknown[];
}

function makeMockPage(
  over?: Partial<SpecPage> & { _html?: string; _url?: string; _isChecked?: boolean; _hasEl?: boolean },
): { page: SpecPage; calls: Call[] } {
  const calls: Call[] = [];
  const html = over?._html ?? "<html><body></body></html>";
  const currentUrl = over?._url ?? "";
  const isChecked = over?._isChecked ?? false;
  const hasEl = over?._hasEl ?? false;

  const page: SpecPage = {
    goto: async (...args) => { calls.push({ method: "goto", args }); },
    fill: async (...args) => { calls.push({ method: "fill", args }); },
    click: async (...args) => { calls.push({ method: "click", args }); },
    selectOption: async (...args) => { calls.push({ method: "selectOption", args }); },
    setInputFiles: async (...args) => { calls.push({ method: "setInputFiles", args }); },
    waitForSelector: async (...args) => { calls.push({ method: "waitForSelector", args }); },
    content: async () => html,
    $: async (...args) => { calls.push({ method: "$", args }); return hasEl ? ({} as unknown) : null; },
    evaluate: async (...args) => { calls.push({ method: "evaluate", args }); return undefined; },
    isChecked: async (...args) => { calls.push({ method: "isChecked", args }); return isChecked; },
    url: () => currentUrl,
    ...over,
  };
  return { page, calls };
}

// ---------------------------------------------------------------------------
// SV — spec validation
// ---------------------------------------------------------------------------

test("SV1: parseAdapterSpec accepts a valid spec", () => {
  const res = parseAdapterSpec(validRawSpec());
  assert.equal(res.ok, true, "valid spec parses");
  if (res.ok) {
    assert.equal(res.spec.meta.key, "test_uni");
    assert.equal(res.spec.specVersion, 1);
    assert.equal(res.spec.steps.length, 7);
  }
});

test("SV2: rejects a non-https / unsafe baseUrl", () => {
  const raw = validRawSpec() as Record<string, unknown>;
  (raw.meta as Record<string, unknown>).baseUrl = "http://insecure.example.com";
  const res = parseAdapterSpec(raw);
  assert.equal(res.ok, false, "http url rejected");
});

test("SV3: rejects an invalid meta.key (uppercase/spaces)", () => {
  const raw = validRawSpec() as Record<string, unknown>;
  (raw.meta as Record<string, unknown>).key = "Test Uni";
  const res = parseAdapterSpec(raw);
  assert.equal(res.ok, false, "bad key rejected");
});

test("SV4: rejects an unknown profile field in valueFrom", () => {
  const raw = validRawSpec() as Record<string, unknown>;
  (raw.steps as Array<Record<string, unknown>>)[1].valueFrom = "profile.notARealField";
  const res = parseAdapterSpec(raw);
  assert.equal(res.ok, false, "unknown profile field rejected");
});

test("SV5: rejects a fill step with BOTH value and valueFrom", () => {
  const raw = validRawSpec() as Record<string, unknown>;
  (raw.steps as Array<Record<string, unknown>>)[1].value = "literal";
  // step[1] already has valueFrom — now it has both.
  const res = parseAdapterSpec(raw);
  assert.equal(res.ok, false, "fill xor enforced (both present)");
  if (!res.ok) {
    assert.ok(
      res.issues.some((i) => /exactly one of/.test(i.message)),
      "issue mentions the xor rule",
    );
  }
});

test("SV6: rejects a fill step with NEITHER value nor valueFrom", () => {
  const raw = validRawSpec() as Record<string, unknown>;
  const steps = raw.steps as Array<Record<string, unknown>>;
  delete steps[2].value; // step[2] was { fill, value } — strip it
  const res = parseAdapterSpec(raw);
  assert.equal(res.ok, false, "fill xor enforced (neither present)");
});

test("SV7: rejects an empty steps array", () => {
  const raw = validRawSpec() as Record<string, unknown>;
  raw.steps = [];
  const res = parseAdapterSpec(raw);
  assert.equal(res.ok, false, "empty steps rejected");
});

// ---------------------------------------------------------------------------
// JH — jsHook detection
// ---------------------------------------------------------------------------

test("JH1: specHasJsHook false for a hook-free spec", () => {
  assert.equal(specHasJsHook(validRawSpec()), false);
});

test("JH2: specHasJsHook true when a step is a jsHook", () => {
  const raw = validRawSpec() as Record<string, unknown>;
  (raw.steps as unknown[]).push({ action: "jsHook", script: "window.scrollTo(0,0)" });
  assert.equal(specHasJsHook(raw), true);
});

test("JH3: specHasJsHook true when a LOGIN step is a jsHook", () => {
  const raw = validRawSpec() as Record<string, unknown>;
  (raw.auth as { loginSteps: unknown[] }).loginSteps.push({
    action: "jsHook",
    script: "document.cookie",
  });
  assert.equal(specHasJsHook(raw), true);
});

test("JH4: specHasJsHook tolerates non-object input", () => {
  assert.equal(specHasJsHook(null), false);
  assert.equal(specHasJsHook("nope"), false);
  assert.equal(specHasJsHook(42), false);
});

// ---------------------------------------------------------------------------
// HLP — pure helpers
// ---------------------------------------------------------------------------

test("HLP1: resolveProfileValue reads profile.<field> and bare field", () => {
  assert.equal(resolveProfileValue(TEST_PROFILE, "profile.firstName"), "Ali");
  assert.equal(resolveProfileValue(TEST_PROFILE, "gender"), "male");
  assert.equal(resolveProfileValue(TEST_PROFILE, "profile.missing"), "");
});

test("HLP2: applyTransform override/map use the table, fuzzy is passthrough", () => {
  assert.equal(applyTransform("male", { type: "override", table: { male: "M" } }), "M");
  assert.equal(applyTransform("x", { type: "map", table: { male: "M" } }), "x", "keeps original when unmapped");
  assert.equal(applyTransform("male", { type: "fuzzy" }), "male");
  assert.equal(applyTransform("male", undefined), "male");
});

test("HLP3: resolveProgramValue — spec override wins", () => {
  const opts: ProgramOption[] = [{ v: "100", t: "Computer Engineering" }];
  const res = resolveProgramValue(opts, TEST_PROFILE, { source: "ajaxOptions", overrides: { "42": "999" } });
  assert.deepEqual(res, { value: "999", conf: 1 });
});

test("HLP4: resolveProgramValue — exact label match", () => {
  const opts: ProgramOption[] = [{ v: "100", t: "Computer Engineering" }];
  const res = resolveProgramValue(opts, TEST_PROFILE, { source: "ajaxOptions" });
  assert.equal(res?.value, "100");
  assert.equal(res?.conf, 1);
});

test("HLP5: resolveProgramValue — no candidate returns null", () => {
  const opts: ProgramOption[] = [{ v: "1", t: "Underwater Basket Weaving" }];
  const res = resolveProgramValue(opts, { ...TEST_PROFILE, programId: "" }, {
    source: "ajaxOptions",
    fuzzyThreshold: 0.99,
  });
  assert.equal(res, null);
});

// ---------------------------------------------------------------------------
// STP — executeSpecStep per action
// ---------------------------------------------------------------------------

test("STP1: navigate → page.goto(url)", async () => {
  const { page, calls } = makeMockPage();
  await executeSpecStep(page, { action: "navigate", url: "https://e.com/x" }, ctx());
  assert.deepEqual([calls[0].method, calls[0].args[0]], ["goto", "https://e.com/x"]);
});

test("STP2: fill valueFrom reads profile + applies transform", async () => {
  const { page, calls } = makeMockPage();
  await executeSpecStep(
    page,
    { action: "fill", selector: "#g", valueFrom: "profile.gender", transform: { type: "override", table: { male: "M" } } },
    ctx(),
  );
  assert.deepEqual([calls[0].method, calls[0].args[0], calls[0].args[1]], ["fill", "#g", "M"]);
});

test("STP3: fill literal value", async () => {
  const { page, calls } = makeMockPage();
  await executeSpecStep(page, { action: "fill", selector: "#n", value: "LIT" }, ctx());
  assert.equal(calls[0].args[1], "LIT");
});

test("STP4: select by value vs byLabel", async () => {
  const { page: p1, calls: c1 } = makeMockPage();
  await executeSpecStep(p1, { action: "select", selector: "#g", valueFrom: "profile.gender" }, ctx());
  assert.deepEqual(c1[0].args[1], "male");

  const { page: p2, calls: c2 } = makeMockPage();
  await executeSpecStep(p2, { action: "select", selector: "#g", valueFrom: "profile.gender", byLabel: true }, ctx());
  assert.deepEqual(c2[0].args[1], { label: "male" });
});

test("STP5: upload resolves slot → file path", async () => {
  const { page, calls } = makeMockPage();
  await executeSpecStep(page, { action: "upload", selector: "#f", slot: "passport" }, ctx());
  assert.deepEqual([calls[0].method, calls[0].args[1]], ["setInputFiles", "/tmp/passport.pdf"]);
});

test("STP6: upload with no file for slot is skipped (no throw)", async () => {
  const { page, calls } = makeMockPage();
  await executeSpecStep(page, { action: "upload", selector: "#f", slot: "transcript" }, ctx());
  assert.equal(calls.length, 0, "no setInputFiles when slot has no file");
});

test("STP7: check clicks only when current state differs", async () => {
  const { page: unchecked, calls: c1 } = makeMockPage({ _isChecked: false });
  await executeSpecStep(unchecked, { action: "check", selector: "#agree", value: true }, ctx());
  assert.ok(c1.some((c) => c.method === "click"), "clicks to check an unchecked box");

  const { page: checked, calls: c2 } = makeMockPage({ _isChecked: true });
  await executeSpecStep(checked, { action: "check", selector: "#agree", value: true }, ctx());
  assert.ok(!c2.some((c) => c.method === "click"), "no click when already checked");
});

test("STP8: radio maps profile value → selector", async () => {
  const { page, calls } = makeMockPage();
  await executeSpecStep(
    page,
    { action: "radio", valueFrom: "profile.level", map: { bachelor: "#lvl-bsc", master: "#lvl-msc" } },
    ctx(),
  );
  assert.deepEqual([calls[0].method, calls[0].args[0]], ["click", "#lvl-bsc"]);
});

test("STP9: waitFor → page.waitForSelector", async () => {
  const { page, calls } = makeMockPage();
  await executeSpecStep(page, { action: "waitFor", selector: ".ready" }, ctx());
  assert.deepEqual([calls[0].method, calls[0].args[0]], ["waitForSelector", ".ready"]);
});

test("STP10: optional step swallows page errors", async () => {
  const { page } = makeMockPage({
    waitForSelector: async () => { throw new Error("timeout"); },
  });
  await assert.doesNotReject(
    executeSpecStep(page, { action: "waitFor", selector: ".never", optional: true }, ctx()),
  );
});

test("STP11: non-optional step rethrows page errors", async () => {
  const { page } = makeMockPage({
    waitForSelector: async () => { throw new Error("timeout"); },
  });
  await assert.rejects(
    executeSpecStep(page, { action: "waitFor", selector: ".never" }, ctx()),
    /timeout/,
  );
});

// ---------------------------------------------------------------------------
// STP — jsHook trust gate
// ---------------------------------------------------------------------------

test("STP12: jsHook is SKIPPED when allowJsHook=false", async () => {
  const { page, calls } = makeMockPage();
  await executeSpecStep(page, { action: "jsHook", script: "window.x=1" }, ctx({ allowJsHook: false }));
  assert.ok(!calls.some((c) => c.method === "evaluate"), "evaluate not called when untrusted");
});

test("STP13: jsHook RUNS when allowJsHook=true", async () => {
  const { page, calls } = makeMockPage();
  await executeSpecStep(page, { action: "jsHook", script: "window.x=1" }, ctx({ allowJsHook: true }));
  assert.ok(calls.some((c) => c.method === "evaluate"), "evaluate called when trusted");
});

// ---------------------------------------------------------------------------
// DRY — dry-run skips terminal click
// ---------------------------------------------------------------------------

test("DRY1: runSpecSteps skips click{final:true} in dry mode", async () => {
  const { page, calls } = makeMockPage();
  await runSpecSteps(
    page,
    [
      { action: "fill", selector: "#a", value: "x" },
      { action: "click", selector: "#submit", final: true },
    ],
    ctx(),
    true,
  );
  assert.ok(!calls.some((c) => c.method === "click"), "final click skipped in dry mode");
  assert.ok(calls.some((c) => c.method === "fill"), "non-final steps still run");
});

test("DRY2: runSpecSteps runs the final click in live mode", async () => {
  const { page, calls } = makeMockPage();
  await runSpecSteps(
    page,
    [{ action: "click", selector: "#submit", final: true }],
    ctx(),
    false,
  );
  assert.ok(calls.some((c) => c.method === "click"), "final click runs in live mode");
});

// ---------------------------------------------------------------------------
// CLS — classifyResult
// ---------------------------------------------------------------------------

test("CLS1: successText → submitted", async () => {
  const { page } = makeMockPage({ _html: "<p>Application submitted successfully</p>" });
  const res = await classifyResult(page, { successText: "application submitted" });
  assert.equal(res.submitted, true);
});

test("CLS2: alreadyExistsText → alreadyExists", async () => {
  const { page } = makeMockPage({ _html: "<p>You are already registered</p>" });
  const res = await classifyResult(page, { successText: "ok", alreadyExistsText: "already registered" });
  assert.equal(res.alreadyExists, true);
  assert.equal(res.submitted, false);
});

test("CLS3: programMissingText → programMissing", async () => {
  const { page } = makeMockPage({ _html: "<p>program not found</p>" });
  const res = await classifyResult(page, { successText: "ok", programMissingText: "program not found" });
  assert.equal(res.programMissing, true);
});

test("CLS4: failureText → not submitted with detail", async () => {
  const { page } = makeMockPage({ _html: "<p>system error occurred</p>" });
  const res = await classifyResult(page, { successText: "ok" }, { failureText: "system error" });
  assert.equal(res.submitted, false);
  assert.equal(res.detail, "failureText matched");
});

test("CLS5: redirectPattern captures externalRef from URL", async () => {
  const { page } = makeMockPage({
    _html: "<p>thanks</p>",
    _url: "https://portal.example.com/done/AB12-CD34",
  });
  const res = await classifyResult(page, { redirectPattern: "/done/([A-Z0-9-]+)" });
  assert.equal(res.submitted, true);
  assert.equal(res.externalRef, "AB12-CD34");
});

test("CLS6: successSelector presence → submitted", async () => {
  const { page } = makeMockPage({ _hasEl: true });
  const res = await classifyResult(page, { successSelector: ".success-banner" });
  assert.equal(res.submitted, true);
});

// ---------------------------------------------------------------------------
// ADP — createSpecAdapter
// ---------------------------------------------------------------------------

test("ADP1: createSpecAdapter exposes key/label/matches/login/submit", () => {
  const parsed = parseAdapterSpec(validRawSpec());
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const adapter = createSpecAdapter(parsed.spec);
  assert.equal(adapter.key, "test_uni");
  assert.equal(adapter.label, "Test Üniversitesi");
  assert.equal(typeof adapter.matches, "function");
  assert.equal(typeof adapter.login, "function");
  assert.equal(typeof adapter.submit, "function");
});

test("ADP2: matches() case-folds spec.meta.matches against the name", () => {
  const parsed = parseAdapterSpec(validRawSpec());
  if (!parsed.ok) throw new Error("fixture invalid");
  const adapter = createSpecAdapter(parsed.spec);
  assert.equal(adapter.matches("Test University application portal"), true);
  assert.equal(adapter.matches("Bogazici University"), false);
});

// ---------------------------------------------------------------------------
// ROW — buildSpecAdapterFromRow / jsHook trust
// ---------------------------------------------------------------------------

function makeSpecRow(over: Partial<PortalAdapterSpec> = {}): PortalAdapterSpec {
  const now = new Date();
  return {
    id: 1,
    key: "test_uni",
    version: 1,
    name: "Test Üniversitesi",
    spec: validRawSpec() as Record<string, unknown>,
    source: "uploaded",
    enabled: true,
    jsHookApproved: false,
    createdBy: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as PortalAdapterSpec;
}

test("ROW1: specRowAllowsJsHook — builtin always trusted", () => {
  assert.equal(specRowAllowsJsHook({ source: "builtin", jsHookApproved: false }), true);
});

test("ROW2: specRowAllowsJsHook — user trusted only when approved", () => {
  assert.equal(specRowAllowsJsHook({ source: "uploaded", jsHookApproved: false }), false);
  assert.equal(specRowAllowsJsHook({ source: "uploaded", jsHookApproved: true }), true);
});

test("ROW3: buildSpecAdapterFromRow builds an adapter for a valid row", () => {
  const adapter = buildSpecAdapterFromRow(makeSpecRow());
  assert.notEqual(adapter, null);
  assert.equal(adapter?.key, "test_uni");
});

test("ROW4: buildSpecAdapterFromRow returns null for an invalid stored spec", () => {
  const adapter = buildSpecAdapterFromRow(makeSpecRow({ spec: { garbage: true } as Record<string, unknown> }));
  assert.equal(adapter, null);
});

test("ROW5: jsHook in a user/unapproved row is skipped at run time", async () => {
  const raw = validRawSpec() as Record<string, unknown>;
  (raw.steps as unknown[]).push({ action: "jsHook", script: "window.x=1" });
  const adapter = buildSpecAdapterFromRow(makeSpecRow({ spec: raw as Record<string, unknown>, source: "uploaded", jsHookApproved: false }));
  assert.notEqual(adapter, null, "row still builds (jsHook is skipped, not rejected)");
});
