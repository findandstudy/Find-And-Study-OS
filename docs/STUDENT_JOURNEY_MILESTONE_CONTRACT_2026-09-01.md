# Student Journey milestone/QAVJP contract — 1 September 2026

## Decision

The first Journey UI slice must not use the legacy `audit_logs` table as a
verified milestone timeline. Current application stage audit writes are
asynchronous, occur after the application transaction and do not consistently
preserve the previous state, evidence receipt or tenant-bound authorization
decision. Treating those rows as canonical completion evidence would create
false certainty and could inflate QAVJP.

The repository therefore contains a default-unwired pure contract before any
new table, writer, route or production migration is introduced. It freezes the
event and denominator semantics required by the 90-day roadmap while leaving
runtime adoption behind the existing tenant/active-context and migration
review gates.

## Verified milestone event v1

`journey.milestone.completed.v1` contains only bounded identifiers and hashes;
it carries no names, document bodies, URLs, secrets or free-text notes.

Required facts include:

- UUIDv7 event and tenant identity;
- application, lifecycle and pseudonymous subject references;
- aggregate version and canonical milestone code;
- explicit `ownerUserId`, `nextAction` and `dueAt` fields (nullable owner/action
  remain measurable gaps rather than being silently omitted);
- completion/recording time and a server-derived on-time result;
- at least one hashed verification reference of kind `SYSTEM_EVENT`,
  `VERIFIED_EVIDENCE` or `PARTNER_RECEIPT`;
- quality factor, versioned quality policy and hash of the factor inputs;
- a domain-separated milestone dedup key and content hash.

A staff-only “completed” marker is not a verification kind. The selected
verification kind must have a matching evidence/receipt reference. Duplicate
completion attempts for the same tenant + application + lifecycle + milestone
produce the same dedup key even if their event IDs or timestamps differ;
non-identical receipts under that key are a conflict and never produce a
score.

## Frozen QAVJP denominator v1

`journey.qavjp.denominator.frozen.v1` is frozen no later than the measurement
period start. Every eligible item includes:

- application/lifecycle/subject and milestone identity;
- a due time inside the frozen period;
- positive bounded weight;
- explicit owner and next-action coverage fields;
- hashed `VERIFIED_EVIDENCE` for cohort consent;
- the same deterministic milestone dedup identity used by completion events.

The snapshot binds the eligibility policy version and source snapshot hash.
`sourceRecordCount` must reconcile exactly to eligible plus excluded records,
which makes silent denominator shrinkage visible. Duplicate milestones,
post-period freeze, out-of-window due dates and non-verified consent fail
closed. Derived item count, total weight, owner coverage, next-action coverage
and the complete snapshot hash are recomputed before scoring.

## QAVJP calculation

The pure calculator implements the roadmap formula without choosing business
weights or quality penalties:

```text
100 × Σ(item weight × verified on-time × supplied policy quality factor)
      / frozen denominator weight
```

The output uses basis points (`0..10000`) to avoid ambiguous display rounding.
Late verified milestones remain visible but contribute zero numerator weight.
Incomplete and unmatched events are counted separately. Event and denominator
integrity are reconstructed before calculation; mutated hashes, derived fields,
dedup identities or timestamps are rejected.

Quality coefficients are deliberately not invented in code. A reviewed
quality policy must produce `qualityFactorBps` and `qualityInputHash`; that
policy is a separate product/data decision and must be versioned before a real
baseline is frozen.

## Verification

- Contract, negative, reconciliation, dedup, integrity, hard-budget and QAVJP
  math tests: `9/9` pass.
- API typecheck: pass.
- The suite is required in both Linux and Windows convergence CI jobs.
- No schema migration, DB write, route, worker, scheduler, external call,
  production configuration or feature activation is included.

## Runtime adoption prerequisites

1. Select and document one measurable application corridor and its canonical
   lifecycle mapping.
2. Approve milestone weights, eligibility/cohort freeze policy and versioned
   quality-factor rules with Product, Ops and Data owners.
3. Bind application ownership to signed active tenant context; do not infer a
   tenant from a client parameter or a global default. Use the default-unwired
   [Student Journey authorization boundary](./STUDENT_JOURNEY_AUTHORIZATION_BOUNDARY_2026-09-01.md)
   only after canonical tenant ownership exists.
4. Add an additive tenant-owned milestone/denominator schema with immutable
   receipt/evidence references and DB uniqueness on the dedup identity.
5. Write the milestone and the state transition/receipt in one transaction;
   asynchronous legacy audit remains secondary evidence only.
6. Add cross-tenant, stale-version, duplicate, concurrent writer and rollback
   tests against disposable PostgreSQL 16.
7. Adopt the default-unwired
   [consent and communication decision contract](./CONSENT_COMMUNICATION_CONTRACT_2026-09-01.md)
   with approved purpose, notice, retention and preference policies.
8. Only after those gates, expose a student-safe redacted timeline projection
   and start a consented cohort baseline.

Until these prerequisites pass, the dashboard may show the current canonical
stage/next action projection but must not claim a verified historical timeline
or QAVJP baseline.
