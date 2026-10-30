# Academy profile claim repair — deployed and accepted

Owner-approved deployment: 2026-10-30 11:43:42 UTC, product source commit
`0a791d04503ccf0d400900469b556e8a506b12db`. Academy receiver was deployed first.

Base: deployed Apply source release a5f31e065682. The server-resolved owning
agent profile (or managing agent for agent_staff) supplies companyName with a
trimmed businessName fallback and a bounded country label. No request-supplied
agency identity, permission change or new SSO destination is accepted. Existing
role/plan/Academy access gates remain intact.

Read-only parity checked 610 deployed API/DB/Zod source files. Two existing
runtime differences were found in lib/db/src/academicLevels.ts and
lib/db/src/schema/studentEducationRecords.ts: doctorate typing and education
country metadata. Commit 370439470 preserves those exact observed changes so
the SSO release does not revert them. An explicit undefined return in
educationExtraction.ts preserves its existing unknown-field runtime fallback
while allowing this observed baseline to typecheck. No education feature is
enabled or migrated by this release.

Three claim tests pass. Libraries and API typecheck and the full API build pass
using exact pnpm 10.33.2. The historical lock excludes Windows esbuild binaries;
the official npm integrity-verified win32-x64 0.28.1 binary was supplied via
ESBUILD_BINARY_PATH without lock/package changes. This is local tooling only.

No new migration SQL, bulk backfill, credentials, uploads,
DNS or email configuration changes. Receiver must deploy before issuer.
The live Apply directory is not a Git checkout; exact source parity/manifest
and compiled artifact hashes must be rechecked immediately before publication.
The two API applications require controlled restarts. Existing startup SQL and
background schedules may run normally; do not start extra workers or drain
queues manually. Verify fresh backup, rollback application copies, health,
normal login, first/repeat SSO and completed-profile preservation after rollout.
Source is published in draft PR #39; no branch merge was performed. Production
approval and bounded rollout are complete. Real first/repeat SSO proved business
name fallback, country normalization, one linked account/agency and preservation
of the prior synthetic account's completed data. Fresh verified DB/storage
backups and application rollback copies were retained. Both public health checks
return 200/ok; exact deployed file hashes match the approved manifest;
46 unrelated containers did not restart. DNS and worker definitions were not
changed. Password login and email delivery are outside this acceptance test.
