---
name: SIT wizard contact/family data gaps
description: Which Step-3/Step-4 SIT "Add Student" fields the CRM can vs cannot fill, and the phone→parent-mobile cross-contamination gotcha.
---

# SIT Add-Student wizard — contact/family field data availability

The SubmitProfile type and the CRM `students` table provide ONLY these
contact/family fields: `address`, `phone`, `fatherName`, `motherName`.

There is NO CRM data for: city, state/province, postalCode, country of
residence, father/mother job, father/mother mobile. Do NOT fabricate values
for these — if the SIT wizard marks any of them required(*), that is a
data-sourcing gap (CRM has no column), not an adapter bug. The walker's FORM
DUMP + inline-error diagnostics will surface which are actually required.

**Country default:** the only derivable field. Fill Step-3 "Country" with the
applicant's nationality country via `toEnglishCountryName(profile.nationality)`
(select→text fallback, mirroring the nationality control).

**Phone cross-contamination gotcha:** the phone label regex `/phone|mobile/i`
also matches a Family-step "Father's / Mother's Mobile". The walker attempts
every field on every step, so an ungated phone fill leaks the STUDENT's phone
into a parent mobile field on Step-4.

**Why:** the walker re-runs all field fills per step; unanchored labels bleed
across steps.

**How to apply:** gate phone as fill-once via `everSet` (add "phone" after the
first successful fill; it is not a `critical`/`mark` name so no BULUNAMADI
side effect). Same caution for any future unanchored contact label.
