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
