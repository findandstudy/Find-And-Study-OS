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

**How to apply:** reuse `distinctiveTokens`/`fold` from these modules — do NOT
add a new normalizer. On a resolution miss return `{programMissing:true, detail}`.

## Application create = GraphQL mutation, NOT the UI (current)

`createApplication` NO LONGER drives the SIT "Add Application" UI dialog
(brittle: the "Add Application"/combobox selectors kept 404-ing). The whole UI
block — `openStudentDetail`, `readComboOptions`, `selectComboByTokens` and the
combobox `SIT_APP_FIELDS` — was **deleted**. Program is matched entirely in code
against `fetchProgramCatalog(...)` (active-only, returns
`{id,name,universityName,degreeName,languageName}`), then the record is written
via `createApplicationRecord` → `INSERT_APPLICATION_MUTATION`
(`insertIntozoho_applicationsCollection`), `records[0].id` = externalRef.

**Column mapping gotchas:** the real column is the misspelled **`acdamic_year`**;
`student`/`program` are related-record REF ids (pass the zoho ids), while
`university`/`degree`/`country` are plain STRING columns (use the catalog's
`universityName` spelling, e.g. "Beykoz University", not the CRM Turkish name).

**DRY vs REAL:** mutation runs ONLY when `doSubmit` is true. DRY stops right
after matching with a clean detail ("öğrenci+program bulundu … kaydedilmeden
durduruldu") — never a UI button error. `createApplicationRecord` returns `null`
(never throws) on missing id so the caller reports a soft failure.

**Why:** SIT's SPA add-application dialog was unreliable headless; the pg_graphql
insert is deterministic and matches the read path already used for idempotency.

**RLS ownership (MANDATORY on INSERT):** the `zoho_applications` insert is gated
by Supabase row-level security (`WITH CHECK user_id = auth.uid()` + agency
scope). Omitting the ownership columns makes the insert affect ZERO rows and
pg_graphql returns `data:null` with NO error (silent). So every insert object
MUST carry `user_id` + `agency_id`, resolved at RUNTIME (never hardcode — the
account/agency changes): `user_id` = the `sub` claim decoded from the Supabase
access_token JWT (no query needed); `agency_id` = fetched from
`user_profileCollection(filter:{id:{eq:$uid}})` (uses `$uid: UUID!`). See
`fetchOwnerContext` (cached per page only on full success so a transient agency
miss can retry). `user_id` alone is decodable offline, so even if the agency
query fails the insert still carries auth.uid and any RLS refusal surfaces via
the logged `errors`/`data:null` body. Student creation stays on the UI wizard
(the authed session sets its ownership server-side), so only the APPLICATION
insert needs these fields.

**Proxy refuses WRITES — send mutations to the DIRECT Supabase endpoint:** the
SIT `/api/graphql` proxy serves READS fine but SILENTLY refuses inserts — it
returns `{"data":null}` with NO `errors` (indistinguishable from an empty read).
So mutations MUST go straight to the Supabase pg_graphql endpoint
`https://<project-ref>.supabase.co/graphql/v1` with the public anon `apikey`
(captured from the SPA's own *.supabase.co requests via `resolveAnonKey`)
ALONGSIDE the user `Authorization: Bearer` access_token. Use `page.request.post`
(CORS-immune) — an in-page fetch to that cross-origin URL throws. The direct
endpoint applies RLS, so a bad insert returns a REAL error ("permission denied"
/ "violates row-level security policy" / "Unknown field") instead of a silent
null. `gqlRequest(..., { direct:true })` does this (anon-apikey-required, no
proxy fallback so no double-insert; always logs the full PII-masked body). Reads
stay on the proxy — do NOT reroute them.

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

**Note:** the former UI university-combobox selection path (typeahead + option
dumping) was removed when application-create moved to the GraphQL mutation (see
"Application create = GraphQL mutation" above). University is now a plain string
column sourced from the matched catalog row's `universityName`.
