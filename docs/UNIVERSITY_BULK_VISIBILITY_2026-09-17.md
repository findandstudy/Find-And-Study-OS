# University bulk activation and inherited visibility

Local implementation; no staging/production deployment or real catalogue mutation.

- University catalogue reuses existing single/page/all-matching selection. Selected rows can be activated/deactivated with a confirmation explaining child visibility. Server accepts up to 5,000 positive integer IDs, deduplicates them and reports actual updated IDs/count.
- Manager/admin/super-admin authorization matches existing program bulk status. One SQL update changes only university `isActive`; audit and existing catalogue/discovery invalidation follow it. Admission `status` (open/closed), child program flags and historical applications are untouched.
- Existing canonical catalogue policy now always checks parent university activity, even for internal Course Finder requests whose public policy is null. Public details and related catalogue sections continue to reuse this policy.
- Legacy catalogue list APIs hide inactive universities/programs from non-managers; managers retain catalogue maintenance visibility. Anonymous legacy detail requests return 404 for inactive schools/programs. Authenticated historical detail reads remain available.
- Course Finder list/facet cache keys reuse catalogue cache generation, which now advances even when SSR caches are empty. Browser responses require revalidation instead of serving stale local responses. Existing server-side TTL/bounded caches remain.
- No cascading child writes: reactivating a university restores only programs whose own flags remain active. Individually inactive programs remain inactive.

## Checks

- Six university tests PASS: valid/deduplicated selections; invalid/bounded inputs; manager-only non-destructive mutation contract; internal/public parent visibility contract; cache generation contracts; public detail contracts. These combine executable parser tests and source contract checks, not a real database/UI end-to-end test.
- API and frontend TypeScript checks PASS.
- 23-locale key/placeholder check PASS. New confirmation copy is Turkish/English; other locales currently use English copy.
- Role-gate inventory refreshed, enforcement classifications unchanged; writer inventory and diff whitespace checks PASS.

## Before deployment acceptance

Staging UAT should use a test university with one active and one inactive program: deactivate, verify Course Finder list/facets/public detail/related links and sitemap omission; reactivate, verify only the active child returns; confirm catalogue records and existing applications remain intact. Test selected row, current page, all-matching across pages and unauthorized mutation. No live records were changed to perform these checks in this task.
