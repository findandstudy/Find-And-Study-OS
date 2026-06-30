---
name: Program-fallback (supersession) orchestrator
description: Phase-3 rule-based program fallback when a portal submission hits program_full; concurrency + guard invariants.
---

When a portal submission ends in `status='program_full'` the worker calls
`handleProgramFull(submissionId)` (lib/portal-runner). It resolves the fallback
rule for the app's program, picks the first OPEN candidate from
`meta.openPrograms`, cancels the old application, creates a NEW application on the
fallback program (linked via `superseded_from/by_application_id`), and enqueues a
new portal submission with `status='queued'` (so `claimNext` picks it up).

## Invariants worth keeping
- **lib/portal-runner cannot import artifacts/api-server.** Audit + in-app
  notification are written DIRECTLY via `@workspace/db` (`auditLogsTable`,
  `notificationsTable`), NOT via api-server dispatch helpers.
  **Why:** runner is a shared lib; importing the app server creates a cycle.
- **Idempotency must run INSIDE the supersession transaction, under a
  tx-scoped advisory lock** (`pg_advisory_xact_lock(srcAppId)`). A pre-tx
  existence check races: two concurrent handlers both see "no child" and create
  duplicate supersessions. The recheck short-circuits on ANY existing child of
  the source app (not only same-program), so a changed rule can't fork one
  source app into multiple children.
- **Guard order in handleProgramFull:** kill-switch (`fallback_enabled`) →
  submission load → `mode==='real'` → `status==='program_full'` → meta.openPrograms
  present → source app + programId → loop-depth (chain `superseded_from` ≤ 2) →
  rule → candidate resolve. The status guard is REQUIRED even though the worker
  only calls on programFull — the fn is documented as safe for any submission id.
- **New app fees/level/language come from the fallback CATALOG (programs table),
  never copied from the old app.** Origin_* attribution IS copied verbatim.
- New submission mode = `rule.autoSubmit ? sub.mode : 'dry'`.

## Prod migration path
Schema lives in Drizzle (`portalAutomationSettings.fallbackEnabled`,
`drizzle/0028_fallback_enabled.sql`) BUT prod runs no migration — parity DDL
(fallback_enabled col, applications supersede cols, portal_program_fallbacks
table + unique index on (university_key, source_program_id)) is idempotent raw
SQL in api-server boot. Dev DB needs the same ALTER applied manually.
