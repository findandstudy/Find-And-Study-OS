# Staging contract parity execution — 26 November 2026

## Result

Deployed source `1a7254915bfbc36a6d5cab3dacbcb143574d754f`, release `staging-20261126T100916Z-1a7254915bfb`, image `sha256:215336be733913c576e774a46a9338185728720e227c9426115f3759e78927f3`.

The exact live base changed during preparation from ee2561a9 to e7b12e3a. The first read-only identity check rejected the removed container before backup or switch. A new isolated integration branch preserved e7b12e3a's Home.tsx, PublicPage.tsx and homeVistaraParity.css. The10-file contract patch was applied on top. Source was pushed to `codex/staging-contract-parity-e7b-20261126`; remote head was independently read. The staging source checkout was clean and fast-forwarded to that source on a separate feature branch.

## Backup and deployment

- Fresh staging backup at09:54:52UTC: DB12617121bytes SHA256 `4dd31c7e9f33966ff58b755e712ca8a57cf5ee629defe2b4d0ef0e4536b32537`; restore-list PASS. Storage16242936bytes SHA256 `83d882219bf15eab3a80a1a0de3832a1c5d4e873ad7bb4f1e2f3b474b5de5f64`; gzip/tar verification PASS.
- Migration ledger144 and fingerprint `e1a215c2390356b0452e8c460b15cecc` unchanged. No migration or restore.
- Actual image source matched the Git base; no /app bind shadow. The candidate reused its installed dependencies with network disabled, synthetic inputs and outbound/worker guards closed.
- Initial image assembly failed because BuildKit interpreted a raw image ID in FROM as a registry name. No service was changed. The successful tests/build/source/context hashes were retained and revalidated; only image assembly resumed using an exact verified local image tag. Original failed receipt/log remain preserved.
- Final build receipt SHA256 `98ebc79b8c78ea0b605ad2b52102837b700b392507058c7be14ea76eaec70b18`.
- Only the staging API was switched, after stop confirmation. New container `59d0e03e88ba4a8950bac68b49eb2faa70b161ad48abedd765ed76aff194854e`; health200, exact release and DB connectivity passed. Other container identities/start states remained unchanged.
- Existing staging compose/app configuration now selects the candidate image, release and approved logo URLs. Only FASOS_STAGING_APP_IMAGE, RELEASE_ID and CONTRACT_PDF_TRUSTED_LOGO_URLS changed; remaining bytes/ownership/permissions were preserved. Resolved compose image/release matched the running container. No compose restart, CI/CD edit or production configuration change was performed by this parity step.

## Content transfer boundaries

- Existing staging template18 remains unchanged. New template19/version7 is draft/inactive and supersedes18; it uses the canonical designed Apply49 body SHA256 `8acd631311960b96440f9389b8d65afb4b90a6d9e29a2b1db206cea50c29605b` with matching existing staging intake metadata.
- Staging Find And Study profile2 changed only its logo URL. Dorm profile1 and every previous template were preserved through exact-row comparison.
- Approved public colored PNG SHA256 `902221ef74cd780adb0ae628638f678c635c3f6fdd1e99758415d37a12068998`; white hero PNG SHA256 `628e13a0499e45bf19784e3376e581d76ef239e94a8ccf96fba22d449debf29b`. Both are local public content-addressed files, added to the existing bounded exact URL allowlist. No generic external image access was enabled.
- Existing unsigned-preview code already supports inline logos whose exact bytes match an approved local public logo. No additional preview rewrite was required. Private signatures and arbitrary images remain omitted.
- Final counts:19 templates,0 signed contracts,0 signing sessions,14 users,0 agent applications,144 migrations. No Apply signed record, user, session, signature, evidence or queue was copied.
- All staging outbound email/live integration/background flags remain closed. Apply's durable delivery migration and worker were not transplanted over staging's existing email queue architecture.

## Validation

- Exact Linux candidate:92 backend tests PASS,0 FAIL; includes synthetic finalizer/router coverage and actual Chromium rendering. No real signing or SMTP call.
- API/web TypeScript, API build, web build,23-locale key parity, critical dictionaries and bundle budgets PASS. Existing build warnings are retained in the log.
- Earlier local patch verification:3 built SignFlow browser cases (EN desktop,TR/AR mobile) PASS; not represented as fresh production E2E evidence.
- Actual authenticated staging admin UI: version7 preview opens, CSS and both logos display, signatures remain blank/test-only. Download unsigned test PDF completes; UI shows PDF ready and Save PDF fallback.
- Actual downloaded PDF:328729bytes,6 A4 pages, SHA256 `9c6b3ad4105afc3386b6e174e010a3a0b9086320c3b2601f3e2c90a8f456dcb7`. All six pages rendered and visually inspected. No fake real signature or account activation was performed.
- Local operator tests:config clone6,persistence8,switch12 PASS; independent reviews found no further blocker. Remote helper receipts, not helper existence, establish the applied operations.

## Evidence and rollback

Private server evidence: `/opt/findandstudy-staging/backups/apply-contract-send-20261126` and `/opt/findandstudy-staging/backups/contracts-parity-20261126`. No secrets, storage copies or private operator inputs are committed.

Local proof: `C:/Users/Find And Study/.codex/artifacts/TEST02-contract-recovery-20261126/staging-contract-v7-preview.png` and `staging-v7-unsigned-preview.pdf`.

Rollback uses the retained prior staging image/config and keeps approved public logos. It does not restore the DB, erase template19, alter signed documents or send mail. If rolling back, also reconcile the three persisted image/release/logo selections with the chosen runtime before any later compose deployment. An ambiguous Docker create response requires inspection rather than blind replay.

Apply remained healthy on `20261126-contracts-send-c0a02d8c99f4`; its future-only email mode was unchanged by staging parity. Apply admin browser testing remains separate because that browser required login; actual Apply agent download and the TEST02 received Gmail attachment were verified in the Apply execution report.
