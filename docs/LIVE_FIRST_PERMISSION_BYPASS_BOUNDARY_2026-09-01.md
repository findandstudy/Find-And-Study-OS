# Live-first permission bypass boundary - 1 September 2026

## Purpose

This slice aligns the central backend permission resolver and the two shared
frontend permission guards with the target rule that only platform Super Admin
may bypass a configured role package.

## Enforced boundary

- `super_admin` remains the sole all-permission principal in the legacy
  resolver.
- `admin` now uses the current stored role package, static fallback only when a
  stored role row is absent, and explicit per-user grant/revocation overrides.
- Request authentication emits the same override-aware effective projection to
  the frontend for admin and all other non-Super-Admin roles.
- The shared `useAuth().hasPermission` and `ProtectedRoute` permission checks no
  longer short-circuit for admin.
- Batched Academy access projection no longer treats admin as holding every
  permission; it uses the same stored/fallback role package and user override.

This does not reinterpret every direct role-gated screen or route. Those legacy
surfaces remain enumerated and quarantined by G30 until they are converted to
versioned capabilities and signed active context.

## Evidence

- Permission and staff-scope tests: `9/9`.
- Live security regressions: `31/31`.
- API TypeScript check: pass.
- Edcons TypeScript check: pass.
- Diff check: pass.
- The Agency platform suite's Academy scenario passes. The aggregate suite is
  `14/15`; its unrelated SMTP scenario still expects an older
  `tlsServername: isIP(originalHost)` source shape while the live code uses an
  explicit, stricter TLS servername/certificate-validation expression. This
  stale assertion was not weakened or counted as a pass.

No production role, permission, session, database, VPS, GitHub or `Next` state
was changed.
