# Control Plane schema bindings slice - 31 August 2026

## Purpose

This live-first slice exposes the already-migrated authorization, active-context
and ChangeSet tables through Drizzle without wiring them into HTTP, sessions,
workers, publishers or production execution paths.

## Provenance

- Live-first base: `3a7daff0c08b2fdfd9865b19ce7d2ae72f97eb05`.
- Canonical source: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- `authorization.ts` Git blob: `ab011bf84d325f5ddee40bf313f3428c28408084`.
- `controlPlane.ts` Git blob: `09500039640a69727af565bf4a048cac22861700`.

Both schema files are copied exactly from the canonical source. The live
product's `agentApplications` and `agentIntegrations` exports remain present;
the live branch's agent, contract, finance, lead, pipeline and student schema
files are not replaced by older draft-line versions.

## Included

1. Authorization, tenant, principal, membership, policy, assignment, active
   session context, issuance rate-limit and decision-receipt bindings.
2. ChangeSet, configuration snapshot, approval, evidence, command,
   reconciliation and durable-audit bindings.
3. Additive exports from `@workspace/db/schema`.
4. A pure schema-binding regression proving both live product exports and the
   new default-unwired table identities.
5. A local-only disposable database reset tool and an exact-head CI workflow
   for Linux, Windows and PostgreSQL 16 fresh/prefix adoption gates.

## Excluded

- application/API imports of the new tables;
- active-context issuance or session gateway wiring;
- command/evidence/audit PostgreSQL adapters;
- route, UI, worker, repair scheduler, publisher or materializer activation;
- long-lived database migration, GitHub push/PR/merge, `Next` synchronization
  or production deployment.

## Local evidence

- Canonical schema Git blobs: `2/2` exact.
- Library typecheck: pass.
- API typecheck: pass.
- Schema binding regression: `3/3`.
- Migration authority with disposable reset and CI pinning checks: `14 PASS + 1`
  Bash-unavailable skip on Windows.
- Disposable reset tool: pass against PostgreSQL `16.15` on
  `127.0.0.1:5433/fasos_apply_local`.
- Production-prefix adoption after reset: `66/66 -> 82/82 -> clean replay`.

The workflow file is prepared locally but has not run on GitHub. This slice is
therefore default-unwired and not merge-, `Next`-sync- or deploy-ready.
