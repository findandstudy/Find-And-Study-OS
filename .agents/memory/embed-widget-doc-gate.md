---
name: Mandatory-doc gate is a dual-path concern
description: Required-document enforcement must be mirrored in BOTH the on-site apply form and the embed widget; they diverge silently.
---

# Mandatory document gate lives in two independent UIs

There are two separate public apply UIs that each need their own required-document gate:

1. On-site form — `artifacts/edcons/src/pages/public/Programs.tsx` (React; `missingRequired`, disabled continue/skip buttons).
2. Embed widget — `artifacts/api-server/src/routes/embed.ts`, which is **generated JS emitted as a template string** by `generateWidgetHTML`. It is NOT type-checked by tsc and edits only take effect after restarting the api-server (dev runs `tsx`, no watch). Fetch the served widget at `GET /api/public/embed/:slug/widget` and `new Function(scriptBody)` it to syntax-check.

**Why:** A production application came in via the embed widget with only 2 of 4 mandatory docs because the widget showed "Required" labels but never gated submit — the on-site form did. Fixing one path does not fix the other.

**How to apply:** Any change to mandatory-doc / required-field enforcement must be applied to BOTH paths. In the widget, the gate (`getDocTypes`/`missingRequiredDocs`/`enforceDocGate`) must guard every exit: the documents-step buttons (disabled) AND the modal skip, inline skip, analyze, and submit handlers (defense-in-depth re-check).

**Design constraint — never hard-block the lead:** The backend always converts and parks incomplete applications in `missing_docs` (`mandatoryDocs.ts`). So the widget gate is a UX guard, not the source of truth. Do NOT fail-closed (block apply) when the per-program requirements fetch fails — that drops the lead. Instead retry once, then fall back to the default required set and let the backend park. Template-string emoji/regex escapes are double-escaped (`\\ud83d`, `\\s`).
