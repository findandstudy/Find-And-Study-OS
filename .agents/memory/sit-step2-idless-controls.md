---
name: SIT Step-2 id-less controls & custom date widgets
description: Why SIT Add-Student Step-2 Gender/Nationality/date fields come back BULUNAMADI and how to resolve them
---

# SIT "Add Student" wizard — Step-2 field resolution

**Rule:** SIT's shadcn form controls (Gender/Nationality `<select>`, and the date
fields) carry **no `id`**, so `resolveControl()`'s `label[for=id]` / wrapping-label
association returns null and the field is never filled → live run logs BULUNAMADI.
Resolve them by scoping to the labelled wrapper instead:
`div[data-slot="form-item"]` that `has:` a `label[data-slot="form-label"]` matching
the question (the SAME pattern the working Step-1 Radix toggle fix uses). Helper:
`formItemByLabel(page, labelRe)` in the SIT adapter.

**Why:** the FORM DUMP (`$$eval` over `input/select/textarea`) showed Gender/
Nationality as `<select>` with empty `id`, and the date fields did **not appear at
all** — meaning they are custom NON-input components (button/calendar popover),
not `<input>`s. Any input-only helper silently misses them.

**How to apply:**
- Selects: read `select.options`, match an anchored `optionRe` against option
  text OR value, skip disabled/empty-placeholder options, `selectOption` + verify
  `select.value`.
- Nationality: CRM stores the country in **Turkish** ("Özbekistan") but the
  wizard's select carries **English** option text ("Uzbekistan"). Translate with
  `toEnglishCountryName()` (helpers.ts — Turkish-fold + TR→EN map, mirrors
  Topkapı's; returns the raw name unchanged on a miss). Build an **anchored**
  regex `^\s*(EN|raw)` so "Samoa" can't match "American Samoa". On a miss, log the
  live option texts (`[sit] nationality opt eşleşmedi …`) instead of a silent fail.
- Gender regexes must stay anchored (`^\s*(male|erkek)\s*$`) or `male` substring-
  matches `Female`.
- **Dates are the open problem.** They are custom widgets; a form-item-scoped
  `<input>` + trigger-open + popover-input best-effort is in place, but if the
  widget is button/calendar-only it still can't be driven blind. `setDateField`
  logs `[sit] DATEHTML <label>: <outerHTML>` on the miss — the NEXT live run's
  DATEHTML output is required to implement deterministic calendar navigation
  (open trigger → set month/year/day → verify reflected value). Do not guess the
  calendar DOM before that log is captured.
