# Student Journey readiness projection — 1 September 2026

## Outcome

This slice adds a pure, deterministic and default-unwired projection for the
Student Journey dossier/application-readiness surface. It separates three
facts that the legacy product currently risks conflating:

1. a required document has been uploaded;
2. its evidence is still awaiting review;
3. every mandatory requirement has server-verified evidence.

The projection performs no database access, route registration, state write,
event emission, notification or external submission. Production, VPS,
migration ledger, live feature state and `Find-And-Study-OS-Next` are unchanged.

## Contract

`buildStudentJourneyReadinessProjection()` accepts only rows already resolved,
authorized and scoped by a server-side adapter. Its result is versioned as
`student.journey.readiness.v1` and contains no file names, URLs, document IDs,
student identifiers or free-form notes.

The projection reports:

- per-mandatory-requirement facts: `missing`, `rejected`, `in_review`,
  `verified` or fail-closed `unknown`;
- aggregate upload and verification coverage as separate values;
- unanswered requests that require student action;
- responded but unfulfilled requests that require staff review;
- an overall state of `action_required`, `review_required`,
  `document_package_ready`, `configuration_required` or `unknown`.

`document_package_ready` means only that the required evidence package can
enter a separate application preflight. It never means that destination
fields, portal compatibility, policy approval or submission authorization have
passed.

Known document aliases use the shared production document-equivalence
contract. A verified replacement can satisfy a requirement even when an older
copy was rejected. An unknown evidence status never counts as uploaded or
verified and is routed to review.

The legacy upload path can assign an `approved` status while mirroring a file.
For that reason, neither `approved` nor `verified` is sufficient by itself.
Verification requires a bounded `VERIFIED_EVIDENCE` reference and lowercase
SHA-256 content hash; a positive status without that immutable evidence remains
`in_review` and cannot make a dossier milestone eligible.

Inputs are hard-bounded to 250 requirements, 500 document facts and 250 open
request facts. Invalid dates, control characters, oversized text, malformed
request state and incomplete versioned authority fail closed.
Equivalent duplicate requirement definitions and rows supplied for an
unresolved requirement source are also rejected instead of distorting coverage.

## Verification and milestone boundary

The current program/degree requirement tables have no canonical tenant ID,
effective-dated requirement-set version, provenance or immutable dossier
revision binding. They are therefore labelled `legacy_unversioned`.

Even when all legacy requirements have verified documents, the projection may
report `document_package_ready` but must return:

```text
milestoneEligibility.dossierVerified = false
milestoneEligibility.reason = legacy_requirement_authority
```

Eligibility can become true only when all mandatory evidence is verified, no
request remains open, and the caller supplies a non-empty versioned
`requirementSetRef`. Eligibility is still not a milestone receipt: the frozen
milestone contract requires a later tenant-owned transactional adapter to
persist state, evidence and event atomically.

A resolved requirement set with zero mandatory requirements also cannot
manufacture a verified-dossier milestone.

## Verification

- Direct readiness projection contract: `12/12` pass.
- Added to the Linux and Windows exact-head convergence jobs.
- No migration, schema, route, UI, writer or runtime import was added.

## Adoption prerequisites

Runtime wiring remains NO-GO until all of the following exist:

1. canonical tenant/organization/branch ownership on the selected corridor;
2. a versioned, effective-dated requirement set with source/provenance and
   freshness rules;
3. authorized current active-context resolution using the Student Journey
   authorization boundary;
4. a tenant-owned dossier revision and requirement-result store;
5. a transaction that writes the verified state, evidence receipt and
   milestone event atomically;
6. approved product, Privacy/Legal and Security inputs for the G45 corridor.

Until then this module is a tested foundation only and does not alter the
legacy mandatory-document gate.
