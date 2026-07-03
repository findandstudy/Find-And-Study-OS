---
name: Name-based program mapping tiers (General + University)
description: How portal program matching resolves label→CRM-name across the General and University mapping tiers, and why a flat merge is wrong.
---

# Name-based program mapping tiers

Portal program matching is **fully name-based**: the panel stores `{ portal option
label -> CRM program name }`. CRM program IDs are never consulted for matching (a
catalog re-sync renumbers IDs and used to silently break mappings). The old
`programOverrides` column ({crmId:portalValue}) is kept but no longer read.

Two mapping tiers, resolved **University > General > fuzzy**:
- **University tier** — a mapping row keyed to a specific university.
- **General tier** — sentinel row `university_key = "__general__"`
  (`GENERAL_MAPPING_KEY`, member NULL). Reuses the same table/index/CRUD, so it
  needs **zero DDL**. Create/rename endpoints must **reject** the reserved key.

## The precedence trap (why a flat merge is wrong)
**Rule:** the matcher receives TWO separate maps — `programNameMap` (university)
and `programNameMapGeneral` (general) — and checks university FIRST, then general.

**Why:** the obvious `{ ...general, ...uni }` flat merge only makes uni win when
both tiers map the **same portal label**. When general and uni map **different
portal labels to the same CRM name**, JS object iteration order (general inserted
first) lets General win the reverse lookup — violating University > General. This
was caught in code review.

**How to apply:**
- Loader (`programMappingLoader.ts` `mergeTiers`): emit `programNameMap = uniMap`
  and `programNameMapGeneral = general entries whose label is NOT in uniMap`
  (shadow same-label general keys so a uni entry always wins even on same label).
- `matchProgram(name, candidates, {nameMap, nameMapGeneral, synonyms})`
  (`programMatch.ts`) step 1: `resolveByNameMap(uni) ?? resolveByNameMap(general)`
  before the exact/fuzzy path. Exact folded-name match still wins conf 1.0.
- Every adapter call site must pass BOTH tiers: interpreter, sit, topkapi.
  `fallback.ts` intentionally uses no name map.
- synonyms concat (general++uni); countryOverrides merge (uni key wins).
- Regression: PM1b (same CRM name, different labels → uni wins) + PM1c (general
  applies when uni misses) in `scripts/test-program-match.ts`.
