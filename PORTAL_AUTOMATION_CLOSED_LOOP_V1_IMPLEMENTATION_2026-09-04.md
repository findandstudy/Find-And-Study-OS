# Portal Automation Closed-Loop v1 — Implementation Record

Date: 4 September 2026
Branch: `codex/reporting-intelligence-center-20260903`
State: exact-head staging deployment and read-only UAT complete; production not deployed

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
   - The same package can map offer, deposit, acceptance, final-acceptance and
     student-card download controls. Collection is a separate second phase and
     runs only when that status needs a file which is not already present.

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

5. Safe portal artifact intake
   - Authenticated downloads are restricted to the adapter's exact origin;
     redirects are denied and the final response origin is checked again.
   - A declared positive content length, a 15 MiB hard ceiling, an allowlisted
     MIME type and matching PDF/JPEG/PNG magic bytes are all required.
   - Application-scoped content-addressed keys and a database unique index
     prevent retry or concurrency from creating duplicate files or rows.
   - The document is bound to the exact observation, submission and application
     by a composite foreign key and appears in the existing Application document
     area with a Portal Automation badge.
   - Automation is a distinct non-human source; it never impersonates a staff
     uploader, and portal-collected evidence cannot be deleted through the
     stage-document API.

6. High-volume queue isolation
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

7. Operations console
   - The Portal Automation page now includes an Operations tab consistent with
     the existing admin shell.
   - It shows aggregate health, per-lane backlog, retry/quarantine counts,
     redacted recent observations and pending approval counts.
   - Manual bounded sweep and quarantine resume commands are admin-only;
     resume is audited and only succeeds for a currently suspended row.
   - Responses are `private, no-store` and do not expose raw status text,
     credentials, student PII or official application numbers.

## Schema and compatibility

`0090_portal_lifecycle_observations.sql` and
`0091_portal_application_artifact_intake.sql` are additive. They add status-check
lease, retry and quarantine columns to `portal_submissions`, an idempotency key
to `ai_action_queue`, the append-only observation table and evidence-source
binding on `application_stage_documents`.
Existing rows receive safe defaults; no table or populated column is dropped,
renamed or rewritten. The canonical local ledger is `92/92`.

The deployment must still follow the repository production preflight. In
particular, the index/constraint lock impact must be checked on the current
production schema and row counts before any production migration approval.

## Verification evidence

- Exact deployed code-bearing commit:
  `4f4ce4df3e01b0e71e84a64c02424847a1e6056f`.
- Exact-head GitHub Actions: Institution Admissions Gate
  `33882911515`, Portal Automation Gate `33882911634` and Live-first
  Convergence Gate `33882911333`; all completed successfully.
- Migration validation: `92 files / 92 journal entries`.
- Fresh disposable PostgreSQL apply: `0 → 92`; clean replay: `92 → 92`.
- Portal pure contracts: `26/26`.
- Dynamic trigger policy: `4/4`.
- PostgreSQL observation, lane, Guardian, operations and artifact tests: `7/7`.
- Migration authority: `31 PASS`, `1` Bash-unavailable Windows skip.
- Package-manager guard: `6/6`, exact pnpm `10.33.2`.
- Workspace and targeted API/portal-worker typechecks: PASS.
- Ten-language i18n synchronization: PASS.
- API and Edcons production builds: PASS.
- `git diff --check`: PASS.

## Staging adoption evidence

- Canonical URL: `https://staging.findandstudy.com/admin/portal-automation`.
- Release: `staging-20260904T143054Z-4f4ce4df3e01` using runtime image
  `sha256:7c4de1e8c79c16ab94423529e2a9f939d3882a573fcbeb5a14469dd479db601d`.
- The immediate pre-adoption dump is
  `staging-backup-20260904T140614Z-852b03b671e1` (`4,566,372` bytes,
  SHA-256 `e01c0727ac10d8b04c17fad51eb0a76188633ccc9ba6adb44b2d77386ab1487f`,
  `0640 root:findandstudy-staging`). Its network-isolated PostgreSQL 16.15
  restore reproduced ledger `90`, 13 synthetic users, zero applications and
  zero portal submissions; the disposable restore container was removed.
- The first restore assertion expected the earlier 12-user baseline and also
  queried the not-yet-created lifecycle table. It failed closed after the
  backup had completed. The accepted rerun used the measured 13-user baseline,
  treated absence of the pre-`0090` table as the expected value, and passed.
- The least-privilege reviewed migration runner advanced only staging from
  ledger `90/90` to `92/92`. Post-adoption counts remained 13 users, zero
  applications, zero portal submissions and zero lifecycle observations.
- Only `findandstudy-staging-app-1` was recreated. It runs as UID/GID `10042`,
  with a read-only root filesystem, all capabilities dropped,
  `no-new-privileges`, health `healthy` and restart count `0`.
- Public `/api/healthz` and `/api/health` returned HTTP `200`, the exact release
  ID and `dbConnected=true`; HSTS is active. Six further samples at five-second
  intervals all returned the same exact result. App logs contained zero
  fatal/unhandled/uncaught matches.
- `ALLOW_LIVE_INTEGRATIONS=false`, `EMAIL_DELIVERY_DISABLED=true`,
  `BACKGROUND_JOBS_ENABLED=false` and
  `AI_EXTERNAL_AUTO_REPLY_KILL_SWITCH=true` remained effective. Portal worker
  count was zero, and no portal, email, WhatsApp, payment or notification call
  was made.
- Authenticated read-only browser UAT opened Rules, Operations, Adapter
  Management, Submission Board and Audit Log. Dynamic stages came from the
  Application Pipeline; terminal Enrolled/Rejected stages were disabled. No
  submit, status sweep, adapter upload, setting save or other mutation ran.
- Final root filesystem use was `80%`, with `21,072,498,688` bytes available.
  No Docker prune or unrelated container restart was performed.

### No-outbound synthetic adapter gate

- The exact deployed build image `findandstudy-staging-build:4f4ce4df3e01`
  ran the v2 adapter production slice with a read-only root filesystem and
  `--network none`. All `26/26` checks passed, including canonical spec hashing,
  version-bound privileged approval, read-only status mapping, exact
  application-reference proof, verified official application number, bounded
  artifact collection, MIME/magic validation, content-addressed idempotency,
  lifecycle proposals, adaptive polling and fixed error redaction.
- A separate PostgreSQL 16.15 container used tmpfs storage, `--network none`
  and port `5433`; test processes shared only that network namespace. The
  reviewed runner applied ledger `0 → 92`, then adapter admin/version workflow,
  observation binding, distributed lane lease, fair claims, poison-row
  quarantine, concurrent Guardian idempotency, operations authorization and
  artifact persistence passed `8/8`.
- The disposable database reconciled to `92/92` with zero users, applications,
  submissions, lifecycle observations and adapter specs, then its container was
  removed. An initial attempt on port `5432` was rejected by the runner's hard
  `127.0.0.1:5433` target pin and cleaned up before the accepted run.
- Live staging was queried only for aggregate state. It contained zero active
  portal credentials, zero configured portal universities, zero adapter specs,
  zero submission lanes and zero applications/documents/observations. Messages,
  broadcasts, portal submissions, finance mutation requests and Journey outbox
  events were all `0` before and after the gate.
- Post-gate browser regression kept Rules in Test Mode with automation,
  fallback, fan-out and scheduled processing off. Operations remained all-zero;
  dynamic pipeline stages and disabled terminal stages were unchanged. Public
  health, ledger `92/92`, restart count `0` and zero fatal log matches passed;
  no test container remained.
- Because there is no active credential, university or adapter configuration,
  enabling a portal worker would be both ineffective and outside the approved
  boundary. The first real partner must be onboarded as one explicit staging
  pilot with its exact domain/origin, encrypted credential reference, immutable
  adapter version and separate dry-run/activation approvals.

## Explicitly not performed

- No pull-request merge, branch protection change or production deployment.
- No production migration, service restart, worker restart or credential read.
- No real portal submission, polling, email, WhatsApp, payment or notification.
- No local database or storage copy was sent to a remote environment.

## Required next gate

Before any staging worker or integration is enabled, run a synthetic
allowlisted adapter fixture for the exact approved version and re-attest that
lane ownership, credential references and external-write denominators remain
bounded. Production remains NO-GO until the repository production preflight,
current production row/lock impact review, rollback plan and separate user
approval are complete for an exact release.
