---
name: edcons stage-document upload surfaces parity
description: Multiple separate UI components upload application stage documents; stage-behavior features must be mirrored across all of them.
---

# Application stage-document upload surfaces must stay in parity

There are (at least) THREE independent UI surfaces that POST to
`/api/applications/:id/stage-documents`:

- `StageDocUploadDialog.tsx` — the pipeline/kanban "Document Required" dialog.
- `StageDocumentsPanel.tsx` — a detail-page panel (full-featured).
- `ApplicationDocumentsPanel.tsx` — the other detail-page "Application Documents" panel (drop-zone style).

**Rule:** any backend stage-behavior requirement (from `pipeline_stages`, e.g.
`requiresValidUntil`, `tracksOfferExpiry`) that the upload endpoint enforces must
be honored in EVERY one of these surfaces, or one path silently 400s while the
others work.

**Why:** the Offer Letter (`offer_received`, `requiresValidUntil=true`) upload
worked from the pipeline dialog and `StageDocumentsPanel` but failed from
`ApplicationDocumentsPanel` with `HTTP 400: validUntil is required for this stage`
because that panel never collected/sent `validUntil`.

**How to apply:** when adding a stage-behavior flag enforced by
`applicationStageDocuments.ts`, grep all three components and add the same
gate + field. Reuse the existing `stageDocs.*` i18n keys (validUntilFieldLabel /
toastValidUntilRequired / toastValidUntilRequiredDesc) — already in all 10 locales.
