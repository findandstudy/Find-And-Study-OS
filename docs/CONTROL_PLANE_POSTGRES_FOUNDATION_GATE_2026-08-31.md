# Control Plane PostgreSQL foundation gate - 31 August 2026

## Purpose

This slice completes the canonical Control Plane source/test inventory on the
live-first branch by adding the comprehensive PostgreSQL foundation gate.

## Target adaptation

- Live-first base: `aa3d81fc`.
- Canonical source: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- The gate is pinned to explicit approval and the exact disposable identity
  `127.0.0.1:5433/fasos_apply_local`.
- Its migration denominator is updated from the draft ancestry's `70` to the
  converged live-product plus Control Plane ledger's `82`.
- Role creation is owned by the reusable disposable reset helper; the gate
  configures and verifies already-created direct roles instead of creating
  cluster roles itself.

## Isolation finding and resolution

The first combined run found that the foundation and command-adapter fixtures
share a synthetic principal UUID. Running both against one populated database
correctly produced PostgreSQL `23505`. The CI candidate now uses an explicit
database reset and a second `66→82` production-prefix replay between the two
fixture families. No production code or assertion was weakened.

## Local evidence

The exact CI-order candidate passed:

```text
disposable reset
-> foundation authority setup
-> production prefix 66/66 -> canonical 82/82 -> clean replay
-> foundation verify PASS
-> explicit reset
-> production prefix 66/66 -> canonical 82/82 -> clean replay
-> command/evidence/context adapter PASS
-> durable audit/reconciliation PASS
-> active-context session/lifecycle/repair PASS
```

The foundation verify covers PostgreSQL 16 authority separation, FORCE RLS,
tenant composite bindings, immutable receipts, atomic DDL rollback, concurrent
tenant isolation and evidence revoke/consumption races.

## Boundary

This remains local and default-unwired. No GitHub push/PR/merge, `Next` sync,
long-lived database adoption, runtime registration or deployment occurred.
