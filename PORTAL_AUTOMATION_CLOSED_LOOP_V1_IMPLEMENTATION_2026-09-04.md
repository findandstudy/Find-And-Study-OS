# Portal Automation Closed-Loop v1 — Implementation Record

Date: 4 September 2026
Branch: `codex/reporting-intelligence-center-20260903`
State: local implementation complete; not pushed or deployed

## Delivered scope

1. Dynamic trigger stages
   - The admin surface reads the current application pipeline catalog.
   - Newly discovered stages are visible but default to unselected.
   - Terminal, won and lost stages cannot trigger an external submission.
   - Saved keys that no longer exist fail closed instead of being invented.

2. No-code adapter onboarding
   - Admins can upload a bounded JSON adapter specification without editing the
     application source.
   - Unknown properties and malformed or oversized payloads are rejected.
   - Every canonical spec version has a stable SHA-256 identity.
   - Dry-run and fixture evidence is required before activation.
   - Privileged operations and JavaScript hooks require separate approvals
     bound to the exact immutable version.
   - Version 2 packages can also declare a bounded, read-only `statusCheck`;
     only navigation, waiting, capture, assertion, variable assignment and
     non-mutating HTTP GET steps are accepted.
   - Status, missing-document data and the official application number can be
     mapped from captured/structured values without adding application code.
     Identity proof and the official number are emitted only when the captured
     application identity exactly equals the requested external reference.

3. Evidence-bound lifecycle monitoring
   - Adapter status results can carry semantic application identity proof,
     structured missing-document items and a verified official application
     number.
   - Observations are redacted, bounded, hashed, append-only and deduplicated.
   - The submission/application composite foreign key prevents cross-case
     attachment.
   - Raw provider errors are collapsed to fixed PII-free failure codes.
   - The official application number is written only with complete semantic
     proof; a conflicting existing value is never overwritten.

4. Safe lifecycle actions
   - Portal statuses normalize to a canonical disposition vocabulary.
   - Missing documents, fee requests, offers, payment receipts, final letters
     and enrolment signals create deterministic, idempotent review proposals.
   - Artifact-bearing stages cannot be proposed until the exact artifact exists
     in the OS.
   - Proposal creation is durable and precedes a terminal submission update.
   - Proposals remain human-approval-only and never authorize portal mutation,
     payment, external messaging or direct CRM stage mutation.

5. High-volume queue isolation
   - Row ownership uses PostgreSQL `FOR UPDATE SKIP LOCKED` leases.
   - Adapter+university lanes use a session advisory lease, guaranteeing one
     active browser session per portal account across API instances.
   - Different lanes run in parallel; a slow or broken institution does not
     block another institution.
   - Per-lane sessions, 60-second operation timeouts, bounded batch sizes,
     deterministic exponential backoff and eight-failure quarantine are used.
   - Successful polling uses disposition-aware 2–24 hour cadence plus stable
     jitter instead of a fixed 15-minute global loop.
   - Offers and final acceptance remain monitored for later enrolment/card
     evidence; only closed-loop terminal outcomes stop the lane item.

6. Operations console
   - The Portal Automation page now includes an Operations tab consistent with
     the existing admin shell.
   - It shows aggregate health, per-lane backlog, retry/quarantine counts,
     redacted recent observations and pending approval counts.
   - Manual bounded sweep and quarantine resume commands are admin-only;
     resume is audited and only succeeds for a currently suspended row.
   - Responses are `private, no-store` and do not expose raw status text,
     credentials, student PII or official application numbers.

## Schema and compatibility

`0090_portal_lifecycle_observations.sql` is additive. It adds status-check lease,
retry and quarantine columns to `portal_submissions`, an idempotency key to
`ai_action_queue`, and the append-only `portal_lifecycle_observations` table.
Existing rows receive safe defaults; no table or populated column is dropped,
renamed or rewritten. The canonical local ledger is `91/91`.

The deployment must still follow the repository production preflight. In
particular, the index/constraint lock impact must be checked on the current
production schema and row counts before any production migration approval.

## Verification evidence

- Migration validation: `91 files / 91 journal entries`.
- Fresh disposable PostgreSQL apply: `0 → 91`; clean replay: `91 → 91`.
- Portal pure contracts: `23/23`.
- Dynamic trigger policy: `4/4`.
- PostgreSQL observation, lane, Guardian and operations tests: `6/6`.
- Migration authority: `31 PASS`, `1` Bash-unavailable Windows skip.
- Package-manager guard: `6/6`, exact pnpm `10.33.2`.
- Workspace and targeted API/portal-worker typechecks: PASS.
- Ten-language i18n synchronization: PASS.
- API and Edcons production builds: PASS.
- `git diff --check`: PASS.

## Explicitly not performed

- No GitHub push, pull request, merge or branch protection change.
- No staging or production deployment.
- No production migration, service restart, worker restart or credential read.
- No real portal submission, polling, email, WhatsApp, payment or notification.
- No local database or storage copy was sent to a remote environment.

## Required next gate

Before staging adoption: review the exact commit, migration SQL, live staging
schema, adapter credential references, worker overlap behavior and rollback
sequence. Run a synthetic allowlisted portal fixture first. Production remains
NO-GO until the repository deployment preflight is reported and the user gives
separate explicit approval for that exact release.
