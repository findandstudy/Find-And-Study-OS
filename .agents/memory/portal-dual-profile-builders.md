---
name: Dual portal profile builders + Step-3 field normalization
description: Two SubmitProfile builders must stay in sync; GPA ranges and graduation year need normalization, not Number()
---

There are TWO independent code paths that build a portal `SubmitProfile` from a
CRM student+application, and they drift:

- `lib/portal-runner/src/profile.ts` `buildSubmitProfileFromRecords` — api-server
  "Run Now" / poller path (and the dry-test CLI via `buildProfileFromApplication`).
- `artifacts/portal-automation-worker/src/profile.ts` `buildStudentProfile` — the
  production worker.

**Rule:** any new Step-3 / education field (schoolName, gpa, graduationYear, …)
must be mapped in BOTH builders, or one path silently fills "-"/undefined and the
adapter's fail-visible verify/retry gate reports "empty after retry" despite real
DB data.

**GPA:** never `Number(data.gpa)` — CRM GPA is free-form ("2.8-3.0", "2,8 – 3,0",
"3 to 3.5") → `Number()` yields NaN → "NaN"/"-" → portal rejects. Use the shared
`normalizeGpaRange` (exported from `@workspace/portal-adapters`): range→upper
bound, comma→dot, empty→undefined, unparseable→throw. Pass RAW `student.gpa`
through to `buildProfile`, which normalizes internally.

**Graduation:** CRM stores a year-only int; a native `<input type=date|month|week>`
silently clears a bare "2025". Detect the REAL DOM widget type at runtime and
expand via `formatGraduationForInput` / `formatGraduationForDatepicker`
(`lib/portal-adapters/src/universities/topkapi/format.ts`). Topkapı's
`twopulse-datepicker` is `type=text` so it needs the datepicker variant
(data-date-format driven, default dd.mm.yyyy), not the bare year.

**Why:** Step 3 failed "empty after retry" because the runner builder never mapped
schoolName/graduationYear and both builders NaN-coerced GPA ranges. Keep the
fail-visible gate; fix the data flow + normalization underneath it.
