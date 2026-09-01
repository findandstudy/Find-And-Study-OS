# Active-context key-ring and session gateway slice - 31 August 2026

## Purpose

This slice adds the canonical versioned active-context key-ring proof,
selection-bound consumption contract, absolute session lifetime helper and
default-off HTTP session gateway to the live-first convergence branch.

## Provenance

- Live-first base: `e779191d`.
- Canonical source: `02a32146b0dcd42c48a1b03335a7145de0542bf2`.
- Source and direct-test Git blobs: `6/6` exact.
- No route, application bootstrap or production session is wired.

## Local evidence

- Versioned key-ring and selection-bound consumption: `9/9`.
- Absolute, non-sliding 24-hour session lifetime: `3/3`.
- Default-off HTTP session gateway: `9/9`.
- API TypeScript compilation: pass.

The gateway proof rejects caller-controlled scope, invalid HTTP method/path,
bearer/cookie/origin/referer/CSRF drift, stale or impersonated sessions,
rate-limit outages, malformed permits, repository replay/substitution and
deadline expiry. It also proves the session lock remains held through permit,
authoritative resolution and signing, and that the gateway is absent from all
application and route registration modules.

## Boundary

PostgreSQL session storage, issuance rate limiting, selection lifecycle,
runtime registration and production adoption are separate gates. GitHub
push/PR/merge, `Next` synchronization and deployment remain out of scope.
