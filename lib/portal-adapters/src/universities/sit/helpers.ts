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
  "Atlas Üniversitesi",
  "Ankara Medipol Üniversitesi",
  "Galata Üniversitesi",
  "Beykoz Üniversitesi",
  "İstinye Üniversitesi",
  "İstanbul Aydın Üniversitesi",
  "İstanbul Kent Üniversitesi",
  "Fenerbahçe Üniversitesi",
  "İstanbul Kültür Üniversitesi",
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

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : undefined;
  }

  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const letter = trimmed.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(CAMBRIDGE_GRADE, letter)) {
    return CAMBRIDGE_GRADE[letter];
  }

  const num = Number(trimmed.replace(",", "."));
  return Number.isFinite(num) ? Math.round(num) : undefined;
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

function distinctiveTokens(name: string): string[] {
  return fold(name)
    .split(" ")
    .filter((t) => t.length > 1 && !GENERIC_TOKENS.has(t));
}

const SIT_ALLOWLIST_TOKENS: ReadonlyArray<{ name: string; tokens: string[] }> =
  SIT_ALLOWLIST.map((name) => ({ name, tokens: distinctiveTokens(name) }));

/**
 * Resolve a free-form university name to its canonical allowlist entry, or
 * null when the name is not one of the 11 agreed universities.
 */
export function matchAllowedUniversity(name: string): string | null {
  const queryTokens = new Set(distinctiveTokens(name));
  if (queryTokens.size === 0) return null;

  for (const entry of SIT_ALLOWLIST_TOKENS) {
    if (entry.tokens.length === 0) continue;
    // Exact token-set equality: same size AND every entry token present.
    if (
      entry.tokens.length === queryTokens.size &&
      entry.tokens.every((t) => queryTokens.has(t))
    ) {
      return entry.name;
    }
  }
  return null;
}

/** True when `name` is one of the 11 allowed SIT universities. */
export function isAllowedUniversity(name: string): boolean {
  return matchAllowedUniversity(name) !== null;
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
