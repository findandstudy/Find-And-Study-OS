# Live-first session lifetime boundary - 1 September 2026

## Purpose

This slice preserves current live authentication and public-application
verification behavior while making the server-side session lifetime
non-sliding across every write helper.

## Enforced boundary

- A server-issued `issued_at` value anchors every session to a fixed 24-hour
  absolute lifetime.
- Sliding the eight-hour idle timeout and browser cookie can never extend that
  absolute deadline.
- Legacy sessions receive one bounded compatibility timestamp on first
  observation.
- `updateSession` first reloads the current server-side session and preserves
  its issued-at value. Omitting the value can no longer restart the absolute
  clock.
- Every legacy impersonation child session inherits the verified parent
  session's issued-at value; switching identity cannot start a fresh absolute
  24-hour window.
- Every impersonated request revalidates the parent session and actor. Missing
  or nested parent state, mismatched issued-at/identity/role, deleted actor or
  inactive actor clears the child session before authorization continues.
- The existing live public-application student verification exception remains
  unchanged.

The session store, pure lifetime helper and direct lifetime test are
content-equivalent to the canonical candidate, ignoring working-tree line
ending normalization.

## Evidence

- Session lifetime tests: `3/3`.
- Impersonation policy and parent-authority tests: `6/6`.
- User-management policy tests: `6/6`.
- Live security regressions: `31/31`.
- API TypeScript check: pass.
- Diff check: pass.

This does not add MFA, step-up, JIT/PAM, full relationship-grant re-evaluation,
browser active-context token storage or production Control Plane wiring. No
production session, database, VPS, GitHub or `Next` state was changed.
