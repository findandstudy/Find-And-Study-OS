# Contract-only SMTP: local implementation and rollout gates

This change extends the already deployed Apply prepare-only path. It does not change global email delivery, enable other external integrations, modify the0067 schema, enroll historical signatures or send a message during testing. Staging uses its own newer queue; do not copy Apply's migration there.

## Controlled first send

Keep `BACKGROUND_JOBS_ENABLED` as deployed and both legacy contract flags false. Configure only:

```text
SIGNED_CONTRACT_DELIVERY_ENABLED=false
SIGNED_CONTRACT_PDF_WORKER_ENABLED=false
SIGNED_CONTRACT_DURABLE_DELIVERY_MODE=send
SIGNED_CONTRACT_SMTP_ENABLED=true
SIGNED_CONTRACT_SMTP_SCOPE=canary
SIGNED_CONTRACT_SMTP_CANARY_CONTRACT_ID=<one reviewed signed-contract ID>
SIGNED_CONTRACT_SMTP_CANARY_RECIPIENT=<one canonical lowercase approved recipient>
```

The ID and recipient are mandatory together. They are rechecked during queue selection, the atomic send claim, immediately before sending and inside the SMTP adapter. An older unrelated ready row cannot block the canary. A different recipient/contract is never substituted. One accepted/ambiguous/rejected attempt cannot automatically be tried again.

`ALLOW_LIVE_INTEGRATIONS` may remain **unset**: the new permission belongs only to this contract adapter. An explicit `ALLOW_LIVE_INTEGRATIONS=false`, `EMAIL_DELIVERY_DISABLED=true`, invalid boolean value, non-production environment or missing contract-specific opt-in blocks sending. Do not change global flags to activate unrelated email/portal/AI work. The existing vetted SMTP configuration, pinned public IP, certificate verification and TLS are reused.

Before applying the canary configuration, review the exact queue row, immutable PDF key/SHA-256, actual signed record/session/recipient and the approved recipient mailbox. No queue row means no send. TEST02/47 additionally requires its separate exact-record recovery and operator enrollment; this worker never adopts it automatically. If its branding is reconstructed, the operator must freeze a truthful disclosure email together with the verified attachment in the same transaction, so the generic preparation path cannot create an undisclosed message.

## Automatic delivery for future signatures

After the approved canary's provider acceptance and mailbox attachment are checked, use:

```text
SIGNED_CONTRACT_SMTP_SCOPE=future
SIGNED_CONTRACT_SMTP_FUTURE_FROM=<fixed reviewed UTC timestamp, e.g. YYYY-MM-DDTHH:mm:ss.sssZ>
```

Keep the other contract send prerequisites above. Remove the obsolete canary ID/recipient from the release config for clarity. The timestamp must be canonical UTC with milliseconds. Both the **actual signature timestamp** and the **queue enrollment timestamp** must be at or after it. Existing pending queues and historical signatures before this boundary stay outside automatic sending, including an old signature explicitly enrolled later. Record and review the exact cutoff and eligible queue count before activation; do not move the cutoff backward as an implicit backlog resend.

The existing signature transaction still creates only one delivery row. Preparation freezes email content and attachment bytes; send claims revalidate ownership, signature state, PDF/evidence identity, recipient and the cutoff in PostgreSQL. Accepted means SMTP server acceptance, not proof of inbox arrival. A scope change after committing a send attempt is recorded for manual inspection without calling SMTP.

## Failure and rollback

Unknown SMTP responses, disconnects, timeouts, process crashes and receipt persistence failures never trigger a blind resend. Reconcile the fixed message ID with provider evidence first; this change adds no retry override. Missing/corrupt PDF content fails that row and does not starve the queue. No global `email_queue` insertion occurs.

Return `SIGNED_CONTRACT_DURABLE_DELIVERY_MODE=prepare` or `SIGNED_CONTRACT_SMTP_ENABLED=false` to stop new sends while retaining PDF preparation, queue and receipts. Drain the previous API/worker before replacing it; the coordinator takes its singleton advisory lock once. Do not re-enable the old workers or restore an older database. Code rollback must use the reviewed guarded rollback artifact, not the unguarded historical worker.

## Evidence

Local synthetic-only checks: disposable PostgreSQL16.15 worker/store tests18PASS, policy + actual SMTP adapter with fake transport5PASS, actual signing enrollment4PASS, signing/render regression18PASS, API TypeScript and production build PASS. These cover exact canary selection, unchanged global settings, cutoff exclusion, concurrent claims, changes before/after claim, acceptance persistence, attachment mismatch, timeout/crash ambiguity and no historical enrollment. Local evidence is under `.codex-tmp/canary-{pg-worker,policy-adapter,enrollment-regression,sign-regression,api-typecheck,api-build}.log`; no real SMTP, recipient notification or production configuration change has been performed by these tests.
