---
name: Topkapı final-submit success proof
description: Why a portal HTTP 200 is not proof of submission, and what counts as real success.
---

# Topkapı final-submit success proof

**Current rule (matches the proven fas-automation engine):** the submission
proof is a 2xx/3xx response from `application-save.php`. That alone sets
`submitted = saveOk`. The `/applications/success/<uuid>` redirect is BEST-EFFORT
— used only to capture `externalRef` when present; a missing redirect does NOT
fail the submit (log "saved but success-url not captured").

History: an earlier version required the COMBINATION (modal + save 2xx/3xx +
success-url uuid) to fix a false-positive, but that proved TOO STRICT — a real
save-200 with no/late success redirect was wrongly reported as failed. The
owner deliberately reverted to the save-200 = success behavior with optional
external_ref. Do not re-tighten without an explicit request.

**Mechanics that stay regardless of the criterion:**
- Arm `waitForResponse(application-save.php)` BEFORE the submit click (a passive
  `page.on("response")` listener races a fast response and misses it).
- Confirm the optional `.jconfirm` summary modal when it appears.
- `saveOk = !!resp && status>=200 && status<400`. If save is NOT 2xx/3xx →
  `submitted=false` with a meaningful `detail` (no false positive).

**How to apply:** `SubmitResult.externalRef` carries the captured uuid; the
runner writeback (`stageWriteback.ts`) persists it to
`portal_submissions.external_ref` ONLY when present (conditional spread) so a
later run with no ref can't clobber it. Never touch the DRY (`doSubmit=false`)
branch, `alreadyExists`, or `programMissing` when changing real-submit logic.
