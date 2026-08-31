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
7. Port the reviewed migration runner's endpoint, database and direct-role
   identity checks onto the live-first branch.
8. Require exact `pnpm@10.33.2` in the migration runner on Windows and Linux,
   with an explicit absolute `pnpm.cjs` path for isolated verification hosts.
9. Add a fail-closed disposable production-prefix adoption harness.

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
- Migration-authority: `14` pass, `1` Bash-unavailable skip on Windows.
- Full workspace typecheck: pass.
- Live security regressions: `29/29`.
- Rate-limit/IP security: `5/5`.
- Agent application/onboarding: `14/14`.
- Finance reconciliation: `5/5` after updating the stale assertion; runtime
  finance code is unchanged.
- Portable EDB PostgreSQL `16.15` on `127.0.0.1:5433`, database
  `fasos_apply_local`, direct `fas_migrator`: pass.
- Fresh PostgreSQL application: `0 -> 82`; reviewed runner replay:
  `82 -> 82`.
- Production-prefix adoption: `66/66 -> 82/82 -> clean replay`.
- Wrong package-manager proof: `pnpm 11.19.0` rejected; exact
  `pnpm 10.33.2` accepted.
- Finance Faz 3 DB suite: `8/8`; the fixture now proves the audit receipt and
  cleans it before deleting its seeded user.
- Contract signing scope DB suite: `14/14` with delivery disabled.
- Contract render/sign suite: `18/18`.
- Exact-head CI workflow prepared locally with pinned Node actions and
  PostgreSQL `16.15` image digest; GitHub run is still pending.
- Canonical authorization and Control Plane Drizzle schema blobs: `2/2` exact.
- Default-unwired schema binding regression: `3/3`.
- Canonical pure authorization/ChangeSet source and direct-test blobs: `6/6`
  exact; active-context `13/13`, R1 policy `12/12`, evidence envelope `8/8`.
- Canonical command/request-context source and direct-test blobs: `4/4` exact;
  command orchestration `25/25`, request binding `4/4`.
- Canonical authoritative active-context issuance source/test blobs: `2/2`
  exact; issuance coordinator `5/5`.
- Canonical PostgreSQL command/evidence/context repository blobs: `3/3` exact;
  isolated EXECUTE-only adapter integration passed on PostgreSQL `16.15`.
- Canonical durable-audit/reconciliation runtime blobs: `2/2` exact; chained
  audit, cancellation, rollback-survival and repair integration passed.
- Canonical key-ring, selection-consumption, session lifetime and default-off
  HTTP gateway source/test blobs: `6/6` exact; direct suites `21/21` and API
  typecheck passed without route or bootstrap wiring.
- Canonical PostgreSQL session/rate-limit/lifecycle/consumption/repair runtime
  and direct-test blobs: `13/13` exact; direct suites `16/16` and the fresh
  PostgreSQL `0→82` session/lifecycle/repair integration chain passed.
- The comprehensive PostgreSQL foundation gate is target-adapted to the
  converged `82` denominator and exact local identity. Foundation fixtures and
  adapter fixtures are separated by an explicit reset plus second `66→82`
  replay; the full CI-order candidate passed.
- Live-first G30 denominators are frozen at `163` writer files / `2,101`
  conservative surfaces and `71` route files / `762` registrations. Normal
  drift gates pass; strict writer and route gates remain expected NO-GO.
- Canonical legacy user-management and impersonation policies are bound to the
  live `users`/`agents` routes with `4/4` exact policy/test blobs; direct policy
  suites `11/11`, live security regressions `30/30` and API typecheck pass.
- External AI delivery is independently default-off, requires an explicit
  Super Admin activation on both current configuration routes, is rechecked at
  provider boundaries and has a stop-only infrastructure kill switch. Direct
  safety tests pass `5/5`; live security regressions pass `31/31`.
- G30 route registration totals remain `71 / 762`; the two explicit activation
  checks increase the conservative direct-role count from `26` to `28`.

## Remaining gates

The local PostgreSQL gate is complete without Docker and without a long-lived
database. The EDB archive was extracted without installing a Windows service;
the disposable cluster was bound only to loopback and used no production dump,
credential, secret or PII.

Exact-head GitHub CI and review still remain. This branch is therefore a local
convergence candidate only. It is not merge-, `Next`-sync- or deploy-ready.
