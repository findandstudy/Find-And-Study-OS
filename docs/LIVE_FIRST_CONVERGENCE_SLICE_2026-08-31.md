# Live-first convergence slice - 31 August 2026

## Frozen inputs

- Production source commit: `d8f385ca018161cf6330232f5840d3a29c3581ce`.
- Control Plane source head: `eb577b780c8ca680ffb07395cd0dfacdffbf494b`.
- Canonicalization source commit: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- Merge base between the live and canonicalization lines:
  `ae1e7f3a988b391df8163aa819753cdfa6623f50`.

This branch starts directly from the production source commit. It does not
merge the stale `Find-And-Study-OS-Next/main` snapshot and does not change the
live release, VPS, database, workers or integrations.

## Slice boundary

Included:

1. Preserve the authoritative product migration history at `0000-0065`.
2. Append the default-unwired Control Plane migrations at `0066-0081`.
3. Pin production migration `0054-0065` tags, timestamps and canonical-LF
   SHA-256 identities.
4. Keep the consumption-attempt `(tenant_id, id)` unique constraint and its
   tenant-bound receipt foreign key under regression test.
5. Make the package-manager preinstall guard work on Windows while requiring
   exact `pnpm@10.33.2` and preserving foreign lockfiles on failure.
6. Align the existing finance reconciliation assertion with the production
   implementation's transaction-bound recalculation and advisory lock.

Excluded:

- Control Plane Drizzle schema bindings and runtime imports;
- HTTP routes, browser/session wiring, workers, publishers and repair schedulers;
- migration application to any long-lived or production database;
- `Find-And-Study-OS-Next` code synchronization;
- GitHub push, PR, merge, deployment or production configuration changes.

## Local evidence

- Migration ledger validation: `82/82`.
- Production journal prefix comparison: `66/66`, unchanged from the live
  source commit.
- Product migration Git blob comparison for `0054-0065`: `12/12` exact.
- Package-manager guard: `6/6`.
- Frozen install with `pnpm@10.33.2`: pass; lockfile unchanged.
- Migration-authority: `10` pass, `1` Bash-unavailable skip on Windows.
- Full workspace typecheck: pass.
- Live security regressions: `29/29`.
- Rate-limit/IP security: `5/5`.
- Agent application/onboarding: `14/14`.
- Finance reconciliation: `5/5` after updating the stale assertion; runtime
  finance code is unchanged.

## Open gate

Fresh and production-prefix adoption on disposable PostgreSQL 16 remains
required. The local Docker Desktop engine cannot start because its Windows IPC
socket cannot be recreated. Tests that require `DATABASE_URL`, including the
finance and contract DB suites, remain pending rather than receiving a fake or
production target.

Until the PostgreSQL gate, exact-head CI and review pass, this branch is a local
convergence candidate only. It is not merge-, `Next`-sync- or deploy-ready.
