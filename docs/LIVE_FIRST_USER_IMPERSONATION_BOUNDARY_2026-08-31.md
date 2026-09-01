# Live-first user-management and impersonation boundary - 31 August 2026

## Purpose

This slice binds the canonical fail-closed legacy user-management and
impersonation policies to the current live-first `users` and `agents` routes
without replacing the newer live product behavior.

## Provenance

- Live-first base: `9f927bae`.
- Canonical source: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- Policy source and direct-test Git blobs: `4/4` exact.
- Route integration is surgical and preserves the live product's validation,
  branch assignment, account-tier and notification logic.

## Enforced boundary

- Non-super generic user listings are limited to the actor's visible branch
  set and exclude agent/student identities that require dedicated routes.
- Detail, update, delete and password-reset actions resolve all student branch
  links and fail closed on cross-branch, branchless, deleted, agent-managed,
  peer or higher-privilege targets.
- Generic user create/role-change cannot create agent/student lifecycles or
  mutable dynamic privilege packages for non-Super Admin actors.
- Permission overrides require the transitional Super Admin boundary.
- Generic impersonation rejects self, inactive/deleted, cross-branch,
  privileged and agent-managed targets according to the policy.
- Generic and agent-specific impersonation reject invalid and nested sessions;
  agent paths also reject inactive/deleted login users.
- Denials emit audit records with fixed policy reasons.

## Evidence

- Legacy user-management policy: `6/6`.
- Legacy impersonation policy: `5/5`.
- Live security regressions: `30/30`.
- API TypeScript compilation: pass.
- Writer inventory drift: pass at `163 / 2,101`.
- Route inventory drift: pass at `71 / 762`; direct-role surface is `26`.

The generic legacy impersonation route remains transitional and is not an
external-tenant authorization claim. JIT, step-up and relationship-grant
Control Plane wiring remain separate NO-GO gates.
