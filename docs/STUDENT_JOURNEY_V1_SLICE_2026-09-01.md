# Student Journey v1 vertical slice — 1 September 2026

## Outcome

The signed-in student dashboard now presents one server-owned next action
before the legacy summary cards. The projection identifies the application
that currently needs the most attention and reports:

- who is expected to act next;
- the current stage and a stage-derived progress value;
- the next safe portal destination;
- an observed document/request status;
- a normalized deadline and overdue signal when the source date is parseable.

This is a local, default-off product slice. Server-side rollout uses
`STUDENT_JOURNEY_V1_MODE=off|allowlist|all`; the default and every invalid
configuration fail closed. `allowlist` mode accepts only a bounded list of
internal numeric user IDs through `STUDENT_JOURNEY_V1_USER_IDS`. It does not add a migration,
activate an integration, contact a customer, merge a branch, deploy a release
or change production/VPS state.

## Data and authorization boundary

`GET /students/me/journey` accepts no student or application identifier. It:

1. requires an authenticated legacy student session;
2. resolves the student record only through the signed-in `user.id`;
3. scopes applications, documents and open document requests to that student;
4. returns `Cache-Control: private, no-store`;
5. remains in the G30 legacy authorization quarantine until a signed
   active-context corridor replaces the legacy role decision source.

The endpoint exposes no mutation. The dashboard CTA routes only to existing
student-owned portal pages.

## Projection contract

The projection is deterministic and versioned as `schemaVersion: 1`.
Configured application pipeline stages are authoritative for ordering and
progress. If the stage catalogue is unavailable, the current seven-stage
legacy catalogue is used and the response is marked `legacy_fallback`. If an
application contains an unknown/custom stage, the service does not invent a
percentage or actor: it returns an unknown waiting party and asks the student
to contact the advisor.

Priority order is intentionally attention-first rather than newest-first:

1. an unanswered missing-document request;
2. an offer requiring review;
3. a rejected/lost application requiring human guidance;
4. an early dossier stage;
5. an unknown stage;
6. a passive external/internal wait;
7. a completed application.

Document evidence is descriptive only. It is derived from observed document
states and open requests; it is not an application-readiness score and does
not authorize submission or another external side effect.

## User interface

The student dashboard contains loading, retry/error, actionable and passive
states. The progress indicator has accessible progress semantics and unknown
progress is announced without a fabricated numeric value. Built-in stage
labels use the existing translated labels; custom stage labels are rendered as
escaped text. Journey copy is synchronized across all ten supported locales.

## Verification

- Journey projection, route-boundary and rollout contract: `10/10` pass.
- IPv4/IPv6 rate-limit security: `6/6` pass.
- Live security regressions: `31/31` pass.
- External AI delivery safety: `5/5` pass with live delivery disabled.
- Package-manager guard: `6/6` pass.
- Data-boundary suite: `4/4` pass.
- Migration ledger validation: `82/82` pass; no migration was added.
- Tenant-writer inventory: `163 / 2,099`, unchanged and fully quarantined.
- Legacy route inventory: `71 / 763`; the single new registration is
  authenticated and quarantined. Normal drift gate passes.
- Full workspace typecheck, API production build and Edcons production build:
  pass.
- Translation check: `4,887` used keys, `6,170` English keys and ten locales in
  sync.
- Local browser smoke test: Turkish student dashboard, university-wait state,
  stage/progress/evidence presentation and the `/student/applications` CTA
  passed against disposable PostgreSQL 16 on `127.0.0.1:5433`.

## Remaining work

This first slice is not the complete G45 Student Journey. The next safe local
slices are:

1. wire the now-frozen milestone/QAVJP contract to a tenant-owned durable
   schema and transactional receipts, then expose a redacted timeline;
2. adopt the now-frozen, default-unwired
   [requirement/readiness projection](./STUDENT_JOURNEY_READINESS_PROJECTION_2026-09-01.md)
   only after a versioned tenant-owned requirement set and dossier revision
   exist;
3. adopt the now-frozen, default-unwired
   [student document-request response command](./STUDENT_DOCUMENT_REQUEST_RESPONSE_COMMAND_2026-09-01.md)
   only after its current-context authority and tenant-owned transactional
   store have durable PostgreSQL adapters;
4. adopt the default-unwired
   [Student Journey authorization boundary](./STUDENT_JOURNEY_AUTHORIZATION_BOUNDARY_2026-09-01.md)
   only after canonical tenant ownership, capability catalogue and current
   PostgreSQL session-selection resolution exist;
5. adopt the default-unwired
   [consent and communication decision contract](./CONSENT_COMMUNICATION_CONTRACT_2026-09-01.md)
   only after Privacy/Legal policy inputs and a tenant-owned transactional
   writer are approved;
6. adopt the now-frozen, default-unwired
   [next-action evaluation contract](./STUDENT_JOURNEY_EVALUATION_CONTRACT_2026-09-01.md)
   only after an approved evaluation policy, consented cohort, evidence-backed
   instrumentation and independent reconciliation exist.

Production adoption remains a separate reviewed release decision and is not
authorized by this document.
