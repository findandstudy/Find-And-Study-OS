# Live-first external AI delivery safety - 1 September 2026

## Purpose

This slice separates the AI agent's internal engine switch from permission to
send customer-facing messages. Existing encrypted configurations and newly
cloned bots fail closed: external delivery remains off until an explicit Super
Admin activation.

## Enforced boundary

- `enabled` continues to control the AI engine; the independent
  `externalAutoReplyEnabled` flag controls customer-facing delivery.
- Missing legacy values resolve to `false`.
- New and cloned bots force external delivery and default-on behavior to
  `false`, regardless of the source bot configuration.
- Admins may change safe configuration and may turn automation off. Enabling
  the engine, external delivery or default-on behavior requires Super Admin.
- Both the multi-bot route and the legacy `/inbox/ai-agent/config` route apply
  the same activation policy and include the delivery controls in audit data.
- For non-Super Admin writes, already-true activation fields are removed as
  no-ops before persistence, so a concurrent Super Admin stop cannot be
  overwritten by a stale form submission.
- The provider boundary rejects an external reply or template without the
  explicit approval value.
- `AI_EXTERNAL_AUTO_REPLY_KILL_SWITCH` is a stop-only infrastructure override;
  `1`, `true`, `yes` and `on` block external sends.
- The DormBooking follow-up worker checks both approval and the kill switch
  before claiming or sending scheduled work.
- Internal chat remains usable without external-delivery approval because it
  has no external provider side effect.

## Evidence

- External-delivery policy, legacy fallback and stale-write protection: `5/5`
  direct tests pass.
- Super Admin transition scenario in the admin integration suite passes:
  admin enable `403`, Super Admin enable `200`, admin disable `200`.
- Live security regressions: `31/31`.
- API and full workspace TypeScript checks: pass.
- G30 writer inventory remains `163 / 2,101`, with external allowlist `0`.
- G30 route inventory remains `71 / 762`; the two explicit activation checks
  raise the frozen direct-role count from `26` to `28`.

The broader historical bot suites still contain pre-existing live-product
expectation drift in escalation/handoff behavior. Their new external-delivery
default-off and activation checks pass, but this slice does not rewrite those
unrelated behavioral expectations.

## Exclusions

No UI activation control, HTTP route bootstrap, Control Plane publisher,
production configuration, external message, VPS mutation, GitHub push, `Next`
sync, merge or deployment is part of this slice. The external delivery flag is
therefore safe and default-off, not production-enabled.
