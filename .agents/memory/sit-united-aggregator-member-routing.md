---
name: SIT/United aggregator member routing
description: How member universities of an aggregator portal (SIT/United) are made submittable and routed to the aggregator adapter without a schema migration.
---

# Aggregator member routing (SIT / United)

An aggregator portal (e.g. `study_in_turkey`→adapter `sit`, `united_education`→adapter `united`) submits on behalf of many member catalog universities. Members are declared in `portal_account_universities` (`portal_key` = aggregator `university_key`, `catalog_university_id` = `universities.id`, `enabled`). A member usually has NO own `portal_universities` row; some have a standalone row that points at the WRONG adapter and lacks the aggregator's credentials.

## Rule
`resolvePortalRouting({universityId,universityName})` (in `portalAutoTrigger.ts`) resolves membership FIRST (member→aggregator WINS over any standalone row), else falls back to `findActivePortalUniversity`. Use it in EVERY submittability/enqueue surface: auto-enqueue gate, manual submit, resolve preview, and the eligible-applications list (added a `university_key IN (enabled memberships for a.university_id)` branch to the join OR + a `CASE WHEN membership THEN 0 ELSE 1` tiebreak so `DISTINCT ON (id)` prefers the aggregator).

**Why:** members were getting NO_PORTAL/NOT_FOUND (no standalone row) or routing to a credential-less wrong adapter (standalone row wins by default).

## Submission encoding (no migration)
- `universityKey` = aggregator key (drives dedup, advisory lock, creds, adapter).
- `universityName` = MEMBER name (display + the runner's name-based adapter fallback).
- `meta` (existing `portal_submissions.meta jsonb`) = `{targetCatalogUniversityId, targetUniversityName, routedViaAggregator}`.

## Runtime resolution (fragile-but-works)
`resolveAdapterKey(aggregatorKey)` returns `adapterKey='sit'/'united'` but `routedVia=null` (aggregator row has `crm_university_id=NULL`), so the worker passes `opts=undefined` → adapter is picked by `adapterForUniversity(submission.universityName)` name fallback. This works ONLY because the member is in the SIT/United allowlist AND `buildStudentProfile` overrides `profile.universityName` from `meta.targetUniversityName` (both adapters select the school from `profile.universityName`).

**Latent risk:** if a future member's name drifts or the allowlist lags, adapter resolution silently fails. Hardening = pass `adapterKey` from `resolveAdapterKey` into `runSubmission` even when `routedVia` is null — deliberately NOT done, since it changes the shared legacy worker path (topkapi etc.) which must stay byte-identical.

**How to apply:** SIT/United are experimental families (excluded from drain/worker auto-run), so members are manual-submit only; that's expected, not a bug. No aggregator/membership/creds rows exist in dev or prod yet — validate by temporarily seeding then cleaning up.
