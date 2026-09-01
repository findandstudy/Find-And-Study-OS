# Control Plane durable audit slice - 31 August 2026

## Purpose

This slice adds the default-unwired PostgreSQL durable audit writer and
scheduled reconciliation worker to the live-first branch.

## Provenance and integration order

- Live-first base: `1f8dde0f`.
- Canonical source: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- Runtime source Git blobs: `2/2` exact.
- The integration test is target-adapted to require
  `ALLOW_DISPOSABLE_AUDIT_TEST=true` and
  `127.0.0.1:5433/fasos_apply_local`.
- It intentionally runs after the command/evidence adapter gate because it
  audits and reconciles the same canonical command state.

## Local evidence

The repeated local chain passed:

```text
disposable reset
-> reviewed migrations 0 -> 82
-> command/evidence/context adapter PASS
-> durable audit/reconciliation PASS
```

The durable gate covers start/terminal HMAC chains, audit survival across
business rollback, scheduled receipt-only reconciliation, exhausted
no-command escalation, SQLSTATE `57014` cancellation audit, tenant denial,
NOLOGIN owner/direct writer split and concurrent single-terminal behavior.

Static authority evidence is `16 PASS / 1 SKIP` on Windows; the single skip
is the Bash-only restore-helper check. API TypeScript compilation also passes.

## Boundary

No route, runtime bootstrap, scheduler process, alert delivery, UI, publisher
or production wiring is added. GitHub push/PR/merge, `Next` synchronization,
long-lived migration and deployment remain out of scope.
