# Inbox: independent filters and explicit provider blocking

## Scope and implementation

- Status and assignee selectors are independent. Mine/unassigned are person filters; old pinned preferences are mapped to the new selector. Existing API tab values remain supported.
- Account filtering uses the existing `conversations.channelAccountId`, not contact phone or message-text matching. All accounts, a specific receiving account, and legacy/unlinked conversations are distinct. Changing filters resets pagination and selection.
- Staff-only filter-account DTO exposes only ID, channel, display name and active flag. No credentials or arbitrary metadata are returned. Administrators can use existing account display names to identify their lines/usernames.
- Bulk actions run at most four individually authorized requests concurrently, up to 100 unique selected conversations. Each failed conversation remains selected when filters have not changed. No automatic retries of ambiguous external effects.
- System-only blocking uses the existing contact block endpoint and inbound/bot guards. It affects that contact's conversations and does NOT prevent a person writing in the provider app.
- Provider blocking/unblocking uses the exact receiving account. Direct Meta WhatsApp and Zernio WhatsApp adapters require HTTP success plus a matching per-user receipt; partial rejection, unsupported channels, timeouts and missing credentials do not count as success. No legacy/default account fallback and no silent local-block substitute.
- Existing system block controls are explicitly labelled as system-only. Provider changes leave local blocks unchanged.

## Safety and activation

`INBOX_PROVIDER_BLOCK_ENABLED=true` AND the existing live-integration gate are required for provider mutations. Default is disabled, including in production unless explicitly configured. No runtime configuration, provider contact, database data, staging deployment or production deployment was changed in this task.

Every provider request requires authenticated staff/admin access, existing entity-scope authorization, an explicit confirmation marker and a per-user PostgreSQL rate limit (100/minute). The exact account must exist, be active, and match the conversation/contact channel. Zernio integration must also be enabled. Audit records carry operation/account/conversation identifiers and normalized outcomes, not credentials or recipient phone numbers. Provider network calls have an eight-second timeout and reject redirects. A timeout is an unknown result, not proof that nothing happened; check the provider before retrying.

## Provider contracts and limits

- [Meta block users](https://www.postman.com/meta/whatsapp-business-platform/request/ywjuxcf/block-user-s): POST phone-number-ID/block_users; matching added_users receipt required.
- [Meta unblock users](https://www.postman.com/meta/whatsapp-business-platform/request/uv3p1z9/unblock-user-s): DELETE with matching removed_users receipt.
- [Zernio block users](https://docs.zernio.com/whatsapp/block-whatsapp-users) and [unblock users](https://docs.zernio.com/whatsapp/unblock-whatsapp-users): exact accountId + users; per-user blocked/unblocked and failed results.
- WhatsApp restricts blocking to consumer contacts that messaged within the last 24 hours; other Business accounts cannot be blocked. API responses remain authoritative.
- Instagram native blocking is not implemented: no verified provider contract was established for it. System-only block must never be described as a native Instagram block.

## Verification

- 18 executable unit/regression tests: account parsing, combined filter query construction including mine/unassigned, bulk concurrency/dedup/failure retention results, direct/Zernio block receipts and failures, existing status permissions: PASS.
- 3 source contract checks for endpoint authorization, filter predicates, exact-account/no-fallback, rate/activation/confirmation/audit gates: PASS. These are not HTTP/database integration tests.
- API and Edcons TypeScript checks: PASS.
- i18n key and placeholder parity across 23 locales: PASS. New copy is translated in Turkish/English; remaining 21 locales currently use explicit English copy and require editorial translation.
- Legacy role-gate registry refreshed without changing enforcement classifications. Tenant-writer inventory checked; existing quarantine boundaries remain.

## Remaining release gates

- Real-data staging HTTP/UI UAT, narrow/mobile/RTL visual inspection, database query-plan check for large account/status combinations.
- Consent-based test-contact provider block/unblock on one direct and one Zernio line, including account isolation and provider readback. No real person has been blocked as a test.
- Authorized environment activation after provider pilot. No activation/production readiness claim.
- Instagram native block integration only after a supported API is verified; otherwise use the provider application manually.

Status: local implementation and unit/contract checks complete; PARTIALLY READY pending staging UAT and controlled provider activation.
