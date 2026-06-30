/**
 * Unit tests for the SIT adapter's pure logic (no browser).
 *
 * GPA1  — normalizeGpa: decimal rounding (dot & comma)
 * GPA2  — normalizeGpa: Cambridge letters A*=90…E=40 (case-insensitive)
 * GPA3  — normalizeGpa: number input rounds; empty/garbage → undefined
 * AL1   — allowlist length is exactly 11
 * AL2   — allowlist includes Beykoz, excludes İstanbul Yeni Yüzyıl
 * AL3   — matchAllowedUniversity resolves the canonical entry
 * AL4   — exact-name guards: Cyprus Aydın / Beykent / İstanbul Medipol rejected
 * EDU1  — mapEducationLevel maps TR/EN levels to canonical labels
 * DATE1 — formatSitDate: ISO → DD/MM/YYYY
 * LANG1 — isLanguageCompatible: EN vs TR mismatch rejected, neutral allowed
 * SEL1  — selector-constant presence (URLs, login, fields, buttons, upload)
 *
 * Run with:
 *   pnpm --filter @workspace/portal-adapters run test:sit
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SIT_ALLOWLIST,
  normalizeGpa,
  mapEducationLevel,
  formatSitDate,
  matchAllowedUniversity,
  isAllowedUniversity,
  isLanguageCompatible,
} from "../src/universities/sit/helpers.js";
import {
  SIT_URLS,
  SIT_LOGIN,
  SIT_STUDENT_FIELDS,
  SIT_APP_FIELDS,
  SIT_BUTTONS,
  SIT_UPLOAD,
} from "../src/universities/sit/selectors.js";

// ---------------------------------------------------------------------------
// GPA normalization
// ---------------------------------------------------------------------------

test("GPA1 — decimal rounding (dot & comma)", () => {
  assert.equal(normalizeGpa("3.6"), 4);
  assert.equal(normalizeGpa("3,4"), 3);
  assert.equal(normalizeGpa("2.5"), 3); // round-half-up
  assert.equal(normalizeGpa("85"), 85);
});

test("GPA2 — Cambridge letters A*=90…E=40 (case-insensitive)", () => {
  assert.equal(normalizeGpa("A*"), 90);
  assert.equal(normalizeGpa("A"), 80);
  assert.equal(normalizeGpa("b"), 70);
  assert.equal(normalizeGpa("C"), 60);
  assert.equal(normalizeGpa("d"), 50);
  assert.equal(normalizeGpa("E"), 40);
});

test("GPA3 — number input rounds; empty/garbage → undefined", () => {
  assert.equal(normalizeGpa(3.49), 3);
  assert.equal(normalizeGpa(88), 88);
  assert.equal(normalizeGpa(""), undefined);
  assert.equal(normalizeGpa(undefined), undefined);
  assert.equal(normalizeGpa(null), undefined);
  assert.equal(normalizeGpa("not-a-grade"), undefined);
});

// ---------------------------------------------------------------------------
// Allowlist integrity
// ---------------------------------------------------------------------------

test("AL1 — allowlist length is exactly 11", () => {
  assert.equal(SIT_ALLOWLIST.length, 11);
});

test("AL2 — includes Beykoz, excludes İstanbul Yeni Yüzyıl", () => {
  assert.ok(
    SIT_ALLOWLIST.some((n) => /beykoz/i.test(n)),
    "Beykoz must be in the allowlist",
  );
  assert.ok(
    !SIT_ALLOWLIST.some((n) => /yeni\s*y/i.test(n)),
    "İstanbul Yeni Yüzyıl must NOT be in the allowlist",
  );
});

test("AL3 — matchAllowedUniversity resolves the canonical entry", () => {
  assert.equal(matchAllowedUniversity("Beykoz Üniversitesi"), "Beykoz Üniversitesi");
  assert.equal(matchAllowedUniversity("haliç universitesi"), "Haliç Üniversitesi");
  assert.equal(
    matchAllowedUniversity("Istanbul Aydin University"),
    "İstanbul Aydın Üniversitesi",
  );
  assert.ok(isAllowedUniversity("TED Üniversitesi"));
});

test("AL4 — exact-name guards reject look-alikes", () => {
  // Cyprus/Kıbrıs Aydın must NOT match İstanbul Aydın.
  assert.equal(matchAllowedUniversity("Kıbrıs Aydın Üniversitesi"), null);
  // Beykent must NOT match İstanbul Kent.
  assert.equal(matchAllowedUniversity("Beykent Üniversitesi"), null);
  // İstanbul Medipol must NOT match Ankara Medipol.
  assert.equal(matchAllowedUniversity("İstanbul Medipol Üniversitesi"), null);
  // Removed university must not match.
  assert.equal(matchAllowedUniversity("İstanbul Yeni Yüzyıl Üniversitesi"), null);
  // Bare generic token must not match anything.
  assert.equal(matchAllowedUniversity("Üniversitesi"), null);
  // Exact token-set equality: an allowlisted token PLUS extra disambiguating
  // tokens is a DIFFERENT institution and must be rejected (no subset match).
  assert.equal(matchAllowedUniversity("Beykoz Lojistik Üniversitesi"), null);
  assert.equal(matchAllowedUniversity("Galata Meslek Yüksekokulu"), null);
  assert.equal(matchAllowedUniversity("TED Ankara Koleji"), null);
});

// ---------------------------------------------------------------------------
// Education level mapping
// ---------------------------------------------------------------------------

test("EDU1 — mapEducationLevel maps TR/EN to canonical labels", () => {
  assert.equal(mapEducationLevel("Lisans"), "Bachelor");
  assert.equal(mapEducationLevel("Bachelor"), "Bachelor");
  assert.equal(mapEducationLevel("Yüksek Lisans"), "Master");
  assert.equal(mapEducationLevel("Master's"), "Master");
  assert.equal(mapEducationLevel("Ön Lisans"), "Associate");
  assert.equal(mapEducationLevel("Doktora"), "PhD");
  assert.equal(mapEducationLevel("PhD"), "PhD");
  assert.equal(mapEducationLevel(""), "Bachelor");
});

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

test("DATE1 — formatSitDate ISO → DD/MM/YYYY", () => {
  assert.equal(formatSitDate("1999-04-15"), "15/04/1999");
  assert.equal(formatSitDate("2001-12-01T00:00:00Z"), "01/12/2001");
  assert.equal(formatSitDate(""), "");
  assert.equal(formatSitDate(undefined), "");
});

// ---------------------------------------------------------------------------
// Language compatibility
// ---------------------------------------------------------------------------

test("LANG1 — language mismatch rejected, neutral allowed", () => {
  assert.equal(
    isLanguageCompatible("Computer Engineering (English)", "Bilgisayar Müh. (Türkçe)"),
    false,
  );
  assert.equal(
    isLanguageCompatible("Computer Engineering (English)", "Computer Engineering (English)"),
    true,
  );
  // Desired names no language → compatible with anything.
  assert.equal(
    isLanguageCompatible("Computer Engineering", "Bilgisayar Müh. (Türkçe)"),
    true,
  );
  // Candidate names no language → compatible.
  assert.equal(
    isLanguageCompatible("Computer Engineering (English)", "Computer Engineering"),
    true,
  );
});

test("LANG2 — desired English + only Turkish candidates → empty pool (programMissing, no fallback)", () => {
  const desired = "Computer Engineering (English)";
  const catalog = [
    { id: "1", name: "Bilgisayar Mühendisliği (Türkçe)" },
    { id: "2", name: "Makine Mühendisliği (Türkçe)" },
  ];
  // This mirrors createApplication()'s language filter. When a language is
  // desired and every candidate is a different detectable language the pool is
  // empty, so the adapter must report programMissing rather than fall back to
  // the full catalog and submit a wrong-language application.
  const pool = catalog.filter((c) => isLanguageCompatible(desired, c.name));
  assert.equal(pool.length, 0);
  assert.ok(catalog.length > 0); // non-empty catalog → the no-fallback guard fires
});

// ---------------------------------------------------------------------------
// Selector-constant presence
// ---------------------------------------------------------------------------

test("SEL1 — selector constants are present and well-formed", () => {
  assert.ok(SIT_URLS.base.startsWith("https://"), "base URL");
  assert.ok(SIT_URLS.loginPath.startsWith("/"), "login path");
  assert.ok(SIT_URLS.studentsPath.startsWith("/"), "students path");

  assert.ok(SIT_LOGIN.submitName instanceof RegExp, "login submit regex");
  assert.ok(Array.isArray(SIT_LOGIN.emailCandidates) && SIT_LOGIN.emailCandidates.length > 0);

  for (const key of ["firstName", "lastName", "email", "gpa", "passportNumber"] as const) {
    assert.ok(SIT_STUDENT_FIELDS[key] instanceof RegExp, `student field ${key}`);
  }
  for (const key of ["university", "degree", "program"] as const) {
    assert.ok(SIT_APP_FIELDS[key] instanceof RegExp, `app field ${key}`);
  }
  for (const key of ["next", "saveStudent", "createApplication"] as const) {
    assert.ok(SIT_BUTTONS[key] instanceof RegExp, `button ${key}`);
  }
  assert.ok(SIT_UPLOAD.photoTrigger instanceof RegExp, "photo trigger");
  assert.ok(SIT_UPLOAD.attachmentTrigger instanceof RegExp, "attachment trigger");
});
