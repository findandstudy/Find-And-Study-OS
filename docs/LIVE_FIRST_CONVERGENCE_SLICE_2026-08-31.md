# Live-first convergence slice - 31 August 2026

## Frozen inputs

- Last web-terminal-verified VPS source commit:
  `d8f385ca018161cf6330232f5840d3a29c3581ce`.
- Current public-health-attested production and GitHub live branch head:
  `6dca1f951590dce297bb4d3579bd17d8d9f92e5f` (`fix: restore inbound
  media and embed logos`). The convergence branch incorporates it through
  merge commit `3ff2f50b90e1c451bab6d21321e213eebdc315d9` without conflict.
- Public production `/api/health` returned HTTP `200`, `dbConnected=true` and
  `releaseId=20260831T115424Z-6dca1f951590` on 1 September. The production
  migration ledger remains last verified at `66/66`; the web console did not
  establish a fresh session for a current ledger query.
- Control Plane source head: `eb577b780c8ca680ffb07395cd0dfacdffbf494b`.
- Canonicalization source commit: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- Merge base between the live and canonicalization lines:
  `ae1e7f3a988b391df8163aa819753cdfa6623f50`.

This branch starts directly from the production source commit. It does not
merge the stale `Find-And-Study-OS-Next/main` snapshot and does not change the
live release, VPS, database, workers or integrations.

The 1 September Hostinger overview confirms that the VPS is running and shows
approximately `90 GB / 100 GB` disk usage. The public health response closes the
deployed-release identity gap, but it does not prove the current migration
ledger, filesystem attribution, process identity, backup restoreability or
`0066+` namespace absence.

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
- GitHub merge, deployment or production configuration changes. The feature
  branch push and draft PR are evidence-only and do not change production.

## Local evidence

- Migration ledger validation: `82/82`.
- Production journal prefix comparison: `66/66`, unchanged from the live
  source commit.
- Product migration Git blob comparison for `0054-0065`: `12/12` exact.
- Package-manager guard: `6/6`.
- Frozen install with `pnpm@10.33.2`: pass; the four reviewed Windows x64
  native packages are present and the lockfile remains stable on replay.
- Migration-authority: `14` pass, `1` Bash-unavailable skip on Windows.
- Full workspace typecheck: pass.
- API and Edcons production builds: pass; Edcons i18n has `4,873` used keys,
  `6,106` English keys and `10` synchronized languages.
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
- Draft PR [#30](https://github.com/findandstudy/Find-And-Study-OS/pull/30)
  is open against `hotfix/embed-release-20260830` at head
  `a18b11f145cdcb1ad0cbeb2e8bc626aefb92864b`; GitHub reports it mergeable and
  `clean`. It remains draft and has not been merged.
- Exact-head GitHub Actions run
  [33446613024](https://github.com/findandstudy/Find-And-Study-OS/actions/runs/33446613024)
  passed all three jobs: Linux ledger/typecheck/security, Windows locked
  install/typecheck, and PostgreSQL `16.15` fresh/prefix/foundation/adapter/
  audit/session verification.
- The first PR run exposed a CI-only host-port mapping mismatch: clients use
  loopback `5433`, while the PostgreSQL container listens internally on `5432`.
  The endpoint allowlist remains fixed at `127.0.0.1:5433`; the disposable
  server-listener identity is now separately explicit and range-validated.
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
- Live-first G30 denominators are frozen at `163` writer files / `2,099`
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
- Canonical integration-DB safety and hardened signed-contract object-authz
  test blobs are `3/3` exact. Targeting tests pass `11/11`; the real loopback
  disposable PostgreSQL object-authorization suite passes `4/4` with cleanup
  and natural exit-code preservation.
- Legacy role mutations, global settings mutation, assignment backfill and
  branch lifecycle writes are temporarily Super Admin-bound; read-time role
  and settings bootstrap writes are removed, n8n endpoint data is redacted and
  bounded config audit events are emitted. Current route counts are `476`
  fixed-role / `41` permission references; strict G30 remains NO-GO.
- Session creation, reads, idle touches, browser-cookie renewal and the dormant
  update helper now share one server-issued 24-hour absolute issued-at clock.
  The update path cannot restart that clock when callers omit the timestamp;
  impersonation children inherit the parent clock and revalidate the parent
  session/actor on every child request, while the current live
  public-application verification behavior is preserved.
- Only `super_admin` now bypasses the central effective-permission resolver and
  shared frontend permission guards. `admin` uses its stored/fallback package
  plus explicit user overrides, including the batched Academy access
  projection; direct legacy role-gated screens/routes remain G30-quarantined
  rather than being treated as converted.
- The latest live inbound-media/embed fix was merged after a clean merge-tree
  preview. Post-merge full workspace typecheck, API production build and Edcons
  production build pass. Edcons remains at `4,873` used keys, `6,106` English
  keys and `10` synchronized languages.
- Post-merge live security regressions pass `31/31`, agency platform regression
  checks pass `15/15`, embed/chatbot checks pass `18/18`, and the package-manager
  guard passes `6/6`.
- The embed route identity was re-frozen after review. G30 normal gates still
  pass at `163 / 2,099` writer files/surfaces and `71 / 762` route
  files/registrations; strict gates remain intentionally NO-GO.
- Final static review finds no Control Plane imports or references in the API
  app bootstrap, legacy index bootstrap or registered route directory. The
  workflow uses SHA-pinned actions, `contents: read`, disabled credential
  persistence and `ALLOW_LIVE_INTEGRATIONS=false`.
- Production-dependency audit reports no known vulnerabilities. GitHub reports
  no repository rulesets, no protection on the live base branch, no requested
  reviewer/team and no submitted review; these absences are release blockers,
  not evidence that review is unnecessary.

## Remaining gates

The local PostgreSQL gate is complete without Docker and without a long-lived
database. The EDB archive was extracted without installing a Windows service;
the disposable cluster was bound only to loopback and used no production dump,
credential, secret or PII.

Independent review and a fresh production ledger/`0066+` namespace attestation
still remain. The branch is therefore a CI-verified draft convergence candidate
only. It is not merge-, `Next`-sync- or deploy-ready.
