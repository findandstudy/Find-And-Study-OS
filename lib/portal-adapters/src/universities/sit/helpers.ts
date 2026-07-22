// ---------------------------------------------------------------------------
// SIT portal — pure helpers (no browser, fully unit-testable)
//
//   normalizeGpa        — coerce CRM GPA (decimal or Cambridge letter) → integer
//   mapEducationLevel   — CRM level → canonical SIT degree label
//   formatSitDate       — ISO-8601 → DD/MM/YYYY
//   matchAllowedUniversity — allowlist-guarded university resolver (IDOR-safe)
//   isLanguageCompatible   — program language-of-instruction compatibility
// ---------------------------------------------------------------------------

import { fold } from "../../programMatch.js";

// ---------------------------------------------------------------------------
// SIT allowlist — EXACTLY 11 universities (do not add/remove without sign-off).
//
// Agreed list. Note vs. the old stub:
//   + Beykoz Üniversitesi          (ADDED)
//   - İstanbul Yeni Yüzyıl Ünv.    (REMOVED)
//
// Exact-name guards (handled by token-subset matching below):
//   - "İstanbul Aydın" must NOT match "Kıbrıs/Cyprus Aydın".
//   - "İstanbul Kent" must NOT match "Beykent".
//   - "Ankara Medipol" must NOT match "İstanbul Medipol".
// ---------------------------------------------------------------------------
export const SIT_ALLOWLIST: readonly string[] = [
  "Haliç Üniversitesi",
  "İstanbul Atlas Üniversitesi",
  "Ankara Medipol Üniversitesi",
  "Galata Üniversitesi",
  "Beykoz Üniversitesi",
  "İstinye Üniversitesi",
  "İstanbul Aydın Üniversitesi",
  "İstanbul Kent Üniversitesi",
  "Fenerbahçe Üniversitesi",
  "İstanbul Kültür Üniversitesi",
  "İstanbul Gelişim Üniversitesi",
  "TED Üniversitesi",
] as const;

// ---------------------------------------------------------------------------
// Cambridge / A-Level letter grade → integer (SIT GPA field is an integer).
// ---------------------------------------------------------------------------
const CAMBRIDGE_GRADE: Readonly<Record<string, number>> = {
  "A*": 90,
  A: 80,
  B: 70,
  C: 60,
  D: 50,
  E: 40,
};

/**
 * Normalize a CRM GPA value to the integer SIT expects.
 *
 *   - number            → rounded to nearest integer
 *   - "3.6" / "3,6"     → 4   (decimal, comma or dot)
 *   - "A*"/"A".."E"     → Cambridge table (case-insensitive)
 *   - undefined / "" / unparseable → undefined (caller decides default)
 */
export function normalizeGpa(
  value: number | string | undefined | null,
): number | undefined {
  if (value === undefined || value === null) return undefined;

  // Zoho'nun GPA alanları TAM SAYI ve 0-100 aralığı bekler (ondalık değerler
  // "INVALID_DATA: High_School_GPA" ile reddediliyor) — yuvarla VE sıkıştır.
  const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

  if (typeof value === "number") {
    return Number.isFinite(value) ? clamp(value) : undefined;
  }

  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const letter = trimmed.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(CAMBRIDGE_GRADE, letter)) {
    return CAMBRIDGE_GRADE[letter];
  }

  const num = Number(trimmed.replace(",", "."));
  return Number.isFinite(num) ? clamp(num) : undefined;
}

// ---------------------------------------------------------------------------
// CRM degree level → canonical SIT degree label.
// The combobox matcher fuzzy-matches this against the live option text.
// ---------------------------------------------------------------------------
export function mapEducationLevel(level: string | undefined | null): string {
  const f = fold(level ?? "");
  if (/doktora|phd|doctora|doctoral/.test(f)) return "PhD";
  if (/yukseklisans|yuksek lisans|master|graduate/.test(f)) return "Master";
  if (/onlisans|on lisans|associate/.test(f)) return "Associate";
  return "Bachelor";
}

// ---------------------------------------------------------------------------
// ISO-8601 date (YYYY-MM-DD) → DD/MM/YYYY. Returns "" for unparseable input.
// ---------------------------------------------------------------------------
export function formatSitDate(iso: string | undefined | null): string {
  const m = String(iso ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ---------------------------------------------------------------------------
// Turkish → English nationality/country name.
//
// The CRM stores nationality in Turkish ("Özbekistan"), but the SIT wizard's
// Nationality <select> carries ONLY English option text ("Uzbekistan", …).
// Matching the Turkish name against the English options fails and the required
// field stays unset, so the step is rejected. Translate to English right before
// matching; the raw name is kept as a same-call fallback candidate in case an
// option ever reverts to Turkish.
// ---------------------------------------------------------------------------
function foldTr(s: string): string {
  return s
    .replace(/İ/g, "i").replace(/I/g, "i").replace(/ı/g, "i")
    .replace(/Ş/g, "s").replace(/ş/g, "s")
    .replace(/Ğ/g, "g").replace(/ğ/g, "g")
    .replace(/Ü/g, "u").replace(/ü/g, "u")
    .replace(/Ö/g, "o").replace(/ö/g, "o")
    .replace(/Ç/g, "c").replace(/ç/g, "c")
    .toLowerCase()
    .trim();
}

const TR_TO_EN_COUNTRY: Readonly<Record<string, string>> = {
  turkiye: "Turkey",
  afganistan: "Afghanistan",
  kazakistan: "Kazakhstan",
  ozbekistan: "Uzbekistan",
  turkmenistan: "Turkmenistan",
  azerbaycan: "Azerbaijan",
  nijerya: "Nigeria",
  misir: "Egypt",
  suriye: "Syria",
  irak: "Iraq",
  iran: "Iran",
  urdun: "Jordan",
  filistin: "Palestine",
  fas: "Morocco",
  cezayir: "Algeria",
  tunus: "Tunisia",
  libya: "Libya",
  sudan: "Sudan",
  somali: "Somalia",
  etiyopya: "Ethiopia",
  kenya: "Kenya",
  gana: "Ghana",
  kamerun: "Cameroon",
  kirgizistan: "Kyrgyzstan",
  tacikistan: "Tajikistan",
  hindistan: "India",
  bangladesh: "Bangladesh",
  endonezya: "Indonesia",
  malezya: "Malaysia",
  filipinler: "Philippines",
  pakistan: "Pakistan",
  yemen: "Yemen",
  rusya: "Russia",
  ukrayna: "Ukraine",
  almanya: "Germany",
  fransa: "France",
  ingiltere: "United Kingdom",
  cin: "China",
  "guney afrika": "South Africa",
  mogolistan: "Mongolia",
  nepal: "Nepal",
  arnavutluk: "Albania",
  kosova: "Kosovo",
  bahreyn: "Bahrain",
  "birlesik krallik": "United Kingdom",
  "amerika birlesik devletleri": "United States",
  "birlesik arap emirlikleri": "United Arab Emirates",
  kuveyt: "Kuwait",
  lubnan: "Lebanon",
  umman: "Oman",
  katar: "Qatar",
  "suudi arabistan": "Saudi Arabia",
  tanzanya: "Tanzania",
};

/**
 * Translate a (possibly Turkish) nationality/country name to English. Returns
 * the original name unchanged when no mapping exists, so a name that is already
 * English (or unmapped) still falls through to the caller's own matching.
 */
export function toEnglishCountryName(name: string | undefined | null): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "";
  return TR_TO_EN_COUNTRY[foldTr(raw)] ?? raw;
}

// ---------------------------------------------------------------------------
// Allowlist matching — exact token-set equality, IDOR-safe.
//
// An allowlist entry matches a query iff their DISTINCTIVE token sets are
// equal (order-independent). Generic tokens ("üniversitesi", "university")
// are stripped first so they never affect the decision.
//
// Exact-set equality (not mere subset) is required for safety: a subset rule
// would let a single-token entry like "Beykoz" match a DIFFERENT institution
// such as "Beykoz Lojistik MYO" (which merely contains the token "beykoz").
// It also still correctly rejects look-alikes — "Beykent" ({beykent}) never
// equals "Kent" ({kent}); "İstanbul Medipol" ({istanbul,medipol}) never
// equals "Ankara Medipol" ({ankara,medipol}).
// ---------------------------------------------------------------------------
const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  "universitesi",
  "university",
  "univ",
]);

/**
 * The Turkish-folded distinctive tokens of a university name (generic tokens
 * like "university"/"üniversitesi" removed). Exported so the adapter can match
 * SIT's live combobox option text against the same folded token basis.
 */
export function distinctiveTokens(name: string): string[] {
  return fold(name)
    .split(" ")
    .filter((t) => t.length > 1 && !GENERIC_TOKENS.has(t));
}

const SIT_ALLOWLIST_TOKENS: ReadonlyArray<{ name: string; tokens: string[] }> =
  SIT_ALLOWLIST.map((name) => ({ name, tokens: distinctiveTokens(name) }));

/**
 * Resolve a free-form university name to its canonical allowlist entry, or
 * null when the name is not one of the 11 agreed universities.
 *
 * Two tiers, both operating on Turkish-folded distinctive tokens:
 *
 *   Tier 1 — EXACT token-set equality (highest confidence). Full catalog names
 *   ("İstanbul Aydın Üniversitesi" → {istanbul, aydin}) match their allowlist
 *   entry outright.
 *
 *   Tier 2 — FLEXIBLE subset: the query's tokens are a subset of exactly ONE
 *   allowlist entry's tokens. This resolves short portal names ("Aydin
 *   University" → {aydin}) to their full catalog entry ("İstanbul Aydın
 *   Üniversitesi" → {istanbul, aydin}) WITHOUT the IDOR risk of the reverse
 *   direction: we never let a query carrying EXTRA tokens (e.g. "Beykoz
 *   Lojistik MYO" → {beykoz, lojistik, myo}) match a shorter entry ("Beykoz" →
 *   {beykoz}). Requiring a UNIQUE containing entry also rejects ambiguous bare
 *   tokens shared by several entries (e.g. {istanbul} alone → 3 entries → no
 *   match), while look-alikes stay rejected ({cyprus, aydin} ⊄ {istanbul,
 *   aydin}; {beykent} ⊄ {istanbul, kent}; {istanbul, medipol} ⊄ {ankara,
 *   medipol}).
 */
export function matchAllowedUniversity(name: string): string | null {
  const queryTokens = new Set(distinctiveTokens(name));
  if (queryTokens.size === 0) return null;

  // Tier 1 — exact token-set equality: same size AND every entry token present.
  for (const entry of SIT_ALLOWLIST_TOKENS) {
    if (entry.tokens.length === 0) continue;
    if (
      entry.tokens.length === queryTokens.size &&
      entry.tokens.every((t) => queryTokens.has(t))
    ) {
      return entry.name;
    }
  }

  // Tier 2 — flexible subset: every query token appears in the entry, and this
  // holds for exactly one allowlist entry (unambiguous short-name resolution).
  const subsetMatches = SIT_ALLOWLIST_TOKENS.filter(
    (entry) =>
      entry.tokens.length > 0 &&
      [...queryTokens].every((t) => entry.tokens.includes(t)),
  );
  if (subsetMatches.length === 1) {
    return subsetMatches[0].name;
  }

  return null;
}

/** True when `name` is one of the 11 allowed SIT universities. */
export function isAllowedUniversity(name: string): boolean {
  return matchAllowedUniversity(name) !== null;
}

// ---------------------------------------------------------------------------
// SIT membership (FAS) — authoritative "should this go through SIT?" check.
//
// Being present in the SIT CATALOG (zoho_universities / zoho_programs) is NOT
// membership. Membership = the universities FAS actually applies to VIA the SIT
// channel — the agreed SIT_ALLOWLIST above (derived from FAS's routing matrix).
// Direct-access universities that FAS applies to through their OWN panels
// (e.g. Altınbaş / İstanbul Okan / Üsküdar) are intentionally ABSENT and must
// never be pushed into SIT.
//
// An optional env var SIT_MEMBER_UNIVERSITIES (comma / semicolon / newline
// separated university names) EXTENDS — never shrinks — this set without a code
// change.
//
// TODO(Dr. Namazcı): confirm the definitive SIT member university list.
// ---------------------------------------------------------------------------
export function isSitMember(
  universityNameOrId: string | null | undefined,
  dynamicMembers?: readonly string[],
): boolean {
  if (universityNameOrId == null) return false;
  const name = String(universityNameOrId).trim();
  if (name === "") return false;

  // Authoritative agreed list (token-set matched, IDOR-safe).
  if (isAllowedUniversity(name)) return true;

  // Dynamic DB "Members" list (portal_account_universities, panel-managed) —
  // matched the same token-set way so a university added via the panel is
  // recognized without a code change. UNION with the agreed list — never
  // removes a member the agreed list already grants (see module doc).
  if (dynamicMembers && dynamicMembers.length > 0) {
    const queryTokens = new Set(distinctiveTokens(name));
    for (const entry of dynamicMembers) {
      if (fold(entry) === fold(name)) return true;
      const entryTokens = distinctiveTokens(entry);
      if (
        entryTokens.length > 0 &&
        entryTokens.length === queryTokens.size &&
        entryTokens.every((t) => queryTokens.has(t))
      ) {
        return true;
      }
    }
  }

  // Optional env extension — kept a UNION with the agreed list so it can only
  // ADD members, never remove one.
  const extra = (process.env.SIT_MEMBER_UNIVERSITIES ?? "")
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (extra.length === 0) return false;

  const folded = fold(name);
  const queryTokens = new Set(distinctiveTokens(name));
  for (const entry of extra) {
    if (fold(entry) === folded) return true;
    const entryTokens = distinctiveTokens(entry);
    if (
      entryTokens.length > 0 &&
      entryTokens.length === queryTokens.size &&
      entryTokens.every((t) => queryTokens.has(t))
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Program language-of-instruction compatibility.
//
// SIT program names commonly carry the language ("... (English)" / "İngilizce"
// / "Türkçe"). When the desired program names a language, an option is only
// compatible if it names the same language (or names none — open-world). This
// prevents picking a Turkish-medium program for an English request and vice
// versa, on top of programMatch's own English hard filter.
// ---------------------------------------------------------------------------
type Lang = "en" | "tr" | "other" | null;

function detectLang(folded: string): Lang {
  if (/\b(ingilizce|english)\b/.test(folded)) return "en";
  if (/\b(turkce|turkish)\b/.test(folded)) return "tr";
  if (/\b(almanca|german|fransizca|french|arapca|arabic|rusca|russian)\b/.test(folded)) {
    return "other";
  }
  return null;
}

/**
 * True when `candidateName`'s language is compatible with `desiredName`'s.
 * Compatible when: the desired program names no language, OR the candidate
 * names no language, OR both name the same language.
 */
export function isLanguageCompatible(
  desiredName: string,
  candidateName: string,
): boolean {
  const want = detectLang(fold(desiredName));
  if (want === null) return true;
  const have = detectLang(fold(candidateName));
  if (have === null) return true;
  return want === have;
}
