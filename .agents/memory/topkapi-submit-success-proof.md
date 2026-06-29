---
name: Topkapı final-submit success proof
description: Why a portal HTTP 200 is not proof of submission, and what counts as real success.
---

# Topkapı final-submit success proof

A bare HTTP 200 from the portal's save endpoint is NOT proof that an application
was actually created. The Topkapı adapter once set `submitted=true` on a passive
`application-save.php` 2xx/3xx listener — but the portal showed no record and
`external_ref` was empty (false positive).

**Real success = the COMBINATION of:**
1. confirming the `.jconfirm` summary modal when it appears (optional — not all
   flows show it),
2. a 2xx/3xx response from `application-save.php` (arm `waitForResponse` BEFORE
   the submit click so a fast response is never missed — a passive listener races),
3. the page landing on `/applications/success/<uuid>`.

`submitted = saveOk && externalRef !== undefined`, where `externalRef` is the
`<uuid>` parsed from the success URL. HTTP 200 alone is never success. On failure
return `submitted=false` with a meaningful `detail` so the run is recorded as
`failed`, never `submitted`.

**Why:** silent false-positives mean students look "submitted" in the CRM while
no portal record exists — the worst failure mode for the automation.

**How to apply:** any portal adapter's real-submit branch should prove success by
a portal-side artifact (success URL / confirmation id), not just a network status.
`SubmitResult.externalRef` carries that id; the runner writeback
(`stageWriteback.ts`) persists it to `portal_submissions.external_ref` ONLY when
present (conditional spread) so a later non-submitted run can't clobber it. Never
touch the DRY (`doSubmit=false`) branch when changing real-submit logic.
