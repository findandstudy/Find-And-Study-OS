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
