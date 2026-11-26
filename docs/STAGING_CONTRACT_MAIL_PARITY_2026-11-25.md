# Staging contract mail parity — local change, workers remain off

This change reuses staging's existing `email_queue`. The separate Apply compatibility migration0067 and worker are not copied here.

## Connected fixes

- An SMTP attempt returns confirmed delivery only after its durable queue receipt is saved. A failed write or a zero-row/replaced-claim update returns false, so contract delivery cannot set `emailed_at` from an unrecorded acceptance. The queue retains the existing stale-processing → unknown policy and never blindly resends that attempt.
- SMTP acceptance must name exactly the intended recipient and message ID, with an affirmative2xx response and no rejected recipient. An incomplete or inconsistent response remains unknown.
- Authorized signing and own-agency reads project the existing contract-specific queue item as pending, sent (SMTP accepted), attention or unconfirmed. Projection requires the contract/session/recipient binding and one checksum-valid PDF attachment; sent additionally requires its queue message ID, acceptance time and equality with the stored signed PDF bytes (10MiB/10second read limit). An unrelated valid PDF or unavailable storage stays unconfirmed. Legacy `emailed_at` alone proves nothing. No email content, provider diagnostics or credentials are returned.
- Account and signing screens show the projection with bounded polling; acceptance means the mail server accepted it, not guaranteed inbox delivery.

## Preserved activation boundaries

No schema, migration, permissions, live data, provider call or runtime flag changes are included. Staging must retain `BACKGROUND_JOBS_ENABLED=false`, `SIGNED_CONTRACT_PDF_WORKER_ENABLED=false`, `EMAIL_DELIVERY_DISABLED=true` and `ALLOW_LIVE_INTEGRATIONS=false`.

Two pre-existing differences from the new default-off Apply path remain **activation blockers**, not fixed by this narrow patch: staging's contract worker still automatically selects recent unemailed records, and its historical PDF helper can fall back to mutable template/agent data and only guards an absent PDF key. Do not enable historical rendering, backfill or outbound delivery until explicit new-record enrollment and frozen-input/evidence safeguards are addressed. This patch does not alter any signed historical record.

## Validation and rollback

The actual existing queue/SMTP functions are tested with synthetic database/SMTP doubles and a network-deny guard. Tests cover receipt-write failure, replaced claim, wrong/multiple accepted recipients, wrong message ID, non2xx/incomplete response and no subsequent automatic resend. Status tests cover owner/session boundaries, missing/corrupt attachments, absent receipts and pending/uncertain results.

Targeted tests: `test-email-delivery-policy.ts`, `test-email-queue-delivery.ts`, `test-signed-contract-delivery.ts`, `test-contract-delivery-status.ts`, `test-agent-contract-lifecycle.ts`: **74 PASS**. Logs: `.codex-tmp/staging-mail-parity-final-tests.log`. No live DB or SMTP was used.

The tightened attachment-to-stored-PDF projection was separately rerun: **4 PASS**, including a different valid PDF and unavailable storage. API/Edcons typecheck and build passed; the built UI browser suite passed English desktop, Turkish mobile and Arabic RTL mobile (**3 scenarios**) with pending → accepted → attention copy and PDF download regression. Logs: `.codex-tmp/staging-mail-status-final.log`, `staging-mail-api-final-typecheck.log`, `staging-mail-ui-typecheck.log`, `staging-mail-api-build.log`, `staging-mail-ui-build.log`, `staging-mail-browser.log`. Existing unrelated build warnings remain; there are no runtime sends in these tests.

Rollback is code-only with all existing worker/outbound flags kept off. Preserve queue rows, receipts and signed records; no DB restore or deletion is required. The user-facing projection is additive and its absence is safe for the older UI/API.
