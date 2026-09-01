# Staging deployment evidence — 1 September 2026

This record covers the isolated synthetic-data staging deployment only. No
production service, production database/storage, production integration, or
`Find-And-Study-OS-Next` branch was changed.

## Identity

- Host: `srv1110168.hstgr.cloud` (`72.61.91.131`)
- Public URL: `https://staging.srv1110168.hstgr.cloud/tr/login`
- Branch: `codex/staging-adoption-runner-20260901`
- Deployed code-bearing commit: `fc9235ec436568aef52e0333553c4c8fa3b60a28`
- Release ID: `staging-20260901-fc9235ec4365`
- App image: `findandstudy-staging-app:fc9235ec4365`
- App image ID: `sha256:fbe20c9466dc0a53f4c65992475a0937d842bd1b512a4efe9c3a08697fb72d6a`

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
  recording the password or session cookie.
- The runtime uses UID/GID `10042`, a read-only root filesystem, dropped Linux
  capabilities and `no-new-privileges`.
- Live integrations, email delivery, background jobs, signed-contract PDF work,
  external AI replies, and Student Journey rollout remained disabled.

## Backup and recovery evidence

- Backup: `/opt/findandstudy-staging/backups/staging-backup-20260901T182508Z-fc9235ec4365.dump`
- Size: `1,205,023` bytes
- SHA-256: `45606c71cd14030913059e1e18861952913081d6b453c3bbe6bcafc4f5c80149`
- Mode/owner: `0640 root:findandstudy-staging`
- The dump restored successfully into a disposable, network-isolated, tmpfs
  PostgreSQL container using the exact digest pinned in `compose.yml`.
- Restored facts: exact ledger `83`, one synthetic user, one active synthetic
  Super Admin, and `190` public tables.
- The disposable restore container was removed and the live staging volume was
  not mounted or changed.

## Operational boundary

This evidence proves that the staging baseline is installed and recoverable. It
does not authorize production deployment, production migration, live external
delivery, portal automation, real student data, or merge of convergence PR #30.
