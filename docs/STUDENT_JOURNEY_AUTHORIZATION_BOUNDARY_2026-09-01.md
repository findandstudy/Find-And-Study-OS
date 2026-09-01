# Student Journey authorization boundary

Date: 2026-09-01

Status: default-unwired local foundation; the legacy Journey route remains
quarantined and is not represented as active-context migrated.

## Why this boundary is separate

The current `/students/me/journey` route is safely self-owned inside the legacy
model: it accepts no student/application identifier and resolves the student by
the authenticated legacy user ID. That is necessary but not sufficient for the
target corridor. The binding authorization contract also requires:

- a server-resolved tenant, organization/branch and human principal;
- a signed active context whose selection and session generation are current;
- current membership, assignment, policy and capability state at request time;
- the exact student resource to belong to the authenticated person;
- same visible resource IDs in another tenant or branch to remain hidden;
- impersonation to remain unavailable for the Student self corridor.

The live `students` and `applications` tables do not yet carry the canonical
tenant ownership required to prove this in the HTTP route. Wiring the generic
active-context evaluator directly to those legacy rows would create false
assurance. This change therefore adds the complete request authority contract
without activating it.

## Contract added

`artifacts/api-server/src/lib/studentJourneyAuthorization.ts` provides
`authorizeStudentJourneyRequest` with these invariants:

1. Only the Ed25519 versioned active-context envelope is accepted. The legacy
   two-part HMAC token is rejected.
2. Token verification binds audience, environment, cell, issuer, tenant,
   selection ID and session generation.
3. Request identity and resource envelopes have exact server-only shapes;
   extra client-shaped student/application fields are rejected.
4. Authenticated principal, legacy user mapping, membership, current selection
   and student ownership must all agree.
5. Request or persisted impersonation is denied.
6. Tenant/organization/branch or owner mismatch returns `resource_not_found`
   before authoritative state resolution, avoiding cross-scope existence leaks.
7. The resolver must re-read current principal/selection/authorization state.
   Replaced/revoked/expired selections and stale generations fail closed.
8. Resolution is bounded by a hard `5000ms` ceiling; the default is `2000ms`.
9. The shared active-context evaluator re-applies current membership,
   assignment, policy, scope, explicit deny, step-up and approval semantics.
10. A successful result emits an internal receipt binding context, selection,
    generation, principal, membership, authenticated legacy user and student.

The candidate capability key is `student.journey.read`. It is not inserted into
the production capability catalogue by this change and therefore cannot become
an implicit runtime allow.

## Verification

The direct `12/12` suite covers:

- positive strict versioned/selection-bound self authorization;
- legacy HMAC rejection;
- selection and generation mismatch;
- authenticated principal and principal-to-user drift;
- request and persisted impersonation;
- same student ID in another tenant or branch;
- another owner's student record;
- replaced/revoked/current-selection drift;
- membership revocation, explicit deny and policy version drift;
- resolver failure, malformed authority state and hard timeout;
- extra client-shaped request/resource fields;
- expired context rejection before database resolution.

The suite is required in both Linux and Windows convergence CI jobs.

## Runtime adoption prerequisites

This foundation must remain unwired until all of the following are proven:

1. The G45 corridor is approved and the Journey tables receive additive,
   backfilled, constrained canonical `tenant_id` ownership without changing the
   production `0000–0065` prefix.
2. Student/person/application ownership and branch semantics are unambiguous;
   null/global defaults cannot stand in for a tenant.
3. `student.journey.read` is reviewed in the platform capability catalogue and
   granted only through a Student self role-package/scope.
4. The HTTP session gateway resolves the current selection and principal mapping
   from PostgreSQL on every protected request; body/query/header values are not
   authority sources.
5. Access decision receipts have a tenant-owned durable writer and cannot make a
   successful read depend on the legacy asynchronous audit logger.
6. Disposable PostgreSQL tests cover two tenants with the same legacy IDs,
   connection-pool context reset, revoke/replace races and application/document
   joins.
7. Only after those gates may the route registry move this endpoint from
   `legacy_quarantine` to `corridor_migrated`.

No migration, route, database writer, session activation, production change,
VPS operation, deploy, merge or `Find-And-Study-OS-Next` synchronization is part
of this change.
