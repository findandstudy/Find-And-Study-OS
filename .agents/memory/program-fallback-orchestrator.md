---
name: Program-fallback (supersession) orchestrator
description: Phase-3 rule-based program fallback; fires on program_full AND program_missing(not_in_dropdown); concurrency + guard invariants.
---

The orchestrator entry point is `handleNeedsFallback(submissionId)` (lib/portal-runner);
`handleProgramFull` is a back-compat alias for it. It fires on TWO structural
statuses, handled identically:
- `program_full` ("Kontenjan Dolu") → candidates from `meta.openPrograms`.
- `program_missing` with `meta.resolution==='not_in_dropdown'` → candidates from
  `meta.availablePrograms` (program not offered in the portal dropdown, but the
  dropdown WAS reached so alternatives are known).
It resolves the fallback rule for the app's program, picks the first OPEN
candidate, cancels the old application, creates a NEW application on the fallback
program (linked via `superseded_from/by_application_id`), and enqueues a new
portal submission with `status='queued'` (so `claimNext` picks it up).

**not_in_dropdown safety invariant:** a `program_missing` result is ONLY eligible
for fallback when the dropdown was reached — i.e. `resolution==='not_in_dropdown'`
AND `availablePrograms` non-empty. Any other program_missing cause (login/level/
mapping failure) means alternatives are UNKNOWN → must no-op, never guess a
fallback (would submit a wrong program). This gate is enforced in ALL THREE
layers and they must stay in lockstep: worker trigger (worker.ts), stageWriteback
`resolveTarget` + meta writeback, and `handleNeedsFallback`'s own status/resolution
guard (defense in depth). Adapter (Topkapı not-found branch) is the sole producer:
it emits `programMissing + resolution:'not_in_dropdown' + availablePrograms + requestedProgram`.

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
- **Guard order in handleNeedsFallback:** kill-switch (`fallback_enabled`) →
  submission load → `mode==='real'` → `status in (program_full, program_missing)` →
  (if program_missing) `resolution==='not_in_dropdown'` → option list
  (`openPrograms ?? availablePrograms`) present → source app + programId →
  loop-depth (chain `superseded_from` ≤ 2) → rule → candidate resolve. The status
  guard is REQUIRED even though the worker pre-gates — the fn is documented as safe
  for any submission id.
- **New app fees/level/language come from the fallback CATALOG (programs table),
  never copied from the old app.** Origin_* attribution IS copied verbatim.
- New submission mode = `rule.autoSubmit ? sub.mode : 'dry'`.

## Prod migration path
Schema lives in Drizzle (`portalAutomationSettings.fallbackEnabled`,
`drizzle/0028_fallback_enabled.sql`) BUT prod runs no migration — parity DDL
(fallback_enabled col, applications supersede cols, portal_program_fallbacks
table + unique index on (university_key, source_program_id)) is idempotent raw
SQL in api-server boot. Dev DB needs the same ALTER applied manually.
