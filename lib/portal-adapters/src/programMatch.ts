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
//   7. Compound-word normalisation (runs on clean ASCII from step 6)
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
    .replace(/\s+/g, " ")
    // --- Step 7: Compound-word normalisation ---
    // "yuksek lisans" is the Turkish two-word spelling of "Yüksek Lisans"
    // (master's degree). Without merging, the token "lisans" maps to the
    // ["lisans", "bachelor", "undergraduate"] synonym group, causing master's
    // portal options to score as near-matches for bachelor queries (and vice
    // versa). Merging into the single token "yukseklisans" correctly picks up
    // the ["yukseklisans", "master", "masters", "graduate"] synonym group.
    .replace(/\byuksek lisans\b/g, "yukseklisans");
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
// EN↔TR synonym groups (sourced from data/fields.json)
//
// Each inner array is an equivalence class of folded tokens.
// When scoring Jaccard, if no primary match is found, tokens are expanded
// with all synonyms from their group before re-scoring (see expandTokens).
// ---------------------------------------------------------------------------
const SYNONYM_GROUPS: readonly string[][] = [
  ["bilgisayar", "computer", "computing"],
  ["muhendislik", "muhendisligi", "engineering"],
  ["isletme", "business", "management", "yonetim"],
  ["ekonomi", "economics"],
  ["iletisim", "communication", "communications"],
  ["hukuk", "law"],
  ["tip", "medicine", "medical", "tibbi"],
  ["mimarlik", "architecture", "architectural"],
  ["psikoloji", "psychology"],
  ["egitim", "education"],
  ["matematik", "mathematics", "math"],
  ["fizik", "physics"],
  ["kimya", "chemistry"],
  ["biyoloji", "biology"],
  ["sosyoloji", "sociology"],
  ["tarih", "history"],
  ["cografi", "geography"],
  ["felsefe", "philosophy"],
  ["sanat", "art", "arts"],
  ["muzik", "music"],
  ["tiyatro", "theater", "theatre"],
  ["uluslararasi", "international"],
  ["iliskiler", "relations"],
  ["siyasi", "political"],
  ["bilim", "science", "sciences"],
  ["yazilim", "software"],
  ["endustri", "industrial"],
  ["makine", "mechanical"],
  ["insaat", "civil", "construction"],
  ["elektrik", "electrical", "electric"],
  ["elektronik", "electronics", "electronic"],
  ["cevre", "environmental", "environment"],
  ["malzeme", "materials"],
  ["tekstil", "textile"],
  ["gida", "food"],
  ["tarim", "agriculture", "agricultural"],
  ["orman", "forestry", "forest"],
  ["basin", "media"],
  ["finans", "finance", "financial"],
  ["bankacilik", "banking"],
  ["muhasebe", "accounting"],
  ["saglik", "health"],
  ["hemsirelik", "nursing"],
  ["eczacilik", "pharmacy", "pharmaceutical"],
  ["teknoloji", "teknolojisi", "technology"],
  ["yonetim", "administration", "management"],
  ["halkla", "public"],
  ["grafik", "graphic"],
  ["tasarim", "design"],
  ["fotograf", "photography"],
  ["sinema", "cinema", "film"],
  ["gazetecilik", "journalism"],
  ["turizm", "tourism", "hospitality"],
  ["spor", "sports", "sport"],
  ["sosyal", "social"],
  ["siyaset", "politics", "political"],
  // Language-of-instruction synonyms (portal uses Turkish language names)
  ["ingilizce", "english"],
  ["turkce", "turkish"],
  ["fransizca", "french"],
  ["almanca", "german"],
  ["arapca", "arabic"],
  ["rusca", "russian"],
  // Degree-level synonyms
  ["lisans", "bachelor", "undergraduate"],
  ["onlisans", "associate"],
  ["yukseklisans", "master", "masters", "graduate"],  // NOTE: fold() merges "yuksek lisans" → "yukseklisans" (Step 7)
  ["doktora", "doctorate", "phd", "doctoral"],
  // Thesis mode synonyms (used by hasTez / hasTezsiz hard filters)
  ["tezli", "thesis"],
  ["tezsiz", "nothesis"],   // "non-thesis" → after fold step 5 becomes "non thesis" → two tokens; kept for safety
  // Subject-area additions (found in Topkapi programs not covered above)
  ["ticaret", "trade", "commerce", "commercial"],
  ["bilisim", "informatics", "information", "systems"],
  ["sistemleri", "systems"],
];

/** Build a token→synonyms map from equivalence-class groups. */
function buildSynonymMap(
  groups: readonly (readonly string[])[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const term of group) {
      const synonyms = map.get(term) ?? new Set<string>();
      for (const other of group) {
        if (other !== term) synonyms.add(other);
      }
      map.set(term, synonyms);
    }
  }
  return map;
}

/** Default token → Set<synonyms>, built once at module load from SYNONYM_GROUPS. */
const _synonymMap = buildSynonymMap(SYNONYM_GROUPS);

/**
 * Expand a token set by adding all dictionary synonyms of each token.
 *
 * @param synonymMap token→synonyms map. Defaults to the built-in map; callers
 *                   that pass DB-supplied groups receive a merged map so panel
 *                   synonyms EXTEND (never replace) the proven defaults.
 */
function expandTokens(
  tokens: Set<string>,
  synonymMap: ReadonlyMap<string, Set<string>>,
): Set<string> {
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    const syns = synonymMap.get(t);
    if (syns) {
      for (const s of syns) expanded.add(s);
    }
  }
  return expanded;
}

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
// scorePool — score candidates with optional token expansion
// ---------------------------------------------------------------------------
type Scored = { candidate: ProgramCandidate; conf: number };

function scorePool(
  queryTokens: Set<string>,
  pool: ProgramCandidate[],
  expand: boolean,
  synonymMap: ReadonlyMap<string, Set<string>>,
): Scored[] {
  const qt = expand ? expandTokens(queryTokens, synonymMap) : queryTokens;
  return pool
    .map(c => {
      const ct = expand ? expandTokens(tokenize(c.name), synonymMap) : tokenize(c.name);
      return { candidate: c, conf: jaccard(qt, ct) };
    })
    .filter(x => x.conf >= CONF_THRESHOLD)
    .sort((a, b) => b.conf - a.conf);
}

// ---------------------------------------------------------------------------
// matchProgram — main entry point
//
// Resolution order:
//   1. programMap[programId] → conf 1.0 (manual override)
//   2. Hard degree/thesis/language filter
//   3. Token-Jaccard scoring (primary — no expansion)
//   4. EN↔TR synonym expansion (fallback — only when step 3 finds NO candidates)
//   5. Confidence gate: conf ≥ 0.6 AND (single candidate OR margin ≥ 0.15)
// ---------------------------------------------------------------------------
export function matchProgram(
  programName: string,
  candidates: ProgramCandidate[],
  programId?: string,
  programMap?: Record<string, string>,
  synonyms?: readonly (readonly string[])[],
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

  // --- 3. Primary Jaccard (no expansion) ---
  // Synonym map: built-in groups, optionally extended with DB-supplied groups
  // (panel-managed). DB groups EXTEND the proven defaults — they never remove
  // built-in coverage. With no extras the shared default map is reused (zero
  // allocation, behaviour identical to before this parameter existed).
  const synonymMap =
    synonyms && synonyms.length > 0
      ? buildSynonymMap([...SYNONYM_GROUPS, ...synonyms])
      : _synonymMap;

  const queryTokens = tokenize(programName);
  let scored = scorePool(queryTokens, pool, false, synonymMap);

  // --- 4. EN↔TR expansion fallback ---
  // Only triggered when NO primary candidate scores ≥ CONF_THRESHOLD.
  // Deliberately NOT triggered for the ambiguity case (margin < 0.15) —
  // that ambiguity result is intentional and must not be overridden.
  if (scored.length === 0) {
    scored = scorePool(queryTokens, pool, true, synonymMap);
  }

  if (scored.length === 0) return null;

  // --- 5. Confidence gate ---
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
