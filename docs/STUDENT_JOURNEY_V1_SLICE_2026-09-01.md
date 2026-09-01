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

This is a local, default-safe product slice. It does not add a migration,
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

- Journey projection and route-boundary contract: `9/9` pass.
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

1. a canonical milestone/event timeline backed by durable receipts rather
   than inferred stage labels;
2. explicit requirement/readiness facts for dossier and application preflight;
3. safe student acknowledgement and document-request response commands with
   idempotency, audit and concurrency tests;
4. signed active-context authorization for the student corridor;
5. notification preference and consent-bound journey updates;
6. analytics/evaluation for next-action correctness, delay and exception rate.

Production adoption remains a separate reviewed release decision and is not
authorized by this document.
