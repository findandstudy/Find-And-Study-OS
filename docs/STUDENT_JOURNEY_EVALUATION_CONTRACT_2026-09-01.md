# Student Journey next-action evaluation contract — 1 September 2026

## Outcome

This slice freezes a pure, deterministic and default-unwired measurement
contract for student next-action task success, time to verified success and
typed exception rate. It does not add analytics collection, cookies, a
migration, schema, route, worker, UI, writer, external call or feature flag.
Production, the VPS, `Find-And-Study-OS-Next`, the live ledger and live feature
state remain unchanged.

The contract is descriptive evidence only. Every report returns
`gateDecision=NOT_AUTHORIZED_BY_EVALUATION_CONTRACT`; it cannot declare G45,
G60A, G60R or G90 GO.

## Frozen plan and privacy boundary

An evaluation plan is frozen no later than the measurement-period start. It
binds:

- an exact tenant, cohort and policy version;
- period start/end and pre-period freeze time;
- a source snapshot hash;
- exact reconciliation of source records into eligible and excluded trials;
- a reviewed minimum sample and task-success target in basis points;
- at most 1,000 trial rows with pseudonymous subject, opaque application,
  scenario and expected-action references;
- immutable `VERIFIED_EVIDENCE` consent for every eligible trial.

The plan accepts no names, email addresses, phone numbers, document bodies,
URLs, free-text notes or client-supplied attribution fields. Duplicate trial
references, late freeze, denominator shrinkage, an unreachable minimum sample
and non-verified consent fail closed. The plan and every outcome carry
domain-separated SHA-256 integrity hashes.

## Outcome and metric semantics

One trial may have exactly one outcome bound to the exact plan ID and hash.
Observed activity must remain inside the frozen period. A verified unaided
success requires all of the following:

1. the selected action exactly matches the plan's expected action;
2. a completion time exists after presentation/action;
3. completion has immutable `SYSTEM_EVENT`, `VERIFIED_EVIDENCE` or
   `PARTNER_RECEIPT` evidence;
4. no human assistance was required;
5. no typed exception or safety violation occurred.

The frozen eligible count is the denominator for measurement coverage, task
success and exception rate. Missing outcomes remain visible and never disappear
from the denominator. Wrong action, explicit typed exception or safety
violation counts as an exception; assistance is reported separately. Median
and p90 delay use only verified unaided successes and measure presentation to
evidence-backed completion.

The target comparison remains `NOT_EVALUATED` unless the reviewed minimum
sample is met, every frozen trial has an outcome and no safety violation is
present. Even then `AT_OR_ABOVE` or `BELOW` is only a comparison with the frozen
plan target, not a product gate decision or causal claim.

## Verification

- Frozen denominator, privacy shape, metric math, delay and exception contract:
  `10/10` pass.
- Missing outcomes block target evaluation and remain in the denominator.
- Assistance, wrong action, exception and safety paths cannot become unaided
  success.
- Plan/outcome tamper, duplicate outcome, cross-plan binding, unmatched trial,
  invalid chronology, missing completion evidence and out-of-period activity
  fail closed.
- Hard plan/outcome budgets and source reconciliation are enforced.
- Included in both Linux and Windows exact-head convergence jobs.
- No current API, Journey or analytics runtime imports the contract.

## Adoption prerequisites

Runtime measurement remains NO-GO until all of the following exist:

1. Product, Privacy/Legal, Data and UX approve the evaluation policy, sample,
   target, exclusion, consent, retention and late-arriving-data rules;
2. a consented cohort is frozen before observation and remains immutable;
3. presentation/action/completion events have tenant-owned, server-recorded,
   deduplicated receipts and bot/internal traffic classification;
4. the expected action is independently reviewed rather than copied from the
   same projection being evaluated;
5. telemetry consent withdrawal and suppression behavior is tested;
6. at least one manual reconciliation sample proves source-to-report accuracy;
7. segment and small-sample caveats are reported without exposing PII;
8. an independent council applies the separate G45/G60/G90 rules.

Until then no live telemetry is collected by this slice and no task-success,
delay, exception or product-value claim is authorized.
