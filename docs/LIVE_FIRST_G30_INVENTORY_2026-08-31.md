# Live-first G30 inventory - 31 August 2026

## Purpose

This slice freezes the conservative writer/side-effect and legacy route-gate
denominators for the live-first convergence branch. Registry entries are
review surfaces, never authorization or evidence that a path is safe.

## Tenant writer inventory

- Production TypeScript files with a detected surface: `163`.
- Conservative surfaces: `2,099`.
- Database ORM writes: `1,398`.
- Raw SQL writes: `383`.
- Object/file writes: `26`.
- External side effects: `179`.
- Event/cache writes: `60`.
- Scheduler/worker surfaces: `53`.
- External-pilot allowlist: `0`.
- Quarantined files: `163`.
- High/critical files keeping the strict gate NO-GO: `135`.

The registry inherits reviewed classifications for `155` paths from the
canonical branch. Eight live-product paths absent from that registry are added
conservatively as high-risk, mixed-legacy and quarantine-required:

- `agentApplicationLifecycle.ts`
- `inbox/applicationIntakeActions.ts`
- `inbox/applicationIntakeOrchestrator.ts`
- `inbox/inboundDocumentPersistence.ts`
- `requestPerformance.ts`
- `routes/agentApplications.ts`
- `routes/agentEmbed.ts`
- `routes/followUps.ts`

## Legacy route-gate inventory

- Route files: `71`.
- Route registrations: `762`.
- `requireAuth` references: `706`.
- Fixed `requireRole(...)`: `476`.
- `requirePermission(...)`: `41`.
- Direct role checks: `28`.
- Auth-only route candidates: `127`.
- Public route candidates: `128`.
- Files in legacy quarantine: `71`; `70` contain route registrations.

## Gate result

Normal drift checks pass with no unclassified or stale files. Strict checks
fail intentionally: `135` high/critical writer files remain quarantined and
`70` route files remain in legacy quarantine. The live-first CI candidate runs
the normal drift gates; strict readiness remains a NO-GO exit criterion.

No runtime code, route behavior, external delivery, database, GitHub, `Next`
or production state is changed by this inventory slice.
