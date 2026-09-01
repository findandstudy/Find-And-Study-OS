# Control Plane pure policy slice - 31 August 2026

## Purpose

This slice moves only deterministic, default-unwired authorization and
ChangeSet decision code onto the live-first branch. It does not connect the
policy engines to requests, sessions, databases, workers or external effects.

## Provenance

- Live-first base: `b220710b`.
- Canonical source: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- Source and direct test Git blobs: `6/6` exact against the canonical source.

Included modules:

1. `changeSetPolicy.ts` — typed R1 configuration allowlist, state machine,
   maker-checker, step-up, evidence, observation and rollback policy.
2. `activeTenantContext.ts` — signed short-lived tenant context and
   server-resolved capability/scope revalidation.
3. `changeSetEvidenceEnvelope.ts` — tenant/grant/key-bound Ed25519 evidence
   envelope with rotation, expiry and artifact-manifest binding.

## Local evidence

- Active tenant context: `13/13`.
- ChangeSet R1 policy: `12/12`.
- ChangeSet evidence envelope: `8/8`.
- Combined pure-policy assertions: `33/33`.
- API typecheck: pass.
- Exact-head CI workflow calls all three suites.

## Boundary

The modules are not imported by a route or runtime bootstrap in this slice.
No PostgreSQL adapter, request-context bridge, active-session gateway,
publisher, scheduler, repair worker, UI or production wiring is added. GitHub
push/PR/merge, `Next` synchronization and production deployment remain out of
scope and have not occurred.
