---
name: SIT flexible university matching
description: How SIT resolves free-form/short university names to its 11-entry allowlist and its live combobox, Turkish-aware and IDOR-safe.
---

# SIT flexible university matching

`matchAllowedUniversity(name)` (helpers.ts) resolves a free-form name to a
canonical allowlist entry using two tiers over Turkish-FOLDED distinctive
tokens (`distinctiveTokens`, generic tokens like university/üniversitesi
stripped):

1. **Tier 1 — exact token-set equality** (same size + all present).
2. **Tier 2 — flexible subset**: query tokens ⊆ EXACTLY ONE allowlist entry.
   Resolves short portal names ("Aydin University" → {aydin}) to the full
   catalog entry ("İstanbul Aydın Üniversitesi" → {istanbul, aydin}).

**Why the "exactly one" + subset direction matters (IDOR safety):**
- Query-⊆-entry (not the reverse) blocks extra-token attacks: "Beykoz Lojistik
  MYO" → {beykoz, lojistik, myo} is NOT a subset of "Beykoz" → stays NULL.
- Requiring a UNIQUE containing entry rejects ambiguous bare tokens
  ("Istanbul" alone matches 3 entries → NULL) and keeps look-alikes out
  ({cyprus,aydin}⊄{istanbul,aydin}; {beykent}⊄{istanbul,kent}).

**Combobox selection (`selectComboByTokens` in adapter.ts):** matching SIT's
live option list must be **token-BOUNDARY membership** — build a `Set` of the
option's folded tokens and require every wanted token to be an exact member.
Never substring (`folded.includes("kent")` wrongly matches "beykent"). Require
exactly one full-coverage option; **reject ties** (fail loud → programMissing)
rather than risk picking the wrong university. Fold BOTH sides — raw regex on
option text breaks on Turkish ı/İ/ş/ç/ö/ğ/ü.

**How to apply:** reuse `distinctiveTokens`/`fold` from these modules — do NOT
add a new normalizer. On combo failure return `{programMissing:true, detail}`
and log `[sit] university not found in SIT list`.

## Catalog field + spelling ≠ CRM name (GraphQL program lookup)

**Field name (verified via live pg_graphql introspection):** the program
university column is **`university_name`** — there is NO `university` field on
`zoho_programs` (querying it errors "Unknown field 'university'"). (By contrast
`zoho_applications` DOES have a bare `university` string field — don't confuse
them.) Only `active: { eq: true }` programs are selectable.

`zoho_programs.university_name` also stores a DIFFERENT spelling than our CRM
allowlist name — usually the English form ("Beykoz University") or bare
("Beykoz"), not the Turkish "Beykoz Üniversitesi". So a full-name
`ilike '%Beykoz Üniversitesi%'` returns **0 rows**. Filter the GraphQL catalog
by CORE DISTINCTIVE TOKENS: a typed `zoho_programsFilter` with an `and` of
per-token `ilike` on `university_name` (`%beykoz%`) plus `active:{eq:true}`,
then confirm each returned row in code by folding `row.university_name` and
requiring its token set to cover all wanted tokens (guards ilike over-match).

**Why:** English/Turkish + "University"/"Üniversitesi" suffix variance makes
full-name matching brittle; core tokens survive it.

**Residual gotcha:** SQL `ilike` does NOT Turkish-fold, so a folded ASCII token
(`aydin`) still won't match a DB row stored with diacritics (`Aydın`). We can't
fold in-query, so on a zero-hit result we log a one-shot DISTINCT
catalog-universities diagnostic (`PROGRAMS_UNIVERSITIES_QUERY`, near-match
highlighted) to reveal the real spelling. If diacritic misses show up, add a
broad no-filter fetch + in-code fold filter for the zero-hit case.

**UI combo is a typeahead:** SIT's university combobox lazily renders options as
you type — `selectComboByTokens` types the longest distinctive token into the
focused search box, then re-reads options; on failure it dumps the available
option texts so the real UI spelling is visible in the dry log.
