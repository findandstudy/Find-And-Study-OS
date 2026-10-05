# Communication integration accounts — 2026-09-21

## Scope and behavior

- The named Anthropic connection action belongs to the Claude card, not the generic integrations header.
- Email Accounts opens the existing Notifications SMTP sender manager in sender-only view. It uses the same sender records, encrypted secrets, revision verification and separate-reviewer controls. Legacy SMTP configuration remains available; no second email-account registry was introduced.
- Telegram and Twilio SMS support multiple encrypted **configuration records** in the existing `channel_accounts` registry. Native sending/receiving adapters are absent. These records are explicitly configuration-only; activation, default sender selection and connection verification cannot falsely claim a working delivery channel.
- Zernio Accounts manages linked WhatsApp, Instagram, Messenger and Telegram identities using the existing Zernio integration credential and webhook. It does not connect multiple independent Zernio API credentials. Saving a reference is not provider authorization or verification. New references start inactive.
- Existing direct Meta accounts stay provider-separated. Zernio `facebook` aliases project as Messenger without moving historical conversations.

## Safety and compatibility

- No migration, new account table, provider call, real message, credential activation, push or deployment was performed.
- Account writes/tests require an active, non-impersonated human admin session. Existing manager read access remains. SMTP cannot be edited through generic account CRUD.
- Config fields are allowlisted, encrypted and fully masked; unchanged masked/blank credentials are retained. Provider diagnostics do not expose raw errors or tokens.
- The new Zernio account verifier is read-only, fixed-origin and redirect-denied, bounded to 10 seconds / 64 KiB / two in-flight checks. It checks the exact account/profile and never logs the provider body or token.
- Explicitly pinned inactive/missing/other-provider accounts cannot fall back to another direct account or legacy credentials. Null legacy account references retain the existing fallback.
- Credential-free direct accounts created by legacy webhooks retain compatibility only when active, uniquely registered, and exactly matched to the enabled legacy integration's channel-specific external identity and usable credential. An Instagram business identity takes precedence over its linked page identity. Missing, mismatched, disabled or ambiguous identities cannot inherit credentials; valid configured pipeline priority remains unchanged.
- Zernio send boundaries require one unique active account and an enabled integration. An explicit disabled outbound flag wins in production-mode tests too.
- Inbound registration and account management share bounded transaction locks. Disabled or ambiguous account identities cannot be silently re-registered.
- Deletion is refused for accounts still referenced by conversations, communication pipelines, stage rules, dispatch history or campaign recipients.

## Validation

- API and Edcons TypeScript checks: PASS.
- API build and Vite public build: PASS (existing Vite sourcemap/chunk warnings remain).
- 23-locale key/placeholder parity and public bundle budget: PASS.
- Account management policy and integration-test result tests: PASS.
- Bounded Zernio account verifier: 5 PASS with mocked provider responses, including timeout/oversize/revocation failures.
- Express account route tests: 6 PASS with DB/provider doubles, including denied actors, SMTP exclusion and reference-safe deletion.
- PostgreSQL session/CRUD/identity tests: 11 PASS against temporary shadow tables on the allowed local database, including disabled/enabled/unreadable Zernio key cases and identity-bound legacy webhook account/pipeline compatibility. Public account count remained 15; temporary sequences avoid changing public sequences. The session cannot recycle or reconnect into public tables. This is single-connection SQL coverage, not independent-connection race or full foreign-key/trigger certification.
- Zernio send guard, media, broadcast and template availability tests: PASS (provider calls mocked).
- Meta channel and webhook identity regressions: PASS.
- Existing email delivery, queue, template and stage policy tests: 50 PASS.
- Frontend account helper and existing email UI tests: 23 PASS.
- Built-app browser account smoke: English desktop, Turkish mobile, Arabic mobile/RTL PASS. All APIs synthetic; external requests blocked.
- Existing email browser smoke: 3 locale/layout and 3 denied/read-only authority scenarios PASS.
- Legacy route inventory and tenant writer classification: PASS; existing quarantine decisions unchanged.

## Not included / follow-up

- Native Telegram and Twilio send/receive adapters, incoming webhook verification and account-aware composer/notification routing remain implementation work. Configuration records alone are not complete messaging integrations.
- Gmail/Outlook OAuth, IMAP/incoming mailbox synchronization are not provided by SMTP sender management.
- Multiple independent Zernio provider credentials require a separate connection-scoping design; this slice reuses the existing provider integration.
- Real credentials, provider permissions, delivery verification and staging UAT need a separately authorized rollout. No claim of live delivery readiness is made.

Status: locally implemented account-management slice; native Telegram/SMS delivery remains incomplete. Not deployed.

## Production request preflight — 2026-09-21

The user requested production deployment. No production write, migration, restart, provider activation or deployment was performed.

- Public production health read at `2026-09-21T15:11:15.504Z`: `status=ok`, `dbConnected=true`, release `20260911T101300Z-a5f31e065682`.
- A refreshed GitHub origin resolves that release prefix to `a5f31e06568229d5f61fa29a1416dd46b83119b0` (`fix: restore bulk lead spreadsheet import`). This is a source correspondence, not an on-host worktree attestation.
- At the preflight's existing branch HEAD `c190681d2dde2b2828bdbf52c0417f40c2ea71ef`, the symmetric source difference is one production-only commit and 266 branch-only commits, before this uncommitted account slice. The production-only bulk-import fix must not be lost.
- The production-source migration journal ends at `0065` (66 entries), while the current branch ends at `0125` (126 entries). This is **not** a measurement of the current production database ledger. The whole branch cannot be treated as a migration-free account UI release; it also contains unrelated, separately gated foundations.
- SMTP account UI requires the previous email library/queue changes. Their `0124–0125` schema dependencies and consumer/rollback constraints must be reconciled with a production-based, scoped candidate. An old email consumer cannot safely consume new revision/claim-aware queue records.
- The independent local review found and fixed the credential-free legacy account regression described above. The expanded local PostgreSQL tests, API TypeScript and API build passed; 34 focused mocked account/security/webhook tests passed again. No real provider requests occurred.
- The old Hostinger web-terminal session expired. A new hPanel console was opened, but its terminal output was unavailable to the automation. Live dirty-worktree state, database identity/ledger, backup/storage recoverability, worker/queue impact and rollback remain unverified.

Decision: **NO-GO for production deployment in this turn**. First obtain a readable console and finish read-only attestation, prepare a narrowly scoped production-compatible release retaining existing live fixes, then present the exact source/files/schema/backup/worker/health/rollback preflight and obtain the required explicit approval. Do not deploy the entire staging branch or apply its migration tail implicitly.

## Corrected deployment target — staging only

The user clarified that "canli" meant the deployed **staging** site, not production. Production authorization is withdrawn; the production comparison above is retained only as historical context and is not a staging blocker. The authorized baseline is the already deployed staging source `c190681d2dde2b2828bdbf52c0417f40c2ea71ef`, release `staging-20260921T133434Z-c190681d2dde`, ledger 126. This account slice has no migration. Staging deployment must preserve all outbound/background/provider gates, take a fresh staging backup and isolated restore proof, check exact-head CI, and switch only the staging application container with an exact previous-image rollback. Actual host verification and deployment evidence are recorded separately; this note does not claim deployment success.
