# Control Plane command and request-context slice - 31 August 2026

## Purpose

This slice adds the storage-agnostic ChangeSet command orchestrator and the
server-bound request-context adapter to the live-first branch. Both remain
default-unwired: no HTTP route, database adapter, publisher or worker imports
them.

## Provenance

- Live-first base: `a1380e9a`.
- Canonical source: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- Source and direct test Git blobs: `4/4` exact.

## Included contracts

1. Create, validate, simulate and submit-to-review command orchestration.
2. Server-derived authorization, baseline, policy, data-class and evidence
   authority.
3. Atomic access receipt, idempotency claim, transition receipt, state update
   and exact-result completion interfaces.
4. Ambiguous commit acknowledgement reconciliation with typed pending state.
5. Durable audit start/terminal semantics outside the business transaction.
6. One verified active-context object binding the store and audit writer to the
   authenticated request identity.

## Local evidence

- ChangeSet command orchestrator: `25/25`.
- Request-context binding: `4/4`.
- Combined command/context assertions: `29/29`.
- API typecheck: pass.
- Exact-head CI workflow calls both suites.

## Boundary

The store and audit writer remain interfaces in this slice. PostgreSQL command,
evidence and durable-audit adapters are not included. There is no route/UI,
session gateway, publisher, scheduler, repair worker or production wiring.
GitHub push/PR/merge, `Next` synchronization and deployment have not occurred.
