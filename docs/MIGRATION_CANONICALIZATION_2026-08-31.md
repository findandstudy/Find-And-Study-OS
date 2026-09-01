# Migration Canonicalization - 31 August 2026

## Decision

Production migration history is authoritative through
`0065_invoice_integrity`. The live source is
`hotfix/embed-release-20260830` at
`d8f385ca018161cf6330232f5840d3a29c3581ce`; the production Drizzle ledger was
verified read-only at 66 entries (`0000-0065`).

The unmerged Control Plane sequence previously reused `0054-0069`. Those
identifiers collided with the production product migrations `0054-0065` even
though the SQL and hashes were different. Because the Control Plane sequence
has not been applied to a long-lived database, it is canonicalized before
adoption instead of rewriting production history.

This live-first convergence branch starts at the immutable production source
commit above and carries only the canonical migration namespace plus its
validation evidence. No production database, service, release, configuration
or external integration is changed by this branch.

## Authoritative production tail

The following SQL files and journal timestamps are copied byte-for-byte from
the live source commit and are pinned by
`lib/db/drizzle/meta/production-prefix.json`:

```text
0054 agent_applications
0055 agent_application_review_then_sign
0056 contract_email_verification_evidence
0057 agent_application_provisional_portal
0058 pipeline_stage_auto_messages
0059 fas_agency_codes
0060 scoped_record_assignments
0061 pipeline_stage_audiences
0062 agent_tenant_capabilities
0063 finance_mutation_integrity
0064 agent_application_token_expiry
0065 invoice_integrity
```

`validate-migrations.mjs` now rejects tag, timestamp or canonical-LF SHA-256
drift in this pinned production tail. The validator normalizes line endings only
for this immutable identity check, so Windows and Linux worktrees prove the same
Git content without rewriting historical migrations or changing the migration
runner's ledger semantics.

## Control Plane mapping

```text
0054_authorization_corridor_foundation
  -> 0066_authorization_corridor_foundation
0055_change_set_control_plane_foundation
  -> 0067_change_set_control_plane_foundation
0056_change_set_command_idempotency
  -> 0068_change_set_command_idempotency
0057_authorization_control_plane_db_hardening
  -> 0069_authorization_control_plane_db_hardening
0058_change_set_evidence_identity_audit_foundation
  -> 0070_change_set_evidence_identity_audit_foundation
0059_change_set_postgres_command_adapter
  -> 0071_change_set_postgres_command_adapter
0060_change_set_durable_audit_adapter
  -> 0072_change_set_durable_audit_adapter
0061_change_set_commit_reconciliation
  -> 0073_change_set_commit_reconciliation
0062_change_set_scheduled_reconciliation
  -> 0074_change_set_scheduled_reconciliation
0063_active_context_authoritative_resolver
  -> 0075_active_context_authoritative_resolver
0064_active_context_session_gateway
  -> 0076_active_context_session_gateway
0065_active_context_selection_lifecycle
  -> 0077_active_context_selection_lifecycle
0066_active_context_selection_binding
  -> 0078_active_context_selection_binding
0067_active_context_selection_consumption
  -> 0079_active_context_selection_consumption
0068_active_context_selection_consumption_attempts
  -> 0080_active_context_selection_consumption_attempts
0069_active_context_selection_consumption_repair
  -> 0081_active_context_selection_consumption_repair
```

The journal is contiguous at 82 entries (`0000-0081`) and every Control Plane
timestamp follows the authoritative production `0065` timestamp.

## Consumption-attempt composite key regression

The Next import snapshot exposed a PostgreSQL failure because a receipt foreign
key referenced `(tenant_id, id)` without a matching unique constraint. The
latest Control Plane head already contains the reviewed fix from `c186cfec`:

```sql
CONSTRAINT active_context_selection_consumption_attempts_tenant_id_uq
  UNIQUE (tenant_id, id)
```

The canonical `0080` migration preserves that constraint. Migration-authority
tests now pin both the unique constraint and the tenant-bound receipt foreign
key, so the stale snapshot failure cannot silently return.

## Required evidence before convergence

1. Migration ledger validation reports 82 SQL files and 82 journal entries.
2. Production-prefix tag, timestamp and SHA-256 pinning passes.
3. Fresh disposable PostgreSQL 16 applies `0000-0081` successfully.
4. Reapplying the runner is a clean no-op.
5. A production-shaped 66-entry prefix accepts only `0066-0081`.
6. Foundation, adapter, audit, session, consumption and repair negative tests
   pass at the exact branch head.
7. No long-lived or production database is used for this evidence.

This document accompanies the first convergence slice based on the live product
commit. Only after these gates pass may Control Plane schema bindings, runtime
code or route/worker wiring be ported in subsequent reviewed slices.
