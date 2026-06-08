---
name: Main-agency seal in final PDF only
description: How the Ana Acente (main agency) seal is confined to the final signed PDF and never the preview/sign screen
---

The contract template has two signature boxes: {{signature}} = alt acente (sub-agent
signer input) and {{main_agency_signature}} = ana acente (Find And Study kaşe+imza).

**Rule:** the main-agency seal must appear ONLY in the final, post-signature PDF —
never in preview or signing-screen renders.

**Why:** preview/sign renders happen before signing; leaking the seal there (or an
empty `<img src="">` broken icon) is wrong. The seal is server-stamped after the
sub-agent signs.

**How to apply:**
- buildAgentContext defaults main_agency_signature to "" → every preview path
  (publicSigning preview, agentOnboarding preview) stays empty automatically; do NOT
  set it there.
- The ONLY injection site is ensureSignedContractPdf (the single final-render fn used
  by the delivery + backfill workers): set ctx.main_agency_signature right after
  ctx.signature. The seal is an inlined base64 data URL (no fetch/disk), so it can
  never fail to load.
- cleanupSignatureImages collapses an empty box to a styled placeholder using the
  img's alt label — so a preview shows exactly ONE real <img> (the signer's).

**Regenerate an already-rendered contract (idempotent cache bypass):**
ensureSignedContractPdf early-returns when pdfObjectKey+evidenceHash are set, so a
renderer change never reaches old contracts. Admin endpoint
POST /contracts/signed/:id/regenerate (requirePermission contracts.manage) NULLs
pdfObjectKey+evidenceHash+deliveryClaimedAt and returns 202; the existing backfill
worker (pdfObjectKey IS NULL AND emailedAt IS NOT NULL) re-renders OFF the request
path. Never render synchronously in the endpoint (autoscale Chromium-in-request OOM
→ opaque edge 403). emailedAt is untouched → no notification re-send.

**Gotcha:** in this api-server, req.params.id is typed string|string[] — use
parseInt(String(req.params.id), 10) or you add a TS2345 to the baseline.
