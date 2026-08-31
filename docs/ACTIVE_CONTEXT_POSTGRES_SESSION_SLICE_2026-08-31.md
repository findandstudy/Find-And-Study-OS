# Active-context PostgreSQL session slice - 31 August 2026

## Purpose

This slice adds the default-unwired PostgreSQL session repository, issuance
rate limiter, selection lifecycle, locked selection consumption, durable
consumption-attempt ledger and receipt-only repair worker/store to the
live-first convergence branch.

## Provenance and target adaptation

- Live-first base: `511090f5`.
- Canonical source: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- Runtime and direct fake-store/test Git blobs: `13/13` exact.
- The database integration test is target-adapted to require
  `ALLOW_DISPOSABLE_SESSION_GATEWAY_TEST=true` and the exact local identity
  `127.0.0.1:5433/fasos_apply_local`.
- NOLOGIN owners and narrowly scoped LOGIN executors are created only by the
  explicit disposable database reset helper.

## Local evidence

The following fresh chain passed on PostgreSQL 16.15:

```text
disposable reset
-> reviewed migrations 0 -> 82
-> command/evidence/context adapter PASS
-> durable ChangeSet audit/reconciliation PASS
-> active-context session/lifecycle/repair PASS
```

Direct contract suites passed `16/16` and API TypeScript compilation passed.
The real integration gate proves EXECUTE-only server session selection,
HMAC-idempotent lifecycle receipts, immutable terminal generations, durable
rate permits, concurrency bounds, SQLSTATE `57014` rollback and clean pooled
connection reuse. The repair path reads verified stored receipts and never
replays the privileged business mutation.

## Boundary

No HTTP route registration, API bootstrap, scheduler, UI, publisher or
production wiring is added. GitHub push/PR/merge, `Next` synchronization,
long-lived database adoption and deployment remain out of scope.
