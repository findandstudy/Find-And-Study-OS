---
name: SIT create = graphql-derive + dedup + n8n webhook (not UI)
description: SIT student AND application create are n8n webhook POSTs, not the panel's dropdown modal/wizard; how ids are derived and why dedup must fail closed.
---

# BOTH SIT creates are webhook replays, not UI automation

There are THREE distinct SIT n8n webhooks — do not confuse them:
- **student** = `da599eaf-7f5e-45aa-9d53-33d1f185515a` (env `SIT_CREATE_STUDENT_WEBHOOK_URL`)
- **application** = `4615d5ae-…` (env `SIT_CREATE_WEBHOOK_URL`)
- **users/invite** = `03ed1ba0-…` (NOT used by create flows)

Both `createStudent` and `createApplication` bypass the automation-hostile UI
(the 6-step "Add Student" wizard / the "Add Application" dropdown modal) and POST
JSON to their dedicated webhook → `{status:true,id}`; the Zoho id is backend-assigned.

## createStudent specifics
- Keeps `ensureLoggedIn` + `findStudent` email/passport precheck + DRY stop, then
  `resolveSitIdentity` (fail-closed if `!agencyId || !crmId`), builds payload, POSTs.
- `findStudent` is TRI-STATE (`found`/`not_found`/`unknown`); `unknown` (GraphQL
  outage / shape drift) → caller aborts create (no POST) to avoid duplicate students.
  The webhook has no client idempotency guard, so the precheck is the only defense.
- Previous-education fields keyed by APPLIED level via `mapEducationLevel`:
  Master→`bachelor_*`, PhD→`master_*`, else `high_school_*`. Dates via `isoDateOnly`
  (YYYY-MM-DD). `documents:[]` + `photo_url:""` — the storage-upload path is NOT part
  of the captured student webhook contract (deviation, acceptable).
- Body carries `first_name`/`last_name`/`email` — NEVER log the body; log only the
  masked response (`rawForLog`) + HTTP status.

# SIT createApplication is a webhook replay, not UI automation

The SIT panel's "Add Application" modal dropdowns are automation-hostile (Student
async popover perpetually 0/0). The panel's REAL create (live-captured) is two
HTTP calls, so the adapter bypasses the UI entirely:

1. **Dedup precheck** — pg_graphql `GetApplicationsByFilter` on
   `zoho_applicationsCollection`.
2. **Create** — JSON POST to an OPEN n8n webhook
   (`SIT_CREATE_WEBHOOK_URL`, hardcoded fallback) → `{status:true,message,id}`;
   the Zoho application id is assigned by the backend and returned as `id`.

`createApplication` keeps login + student search + program catalog match + DRY
stop, then derives every id from GraphQL and POSTs.

## Id derivation (all dynamic, never hardcoded)
- **program fields**: `zoho_programsCollection{id name university_id degree_id
  country_id}` → university/degree/country/program_name.
- **academic_year / semester**: resolved by NAME from
  `zoho_academic_yearsCollection` / `zoho_semestersCollection` (year compared
  digit-only so "2026-2027" matches "2026/2027"; semester folded fall/spring/summer).
- **identity**: `user_id` = the `sub` claim of the Supabase access_token (decode
  the JWT payload, base64url); `agency_id` + `crm_id` from `user_profileCollection`
  filtered by that uid (typed `user_profileFilter`).

## Non-obvious constraints
- **Dedup key = student + university + degree + acdamic_year + semester**
  (program and country are intentionally EXCLUDED). The column is literally
  spelled `acdamic_year` (panel typo) — use verbatim in filter AND webhook body.
- **Dedup must FAIL CLOSED.** `dedupApplication` returns a tri-state
  (found/not_found/unknown); on `unknown` (GraphQL outage / response-shape drift)
  the caller aborts create — treating unknown as "no duplicate" would silently
  create duplicates during transient instability.
  **Why:** the webhook has no client-visible idempotency guard; the precheck is
  the only duplicate defense.
- **Secrets/PII:** the webhook body carries `student_name` — NEVER log the body;
  log only the response (masked via `rawForLog`) + HTTP status. Identity is
  logged presence-only.
- Failure on any missing required id (program ids / AY / semester / agency_id /
  crm_id / studentId) → abort with a field-specific detail, never a partial POST.
