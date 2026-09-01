# Consent and communication decision contract

Date: 2026-09-01
Status: default-unwired local foundation; no database writer, route, UI or provider delivery

## Why this slice exists

The Student Journey cannot become a real notification or adoption corridor by
treating a checkbox, a profile field or an audit log row as permission to send.
The binding target contracts require:

- purpose, lawful basis, channel, locale, notice version, capture/withdrawal
  time and evidence on a consent record;
- a minimal durable suppression for unsubscribe, complaint and bounce;
- category, task/state reference, locale, consent, channel, quiet-hours,
  frequency and dedup policy on a notification intent;
- a visible channel/consent state and a blocked composer when opt-out or consent
  is absent;
- a `student_consent_updated` event only after a consent receipt exists.

The implementation is therefore a pure decision boundary first. It cannot send
a message and it does not claim that a legal basis, retention duration or notice
version has been approved.

## Contract added

`artifacts/api-server/src/lib/consentCommunicationContract.ts` defines four
immutable versioned objects:

1. `person.consent.receipt.v1`
2. `person.communication.preference.receipt.v1`
3. `person.communication.suppression.receipt.v1`
4. `notification.communication.decision.v1`

Consent and preference are deliberately separate:

- consent records purpose, externally supplied lawful-basis code, channel,
  locale, notice/policy/retention versions, evidence and effective validity;
- preference records the student's category/channel choice;
- preference cannot manufacture consent and consent cannot override a disabled
  preference;
- both use contiguous append-only receipt sequences and exact previous-hash
  links. A gap, broken link, altered receipt or retroactive insertion fails
  closed.

Suppression is a separate minimal receipt. An effective `UNSUBSCRIBE`,
`COMPLAINT` or `HARD_BOUNCE` always defeats otherwise positive consent and
preference state. This v1 foundation intentionally has no generic "unsuppress"
operation; any future release process must be separately governed and evidenced.

## Pre-send decision

`evaluateCommunicationIntent` accepts only one exact tenant, subject, purpose,
canonical notification category, channel, task/state reference and dedup key.
Mixed-tenant or mixed-subject receipt collections are rejected instead of being
silently filtered.

The decision is deny-first. In precedence order it checks:

1. effective suppression;
2. a previously delivered dedup key;
3. evidence-bound contact-point verification that predates the intent;
4. current, non-withdrawn and non-expired consent;
5. a current enabled category/channel preference;
6. tenant-local quiet hours using an explicit IANA time zone;
7. an evidence-bound frequency window and cap.

Only after every check passes is the result `ALLOW / ELIGIBLE`. The result
contains the exact active receipt hashes, policy versions, a domain-separated
state-input hash and an immutable decision hash. It contains no email address,
phone number, message body or raw evidence.

The canonical categories come from the Role and Control Plane contract:

`ACTION_REQUIRED | APPROVAL_REQUIRED | DEADLINE | HANDOFF | SECURITY | DEGRADED | INFORMATIONAL`

Channel, purpose, lawful-basis and policy identifiers remain versioned inputs.
The code does not invent jurisdictional rules or silently select a retention
period.

## Explicit non-goals

This change does not add or activate:

- a `consent_record`, preference, suppression or notification table;
- a student `/privacy-sharing` route or UI;
- a notification writer, dispatcher hook, campaign integration or provider send;
- a real `student_consent_updated` analytics/domain event;
- a guardian/sponsor/institution relationship grant or data-sharing projection;
- a legal determination, notice text, lawful-basis catalogue or retention rule;
- production/VPS wiring, migration, deploy or `Find-And-Study-OS-Next` sync.

The broader STU-006 "Consent & sharing" screen also needs relationship-grant,
field/data-scope, recipient and time-bound authorization contracts. This
communication slice must not be presented as completion of that screen.

## Verification

The direct suite covers:

- positive evidence-bound eligibility;
- missing, future, withdrawn and expired consent;
- absent and disabled preferences;
- suppression precedence;
- unverified and too-late contact verification;
- dedup, quiet-hours and frequency-cap denial;
- receipt-chain gaps and retroactive insertion;
- cross-tenant/cross-subject scope confusion;
- receipt and decision tamper detection;
- malformed time-zone, timing and evidence inputs.

It runs on both Linux and Windows in the exact-head convergence workflow.

## Next gate before durable adoption

Before adding an additive tenant-owned schema or a writer, Product, Privacy/Legal
and Security owners must approve:

1. the first narrow Journey corridor and lifecycle;
2. purpose and lawful-basis catalogue versions by jurisdiction/tenant;
3. notice versions and evidence capture mechanism;
4. category/channel defaults and which notification classes, if any, use a
   different legal rule;
5. quiet-hour and frequency-cap policy versions;
6. suppression retention and controlled remediation semantics;
7. relationship-grant/data-sharing scope for STU-006;
8. same-transaction receipt, state, intent and durable event writer semantics.

Until those inputs exist, runtime integration remains NO-GO and the current
legacy message/audit paths are not upgraded into consent evidence by assumption.
