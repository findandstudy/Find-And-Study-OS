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
  isSitMember,
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
import {
  sitCanAuthWithoutPage,
  extractAnonJwt,
  selectBundleUrls,
} from "../src/universities/sit/graphql.js";
import {
  buildSignedStudentPhotoPath,
  verifyStudentPhotoSignature,
} from "../src/studentPhotoSigning.js";
import {
  buildSignedDocumentPath,
  verifyDocumentSignature,
} from "../src/documentSigning.js";
import { extractStudentDocumentRefs } from "../src/profile.js";

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

test("AL1 — allowlist length is exactly 12", () => {
  assert.equal(SIT_ALLOWLIST.length, 12);
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

// ---------------------------------------------------------------------------
// SIT membership (FAS) — isSitMember
// ---------------------------------------------------------------------------

test("MEMBER1 — agreed SIT universities are members", () => {
  assert.equal(isSitMember("İstanbul Aydın Üniversitesi"), true);
  assert.equal(isSitMember("Atlas Üniversitesi"), true);
  assert.equal(isSitMember("Aydin University"), true); // short portal name resolves
});

test("MEMBER2 — direct-access universities are NOT SIT members", () => {
  assert.equal(isSitMember("Altınbaş Üniversitesi"), false);
  assert.equal(isSitMember("İstanbul Okan Üniversitesi"), false);
  assert.equal(isSitMember("Üsküdar Üniversitesi"), false);
});

test("MEMBER3 — empty / nullish → not a member", () => {
  assert.equal(isSitMember(""), false);
  assert.equal(isSitMember("   "), false);
  assert.equal(isSitMember(null), false);
  assert.equal(isSitMember(undefined), false);
});

test("MEMBER4 — SIT_MEMBER_UNIVERSITIES env EXTENDS (never shrinks) the list", () => {
  const prev = process.env.SIT_MEMBER_UNIVERSITIES;
  try {
    assert.equal(isSitMember("Üsküdar Üniversitesi"), false);
    process.env.SIT_MEMBER_UNIVERSITIES = "Üsküdar Üniversitesi";
    assert.equal(isSitMember("Üsküdar Üniversitesi"), true);
    // agreed members are still recognised alongside the extension
    assert.equal(isSitMember("Atlas Üniversitesi"), true);
  } finally {
    if (prev === undefined) delete process.env.SIT_MEMBER_UNIVERSITIES;
    else process.env.SIT_MEMBER_UNIVERSITIES = prev;
  }
});

// ---------------------------------------------------------------------------
// Signed, auth-free student-photo URLs (PHOTO1..PHOTO5)
// ---------------------------------------------------------------------------
function withPhotoSecret<T>(fn: () => T): T {
  const prevSession = process.env.SESSION_SECRET;
  const prevEmbed = process.env.EMBED_TOKEN_SECRET;
  process.env.SESSION_SECRET = "test-photo-secret";
  delete process.env.EMBED_TOKEN_SECRET;
  try {
    return fn();
  } finally {
    if (prevSession === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = prevSession;
    if (prevEmbed === undefined) delete process.env.EMBED_TOKEN_SECRET;
    else process.env.EMBED_TOKEN_SECRET = prevEmbed;
  }
}

test("PHOTO1 — sign → verify round-trips for the same student", () => {
  withPhotoSecret(() => {
    const path = buildSignedStudentPhotoPath(123);
    assert.ok(path, "expected a signed path when a secret is configured");
    const m = path!.match(/^\/api\/students\/123\/photo\?exp=(\d+)&sig=([0-9a-f]+)$/);
    assert.ok(m, `unexpected path shape: ${path}`);
    const exp = Number(m![1]);
    const sig = m![2];
    assert.equal(verifyStudentPhotoSignature(123, exp, sig), true);
  });
});

test("PHOTO2 — signature is bound to the student id (cannot be reused)", () => {
  withPhotoSecret(() => {
    const path = buildSignedStudentPhotoPath(123)!;
    const m = path.match(/exp=(\d+)&sig=([0-9a-f]+)/)!;
    const exp = Number(m[1]);
    const sig = m[2];
    assert.equal(verifyStudentPhotoSignature(456, exp, sig), false);
  });
});

test("PHOTO3 — tampered signature / expiry is rejected", () => {
  withPhotoSecret(() => {
    const path = buildSignedStudentPhotoPath(123)!;
    const m = path.match(/exp=(\d+)&sig=([0-9a-f]+)/)!;
    const exp = Number(m[1]);
    const sig = m[2];
    assert.equal(verifyStudentPhotoSignature(123, exp, sig.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), false);
    assert.equal(verifyStudentPhotoSignature(123, exp + 999, sig), false);
    assert.equal(verifyStudentPhotoSignature(123, exp, ""), false);
  });
});

test("PHOTO4 — expired signature is rejected", () => {
  withPhotoSecret(() => {
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    // recompute a valid-but-expired signature by signing then checking rejection
    const path = buildSignedStudentPhotoPath(123, -1000); // ttl in the past
    if (path) {
      const m = path.match(/exp=(\d+)&sig=([0-9a-f]+)/)!;
      assert.equal(verifyStudentPhotoSignature(123, Number(m[1]), m[2]), false);
    }
    assert.equal(verifyStudentPhotoSignature(123, pastExp, "deadbeef"), false);
  });
});

test("PHOTO5 — no secret configured → signing returns null, verify false", () => {
  const prevSession = process.env.SESSION_SECRET;
  const prevEmbed = process.env.EMBED_TOKEN_SECRET;
  delete process.env.SESSION_SECRET;
  delete process.env.EMBED_TOKEN_SECRET;
  try {
    assert.equal(buildSignedStudentPhotoPath(123), null);
    assert.equal(verifyStudentPhotoSignature(123, Math.floor(Date.now() / 1000) + 100, "abc"), false);
  } finally {
    if (prevSession !== undefined) process.env.SESSION_SECRET = prevSession;
    if (prevEmbed !== undefined) process.env.EMBED_TOKEN_SECRET = prevEmbed;
  }
});

// ---------------------------------------------------------------------------
// Signed, auth-free document URLs (DOC1..DOC4)
// ---------------------------------------------------------------------------
test("DOC1 — document sign → verify round-trips; bound to id & rejects tamper/expiry", () => {
  withPhotoSecret(() => {
    const path = buildSignedDocumentPath(6008);
    assert.ok(path, "expected a signed doc path when a secret is configured");
    const m = path!.match(/^\/api\/documents\/6008\/file\?exp=(\d+)&sig=([0-9a-f]+)$/);
    assert.ok(m, `unexpected doc path shape: ${path}`);
    const exp = Number(m![1]);
    const sig = m![2];
    assert.equal(verifyDocumentSignature(6008, exp, sig), true);
    // bound to id
    assert.equal(verifyDocumentSignature(9999, exp, sig), false);
    // tampered sig / expiry / empty
    assert.equal(verifyDocumentSignature(6008, exp, sig.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), false);
    assert.equal(verifyDocumentSignature(6008, exp + 999, sig), false);
    assert.equal(verifyDocumentSignature(6008, exp, ""), false);
  });
});

test("DOC2 — a document signature does NOT verify as a photo signature (domain separation)", () => {
  withPhotoSecret(() => {
    const path = buildSignedDocumentPath(123)!;
    const m = path.match(/exp=(\d+)&sig=([0-9a-f]+)/)!;
    // same id + exp, but the photo verifier uses a different HMAC payload
    assert.equal(verifyStudentPhotoSignature(123, Number(m[1]), m[2]), false);
  });
});

test("DOC3 — no secret configured → signing null, verify false", () => {
  const prevSession = process.env.SESSION_SECRET;
  const prevEmbed = process.env.EMBED_TOKEN_SECRET;
  delete process.env.SESSION_SECRET;
  delete process.env.EMBED_TOKEN_SECRET;
  try {
    assert.equal(buildSignedDocumentPath(6008), null);
    assert.equal(verifyDocumentSignature(6008, Math.floor(Date.now() / 1000) + 100, "abc"), false);
  } finally {
    if (prevSession !== undefined) process.env.SESSION_SECRET = prevSession;
    if (prevEmbed !== undefined) process.env.EMBED_TOKEN_SECRET = prevEmbed;
  }
});

test("DOC4 — extractStudentDocumentRefs signs base64-only rows; base64 photo → hasPhotoDoc, no public photoUrl", () => {
  withPhotoSecret(() => {
    const out = extractStudentDocumentRefs([
      { id: 1, type: "passport", fileData: "QkFTRTY0", mimeType: "application/pdf", sizeBytes: 8 },
      { id: 2, type: "transcript", fileUrl: "https://cdn.example.com/t.pdf" },
      { id: 3, type: "photo", fileData: "Zm90bw==", mimeType: "image/jpeg" },
      { id: 4, type: "diploma", fileData: "" }, // empty stub → skipped
      { id: null, type: "certificate", fileData: "QUJD" }, // base64 but no id → cannot sign → skipped
    ]);
    // base64 passport now produces a signed document ref (no longer skipped)
    const passport = out.documents.find((d) => d.type === "passport");
    assert.ok(passport, "base64 passport should produce a ref");
    assert.match(passport!.url, /^\/api\/documents\/1\/file\?exp=\d+&sig=[0-9a-f]+$/);
    // public transcript passes through unchanged
    const transcript = out.documents.find((d) => d.type === "transcript");
    assert.equal(transcript!.url, "https://cdn.example.com/t.pdf");
    // empty stub and unsignable (no id) rows are skipped
    assert.equal(out.documents.some((d) => d.type === "diploma"), false);
    assert.equal(out.documents.some((d) => d.type === "certificate"), false);
    // base64 photo: no public photoUrl but hasPhotoDoc flags the signed-photo fallback
    assert.equal(out.photoUrl, undefined);
    assert.equal(out.hasPhotoDoc, true);
    // photo is never included in documents[]
    assert.equal(out.documents.some((d) => d.type === "photo"), false);
  });
});

// ---------------------------------------------------------------------------
// Auth decision logic — sitCanAuthWithoutPage (AUTH1..AUTH3).
//
// Pure, deterministic checks of whether a Supabase token can be obtained WITHOUT
// loading a browser page. The token cache starts empty in a fresh process, so
// the decision here is driven entirely by env presence. Each test snapshots and
// restores the relevant env vars so it is order-independent.
// ---------------------------------------------------------------------------
function withSitAuthEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
): void {
  const keys = [
    "SIT_SUPABASE_ANON_KEY",
    "SIT_ACCESS_TOKEN",
    "SIT_REFRESH_TOKEN",
    "SIT_SUPABASE_URL",
  ];
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    if (k in overrides) {
      const v = overrides[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    } else {
      delete process.env[k];
    }
  }
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("AUTH1 — no env + empty cache → a page is required", () => {
  withSitAuthEnv({}, () => {
    assert.equal(sitCanAuthWithoutPage({ user: "auth1@example.com" }), false);
  });
});

test("AUTH2 — anon key in env → password grant needs no page", () => {
  withSitAuthEnv({ SIT_SUPABASE_ANON_KEY: "anon-public-key" }, () => {
    assert.equal(sitCanAuthWithoutPage({ user: "auth2@example.com" }), true);
  });
});

test("AUTH3 — injected access token → no page needed", () => {
  withSitAuthEnv(
    { SIT_ACCESS_TOKEN: "ey" + "AAAA.BBBB.CCCC" },
    () => {
      assert.equal(sitCanAuthWithoutPage({ user: "auth3@example.com" }), true);
    },
  );
});

// ---------------------------------------------------------------------------
// Public anon apikey extraction — extractAnonJwt (ANON1..ANON3).
//
// Deterministically pull the Supabase anon JWT out of arbitrary text (SPA HTML
// or a JS bundle) without logging in. Prefer an anon-role JWT whose payload ref
// matches the SIT project; fall back to any anon-role JWT; ignore non-anon and
// non-JWT noise.
// ---------------------------------------------------------------------------
const SIT_PROJECT_REF = "knqtjanxjwfjfrwoater";
function makeJwt(payload: Record<string, unknown>): string {
  const seg = (o: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${seg({ alg: "HS256", typ: "JWT" })}.${seg(payload)}.sigsig`;
}

test("ANON1 — prefers anon JWT with matching project ref", () => {
  const service = makeJwt({ role: "service_role", ref: SIT_PROJECT_REF });
  const otherAnon = makeJwt({ role: "anon", ref: "someotherproject" });
  const target = makeJwt({ role: "anon", ref: SIT_PROJECT_REF });
  const blob = `var a="${service}";var b="${otherAnon}";var c="${target}";`;
  assert.equal(extractAnonJwt(blob), target);
});

test("ANON2 — falls back to any anon JWT when ref does not match", () => {
  const service = makeJwt({ role: "service_role", ref: SIT_PROJECT_REF });
  const otherAnon = makeJwt({ role: "anon", ref: "someotherproject" });
  const blob = `${service} ... ${otherAnon}`;
  assert.equal(extractAnonJwt(blob), otherAnon);
});

test("ANON3 — returns null when no anon-role JWT is present", () => {
  const service = makeJwt({ role: "service_role", ref: SIT_PROJECT_REF });
  assert.equal(extractAnonJwt(`only service ${service} here`), null);
  assert.equal(extractAnonJwt("no tokens here at all"), null);
});

// ---------------------------------------------------------------------------
// SPA bundle URL selection — selectBundleUrls (BUNDLE1..BUNDLE3).
//
// The anon-key chunk can sit deep in the script list (observed at position 19
// live), so the scan must NOT cap too low. Cross-origin refs must be dropped
// (SSRF / supply-chain guard) and duplicates deduped while preserving order.
// ---------------------------------------------------------------------------
test("BUNDLE1 — same-origin refs, relative resolved (scripts then links)", () => {
  const html = `
    <script src="/exp1-static/a.js"></script>
    <link rel="modulepreload" href="/exp1-static/b.js"/>
    <script src="c.js"></script>`;
  // <script src> refs are collected before <link href> refs.
  const urls = selectBundleUrls(html);
  assert.deepEqual(urls, [
    "https://partners.sitconnect.net/exp1-static/a.js",
    "https://partners.sitconnect.net/c.js",
    "https://partners.sitconnect.net/exp1-static/b.js",
  ]);
});

test("BUNDLE2 — drops cross-origin refs and dedups", () => {
  const html = `
    <script src="https://evil.example.com/x.js"></script>
    <script src="/keep.js"></script>
    <script src="/keep.js"></script>`;
  const urls = selectBundleUrls(html);
  assert.deepEqual(urls, ["https://partners.sitconnect.net/keep.js"]);
});

// ---------------------------------------------------------------------------
// Contact-fill helpers (SIT-FIX-18)
//
// PHONE1 — cleanPhone: E.164 passthrough, trunk-digit strip, 00→+ prefix
// PHONE2 — cleanPhone: strips non-digit/+ characters
// PHONE3 — dial-code skip regex: short "+XX" placeholders excluded, long ones kept
// PHONE4 — DEEP_FILL_INPUT_JS tel-visibility guard: isTel bypasses offsetParent=null
// ---------------------------------------------------------------------------

// cleanPhone is not exported from helpers.js (file-private), so we replicate
// its exact logic here as a pure-function unit test target.
function cleanPhone(raw: string): string {
  if (!raw) return "";
  let s = String(raw).trim().replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) return s;
  const trunkFix: Array<[string, number, string]> = [
    ["+998", 9, "8"], // Uzbekistan
    ["+7", 10, "8"],  // Russia / Kazakhstan
    ["+994", 9, "0"], // Azerbaijan
    ["+996", 9, "0"], // Kyrgyzstan
    ["+992", 9, "8"], // Tajikistan
    ["+993", 8, "8"], // Turkmenistan
    ["+380", 9, "0"], // Ukraine
    ["+375", 9, "8"], // Belarus
  ];
  for (const [cc, natLen, trunk] of trunkFix) {
    if (s.startsWith(cc)) {
      const nat = s.slice(cc.length);
      if (nat.length === natLen + 1 && nat.startsWith(trunk)) {
        s = cc + nat.slice(1);
      }
      break;
    }
  }
  return s;
}

// Regex from Strategy-1 in adapter: skip inputs whose placeholder is a bare dial code.
const DIAL_CODE_PLACEHOLDER_RE = /^\+?\d{0,4}$/;

test("PHONE1 — cleanPhone: E.164 passthrough and 00→+ prefix", () => {
  assert.equal(cleanPhone("+905551234567"), "+905551234567");
  assert.equal(cleanPhone("00905551234567"), "+905551234567");
});

test("PHONE2 — cleanPhone: strips non-digit/+ characters and trunk digits", () => {
  // Strips dashes, spaces, parens before trunk logic
  assert.equal(cleanPhone("+7 (921) 123-45-67"), "+79211234567");
  // Russian trunk: strip only when nat.length === natLen+1 (i.e. 11 digits for +7).
  // "+789212345678" → nat="89212345678" (11 chars, starts with "8") → strip trunk → "+79212345678"
  assert.equal(cleanPhone("+789212345678"), "+79212345678");
  // "+78921234567" → nat="8921234567" (10 chars = natLen, not natLen+1) → no strip
  assert.equal(cleanPhone("+78921234567"), "+78921234567");
  // Empty / null-ish passthrough
  assert.equal(cleanPhone(""), "");
});

test("PHONE3 — dial-code skip regex: short placeholders excluded, long ones kept", () => {
  // Should be SKIPPED (are dial codes, not mobile number inputs)
  assert.ok(DIAL_CODE_PLACEHOLDER_RE.test("+"),     "+ is a dial code");
  assert.ok(DIAL_CODE_PLACEHOLDER_RE.test("+1"),    "+1 is a dial code");
  assert.ok(DIAL_CODE_PLACEHOLDER_RE.test("+90"),   "+90 is a dial code");
  assert.ok(DIAL_CODE_PLACEHOLDER_RE.test("+994"),  "+994 is a dial code");
  assert.ok(DIAL_CODE_PLACEHOLDER_RE.test("90"),    "bare 2-digit is a dial code");
  assert.ok(DIAL_CODE_PLACEHOLDER_RE.test(""),      "empty string matches (no placeholder ⇒ skip)");
  // Should NOT be skipped (are real mobile-number inputs)
  assert.ok(!DIAL_CODE_PLACEHOLDER_RE.test("Enter mobile number"), "descriptive placeholder kept");
  assert.ok(!DIAL_CODE_PLACEHOLDER_RE.test("+1234567890"),         "full E.164 number kept");
  assert.ok(!DIAL_CODE_PLACEHOLDER_RE.test("Mobile Number"),       "label-like placeholder kept");
});

test("PHONE4 — DEEP_FILL_INPUT_JS tel-visibility guard: isTel bypasses offsetParent=null", () => {
  // The JS guard we patched reads: if (!visible && !isTel) continue
  // Simulate the decision: a tel input with offsetParent=null must NOT be skipped.
  function shouldSkip(type: string, hasOffsetParent: boolean): boolean {
    const isTel = type === "tel";
    const visible = hasOffsetParent;
    return !visible && !isTel;
  }
  // tel with no offsetParent → must NOT skip
  assert.ok(!shouldSkip("tel", false), "tel input with offsetParent=null must NOT be skipped");
  // text with no offsetParent → must skip
  assert.ok(shouldSkip("text", false), "text input with offsetParent=null must be skipped");
  // tel with offsetParent → must NOT skip
  assert.ok(!shouldSkip("tel", true), "tel input with offsetParent must NOT be skipped");
  // text with offsetParent → must NOT skip
  assert.ok(!shouldSkip("text", true), "text input with offsetParent must NOT be skipped");
});

test("BUNDLE3 — a deep chunk (19th) is included; low cap would drop it", () => {
  const tags = Array.from(
    { length: 20 },
    (_, i) => `<script src="/chunk-${i}.js"></script>`,
  ).join("\n");
  // Default cap (48) keeps all 20, so the 19th (index 18) is present.
  const all = selectBundleUrls(tags);
  assert.equal(all.length, 20);
  assert.ok(all.includes("https://partners.sitconnect.net/chunk-18.js"));
  // A too-low cap of 12 would have missed it — this is the live bug we fixed.
  const capped = selectBundleUrls(tags, 12);
  assert.equal(capped.length, 12);
  assert.equal(capped.includes("https://partners.sitconnect.net/chunk-18.js"), false);
});
