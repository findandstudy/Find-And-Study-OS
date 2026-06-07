---
name: Contract signature renders as a broken-image icon in the signed PDF
description: Why a signed contract PDF shows a broken signature icon and how to actually fix it (it is almost never a renderer bug)
---

# Broken signature icon in the signed contract PDF

Signatures are stored **bare base64** (no `data:` prefix) in the DB
(`signed_contracts.signature_image_base64`). The PDF render path already wraps it
into a `data:image/png;base64,...` URL via `toSignatureDataUrl()` in
`contractRenderer.ts` (applied at the `ctx.signature = ...` line in
`ensureSignedContractPdf`). So a broken `<img>` in a live PDF is almost never a
missing-prefix renderer bug.

The two real causes:
1. **Stale cached PDF.** `ensureSignedContractPdf` is idempotent — it returns
   early once `pdf_object_key` + `evidence_hash` are set and **never
   regenerates**. A PDF rendered before a fix (or from a corrupt signature) stays
   broken forever. To force a fresh render you must clear the row's
   `pdf_object_key` + `evidence_hash` (then next download regenerates) **or**
   re-sign.
2. **Corrupt source signature.** If `signature_image_base64` is garbage (the
   classic prod incident stored the literal `"AAAA"`, 4 chars, decodes to
   `00 00 00` — not PNG), there is **no real signature to render**. Regenerating
   the PDF cannot help; the agent must **re-sign** (revoke/resend the session so a
   new, validated signature is captured).

**How to diagnose (prod is read-only via executeSql):** check the *active* row for
the session — `length(signature_image_base64)`, `signature_image_base64 LIKE
'iVBORw0KGgo%'` (base64 of the PNG magic). A short length / false magic = corrupt
source → re-sign, not regen. There is a unique index on `signing_session_id`, so
a session has exactly one signed_contract row (no "#3 vs #4" duplicates unless one
was deleted).

**Canonical rule:** DB + API carry bare base64; build the `data:` URL only at the
render/display point (`toSignatureDataUrl`, idempotent for legacy data-URL rows).
Never write the data-URL form back to the DB.

## The deeper cause: agents.contract_url locks to the FIRST contract

`agents.contract_url` is hydrated lazily in `ensureSignedContractPdf` on the first
PDF render. The original guard `.where(... isNull(agentsTable.contractUrl))` meant
the URL was set **once and never updated**. So when an agent **re-signs** (a
"resend" creates a brand-new `signing_sessions` row + a new `signed_contracts`
row), the new contract's render became a no-op and the agent stayed pointed at the
**stale/broken** earlier PDF. This is the real reason the portal kept showing the
broken `contract-23.pdf` even after a valid re-sign produced a good
`contract-24.pdf`.

**Fix:** gate the hydration on "is this row the agent's *newest* signed_contract"
(`ORDER BY signed_at DESC, id DESC LIMIT 1`), then update without the `isNull`
guard. A re-sign now wins; a late download of an OLD contract's PDF won't clobber
the URL back to a superseded contract. This fix only auto-corrects an agent on the
**next** render of their newest contract — because rendering is idempotent, an
already-rendered newest contract won't re-run, so an agent stuck on an old URL
still needs a one-off `UPDATE agents SET contract_url = <newest pdf url>`.

**Resend creates a NEW session, not a reused one:** don't scope diagnosis to a
single session id. A "missing #N" record is usually on the newer session — query
`signed_contracts ORDER BY id DESC` across ALL sessions before concluding data
loss. A 200 + "Contract.Signed #N" activity with "no row" almost always means you
looked at the wrong session.

**Note:** the unsigned-preview render paths (publicSigning preview,
agentOnboarding preview) intentionally leave `signature`/`main_agency_signature`
empty; `cleanupSignatureImages` swaps an empty `<img src="">` for a styled
placeholder box, reusing the `<img alt=...>` text as the label when present, else
the per-language `SIG_PLACEHOLDER`.
