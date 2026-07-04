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

## Application create = REAL "Add Application" UI flow, id from Zoho backend

**The client CANNOT create the application record itself.** sitconnect's "Add
Application" button hits a Next.js Server Action → the SIT backend creates the
record in **Zoho CRM**, which assigns `id` + `app_id` (SITP-xxxxx) + `stage`
("Pending Review"). A raw Supabase `INSERT` NEVER worked (RLS + Zoho ownership
generate the id server-side). So `createApplication` drives the REAL portal UI
(Path A, Playwright): goto `/applications` → click Add Application → fill 7
searchable dropdowns (Student, Academic Year, Semester=Fall, Country=Turkey,
University, Degree, Program by NAME) → click Create Application.

**Outcome classification (from resulting page/toast body text):**
- portal duplicate toast ("It looks like you've already submitted…" /
  `SIT_ERRORS.duplicateApplication|duplicate`) = **idempotent SUCCESS** →
  `alreadyExists:true`, read record back for app_id.
- `SIT_ERRORS.serverError` (503/backend) = clear FAILURE.
- else = success → poll the read model (`findLatestApplication`, ~4×/2s) for the
  new record; if it never appears report `submitted:false` + "doğrulanamadı"
  (NEVER a false success).

**externalRef = `app_id` (SITP-…) ?? `id`** — both the create success path AND
the pre-check dedup path use `appId ?? id`, so writeback carries the human app id.

**Field selection: 5 MANDATORY, 2 default-aware.** Student/Country/University/
Degree/Program are mandatory — `selectComboSearch` returns a boolean; if any
fails, fail fast with a field-specific detail (do NOT click Create → would
submit default/no-op). University option matched by `distinctiveTokens`
lookahead regex; program by `matched.name`.

**`selectComboSearch` matching is tiered + diagnostic.** Pass `target` (human
string) and `fieldLabel`. Order: (0) already-selected short-circuit — accept the
trigger's visible value without opening if it folds-equal/contains the target or
matches optionRe; (1) optionRe fast path; (2) folded tolerant tiers over the
rendered option texts — exact-fold → contains-fold (either direction) →
first-token; (3) MISS → `logOptionsOnMiss` dumps up to 30 visible option texts as
a warn so the next real run reveals the exact mismatch (no blind guessing).
`fold` is the shared programMatch Turkish-folder (İ/I/ı→i, ş→s, etc., strips
non-alphanumeric). **Country filters the University list** — it MUST run before
University (it does) and we sleep ~1.2s after picking; Country tries Turkey →
Türkiye → Northern Cyprus in turn.

**Academic Year + Semester are PRE-SELECTED defaults ("2026/2027", "Fall") →
default-aware, NEVER block.** A pre-filled SIT combobox's ACCESSIBLE NAME becomes
its VALUE (not the label), so the label-regex trigger lookup that works for empty
fields FAILS on these two — that's the trap that made the old mandatory loop
fail-fast on Academic Year even though the default was already correct.
`selectOrKeepDefault` first scans the dialog's comboboxes/buttons for one whose
current text already satisfies the target (academicYearMatches = digits-only,
prefix-ok; semesterKey = TR/EN fall|güz|autumn→fall) and accepts it WITHOUT
opening; only if none matches does it try to pick, and it NEVER fails the flow
(keeps the portal default). Academic-year option regex must be separator-optional
(`2026\s*[/\-\s]?\s*2027`) — the option renders "2026/2027" (slash) while the
target is "2026-2027" (dash).

**DRY vs REAL:** DRY stops right after program matching ("öğrenci+program
bulundu … kaydedilmeden durduruldu") — never navigates/clicks. Only `doSubmit`
true drives the UI.

**Why:** the "Add Application" write path is the ONLY way to get Zoho to mint the
id/app_id/stage; the raw `insertIntozoho_applicationsCollection` mutation +
direct Supabase transport + RLS owner-context plumbing were all **deleted** (the
proxy silently refused inserts and even the direct endpoint couldn't reproduce
the server-action's Zoho record creation). READS still use the proxy GraphQL
(`fetchProgramCatalog`, `listStudentApplications`, `findLatestApplication`).

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

**Note:** the university spelling from the matched catalog row's `universityName`
is what the "Add Application" UI university dropdown is matched against (via
`distinctiveTokens` lookahead regex), so English/Turkish suffix variance is
tolerated at selection time. See "Application create = REAL 'Add Application' UI
flow" above.
