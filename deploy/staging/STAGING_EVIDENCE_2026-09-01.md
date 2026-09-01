# Staging deployment evidence — 1–2 September 2026

This record covers the isolated synthetic-data staging deployment only. No
production service, production database/storage, production integration, or
`Find-And-Study-OS-Next` branch was changed.

## Identity

- Host: `srv1110168.hstgr.cloud` (`72.61.91.131`)
- Public URL: `https://staging.srv1110168.hstgr.cloud/tr/login`
- Branch: `codex/staging-adoption-runner-20260901`
- Deployed code-bearing commit: `422c3e0d7274218f98b0b7693fb78a41cd3148e5`
- Release ID: `staging-20260901T221850Z-422c3e0d7274`
- App image: `findandstudy-staging-app:422c3e0d7274`
- App image ID: `sha256:6d5089664c229fbb94410fba8128aa56e9463af6e5d0cb66644be76e014bfe3b`
- The host checkout, its upstream ref, and the deployed code-bearing commit
  matched exactly; the tracked worktree was clean.

## Runtime and database evidence

- App and PostgreSQL containers reported healthy after deployment and after the
  restore drill.
- Public `/api/healthz` and `/api/health` returned HTTP `200`; the detailed
  health response reported `dbConnected=true` and the expected release ID.
- PostgreSQL database `fasos_staging` matched the canonical `83/83` migration
  ledger.
- The accepted RBAC UAT denominator contained exactly 12 synthetic users: the
  existing staging Super Admin plus 11 purpose-built role users. Two active
  synthetic agent profiles and one active synthetic student profile were
  provisioned without production PII.
- The exact-release HTTPS/API RBAC runner passed all 126 checks across 11 roles.
  It performed only synthetic login/logout POSTs and read-only GET probes.
- Server-side login, authenticated `auth/me`, and logout smoke passed without
  recording the password, CSRF token, or session cookie. The smoke reproduced
  the browser's initial GET → CSRF cookie/header → login contract.
- The runtime uses UID/GID `10042`, a read-only root filesystem, dropped Linux
  capabilities and `no-new-privileges`.
- Neither the application nor the database publishes a host port; TLS routing
  remains through the existing proxy. The public login response retained HSTS
  with a one-year max age and `includeSubDomains`.
- Live integrations, email delivery, background jobs, signed-contract PDF work,
  external AI replies, and Student Journey rollout remained disabled.
- App logs since the final replacement contained zero
  fatal/unhandled/uncaught matches. All unrelated VPS containers remained up;
  their healthy services retained their health status.
- Browser UAT found an unnamed password visibility control. The deployed head
  gives all three login/registration/set-password toggles localized accessible
  names and `aria-pressed` state in all 10 supported languages. Two focused
  regressions, i18n parity and Edcons typecheck passed.

## CI evidence

- Initial staging gate run
  [33559561691](https://github.com/findandstudy/Find-And-Study-OS/actions/runs/33559561691)
  passed on evidence/runbook head `94a6684a9d88127a37103909075a304c398fefd0`.
- Final deployed code head run
  [33560146929](https://github.com/findandstudy/Find-And-Study-OS/actions/runs/33560146929)
  passed on `65f85d6577e5ba9eb8e3b4863b6baa4113ede71e`.
- RBAC UAT implementation run
  [33564231331](https://github.com/findandstudy/Find-And-Study-OS/actions/runs/33564231331)
  passed on `3ed30de5f4373dd7913b47d137fc991d1a4de2be`.
- Final code-bearing run
  [33565008425](https://github.com/findandstudy/Find-And-Study-OS/actions/runs/33565008425)
  passed on `422c3e0d7274218f98b0b7693fb78a41cd3148e5`.
- The final run completed the Linux source/build/security gate, Windows locked
  install/typecheck gate, and exact-source hardened container build. CI also
  discovered all 106 staging RBAC browser cases without executing them against
  the external staging host.

## Backup and recovery evidence

- Backup: `/opt/findandstudy-staging/backups/staging-backup-20260901T212010Z-65f85d6577e5.dump`
- Size: `1,205,478` bytes
- SHA-256: `31ad2562d0a2fa37f8594ddb42d2773330c45fa70dbc3fc0270e95a71abcdb51`
- Mode/owner: `0640 root:findandstudy-staging`
- The dump restored successfully into a disposable, network-isolated, tmpfs
  PostgreSQL container using the exact digest pinned in `compose.yml`.
- Restored facts: exact ledger `83`, one synthetic user, one active synthetic
  Super Admin, and `190` public tables.
- The disposable restore container was removed and the live staging volume was
  not mounted or changed.
- A pre-UAT backup was also accepted at
  `/opt/findandstudy-staging/backups/staging-pre-uat-20260901T220845Z-3ed30de5f437.dump`
  (`1,205,504` bytes, SHA-256
  `b4c1eb04b583521987868366cbb9be3baf55dedcd5bcdc5644208abde22cabe1`).
  Its isolated restore reproduced ledger `83` and the original one-user state.
- The accepted post-UAT backup is
  `/opt/findandstudy-staging/backups/staging-rbac-uat-20260901T222033Z-422c3e0d7274.dump`
  (`1,206,715` bytes, SHA-256
  `2edccc322f56b953d37a0de11142376134fe6821b359862670b25e3ff92a254d`,
  `0640 root:findandstudy-staging`).
- Its network-isolated PostgreSQL 16.15 restore reproduced database
  `fasos_restore_rbac_uat`, ledger `83`, 12 users, four active agent rows, five
  active student rows, the exact `11/2/1` UAT user/agent/student fixtures, and
  190 public tables. The disposable container was removed.
- Final filesystem use was `72/96 GiB` (`75%`, approximately `25 GiB` free);
  build images were retained and no Docker prune/retention mutation was
  performed.

## Stability soak evidence

- A read-only five-minute public health soak ran from
  `2026-09-01T22:34:41Z` through `2026-09-01T22:39:39Z` against release
  `staging-20260901T221850Z-422c3e0d7274`.
- All 60 HTTPS samples returned the exact release, HTTP `200` and
  `dbConnected=true`; samples were spaced five seconds apart.
- Observed public health latency was `0.023869` seconds minimum, `0.035100`
  seconds average and `0.135975` seconds maximum.
- App restart count remained `0 → 0`, final container health was `healthy`,
  the migration ledger remained `83`, and the soak-window app logs contained
  zero fatal/unhandled/uncaught matches.
- The soak made no database writes, configuration changes, container changes
  or external-delivery calls and retained no request/session payloads.

## Operational boundary

This evidence proves that the staging baseline is installed and recoverable. It
does not authorize production deployment, production migration, live external
delivery, portal automation, real student data, or merge of convergence PR #30.
Authenticated visual role-by-role browser walkthrough remains a manual staging
acceptance activity; the automated API authorization matrix is complete.
