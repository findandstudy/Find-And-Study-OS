---
name: Altınbaş adapter (Faz 1)
description: Salesforce Experience Cloud Screen Flow portal; level guard Master/PhD only; self-capture after Step 1; Faz 2 needs program select from dry-run logs.
---

## Architecture

- **Portal**: `https://apply.altinbas.edu.tr/partner/s/` — Salesforce Experience Cloud (partner community)
- **Form engine**: Salesforce Screen Flow (multi-step server-side interview state; API-replay risky → Playwright browser approach like Topkapi)
- **Adapter file**: `lib/portal-adapters/src/universities/altinbas/adapter.ts`
- **Family**: `"altinbas"` in registry.ts; `EXPERIMENTAL_FAMILIES` (manual-only, no auto-drain)
- **Session state**: `/tmp/altinbas-portal-state.json`

## Level guard

Only `master` / `phd` / `doktora` / `yüksek lisans` are accepted. Everything else returns a `SubmitResult` with `submitted:false, programMissing:false` and a clear `detail` string — never a silent fail. The guard check is `isAcceptedLevel(normLevel(profile.level))`.

**Why**: Customer confirmed (8 Tem) only Master+PhD is open; Associate/Bachelor silently submitting would be wrong.

## Faz 1 Step 1 fields (confirmed from plan)

- First Name, Last Name, Citizenship (SF lookup/typeahead), Passport Number, Applicant Email → Next

## Self-capture (Faz 2 discovery mechanism)

After Step 1, every unknown screen calls `captureCurrentStep()` which:
1. Takes a screenshot → `/tmp/altinbas-capture-step<N>-<ts>.png`
2. Runs a page.evaluate that dumps: headings, all label texts, input names/types/placeholders, select names + all options, combobox fields, textareas, button texts, file inputs, body excerpt (800 chars)
3. Logs the full JSON structure via `logger.info`

A dry-run (`ALTINBAS_DRYRUN=1` or `PORTAL_DRYRUN=1` or `doSubmit=false`) navigates all steps via generic `clickNext()` calls, capturing each screen, and stops before the final Submit. This gives complete field/option data for Faz 2 without a manual capture session.

## Faz 2 / Faz 3 TODOs

1. Implement specific step handlers from the dry-run log output (education history, program selection, document upload)
2. Implement `listPrograms()` — placeholder currently returns `[]`
3. Verify Step 1 field `name=` attributes match the live portal (plan says First_Name / Last_Name / Passport_Number — confirm from self-capture)
4. Citizenship lookup: Salesforce LWC combobox; `sfLookup()` does fuzzy fold match on dropdown options

## Key helpers

- `sfFill(page, sel, value)` — fill+verify with pressSequentially fallback
- `sfLookup(page, labelPattern, searchTerm)` — SF typeahead: type → wait → fold-match option → click
- `navigateToAppForm(page)` — SPA route-guard workaround: boot on Home, click APPLY NOW, warmed goto fallback, 3× retry
- `captureCurrentStep(page, tag)` — full screen dump + screenshot
- `checkAlreadyExists(page)` — DUP regex + app-number pattern (`[A-Z]{2,3}\d{6,}`)

**How to apply**: Any Faz 2 step handlers should be added as named functions `fillStep2(page, profile)` etc., placed before the `handleUnknownStep` loop, and detected by checking visible field names/body text from the self-capture output.

## Faz-2 status update (2026-07-10)

Confirmed via repeated headed dry-run: login→Basic Info→student grid→Create New
Application→Term→Degree→**Program Selection (Save and Next)**→Personal Information all work reliably.
Every SLDS control needs `{force:true}`; card/button text is unreliable for
accessible-name matching (e.g. "SelectSelectedRemove") — use `button:has-text()` / content-based card lookup.

## Faz-2.4 — full wizard mapped live (interactive session, all techniques proven)

The two former blockers were resolved by watching the live portal interactively (real Chrome):
1. **Country typeaheads** (Country of Birth/Citizenship/Passport Issuing/Address Country): the LWC listbox
   only renders on REAL keystrokes — natural click (NOT force) → `pressSequentially(value, {delay:80})` →
   click `role=option` (ArrowDown+Enter fallback). `fill()` never opens the dropdown.
2. **Program "Save and Next"**: verify cart shows "Selected Programs (1)" BEFORE proceeding; dismiss the
   CSS-Error dialog BEFORE each of up to 4 Save-and-Next retries; confirm the modal actually closed.
   **Program stage rules (Faz-2.5/2.6, live-debugged twice)**:
   - The search box is BROKEN for MULTI-word queries ("0 items • Page 0/0" even when the program
     exists) but a SINGLE significant word (len>3) filters correctly — search with ONE word only.
   - Do NOT rely on pagination: the pager button's accessible name is "Next" (not ">"), and a generic
     /next/ locator collides with the footer Next — browsing pages proved fragile; prefer
     single-word search + the Language/Thesis SLDS dropdown filters to narrow the list.
   - FINAL diagnosis (Faz-3, live end-to-end success): the program cards live inside iframe +
     **CLOSED** LWC shadow-DOM — NO Playwright locator can reach them (getByText/getByRole/frames
     all 0 hits even for the program NAME after a working search), and the page.evaluate DEEP
     WALKER also FAILS (closed shadow ⇒ `el.shadowRoot === null`, the walker never sees the
     cards). Do NOT retry selector strategies AND do NOT reintroduce the walker for the cards.
   - The ONLY live-proven access: single-word search + Language/Thesis filters to narrow the list
     to ~1 card, then coordinate-based trusted `page.mouse.click` on empirical candidate points,
     verifying the cart ("Selected Programs (N)", /\(\s*[1-9]/) after EVERY click; `dismissSfError`
     between attempts; fail visibly + screenshot if the cart stays empty.
   - **Faz-3.1 calibration: the worker viewport is ACTUALLY 1280x720** (proven by dry-run
     screenshots — an earlier setViewportSize(1568x900) did NOT take effect and was removed; do not
     re-add it). "+ Select" sits BELOW the 720 fold → `page.mouse.wheel(0,450)` + wait BEFORE
     clicking, and capture a "program-postsearch" screenshot for coordinate evidence. Candidate
     points are calibrated for 1280x720 (button right side ~x900-950); never change viewport or
     coordinates independently — recalibrate from the post-search screenshot.
   - Filters default to English / With Thesis when the CRM name carries no "(in turkish)" /
     "(without thesis)" hint; unhinted dimensions get bounded fallback combinations (default set
     always tried first) so hint-less Turkish/Without-Thesis programs aren't deterministically lost.
   - The cart "Selected Programs (N)" button and the cart modal are standard DOM — role/`has-text`
     locators DO work for them. Open the modal via the cart button, NOT the footer Next; success =
     ≥1 "Save and Next" click AND the button disappearing.

Other live-proven portal rules:
- **Country typeaheads must be CLEARED first** (ControlOrMeta+A → Backspace), then type only the
  first ~3 chars and CLICK the full-name option — typing alone never commits the value.
- **Phone** = country chip (shadow-nested native select; set via open-shadow walker preferring the
  select whose option contains "+") + **national number without trunk 0** ("+930798546789" →
  chip(+93) + "798546789"); "Phone number can only contain digits" ⇒ leading 0 left in.
- **Dates** = "DD Mon YYYY" (e.g. `31 May 2001`); "05/31/2001" is REJECTED.
- **GPA spinbutton rejects decimals even from a real keyboard** — send an INTEGER string only
  (`String(Math.max(1, Math.round(gpa)))`); "3.20" is refused, "3" is accepted; write via native
  value setter + input/change/blur dispatch.
- **GPA Type** (Grading System) is a shadow-nested native `<select>` — set via open-shadow walker
  (option text "OUT OF 100"/"OUT OF 4") + input/change dispatch; getByLabel alone is unreliable.
- **Personal stage requires Email** — it was the silent blocker in earlier automated runs; fill explicitly.
- **Questionnaire** = one "Do you need Visa Support?" button-combobox → option "Yes". The leftover
  "Complete this field." text after selecting is STALE — first Next validates, SECOND Next advances
  (double-Next if the Answer combobox is still present).
- **Documents** = 4 required file rows (Passport, Bachelor Diploma, Bachelor Transcript, Personal Picture):
  `setInputFiles` → "Upload Files" progress modal → click **Done** → row flips to "( Uploaded )".
  DOM re-renders after EVERY upload — re-resolve the file-input locator/count per document (no stale refs).
- Live success verification: Applications list shows Stage "Evaluation" + green ✓ + "View
  Application"; "Signed Up"/"Complete Application" = half-finished. Post-submit the session may drop
  to agency login (normal).
- **The final submit is the Documents footer's "Submit Application" button** (no Next, no separate
  Completed action). Dry-run must stop before it; the generic final-screen detector must NOT fire on the
  Documents stage (its footer text contains "Submit Application") — guard by stage name AND file-input
  presence.

**Why it matters**: this portal (SF Experience Cloud LWC) is unusually automation-resistant; every rule
above was disproven/proven empirically on the live portal — don't "simplify" them back to standard
Playwright patterns.
