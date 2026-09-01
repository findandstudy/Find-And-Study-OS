# Live-first platform configuration boundary - 1 September 2026

## Purpose

This slice narrows legacy platform configuration mutations without replacing
the live product's newer settings projections, validation or agency assignment
behavior.

## Enforced boundary

- Role-package create, update and delete are temporarily Super Admin-only.
  Permission-backed role reads remain intact.
- Importing the roles router no longer seeds or mutates the database.
- Global settings PATCH and assignment backfill are temporarily Super
  Admin-only.
- Reading a missing settings row returns safe defaults and never bootstraps
  mutable configuration.
- The authenticated `/settings/client` projection and manager-only full read
  are preserved from the current live product.
- `n8nWebhookUrl` is treated as credential-bearing and removed from settings
  responses alongside SMTP and WhatsApp secrets.
- Role changes, settings changes and branch create/update/archive/unarchive
  request audit events with bounded change metadata.

These are transitional legacy boundaries. They do not make fixed
`requireRole(...)` checks Control Plane-ready and do not remove the affected
files from G30 quarantine.

## Evidence

- Live security regressions: `31/31`.
- API and full workspace TypeScript checks: pass.
- G30 writer drift: `163` files / `2,099` surfaces, external allowlist `0`.
- G30 route drift: `71` files / `762` registrations, `476` fixed-role and `41`
  permission references.
- Strict writer and route gates remain expected NO-GO.

No production setting, role, branch, assignment, VPS, GitHub or `Next` state
was changed.
