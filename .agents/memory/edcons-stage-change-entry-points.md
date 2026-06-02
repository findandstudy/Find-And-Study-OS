---
name: edcons stage-change entry points
description: All UI paths that change an application's pipeline stage in the edcons web app — easy to miss some when adding stage-transition gating.
---

# Application stage-change entry points (edcons)

An application's pipeline `stage` can be changed from several distinct UI paths.
When adding any gating/interception on stage changes (e.g. document-request
modals), every one of these must be handled, or some paths silently bypass it.

Known entry points:
- Kanban drag-and-drop (Applications.tsx)
- List/table quick stage actions (Applications.tsx, `performStageMove` / `handleStageAction`)
- Bulk "move" action (Applications.tsx + bulk-action route)
- ApplicationDetail stage dropdown (`handleStageChange`)
- `EditApplicationDialog` full-edit form (Applications.tsx) — sends `stage` in a multi-field PATCH
- `EditApplicationInlineDialog` full-edit form (ApplicationDetail.tsx) — same

**Why:** The two full-edit dialogs each do their own direct `fetch` PATCH and are
easy to overlook because they aren't "stage move" code — they're general edit
forms that happen to include the stage field. A code review caught that they
bypassed the new 422 doc-gating flow.

**How to apply:** Enforce stage-transition rules **server-side** in
`PATCH /applications/:id` (and the bulk route) so no client path can bypass them.
On the client, route every entry point's 422 handling through the shared
`stageTransition.ts` helpers / shared dialogs. After any such change, grep for all
PATCH calls to `/api/applications/` and confirm each handles the relevant 422 codes.
