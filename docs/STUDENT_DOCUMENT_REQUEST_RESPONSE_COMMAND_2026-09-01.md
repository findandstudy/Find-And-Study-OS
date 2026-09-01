# Student document-request response command — 1 September 2026

## Outcome

This slice freezes a default-unwired command contract for a student to
acknowledge an open document request or submit already-ingested evidence in
response. It adds no migration, schema, route, UI, writer registration,
capability seed or runtime import. Production, the VPS, the live feature state
and `Find-And-Study-OS-Next` remain unchanged.

The candidate capability is `student.document_request.respond` over the
`student_document_request` resource. It is intentionally absent from the live
capability catalogue until the G45 product direction and the required
Privacy/Legal/Security inputs are approved.

## Server-owned scope and authority

The client command contains only:

- a UUIDv7 command ID;
- a bounded idempotency key;
- the expected request version;
- either `ACKNOWLEDGE` or `EVIDENCE_SUBMITTED` plus an immutable ingest
  receipt.

It does not accept a tenant, student, application, request, membership or
active-context identifier. Those values come from a strict server-only
authority decision. Inside the same transaction, the adapter must re-resolve
the current selection, session generation, membership, capability and exact
resource scope under lock. Revoked or stale authority fails closed before the
idempotency claim or any durable mutation.

Every successful first execution and authorized replay records a fresh access
decision receipt. The first execution receipt binds the exact access-decision
receipt ID, actor, membership, context, selection, session generation, policy
version and resource scope.

## State and evidence boundary

`ACKNOWLEDGE` is an `OPEN → OPEN` transition. It records that the student saw
the request, increments the optimistic version and never marks the request
responded, fulfilled or verified.

`EVIDENCE_SUBMITTED` consumes one same-scope immutable
`student.document.ingest.received.v1` receipt and performs
`OPEN → RESPONDED`. The ingest receipt binds the private object reference,
lowercase SHA-256 content hash, malware/ingest scan state and occurrence time.
Only `scanStatus=PASSED` may enter `RESPONDED`; quarantined or still-scanning
evidence fails closed. `PASSED` means only that the upload passed the ingest
boundary; it is not verification evidence. The command cannot produce
`FULFILLED`, a verified-document state, a dossier milestone or application
readiness.

Only a later staff-side review command, under its own capability, maker/checker
rules and immutable verification evidence, may fulfil the request. Application
submission remains behind its separate preflight and approval boundary.

## Atomicity, idempotency and audit

The required PostgreSQL adapter must execute the following in one transaction:

1. current authority revalidation;
2. tenant-scoped hashed idempotency claim;
3. exact request row lock and expected-version comparison;
4. optional one-time ingest-receipt consumption;
5. request state/version update;
6. immutable access-decision, response and audit receipts;
7. command-claim completion.

Any failure rolls back all seven effects. The raw idempotency key is never
written into response or audit receipts. An exact retry returns the original
immutable response receipt only after current authority is revalidated. A
changed payload under the same key, stale version, scope drift, already-used
ingest receipt, terminal request or invalid receipt fails closed.

## Verification

- Direct command, receipt, rollback and concurrency contract: `15/15` pass.
- Same-key race: one commit and one byte-equivalent logical replay.
- Different-key race against the same expected version: one transition and
  one stale-version denial.
- Cross-tenant, cross-student, cross-application and cross-request rows are
  rejected.
- Tampered, future-dated, cross-scope, quarantined, still-scanning and
  already-consumed ingest receipts are rejected.
- Injected receipt-write failure rolls back request state, access decision,
  ingest consumption, audit and idempotency claim.
- The contract is included in both Linux and Windows exact-head convergence
  jobs.

## Adoption prerequisites

Runtime wiring remains NO-GO until all of the following exist:

1. explicit G45 product-direction approval;
2. canonical tenant/student/application/document-request ownership;
3. a seeded, reviewed `student.document_request.respond` capability and
   purpose-limited student assignment;
4. current PostgreSQL active-context/session-selection revalidation;
5. tenant-owned request, ingest-consumption, access-decision, command-receipt
   and audit tables with atomic adapter tests on PostgreSQL 16;
6. private-object authorization, upload-size/type/quota and malware scanning
   enforcement at the ingest boundary;
7. approved Privacy/Legal retention and evidence rules;
8. independent review, canary, rollback and production release approval.

Until then this is a tested contract only. Existing legacy document-request
routes and upload behavior are unchanged.
