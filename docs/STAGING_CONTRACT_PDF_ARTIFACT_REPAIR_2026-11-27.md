# Staging contract PDF artifact repair — 27 November 2026

Scope: Apply staging only. Production deployment, production data, real agents,
real signatures and real email delivery are explicitly outside this change.

## Implemented contract

- Signing preview and final PDF continue through the shared contract renderer.
- Chromium PDF rendering remains network-denied; all image bytes must already be
  embedded before the browser receives HTML.
- Every distinct external `img[src]` in a new signing session is captured from
  the exact bounded operator allowlist. The configured header logo and legacy
  template-body logos are independent snapshots.
- Captured images are decoded and normalized to PNG, at most 1024 x 1024 and
  256 KiB, then frozen with their SHA-256 digest.
- Render-time branding replaces exact image sources with their frozen data URL.
  No current template, mutable agent profile or provider fetch is used when a
  signed PDF is created or repaired.
- Normal lazy generation accepts only an entirely absent artifact. Partial
  object/evidence states require controlled repair.
- Controlled repair parses the stored PDF to distinguish a healthy artifact
  from a missing/corrupt one, rebuilds only from frozen signing evidence, writes
  a new object and evidence hash, and atomically records an audit receipt.
- Repair compare-and-set protects the source snapshot. Signature bytes,
  `signed_at`, signer identity and the signing session are never updated. The
  old PDF object is retained.
- The administrator repair route is protected by `contracts.manage`, branch
  scope and a mandatory bounded reason.

## Safety and verification

- `ALLOW_LIVE_INTEGRATIONS=false`
- `EMAIL_DELIVERY_DISABLED=true`
- `SIGNED_CONTRACT_DELIVERY_ENABLED=false`
- No production endpoint or database is used.
- Unit suites cover CSS preservation, shared shell parity, multi-logo capture,
  exact data-URL replacement, PNG/hash constraints, render network isolation,
  signing immutability, missing-PDF policy and attachment delivery receipts.
- The disposable Linux candidate test creates only synthetic users, agency,
  template, signing session and contract rows. It verifies agent/admin/public
  downloads, corrupt-artifact repair, new evidence hash, unchanged signature
  and signing time, one audit record, and zero external connections.
- The whole disposable database, local object root and candidate container are
  discarded after the test. No real email is sent.

## Runtime policy

The live staging PDF/email workers remain disabled for this verification. Worker
recovery is exercised in isolated candidate tests; enabling a live sweep is a
separate operational decision and is not required to make explicit admin or
agent downloads functional.
