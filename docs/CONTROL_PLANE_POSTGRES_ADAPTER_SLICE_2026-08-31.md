# Control Plane PostgreSQL adapter slice - 31 August 2026

## Purpose

This slice adds the default-unwired PostgreSQL command, evidence and
authoritative-context repository adapters to the live-first branch and proves
their real database authority split on disposable PostgreSQL 16.15.

## Provenance and adaptation

- Live-first base: `a9b77fe2`.
- Canonical source: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- Adapter source Git blobs: `3/3` exact.
- The canonical adapter test was intentionally adapted to require
  `ALLOW_DISPOSABLE_ADAPTER_TEST=true` and the exact local target
  `127.0.0.1:5433/fasos_apply_local`.
- Its evidence issuer/principal seed is now self-contained. The canonical CI
  version implicitly depended on the preceding foundation test leaving that
  row behind; a fresh isolated run exposed FK `23503` and the fixture order was
  corrected without changing adapter runtime code.

## Local evidence

- API package declares direct `pg@^8.20.0` and `@types/pg@^8.18.0`
  development dependencies; frozen exact-pnpm install passes.
- API typecheck: pass.
- Disposable DB reset creates separate NOLOGIN owners and direct LOGIN
  executors/resolvers with no memberships or elevated attributes.
- Fresh reviewed migration application: `0 -> 82`.
- PostgreSQL adapter gate: pass.
- Migration authority, including adapter target/role pinning:
  `15 PASS + 1` Bash-unavailable skip on Windows.

The adapter gate proves EXECUTE-only authoritative context issuance, real
command-store transactions, signed evidence, ambiguous-commit replay,
SQLSTATE `57014` cancellation rollback, membership/policy/key/grant/issuer
revoke serialization and pool context cleanup.

## Boundary

The adapters are not imported by HTTP routes, runtime bootstrap, sessions,
workers or publishers. No long-lived database, GitHub push/PR/merge, `Next`
synchronization or production deployment is included.
