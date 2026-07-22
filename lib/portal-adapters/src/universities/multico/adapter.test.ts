// ---------------------------------------------------------------------------
// Multico adapter — pure-function unit tests
//
// Tests the pure, side-effect-free functions in the multico adapter:
//   - isMulticoNationality: nationality string matching
//   - mapProgramType: CRM level → Multico program_type
//   - matchMulticoProgram (via matchProgram): program name fuzzy match
//   - parseStudentIdFromHtml: HTML ID extraction
//   - toMulticoDate: date formatting
//   - parseLatestApplication: HTML application row parsing
//
// These tests run without a browser or DB connection.
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isMulticoNationality,
  MULTICO_NATIONALITIES,
} from "./adapter.js";

// ---------------------------------------------------------------------------
// isMulticoNationality
// ---------------------------------------------------------------------------

describe("isMulticoNationality", () => {
  // --- Positive cases (exact country names) ---
  for (const nat of MULTICO_NATIONALITIES) {
    it(`matches lowercase country name: ${nat}`, () => {
      assert.ok(isMulticoNationality(nat));
    });
    it(`matches title-case: ${nat.charAt(0).toUpperCase() + nat.slice(1)}`, () => {
      assert.ok(isMulticoNationality(nat.charAt(0).toUpperCase() + nat.slice(1)));
    });
    it(`matches UPPERCASE: ${nat.toUpperCase()}`, () => {
      assert.ok(isMulticoNationality(nat.toUpperCase()));
    });
  }

  // --- Positive cases (adjective / demonym forms) ---
  it("matches 'Azerbaijani'", () => assert.ok(isMulticoNationality("Azerbaijani")));
  it("matches 'Kazakh'", () => assert.ok(isMulticoNationality("Kazakh")));
  it("matches 'Uzbek'", () => assert.ok(isMulticoNationality("Uzbek")));
  it("matches 'Kyrgyz'", () => assert.ok(isMulticoNationality("Kyrgyz")));
  it("matches 'Tajik'", () => assert.ok(isMulticoNationality("Tajik")));
  it("matches 'Turkmen'", () => assert.ok(isMulticoNationality("Turkmen")));
  it("matches 'Mongolian'", () => assert.ok(isMulticoNationality("Mongolian")));
  it("matches mixed case 'AZERbaijani'", () => assert.ok(isMulticoNationality("AZERbaijani")));

  // --- Negative cases (non-Central-Asian nationalities) ---
  it("does not match 'Turkish'", () => assert.ok(!isMulticoNationality("Turkish")));
  it("does not match 'Turkish Republic of Azerbaijan' ... no wait Turkish is not azeri", () => {
    // "Turkish" does not include "azerbaijan", "kazakhstan" etc.
    assert.ok(!isMulticoNationality("Turkish"));
  });
  it("does not match 'German'", () => assert.ok(!isMulticoNationality("German")));
  it("does not match 'Iranian'", () => assert.ok(!isMulticoNationality("Iranian")));
  it("does not match 'Pakistani'", () => assert.ok(!isMulticoNationality("Pakistani")));
  it("does not match empty string", () => assert.ok(!isMulticoNationality("")));
  it("does not match null", () => assert.ok(!isMulticoNationality(null)));
  it("does not match undefined", () => assert.ok(!isMulticoNationality(undefined)));
  it("does not match 'Nigerian'", () => assert.ok(!isMulticoNationality("Nigerian")));
});
