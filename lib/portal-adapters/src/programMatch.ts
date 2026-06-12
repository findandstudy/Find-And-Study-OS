// ---------------------------------------------------------------------------
// fold — canonical string normalisation for program-name matching
//
// Order of operations (CRITICAL — do NOT reorder):
//   1. Turkish-specific char replacements BEFORE toLowerCase
//   2. toLowerCase
//   3. NFKD Unicode normalisation
//   4. Strip combining diacritics (0300-036F)
//   5. Replace any non-alphanumeric run with a single space
//   6. Trim & collapse interior whitespace
// ---------------------------------------------------------------------------
export function fold(s: string): string {
  return s
    // --- Step 1: Turkish chars → ASCII equivalents (must be BEFORE toLowerCase) ---
    .replace(/İ/g, "i")   // capital dotted I  → i
    .replace(/I/g,  "i")  // capital I (undotted, Turkish uppercase of ı) → i
    .replace(/ı/g,  "i")  // lowercase dotless i → i
    .replace(/Ş/g,  "s").replace(/ş/g, "s")
    .replace(/Ç/g,  "c").replace(/ç/g, "c")
    .replace(/Ö/g,  "o").replace(/ö/g, "o")
    .replace(/Ü/g,  "u").replace(/ü/g, "u")
    .replace(/Ğ/g,  "g").replace(/ğ/g, "g")
    // --- Step 2: to lower ---
    .toLowerCase()
    // --- Step 3: NFKD decomposition ---
    .normalize("NFKD")
    // --- Step 4: strip combining diacritics ---
    .replace(/[\u0300-\u036f]/g, "")
    // --- Step 5: non-alphanumeric → space ---
    .replace(/[^a-z0-9]+/g, " ")
    // --- Step 6: trim & collapse ---
    .trim()
    .replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ProgramCandidate {
  id: string;
  name: string;
}

export interface MatchResult {
  match: ProgramCandidate;
  conf: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CONF_THRESHOLD   = 0.6;
const MARGIN_THRESHOLD = 0.15;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Split folded string into tokens (keep only tokens with length > 1). */
function tokenize(s: string): Set<string> {
  return new Set(fold(s).split(" ").filter(t => t.length > 1));
}

/** Jaccard similarity between two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** True when the folded string indicates a thesis (tezli) programme. */
function hasTez(f: string): boolean    { return /\btezli\b/.test(f); }
/** True when the folded string indicates a non-thesis (tezsiz) programme. */
function hasTezsiz(f: string): boolean { return /\btezsiz\b/.test(f); }
/** True when the programme is taught in English. */
function hasEnglish(f: string): boolean {
  return /\b(ingilizce|english)\b/.test(f);
}

// ---------------------------------------------------------------------------
// Degree / thesis / language hard filter
//
// Applied BEFORE Jaccard scoring.  If applying a filter would eliminate all
// candidates the filter is skipped (open-world assumption for incomplete data).
// ---------------------------------------------------------------------------
function applyHardFilters(
  queryFolded: string,
  candidates: ProgramCandidate[],
): ProgramCandidate[] {
  let pool = candidates;

  // Thesis mode
  if (hasTez(queryFolded) && !hasTezsiz(queryFolded)) {
    const f = pool.filter(c => hasTez(fold(c.name)));
    if (f.length > 0) pool = f;
  } else if (hasTezsiz(queryFolded)) {
    const f = pool.filter(c => hasTezsiz(fold(c.name)));
    if (f.length > 0) pool = f;
  }

  // Language: English-medium
  if (hasEnglish(queryFolded)) {
    const f = pool.filter(c => hasEnglish(fold(c.name)));
    if (f.length > 0) pool = f;
  }

  return pool;
}

// ---------------------------------------------------------------------------
// matchProgram — main entry point
//
// Resolution order:
//   1. programMap[programId] → conf 1.0 (manual override)
//   2. Hard degree/thesis/language filter
//   3. Token-Jaccard scoring
//   4. Confidence gate: conf ≥ 0.6 AND (single candidate OR margin ≥ 0.15)
// ---------------------------------------------------------------------------
export function matchProgram(
  programName: string,
  candidates: ProgramCandidate[],
  programId?: string,
  programMap?: Record<string, string>,
): MatchResult | null {

  // --- 1. Manual override (highest confidence) ---
  if (programId && programMap) {
    const override = programMap[programId];
    if (override !== undefined) {
      const found =
        candidates.find(c => c.id === override) ??
        candidates.find(c => fold(c.name) === fold(override));
      if (found) return { match: found, conf: 1.0 };
    }
  }

  if (candidates.length === 0) return null;

  // --- 2. Hard filters ---
  const queryFolded = fold(programName);
  const pool = applyHardFilters(queryFolded, candidates);

  // --- 3. Token-Jaccard scoring ---
  const queryTokens = tokenize(programName);

  type Scored = { candidate: ProgramCandidate; conf: number };
  const scored: Scored[] = pool
    .map(c => ({ candidate: c, conf: jaccard(queryTokens, tokenize(c.name)) }))
    .filter(x => x.conf >= CONF_THRESHOLD)
    .sort((a, b) => b.conf - a.conf);

  if (scored.length === 0) return null;

  // --- 4. Confidence gate ---
  if (scored.length === 1) {
    return { match: scored[0].candidate, conf: scored[0].conf };
  }

  const margin = scored[0].conf - scored[1].conf;
  if (margin >= MARGIN_THRESHOLD) {
    return { match: scored[0].candidate, conf: scored[0].conf };
  }

  // Two or more candidates within 0.15 of each other — refuse to guess
  return null;
}
