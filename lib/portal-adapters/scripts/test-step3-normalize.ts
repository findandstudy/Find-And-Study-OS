/**
 * test-step3-normalize.ts — Topkapı Step 3 education-field normalization.
 *
 * Pure-function unit tests (no DB / no browser) for:
 *   - normalizeGpaRange        — CRM GPA range/single/comma → single numeric GPA
 *   - formatGraduationForInput — year-only → widget-appropriate value
 *   - eduLevelCandidates       — applied level → ordered PRIOR-education labels
 *   - isPlaceholderChoice      — detect non-selection placeholders ("Seçim Yapın")
 *
 * Run:
 *   pnpm --filter @workspace/portal-adapters test:step3
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGpaRange } from "../src/profile.js";
import {
  formatGraduationForInput,
  eduLevelCandidates,
  isPlaceholderChoice,
} from "../src/universities/topkapi/format.js";

test("normalizeGpaRange — single values pass through", () => {
  assert.equal(normalizeGpaRange("80.6"), 80.6);
  assert.equal(normalizeGpaRange("3.5"), 3.5);
  assert.equal(normalizeGpaRange("4"), 4);
  assert.equal(normalizeGpaRange(3.2), 3.2);
});

test("normalizeGpaRange — ranges resolve to the upper bound", () => {
  assert.equal(normalizeGpaRange("2.8-3.0"), 3.0);
  assert.equal(normalizeGpaRange("3.0 - 3.5"), 3.5);
  assert.equal(normalizeGpaRange("2.8 – 3.0"), 3.0); // en dash
  assert.equal(normalizeGpaRange("2.8 — 3.0"), 3.0); // em dash
  assert.equal(normalizeGpaRange("3 to 3.5"), 3.5);
  assert.equal(normalizeGpaRange("70-80"), 80);
});

test("normalizeGpaRange — decimal comma is converted", () => {
  assert.equal(normalizeGpaRange("2,8"), 2.8);
  assert.equal(normalizeGpaRange("2,8-3,0"), 3.0);
});

test("normalizeGpaRange — empty / nullish → undefined", () => {
  assert.equal(normalizeGpaRange(""), undefined);
  assert.equal(normalizeGpaRange("   "), undefined);
  assert.equal(normalizeGpaRange(null), undefined);
  assert.equal(normalizeGpaRange(undefined), undefined);
  assert.equal(normalizeGpaRange(NaN), undefined);
});

test("normalizeGpaRange — unparseable throws a clear error", () => {
  assert.throws(() => normalizeGpaRange("abc"), /unparseable GPA/);
  assert.throws(() => normalizeGpaRange("good-student"), /unparseable GPA/);
});

test("formatGraduationForInput — expands by widget type", () => {
  assert.equal(formatGraduationForInput(2025, "date"), "2025-01-01");
  assert.equal(formatGraduationForInput(2025, "month"), "2025-01");
  assert.equal(formatGraduationForInput(2025, "week"), "2025-W01");
  assert.equal(formatGraduationForInput(2025, "text"), "2025");
  assert.equal(formatGraduationForInput(2025, "number"), "2025");
  assert.equal(formatGraduationForInput(2025, ""), "2025");
});

test("formatGraduationForInput — missing year → placeholder", () => {
  assert.equal(formatGraduationForInput(null, "date"), "-");
  assert.equal(formatGraduationForInput(undefined, "text"), "-");
});

test("eduLevelCandidates — Bachelor applicant → prior is high school", () => {
  const c = eduLevelCandidates("Bachelor", "Computer Engineering");
  assert.equal(c[0], "Lise");
  assert.ok(c.includes("High School"));
  // applied level appended last as a defensive fallback
  assert.equal(c[c.length - 1], "Bachelor");
});

test("eduLevelCandidates — Associate / Foundation applicant → high school", () => {
  assert.equal(eduLevelCandidates("Associate", "")[0], "Lise");
  assert.equal(eduLevelCandidates("Foundation Year", "")[0], "Lise");
});

test("eduLevelCandidates — Masters applicant → prior is Bachelor", () => {
  const c = eduLevelCandidates("Masters (Thesis)", "Business");
  assert.equal(c[0], "Lisans");
  assert.ok(c.includes("Bachelor"));
  // applied (Masters …) is the fallback, never first
  assert.notEqual(c[0], "Masters (Thesis)");
});

test("eduLevelCandidates — Turkish 'Yüksek Lisans' applicant → prior is Bachelor", () => {
  const c = eduLevelCandidates("Yüksek Lisans", "İşletme");
  assert.equal(c[0], "Lisans");
});

test("eduLevelCandidates — Doctorate applicant → prior is Masters", () => {
  const c = eduLevelCandidates("PhD", "Physics");
  assert.equal(c[0], "Yüksek Lisans");
  assert.ok(c.includes("Master"));
});

test("isPlaceholderChoice — placeholders are rejected", () => {
  assert.equal(isPlaceholderChoice("Seçim Yapın", "Seçim Yapın"), true);
  assert.equal(isPlaceholderChoice("0", "Seçiniz"), true);
  assert.equal(isPlaceholderChoice("", "Lise"), true);
  assert.equal(isPlaceholderChoice("123", "Please Select"), true);
  assert.equal(isPlaceholderChoice("123", "Lütfen Seçiniz"), true);
  assert.equal(isPlaceholderChoice("123", "-"), true);
});

test("isPlaceholderChoice — real selections pass", () => {
  assert.equal(isPlaceholderChoice("12", "Lise"), false);
  assert.equal(isPlaceholderChoice("5", "High School"), false);
  assert.equal(isPlaceholderChoice("9", "Lisans"), false);
});
