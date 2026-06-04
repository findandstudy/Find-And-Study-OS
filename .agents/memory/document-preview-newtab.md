---
name: Document preview in new tab (role access)
description: Why lead-document previews use client-side blob URLs instead of the shared download endpoint
---

Document previews in edcons open in a new browser tab (no in-app modal).

- Student/application documents: open `${BASE}/api/documents/:id/download?disposition=inline` directly — staff have full access there.
- Lead documents: build a blob URL client-side from the already-loaded base64 `fileData` and `window.open` it; fall back to `fileUrl`.

**Why:** lead-only documents (rows with `leadId` but no `studentId`) are NOT downloadable via `/api/documents/:id/download` for agent roles — that endpoint requires `doc.studentId` for agents and 403s otherwise. The lead docs list already ships base64 `fileData` to the client, so a blob URL previews correctly for every role without a server round-trip.

**How to apply:** when adding any "preview/open" affordance for documents that may be lead-scoped, prefer the client-side blob path; only use the inline download endpoint for student/application-scoped docs. `data:` URLs are unreliable for top-level `window.open` navigation (browsers block them) — use a blob URL and revoke it after a timeout.
