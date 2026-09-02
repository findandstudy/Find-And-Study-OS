# Staging deployment evidence — 1–2 September 2026

This record covers the isolated synthetic-data staging deployment only. No
production service, production database/storage, production integration, or
`Find-And-Study-OS-Next` branch was changed.

## Identity

- Host: `srv1110168.hstgr.cloud` (`72.61.91.131`)
- Canonical public URL: `https://staging.findandstudy.com/tr/login`
- Temporary rollback URL: `https://staging.srv1110168.hstgr.cloud/tr/login`
- Branch: `codex/staging-adoption-runner-20260901`
- Deployed commit: `ffc7f8d0f54b8becff3162410e86f5942e3c55a8`
- Release ID: `staging-20260902T123142Z-ffc7f8d0f54b`
- App image: `findandstudy-staging-app:ffc7f8d0f54b`
- App image ID: `sha256:d4db218be0bee0c69ba1d89428b5b94068639d739555be806a4cb9923d5f36c1`
- The host checkout and deployed code-bearing commit matched exactly; the
  tracked worktree was clean.

## Custom hostname adoption — 2 September 2026

- The authoritative `findandstudy.com` zone received the exact A record
  `staging` → `72.61.91.131` with TTL `300`. The authoritative server and the
  Cloudflare and Google public resolvers returned the same address.
- Traefik uses one dual-host router for the canonical and rollback hostnames.
  The Let's Encrypt certificate contains both names as SANs; local and public
  HTTPS verification succeeded without disabling certificate checks.
- The application canonical origins and the release-bound RBAC runner now use
  `https://staging.findandstudy.com`. The legacy hostname remains in the exact
  CORS allowlist only as the temporary rollback route.
- The host-only pre-cutover configuration is preserved at
  `/opt/findandstudy-staging/backups/config-cutover-20260902T053051Z-507fdbd0c7ab`
  with `0750 root:findandstudy-staging`; its three files retain `0640`.
- Two fail-closed trial replacements returned to the old image automatically:
  the first waited for certificate issuance, and the second exposed an
  attestation mismatch between the image's named user and Compose's exact
  runtime `10042:10042` identity. No production or database state changed.

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
- A fresh public browser load of the canonical Turkish login route rendered the
  labelled email/password inputs, named password visibility toggle, login and
  registration tabs without an error boundary.

## Workflow UAT and document-content safety fix — 2 September 2026

- The first controlled workflow run stopped fail-closed when
  `POST /api/documents` accepted a metadata-only document with HTTP `201`.
  Cleanup restored the exact baseline and all external-write tables remained
  zero. This exposed a real path by which a missing-document response could be
  recorded without stored evidence.
- Commit `ffc7f8d0f54b8becff3162410e86f5942e3c55a8` now requires a non-empty
  stored `fileKey` or valid `fileUrl` before document registration. Missing
  content returns HTTP `400` with `DOCUMENT_CONTENT_REQUIRED`; the existing
  object lookup, uploader ownership, MIME and content validation still run for
  local uploads.
- Document intake/content regressions passed `18/18`, the staging workflow
  runner's pure tests passed `3/3`, API typecheck passed, and the exact-source
  production build validated the `83/83` migration ledger.
- The accepted run was `stg-workflow-mtk2xr7l`: `39/39` checks passed against
  release `staging-20260902T123142Z-ffc7f8d0f54b`, with `externalWrites=0` and
  `cleanup=API_COMPLETE`.
- The run covered agent lead creation and conversion, agent-owned application
  creation, cross-role visibility denial, an admin-created student application,
  an admin-only missing-document request, a real 68-byte synthetic PNG upload,
  student response, `RESPONDED`-without-`FULFILLED` verification, explicit
  Super Admin fulfillment, and finance/message denials for agent and student.
  It used the configured `offer_received` stage because staging intentionally
  sets `inquiry.uploadPermissionLevel=none`; no stage policy was bypassed.
- The two soft-deleted synthetic document rows, the single object-owner binding,
  and the exact uploaded object plus MIME sidecar were removed after their IDs,
  run labels and storage path were verified. Audit events were retained.
- Post-cleanup baseline was exact: `12` users, `4` active agent rows, `5` active
  student rows, `2` active leads, `0` active applications, `0` documents,
  `0` missing-document rows and `0` object-owner rows. Messages, broadcasts,
  portal submissions, finance mutation requests and Journey outbox events all
  remained `0`. The fixed audit student fields were restored, ledger remained
  `83`, app health was `healthy`, restart count was `0`, and the last 15-minute
  log window had zero fatal/unhandled/uncaught matches.

## Completed visual RBAC UAT — 2 September 2026

- All `11/11` fixed `@audit.test` identities reached the expected landing path:
  Super Admin/Admin/Manager → `/admin/dashboard`; Staff/Consultant/Editor/
  Accountant → `/staff/dashboard`; Agent/Sub-agent/Agent Staff → `/agent`;
  Student → `/student`.
- All `10/10` exact visual route checks passed. Accountant Finance, Admin AI
  Personas/Students, Staff Messages, Student Applications and all three Agent
  dashboards remained on their protected routes. Staff Finance and Staff AI
  Personas redirected to `/en` without protected content or an error boundary.
- Desktop pages had no horizontal overflow or application error. Mobile
  `390 × 844` checks passed for login, Student dashboard/applications, Agent
  dashboard and Staff dashboard/messages; each protected page exposed a visible
  named sidebar toggle. The viewport override was reset after testing.
- The mobile login form kept labelled email/password fields, a visible submit
  control and a named password toggle. The toggle's accessible name,
  `aria-pressed` state and input type changed coherently in both directions.
- Every synthetic role logged out before the next role logged in. The final tab
  was left at `/en/login`; no browser cookie, storage, token or password value
  was inspected or recorded.

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
- Custom-host adoption run
  [33589045478](https://github.com/findandstudy/Find-And-Study-OS/actions/runs/33589045478)
  passed all three Linux, Windows and exact-source hardened container jobs on
  deployed commit `507fdbd0c7ab686b51bfc500ab0c3652a82bcb23`.
- Document-content/workflow gate run
  [33629480415](https://github.com/findandstudy/Find-And-Study-OS/actions/runs/33629480415)
  passed the Linux source/build/safety gate, Windows locked install/typecheck
  gate and exact-source hardened container build on deployed commit
  `ffc7f8d0f54b8becff3162410e86f5942e3c55a8`.

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
- The accepted custom-host backup is
  `/opt/findandstudy-staging/backups/staging-custom-host-20260902T053456Z-507fdbd0c7ab.dump`
  (`1,206,953` bytes, SHA-256
  `3caf6f78fe03289aa2d710976118bb8e3a0febe637ab6fe14d4ce4f35e554735`,
  `0640 root:findandstudy-staging`). Its network-isolated PostgreSQL 16.15
  restore reproduced ledger `83`, 12 synthetic users and 190 public tables;
  the disposable restore container was removed. At final attestation the root
  filesystem reported `31/96 GiB` used (`32%`, `66 GiB` available).
- The immediate pre-workflow backup is
  `/opt/findandstudy-staging/backups/staging-pre-workflow-20260902T120036Z-507fdbd0c7ab.dump`
  (`1,300,216` bytes, SHA-256
  `a6ae13d718c1b465e0755218072c49d1f3591f6398b35e79a3fe0560ce9fd50b`,
  `0640 root:findandstudy-staging`). Its network-isolated restore reproduced
  ledger `83`, 12 users and 190 public tables.
- The accepted post-workflow backup is
  `/opt/findandstudy-staging/backups/staging-post-workflow-20260902T124021Z-ffc7f8d0f54b.dump`
  (`1,211,985` bytes, SHA-256
  `3c7dbb1fb20a9a8801f354610d9213cfabe3d4b931fe3efb12b14a0b69ab8454`,
  `0640 root:findandstudy-staging`). Its exact PostgreSQL 16.15 digest,
  `--network none` and tmpfs restore reproduced
  `fasos_restore|83|12|0|0|0|0|0|0|0|190` for database, ledger, users,
  active applications, documents and five external-write denominators plus
  public tables. The disposable restore container was removed. An initial
  attempt through the migration role correctly failed on FORCE-RLS and removed
  its partial dump before the host-only PostgreSQL owner performed the accepted
  backup.

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
- After custom-host cutover, 12 additional public samples over approximately
  one minute all returned HTTP `200` and the exact new release. Observed
  latency was `0.137559` seconds minimum, `0.156513` average and `0.189079`
  maximum. The post-soak app remained healthy with zero restarts and zero
  fatal/unhandled/uncaught log matches.

## Operational boundary

This evidence proves that the staging baseline is installed, recoverable, and
has completed both the authenticated visual role walkthrough and the controlled
synthetic workflow UAT. It does not authorize production deployment, production
migration, live external delivery, portal automation, real student data,
`Find-And-Study-OS-Next` synchronization, or merge of convergence PR #30.
