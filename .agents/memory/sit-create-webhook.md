---
name: SIT create = graphql-derive + dedup + n8n webhook (not UI)
description: SIT application create is an n8n webhook POST, not the panel's dropdown modal; how ids are derived and why dedup must fail closed.
---

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
