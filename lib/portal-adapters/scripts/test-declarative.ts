/**
 * test-declarative.ts — TD1 / TD2
 *
 * TD1: createDeclarativeAdapter() returns a correct UniversityAdapter shape:
 *      key, label, matches(), login() and submit() exist as functions.
 *
 * TD2: executeStep() + runSteps() handle all step types correctly against
 *      a mock page — no real browser, no network I/O.
 *
 * Run:
 *   pnpm --filter @workspace/portal-adapters test:declarative
 */

import { test } from "node:test";
import assert  from "node:assert/strict";

import {
  createDeclarativeAdapter,
  executeStep,
  runSteps,
  checkResult,
  type DeclarativeConfig,
  type MinimalPage,
} from "../src/declarativeAdapter.js";
import type { SubmitProfile, SubmitFiles } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_CONFIG: DeclarativeConfig = {
  key:   "test_uni",
  label: "Test Üniversitesi",
  matches: ["test university", "test_uni", "testuni"],
  loginUrl: "https://portal.test-uni.example.com/login",
  credentials: {
    userSelector:   "#email",
    passSelector:   "#password",
    submitSelector: "button[type=submit]",
    afterSelector:  ".dashboard",
  },
  steps: [
    { type: "navigate", url: "https://portal.test-uni.example.com/apply" },
    { type: "fill",     selector: "#firstName",   field: "firstName"       },
    { type: "fill",     selector: "#lastName",    field: "lastName"        },
    { type: "fill",     selector: "#email",        field: "email"           },
    { type: "fill",     selector: "#passport",     field: "passportNumber"  },
    { type: "fill",     selector: "#ref",          value: "AGENT-2026"      },
    { type: "select",   selector: "#gender",       field: "gender"          },
    { type: "upload",   selector: "#passportFile", fileField: "passport"    },
    { type: "upload",   selector: "#photoFile",    fileField: "photo"       },
    { type: "wait",     selector: ".form-loaded"                            },
    { type: "click",    selector: "#submitBtn"                              },
    { type: "screenshot"                                                    },
  ],
  submitCheck: {
    successText:        "application submitted",
    alreadyExistsText:  "already registered",
    programMissingText: "program not found",
  },
};

const TEST_PROFILE: SubmitProfile = {
  email:          "test@example.com",
  passportNumber: "A1234567",
  firstName:      "Ali",
  lastName:       "Yılmaz",
  dateOfBirth:    "2000-01-01",
  gender:         "male",
  fatherName:     "Mehmet",
  motherName:     "Fatma",
  nationality:    "Turkish",
  address:        "Istanbul",
  phone:          "+905001234567",
  level:          "bachelor",
  programName:    "Computer Engineering",
  programId:      "42",
};

const TEST_FILES: SubmitFiles = {
  passport:   "/tmp/passport.pdf",
  photo:      "/tmp/photo.jpg",
};

// ---------------------------------------------------------------------------
// Mock page factory
// ---------------------------------------------------------------------------

interface Call { method: string; args: unknown[] }

function makeMockPage(overrides?: Partial<MinimalPage> & { _html?: string }): {
  page: MinimalPage;
  calls: Call[];
} {
  const calls: Call[] = [];
  const html = overrides?._html ?? "<html><body></body></html>";

  const page: MinimalPage = {
    goto:             async (...args) => { calls.push({ method: "goto",             args }); },
    fill:             async (...args) => { calls.push({ method: "fill",             args }); },
    click:            async (...args) => { calls.push({ method: "click",            args }); },
    selectOption:     async (...args) => { calls.push({ method: "selectOption",     args }); },
    setInputFiles:    async (...args) => { calls.push({ method: "setInputFiles",    args }); },
    waitForSelector:  async (...args) => { calls.push({ method: "waitForSelector",  args }); },
    content:          async ()        => html,
    $:                async (...args) => { calls.push({ method: "$",               args }); return null; },
    ...overrides,
  };
  return { page, calls };
}

// ---------------------------------------------------------------------------
// TD1: adapter shape
// ---------------------------------------------------------------------------

test("TD1: createDeclarativeAdapter() returns correct UniversityAdapter shape", () => {
  const adapter = createDeclarativeAdapter(TEST_CONFIG);

  assert.equal(typeof adapter,        "object",   "adapter is an object");
  assert.equal(adapter.key,           "test_uni", "key matches config");
  assert.equal(adapter.label,         "Test Üniversitesi", "label matches config");
  assert.equal(typeof adapter.login,  "function", "login is a function");
  assert.equal(typeof adapter.submit, "function", "submit is a function");
  assert.equal(typeof adapter.matches, "function", "matches is a function");
});

test("TD1b: matches() returns true for all configured patterns", () => {
  const adapter = createDeclarativeAdapter(TEST_CONFIG);

  assert.equal(adapter.matches("Test University"),        true,  "matches 'test university' (case-folded)");
  assert.equal(adapter.matches("This is Test_Uni Portal"), true, "matches 'test_uni' substring");
  assert.equal(adapter.matches("TestUni Portal"),          true, "matches 'testuni' substring");
  assert.equal(adapter.matches("Bogazici University"),     false, "no match for unrelated university");
  assert.equal(adapter.matches(""),                        false, "no match for empty string");
});

// ---------------------------------------------------------------------------
// TD2: executeStep — all step types
// ---------------------------------------------------------------------------

test("TD2a: executeStep — 'navigate' calls page.goto(url)", async () => {
  const { page, calls } = makeMockPage();
  await executeStep(page, { type: "navigate", url: "https://example.com/apply" }, TEST_PROFILE, TEST_FILES);
  assert.equal(calls.length, 1, "one call");
  assert.equal(calls[0].method, "goto", "method is goto");
  assert.equal(calls[0].args[0], "https://example.com/apply", "url passed correctly");
});

test("TD2b: executeStep — 'fill' with field reads from profile", async () => {
  const { page, calls } = makeMockPage();
  await executeStep(page, { type: "fill", selector: "#firstName", field: "firstName" }, TEST_PROFILE, TEST_FILES);
  assert.equal(calls[0].method, "fill",        "method is fill");
  assert.equal(calls[0].args[0], "#firstName", "selector passed");
  assert.equal(calls[0].args[1], "Ali",        "value from profile.firstName");
});

test("TD2c: executeStep — 'fill' with literal value", async () => {
  const { page, calls } = makeMockPage();
  await executeStep(page, { type: "fill", selector: "#ref", value: "AGENT-2026" }, TEST_PROFILE, TEST_FILES);
  assert.equal(calls[0].method, "fill",        "method is fill");
  assert.equal(calls[0].args[1], "AGENT-2026", "literal value passed");
});

test("TD2d: executeStep — 'select' calls selectOption with profile field", async () => {
  const { page, calls } = makeMockPage();
  await executeStep(page, { type: "select", selector: "#gender", field: "gender" }, TEST_PROFILE, TEST_FILES);
  assert.equal(calls[0].method, "selectOption", "method is selectOption");
  assert.equal(calls[0].args[0], "#gender",     "selector passed");
  assert.equal(calls[0].args[1], "male",        "value from profile.gender");
});

test("TD2e: executeStep — 'click' calls page.click(selector)", async () => {
  const { page, calls } = makeMockPage();
  await executeStep(page, { type: "click", selector: "#submitBtn" }, TEST_PROFILE, TEST_FILES);
  assert.equal(calls[0].method, "click",      "method is click");
  assert.equal(calls[0].args[0], "#submitBtn", "selector passed");
});

test("TD2f: executeStep — 'upload' calls setInputFiles when file exists", async () => {
  const { page, calls } = makeMockPage();
  await executeStep(page, { type: "upload", selector: "#passportFile", fileField: "passport" }, TEST_PROFILE, TEST_FILES);
  assert.equal(calls[0].method, "setInputFiles",   "method is setInputFiles");
  assert.equal(calls[0].args[0], "#passportFile",  "selector passed");
  assert.equal(calls[0].args[1], "/tmp/passport.pdf", "file path from files.passport");
});

test("TD2g: executeStep — 'upload' is a no-op when file is missing", async () => {
  const { page, calls } = makeMockPage();
  const filesWithoutDiploma: SubmitFiles = { passport: "/tmp/p.pdf" };
  await executeStep(page, { type: "upload", selector: "#diploma", fileField: "diploma" }, TEST_PROFILE, filesWithoutDiploma);
  assert.equal(calls.length, 0, "no calls when file is absent (non-fatal)");
});

test("TD2h: executeStep — 'wait' calls waitForSelector", async () => {
  const { page, calls } = makeMockPage();
  await executeStep(page, { type: "wait", selector: ".form-loaded" }, TEST_PROFILE, TEST_FILES);
  assert.equal(calls[0].method, "waitForSelector", "method is waitForSelector");
  assert.equal(calls[0].args[0], ".form-loaded",   "selector passed");
});

test("TD2i: executeStep — 'screenshot' is a no-op (no page calls)", async () => {
  const { page, calls } = makeMockPage();
  await executeStep(page, { type: "screenshot" }, TEST_PROFILE, TEST_FILES);
  assert.equal(calls.length, 0, "screenshot step makes no page calls");
});

// ---------------------------------------------------------------------------
// TD2j: runSteps — all steps in sequence
// ---------------------------------------------------------------------------

test("TD2j: runSteps() executes all steps in order", async () => {
  const { page, calls } = makeMockPage();

  await runSteps(page, TEST_CONFIG.steps, TEST_PROFILE, TEST_FILES);

  // navigate, fill×5, select, upload×2 (photo present), wait, click, screenshot(no-op)
  // upload for photo: present → setInputFiles
  // upload for passport: present → setInputFiles
  // navigate(1) + fill(5) + select(1) + upload(2) + wait(1) + click(1) = 11 calls
  assert.ok(calls.length === 11, `Expected 11 page calls, got ${calls.length}`);

  assert.equal(calls[0].method, "goto",            "step 1: navigate");
  assert.equal(calls[1].method, "fill",            "step 2: fill firstName");
  assert.equal(calls[1].args[1], "Ali",            "step 2: firstName value");
  assert.equal(calls[5].method, "fill",            "step 6: fill ref (literal)");
  assert.equal(calls[5].args[1], "AGENT-2026",     "step 6: literal value");
  assert.equal(calls[6].method, "selectOption",    "step 7: select gender");
  assert.equal(calls[7].method, "setInputFiles",   "step 8: upload passport");
  assert.equal(calls[8].method, "setInputFiles",   "step 9: upload photo");
  assert.equal(calls[9].method, "waitForSelector", "step 10: wait");
  assert.equal(calls[10].method, "click",          "step 11: click");
  // step 12: screenshot → no call (skipped in count)
});

// ---------------------------------------------------------------------------
// TD2k: checkResult — all outcome branches
// ---------------------------------------------------------------------------

test("TD2k-1: checkResult → submitted when successText in page HTML", async () => {
  const { page } = makeMockPage({ _html: "<html><body>Application Submitted successfully.</body></html>" });
  const result = await checkResult(page, TEST_CONFIG.submitCheck);
  assert.equal(result.submitted,     true,  "submitted=true");
  assert.equal(result.alreadyExists, false, "alreadyExists=false");
  assert.equal(result.programMissing,false, "programMissing=false");
});

test("TD2k-2: checkResult → alreadyExists when alreadyExistsText in page HTML", async () => {
  const { page } = makeMockPage({ _html: "<html><body>Student already registered in the system.</body></html>" });
  const result = await checkResult(page, TEST_CONFIG.submitCheck);
  assert.equal(result.submitted,     false, "submitted=false");
  assert.equal(result.alreadyExists, true,  "alreadyExists=true");
});

test("TD2k-3: checkResult → programMissing when programMissingText in page HTML", async () => {
  const { page } = makeMockPage({ _html: "<html><body>Error: Program not found in catalog.</body></html>" });
  const result = await checkResult(page, TEST_CONFIG.submitCheck);
  assert.equal(result.programMissing, true, "programMissing=true");
  assert.equal(result.submitted,     false, "submitted=false");
});

test("TD2k-4: checkResult → all false when nothing matches", async () => {
  const { page } = makeMockPage({ _html: "<html><body>Loading...</body></html>" });
  const result = await checkResult(page, TEST_CONFIG.submitCheck);
  assert.equal(result.submitted,      false, "submitted=false");
  assert.equal(result.alreadyExists,  false, "alreadyExists=false");
  assert.equal(result.programMissing, false, "programMissing=false");
});

test("TD2k-5: checkResult → alreadyExists takes priority over successText", async () => {
  // Both texts present — alreadyExists wins (higher priority)
  const { page } = makeMockPage({
    _html: "<html><body>Application submitted. But student already registered.</body></html>",
  });
  const result = await checkResult(page, TEST_CONFIG.submitCheck);
  assert.equal(result.alreadyExists, true,  "alreadyExists takes priority");
  assert.equal(result.submitted,     false, "submitted=false");
});

test("TD2k-6: checkResult → successSelector fallback when successText absent", async () => {
  const { page: _p } = makeMockPage({ _html: "<html><body><div id='ok-banner'>Done</div></body></html>" });

  // Build a page where $(".success-banner") returns a truthy element handle
  const { page } = makeMockPage({
    _html: "<html><body></body></html>",
    $: async (sel: string) => sel === ".success-banner" ? {} : null,
  });

  const result = await checkResult(page, {
    successSelector:    ".success-banner",
    alreadyExistsText:  "already registered",
    programMissingText: "program not found",
  });
  assert.equal(result.submitted, true, "submitted=true via successSelector");
});
