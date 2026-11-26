# Apply contract delivery execution — 26 November 2026

The project owner approved the previously presented exact source/preview/backup/deployment plan with “yap”. This is the execution record; the preflight document remains unchanged as the approved byte artifact.

## Confirmed Apply changes

- Source `c0a02d8c99f4baf98bc6d52e74813dfc36b7a3fb`, release `20261126-contracts-send-c0a02d8c99f4`; prior release `20261125T212151Z-contracts-25164abd3616` was preserved.
- Fresh DB custom backup 6,007,840,568 bytes, SHA256 `7f545261c3cb31bada5a2294696f05f9d8182cedf2cb5f813ed2021e3f920803`; restore-list PASS.
- Fresh storage archive 1,453,661,741 bytes, SHA256 `e52c9ae7323047a50a8c551ebf49d0056b017b322384252d00b0827e108471d2`; archive integrity PASS.
- Ledger remained68; no migration or DB restore. Existing29 expired legacy claims remained untouched; active claims/sending/preparing were zero before maintenance.
- Contract47/session165 TEST02 received the exact reviewed reconstructed PDF: SHA256 `45e26ec2214a5a3d432b673d3a94f14c49b1c2eda3cfc358af5aa7ef0dbe9b94`,481025bytes. No re-signing, altered frozen contract text, guessed WhatsApp number, or replacement of an existing PDF.
- Recovery manifest SHA256 `6b1cd0fbf47ad9db3a39f0f5a967500477ce322ea7323e8b045a4ae5e5f9c237`; one-row recovery PASS. Post-recovery input digest `d577eb470e2cdc0002b0b5d59a3b66095161dfc787c8cfb9b3e286ec5a5c0882`.
- Exact47 enrollment manifest `96f18f8023d4c2ef8c39bda8aabe88af1358283cad1d62d93a3296117f8b4320`; one ready delivery, fixed disclosed reconstruction email, no send during enrollment.
- Profile1 logo-only CAS and template49/version7 canonical body/publication applied. Template14,48 and profile2 unchanged. Canonical49 body SHA256 `8acd631311960b96440f9389b8d65afb4b90a6d9e29a2b1db206cea50c29605b`; colored public logo SHA256 `902221ef74cd780adb0ae628638f678c635c3f6fdd1e99758415d37a12068998`. Original white logo retained.
- Canary47 SMTP accepted `2026-11-26T09:40:17.114508Z`. One exactTEST02 recipient and Message-ID `<fas-contract-47-test02-recovered-v1@findandstudy.com>`; SMTP response digest `f21252cbe5ea897b3f53c6cff71cc903b8fb5395f0b6b9813d56c92226b90afc`.
- Gmail inbox message `1a2173a44d02d04e` was independently read. Its single481025byte PDF was downloaded and hash matched the approved PDF. SMTP acceptance was not substituted for inbox evidence.
- The real TEST02 agent session at My Account→Agency displayed the signed contract and delivery status. The actual Download signed PDF action produced `Downloads/signed-contract.pdf`; byte count and SHA256 matched. Browser download-event listener timed out, but the actual newly created file was independently verified.
- Future-only mode activated at fixed `2026-11-26T09:42:07.187Z` (12:42:07 Türkiye). Both signature and enrollment must follow that cutoff; all preexisting rows were excluded. Current API container `8677f238ec6c57c97e893310718fd05876979606ebc68c74a2873b8cadfd9665`. Legacy delivery/PDF workers remain false; unrelated global email/integration settings unchanged.

## Distinctions and limitations

- Application12 was already approved at `2026-11-26T05:04:27.566Z`, before this deployment. This operator did not approve or activate the agency. The current account screen correctly showed Active. Earlier notes saying approved_at was null are superseded by this actual read.
- The recovered PDF is explicitly marked as a later reconstructed rendition, not the original signing-time PDF. Original signatures/date/text are retained; unavailable historical WhatsApp remains blank.
- Apply admin browser verification could not run: the independent browser opened `/admin/contracts` and redirected to login. No password was requested, session fabricated, or access expanded. Agent download and server/SMTP/mailbox verification did run.
- No real new signature was submitted to test future mode. Existing unit/integration/render/UI gates and exact47 production canary support the rollout; a future ordinary signature has not been artificially created.
- Staging parity completed separately: release `staging-20261126T100916Z-1a7254915bfb`. A concurrent homepage deployment advanced the staging base from `ee2561a9` to `e7b12e3a`; the contract patch was rebased on that exact source, preserving its three homepage files. GitHub feature branch `codex/staging-contract-parity-e7b-20261126` and the clean staging checkout contain `1a7254915bfbc36a6d5cab3dacbcb143574d754f`.
- Staging received a new inactive draft template19/version7, superseding its own template18. Profile2 received only the public logo URL; the canonical designed body and approved white hero logo were transferred. No signed Apply records, users, sessions or company signatures were imported. Final staging counts:19 templates,0 signed contracts,0 signing sessions,14 users,0 applications; ledger144 unchanged.
- Staging Linux tests92/92, API/web TypeScript, API/web build and bundle checks PASS. Real authenticated admin panel preview displayed both logos and styling. Its actual Download unsigned test PDF action produced a328729byte,6-page PDF, SHA256 `9c6b3ad4105afc3386b6e174e010a3a0b9086320c3b2601f3e2c90a8f456dcb7`; all six pages were visually inspected. The PDF is explicitly unsigned/synthetic, not a new legal signature.
- Staging outbound remains disabled. The running image/release/approved logo list were also persisted to the existing staging compose/app configuration; other values remained unchanged. Compose resolution was checked against the running image and release. Apply remained on the above production release throughout staging work.

## Rollback and evidence locations

Private operator/preview inputs: `/opt/findandstudy-staging/backups/apply-contract-send-20261126`.
Fresh production backups/receipts: `/srv/academy160-preview/backups/contracts-send-20261126`.
Private observations, actual user-decision evidence, source/build/test manifests and exact operation logs bind each step. No secrets/dumps/storage are included in this repository.

Rollback disables contract SMTP and returns to prepared code while preserving signed artifacts, delivery receipts and all current DB data. It cannot recall a delivered email. No blind retry, historical mass send, DB restoration, account activation or external message was performed beyond the approved exactTEST02 email.
