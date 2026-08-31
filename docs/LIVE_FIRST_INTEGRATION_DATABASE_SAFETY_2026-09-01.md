# Live-first integration database safety - 1 September 2026

## Purpose

This slice prevents the signed-contract object-authorization integration test
from mutating production, staging, remote or ambiguously named PostgreSQL
databases.

## Enforced boundary

- Mutation requires both `ALLOW_LIVE_INTEGRATIONS=false` and the explicit
  `OBJECT_AUTHZ_TEST_ALLOW_DATABASE_MUTATION=1` opt-in.
- The host must be literal `127.0.0.1`; DNS aliases, remote hosts, URL query
  overrides and fragments are rejected.
- Local runs accept only `127.0.0.1:5433/fasos_apply_local`.
- CI runs accept only GitHub Actions with numeric run ID/attempt and the exact
  `127.0.0.1:5432/fas_it_<run_id>_<attempt>` database identity.
- The safety contract runs before importing the database layer.
- Fixture IDs are recorded immediately after each successful insert so partial
  seeding remains recoverable.
- Cleanup attempts every table, aggregates failures, closes the pool and
  preserves the natural test-runner exit status; forced `process.exit` is
  removed.

## Evidence

- Canonical safety source, direct test and hardened object-authz test blobs:
  `3/3` exact.
- Integration database targeting: `11/11` pass.
- Real signed-contract object authorization on the loopback disposable
  PostgreSQL 16 database: `4/4` pass.
- API TypeScript compilation and live security regressions pass.

The real DB test used only `127.0.0.1:5433/fasos_apply_local`, with no
production dump, credential, secret or PII. No long-lived database, VPS,
GitHub, `Next` or production state was changed.
