# Education country

Date: 3 October 2026

## Behaviour

- High-school, bachelor, master and doctorate records store the country of the school independently from student nationality.
- Country can be selected, changed or explicitly cleared.
- Missing country remains `null`; it is never inferred or backfilled from nationality.
- Document extraction accepts a country only when the school/university country is explicitly present in the source document.
- Automatic extraction uses fill-missing-only database updates, so an existing country is preserved.
- Both the current `student_education_records` projection and the detailed `education_records` projection remain supported.
- SIT preflight blocks before browser automation when the country of the required prior education level is missing.

## Database change

Migration `0132_education_country.sql` adds the nullable country column to the current projection and extends both education-level constraints with `doctorate`. It contains no nationality backfill, data rewrite or row deletion.

## Compatibility

Older clients may omit `country`; the server stores it as `null`. Existing API routes and response shapes are extended additively. The generated client and validation schemas are regenerated from OpenAPI.

## Scope exclusions

SIT dropdown commit reliability and final-submit error diagnostics remain separate work. This change does not submit or resubmit a real student application.

## Release state

Implemented for development/staging validation only. Production deployment is explicitly out of scope for this change.
