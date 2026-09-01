# Staging deployment evidence — 1–2 September 2026

This record covers the isolated synthetic-data staging deployment only. No
production service, production database/storage, production integration, or
`Find-And-Study-OS-Next` branch was changed.

## Identity

- Host: `srv1110168.hstgr.cloud` (`72.61.91.131`)
- Public URL: `https://staging.srv1110168.hstgr.cloud/tr/login`
- Branch: `codex/staging-adoption-runner-20260901`
- Deployed code-bearing commit: `65f85d6577e5ba9eb8e3b4863b6baa4113ede71e`
- Release ID: `staging-20260901T212010Z-65f85d6577e5`
- App image: `findandstudy-staging-app:65f85d6577e5`
- App image ID: `sha256:dcb3f17fc917562fadd174a7fafcc77050e181e9bdd10622c941a1f81041f91c`

## Runtime and database evidence

- App and PostgreSQL containers reported healthy after deployment and after the
  restore drill.
- Public `/api/healthz` and `/api/health` returned HTTP `200`; the detailed
  health response reported `dbConnected=true` and the expected release ID.
- PostgreSQL database `fasos_staging` matched the canonical `83/83` migration
  ledger.
- Only synthetic reference data and the synthetic
  `staging-admin@findandstudy.com` Super Admin were seeded.
- Server-side login, authenticated `auth/me`, and logout smoke passed without
  recording the password, CSRF token, or session cookie. The smoke reproduced
  the browser's initial GET → CSRF cookie/header → login contract.
- The runtime uses UID/GID `10042`, a read-only root filesystem, dropped Linux
  capabilities and `no-new-privileges`.
- Live integrations, email delivery, background jobs, signed-contract PDF work,
  external AI replies, and Student Journey rollout remained disabled.
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
- Both runs completed the Linux source/build/security gate, Windows locked
  install/typecheck gate, and exact-source hardened container build.

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
- Final free disk was `31,164,538,880` bytes (`70%` used); build images were
  retained and no Docker prune/retention mutation was performed.

## Operational boundary

This evidence proves that the staging baseline is installed and recoverable. It
does not authorize production deployment, production migration, live external
delivery, portal automation, real student data, or merge of convergence PR #30.
