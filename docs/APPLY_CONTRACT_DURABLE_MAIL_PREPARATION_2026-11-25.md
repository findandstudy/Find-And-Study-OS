# Apply contract mail — local preparation, not activated

This compatibility implementation is for the attested Apply legacy source/67-entry ledger. Staging already has newer email infrastructure; do not copy this migration onto staging or replace its queue. Runtime user-facing behavior is intended to match: an immutable PDF attachment, truthful delivery state and no automatic resend after uncertain acceptance.

## What is connected

With the default-off mode enabled after migration, `finalizeSign` atomically inserts one delivery record for the **new** signed contract. A queue failure rolls the signature transaction back. Startup never scans historical signed contracts for enrollment, including TEST02/47.

The existing background-job coordinator starts the module worker in place of the explicitly disabled legacy delivery worker. Preparation uses only the enrolled signature/session snapshots, rejects missing historical information or external images without frozen bytes, and compares-and-sets only an absent PDF **and** evidence hash. It does not load the current agent, template or company signature. It freezes the email body and attachment key/SHA-256. The SMTP adapter reuses the existing DNS/IP-pinned, certificate-verified TLS configuration but does **not** use `email_queue`.

An attempt is committed as `sending` before SMTP starts. Only an exact recipient/message-ID acceptance receipt atomically marks the delivery accepted and sets `signed_contracts.emailed_at`. Acceptance means the SMTP server accepted the message, not that the recipient opened it or it reached the inbox. Lost connections, timeouts and crashes after starting SMTP remain `ambiguous`; they never automatically return to the send queue. Operator reconciliation requires provider evidence for the fixed message ID. No reconciliation UI or automatic retry override is added.

## Disabled-by-default activation gates

- `SIGNED_CONTRACT_DURABLE_DELIVERY_MODE=off` (also default when missing/invalid).
- Both `SIGNED_CONTRACT_DELIVERY_ENABLED=false` and `SIGNED_CONTRACT_PDF_WORKER_ENABLED=false` are prerequisites for either new mode; they prevent legacy historical sweeps.
- `prepare` may enroll and produce new PDFs, but cannot send.
- `send` additionally requires `ALLOW_LIVE_INTEGRATIONS=true`, `EMAIL_DELIVERY_DISABLED` not equal to `true`, and `NODE_ENV` not equal to `test`.
- Existing `BACKGROUND_JOBS_ENABLED` and the existing coordinator still control worker startup. No new process/service is required.

## Prepared migration, not applied to persistent environments

`deploy/prepared-migrations/apply/0067_signed_contract_delivery.sql` is intentionally outside the canonical journal. Apply's actual prefix is 67 entries, ending `{idx:66,tag:0066_education_country,when:1791040178940,version:7,breakpoints:true}`. Expected actual 0066 SQL SHA-256: `72747e384a9b6ce96c1f72947cfbdf83808310ab0904a528cc38e7d7c93c8f52`; snapshot SHA-256: `d76e1bd3ecc281f3c361eaf88f8d28f359baaf6e1f652e1fc52aec1eeceea391`.

The hotfix Git base ends at 0065. Do not fabricate a 0066 snapshot or overwrite the live journal. Assemble the reviewed 0067 journal/snapshot on the attested overlay before requesting production migration approval. The additional full-prefix test runs the real Drizzle migrator on fresh 0000–0065, SHA-exact actual 0066, and prepared 0067 in disposable PostgreSQL16.15: 67 existing ledger entries remain byte-identical, 0067 advances to68, replay stays68, and zero historical deliveries appear. Production journal assembly/review remains separate; no persistent ledger was changed.

Prepared 0067 SQL SHA-256: `73c3dc386d18cb7bd37dc9b1b19f7401469f5e7a3063f36f9f08c929082d2666`. The SQL creates an empty table, two foreign keys, an index and a trigger; it does not scan or backfill historical contracts. Foreign-key DDL still briefly locks the referenced tables. This preparation does not install a migration advisory lock: the reviewed release runner must serialize migrations under its existing authority/lock, with finite lock/statement timeouts. A PostgreSQL advisory lock is cooperative and does not replace the maintenance-window or competing-writer check. Abort rather than wait indefinitely for DDL locks.

Before activation: verified backups, reviewed exact-source overlay preserving all live drift, Linux/browser/storage checks, exact-prefix migration replay, recipient-approved isolated canary, and an operator method for inspecting ambiguous receipts. Keep the first code deployment at `off`; no real signature, account activation or mail send is part of local tests.

New signing sessions also require exact configured `CONTRACT_PDF_TRUSTED_LOGO_URLS` and successful frozen logo capture whenever a template has a logo; an unfrozen external image blocks preparation. Configure this for reviewed public logo assets before enabling enrollment, rather than silently replacing historical signed branding.

## Rollback and limits

Set mode `off` first and drain the worker. Retain the additive table and all receipts; do not clear ambiguous rows, delete signatures or restore the live database. Reverting code is safe while off because the old application does not read this table. Do not re-enable the legacy worker: its body-only queue and unconfirmed `emailed_at` behavior are deliberately not used by the new path.

TEST02/47 remains outside automatic enrollment. Its PDF recovery is a separate exact-record reviewed operation. Sending its recovered PDF needs a separate explicit request and durable enrollment/reconciliation procedure; this change cannot silently notify historical signers or administrators.

## Local validation

Tests use `CONTRACT_DELIVERY_TEST_DATABASE_URL` restricted to `127.0.0.1` and a brand-new `fas_contract_mail_test_*` database. Fake SMTP verifies attachment bytes, recipient, message ID and acceptance/rejection/ambiguity; no real transport is called. Route-level signing tests use a synthetic transaction executor and fail closed on network/DB access. The built production adapter is separately exercised with fake nodemailer/SMTP config dependencies.

Public signing status and the authenticated agency account project only `pending`, `sent` (SMTP accepted), `attention` or `unconfirmed`. They never expose queue contents/provider credentials or trust legacy `emailed_at` without a matching durable receipt. Missing migration, absent historical enrollment and lookup failure remain unconfirmed. Other agencies cannot read a receipt through the account projection. UI status polling is bounded and does not enqueue or send anything.

Final local results: durable delivery/enrollment/fake SMTP **19 PASS**; exact-prefix migration and replay **1 PASS**; targeted lifecycle/template/render/recovery regression **67 PASS**; signing regression **18 PASS** after supplying its required inert loopback `DATABASE_URL`; API and Edcons typecheck/build **PASS**; built-browser Account/signing/admin smoke **3 PASS** (English desktop, Turkish mobile, Arabic RTL mobile). The browser suite checks pending → accepted → attention email copy, PDF download and stale-202 refresh recovery. No real SMTP, signature or customer data was used. PostgreSQL acceptance time is copied directly inside the acceptance transaction, preserving database microseconds for the receipt/status consistency check.

The exact-prefix invocation used a new empty database in the disposable PostgreSQL16.15 cluster on loopback port50110:

```powershell
$env:CONTRACT_DELIVERY_PREFIX_DATABASE_URL='postgres://contract47_test@127.0.0.1:50110/fas_contract_mail_prefix_test_20261125a'
$env:APPLY_0066_SQL_PATH='C:\Yeni WEBSİTESİ\Find-And-Study-OS-Apply-Contract-Hotfix\.codex-tmp\live0066.sql'
node 'C:\Yeni WEBSİTESİ\.staging-tools\pnpm-10.33.2\package\bin\pnpm.cjs' --filter @workspace/api-server exec tsx --test scripts/test-contract-delivery-migration-prefix.ts
```

For a rerun, create a **new** empty database whose name starts `fas_contract_mail_prefix_test_`; the test refuses existing public tables. Local receipts are `.codex-tmp/mail-prefix-test.log`, `mail-final-tests.log`, `mail-regression-tests.log`, `mail-sign-regression.log`, `mail-ui-tests.log`, `mail-typecheck-final.log`, `mail-ui-typecheck.log`, `mail-api-build.log` and `mail-ui-build.log`. These local logs are not deployed. The first aggregate regression run exposed a missing test-only `DATABASE_URL`, not a product failure; the isolated signing rerun passed all18 assertions.

Residual operational limits: a crash after storing a new private PDF but before its database compare-and-set may leave an unreferenced object for later reviewed retention cleanup. Existing accepted/ambiguous records remain immutable. Linux runtime validation, a recipient-approved isolated SMTP canary, production journal assembly and operator receipt reconciliation remain activation gates; local results are not evidence of inbox delivery or an Apply deployment.
