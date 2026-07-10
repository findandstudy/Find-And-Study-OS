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
   - FINAL diagnosis (empirically closed): the program cards live inside iframe + LWC Lightning
     shadow-DOM — NO Playwright locator can reach them (getByText/getByRole/frames all 0 hits even
     for the program NAME after a working search; accordion already aria-expanded=true; page
     exposes only 8 role=buttons; select control renders concatenated three-state text
     "SelectSelectedRemove" in one element). Do NOT retry selector strategies.
   - The ONLY working access is a DEEP WALKER inside page.evaluate: recurse collect() through
     el.shadowRoot and same-origin IFRAME.contentDocument (try/catch cross-origin). Select
     control filter: own textContent /select/, NOT /programs|save and next|cancel/, len<40
     (catches the composite). Card match: climb parentElement OR getRootNode().host (crosses
     shadow boundaries) up to 8 levels checking all significant program words; fall back to the
     first select. Click closest('button,a,[role=button],lightning-button')||self.
   - Cart read / Save-and-Next also need the walker as fallback (same shadow problem); the
     "Selected Programs (N)" cart IS one of the 8 real role=buttons (role locator works for it).
     Verify the cart /\(\s*[1-9]/ after EVERY click attempt; fail visibly if it stays empty.
   - Open the modal via the **"Selected Programs (N)" cart button**, NOT the footer Next; success =
     ≥1 Save-and-Next click AND the button disappearing.

Other live-proven portal rules:
- **GPA spinbutton rejects decimals even from a real keyboard** — send an INTEGER string only
  (`String(Math.max(1, Math.round(gpa)))`); "3.20" is refused, "3" is accepted.
- **Personal stage requires Email** — it was the silent blocker in earlier automated runs; fill explicitly.
- **Questionnaire** = one "Do you need Visa Support?" button-combobox → option "Yes".
- **Documents** = 4 required file rows (Passport, Bachelor Diploma, Bachelor Transcript, Personal Picture):
  `setInputFiles` → "Upload Files" progress modal → click **Done** → row flips to "( Uploaded )".
- **The final submit is the Documents footer's "Submit Application" button** (no Next, no separate
  Completed action). Dry-run must stop before it; the generic final-screen detector must NOT fire on the
  Documents stage (its footer text contains "Submit Application") — guard by stage name AND file-input
  presence.

**Why it matters**: this portal (SF Experience Cloud LWC) is unusually automation-resistant; every rule
above was disproven/proven empirically on the live portal — don't "simplify" them back to standard
Playwright patterns.
