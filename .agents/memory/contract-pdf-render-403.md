---
name: Contract PDF render → opaque 403
description: Why heavy headless-Chromium PDF renders must stay off the user-facing request path, and the pre-warm + serialize pattern that fixes the opaque edge-proxy 403.
---

# Heavy PDF render on the request path = opaque edge-proxy 403

When an agent signs and then views/downloads their signed contract PDF, an
opaque `HTTP 403 Forbidden` **HTML** page (NOT one of the app's JSON 403s) means
the Replit edge proxy returned it because the autoscale instance crashed/timed
out mid-request — typically a headless-Chromium PDF render OOM-killing the
process. App-level 403s are always JSON; an HTML 403 is the proxy, not Express.

**Rule:** never run `buildSignedPdf` / `ensureSignedContractPdf` (headless
Chromium, ~15s, memory-heavy) **synchronously on a request the user is blocking
on** in the autoscale deployment. Dev has generous memory so it "works" there
(~15s) and hides the production OOM — reproduction in dev will NOT show the 403.

**Why:** Chromium RSS is large; one render is borderline on the constrained
autoscale instance, concurrent renders multiply it and crash the process. A
crashed/dropped connection makes the proxy emit its own opaque 403 HTML, so the
in-app `withTimeout`→JSON-500 fallback never runs (the process is gone).

**How to apply (pattern in `lib/signContract.ts`):**
- Sign hot path stores ONLY the signature image; no Chromium inline.
- `schedulePdfRender(signedContractId)` — fire-and-forget, error-contained
  pre-warm called at the END of `finalizeSign` success (after commit) so the PDF
  is cached before the agent opens it.
- `withRenderLock` — global in-process promise-chain mutex so at most ONE
  Chromium render runs at a time (kills the concurrency-OOM multiplier).
- `ensureSignedContractPdf` re-checks the stored `pdfObjectKey` INSIDE the lock,
  so a download racing the pre-warm skips a redundant render; keep the
  `WHERE pdfObjectKey IS NULL` CAS as the cross-caller safety net.
- All lazy-download callers (`/contracts/me/pdf`, admin `/contracts/signed/:id/pdf`,
  public `/sign/:token/pdf`) route through `ensureSignedContractPdf`, so fixing it
  there covers every download path.

**Residual risk:** in-process lock bounds concurrency per instance, not the
single-render OOM. If crashes persist, move rendering out-of-process (worker/queue).
