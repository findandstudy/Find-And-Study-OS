---
name: universities endpoint limit cap
description: GET /api/universities silently caps page size; selectors needing the full catalog must paginate
---

The `GET /api/universities` handler caps `limit` at 100 server-side (`Math.min(100, ...)`). A single request with a large `limit` (e.g. `?limit=500`) silently returns only the first 100 rows ordered by name — extra universities just vanish with no error.

**Why:** the catalog exceeds 100 rows; any admin selector that loaded the list in one shot dropped the tail (e.g. universities sorted late by name), making them look "missing" / unselectable.

**How to apply:** when a UI needs the complete university list (dropdowns, selectors), page through `?limit=100&page=N` until `data.length >= meta.total` rather than requesting one oversized page. The same cap pattern may exist on other list endpoints — don't assume a high `limit` returns everything.

Related: the curated `destinations` table holds only a handful of countries, but universities span more. UI that auto-fills a destination from a university's country should union curated destinations with the system's actual university countries (e.g. synthetic `c:<country>` options) so every university can resolve; `university_contracts.country` is notNull and derived server-side from the university, while `destinationId` is an optional FK.
