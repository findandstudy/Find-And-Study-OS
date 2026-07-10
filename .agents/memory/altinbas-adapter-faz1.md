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

Confirmed via repeated headed dry-run (app 2263/HASNAIN): login→Basic Info→student grid→Create New
Application→Term→Degree→**Program Selection (Save and Next)**→Personal Information all work reliably in
git (commits through 446c954). Every SLDS control needs `{force:true}`; card/button text is unreliable for
accessible-name matching (e.g. "SelectSelectedRemove") — use `button:has-text()` / content-based card lookup.

Two open blockers — do NOT blindly re-iterate a fix, they need an interactive live-portal session:
1. **Personal Information country typeaheads** (Country of Birth/Citizenship/Passport Issuing/Address
   Country) never open a dropdown in automated/xvfb sessions (fill/pressSequentially/force-click all fail;
   works fine under real human-driven Chrome). Diagnosing the real open/select event requires watching the
   live DOM interactively, not another blind Playwright attempt.
2. **Program "Save and Next"** is non-deterministic — identical code sometimes advances to Personal,
   sometimes gets stuck on the Selected Programs modal (CSS-Error dialog + hydration race). A retry loop
   exists but isn't 100% reliable.

**Why it matters**: this portal (SF Experience Cloud LWC) is unusually automation-resistant; before adding
more blind selector tweaks, prefer an interactive session (real Chrome, watch DOM/events live) or fall back
to a semi-manual flow (adapter drives Basic Info→Program selection, human completes Personal/Documents).
