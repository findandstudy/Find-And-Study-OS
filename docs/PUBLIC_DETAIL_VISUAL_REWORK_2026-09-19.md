# Public detail visual rework — 19 September 2026

## Scope and delivery state

Local correction of the Country/Destination, City, University and Program detail presentation after the owner rejected the previous visual interpretation. This supersedes the presentation descriptions in `PUBLIC_DETAIL_PAGES_REFINEMENT_2026-09-19.md`, not its factual contracts.

Repository: `Find-And-Study-OS-Public-Detail-Release`; branch: `codex/public-detail-staging-20260919`; starting commit: `d7968818baaa40ae94f166b2c0b83c7a81f0f3d7`.

This rework has NOT been committed, pushed or deployed. Staging still has the previous `staging-20260919T073233Z-d7968818baaa` release. Production and the unrelated working tree were not changed.

## Design correction

The three supplied HTML files were read and rendered as visual references, not imported as application code or treated as factual sources. The final light/cool-blue country reference, rounded cards, stronger typography, side summary panels and section rhythm informed the new local styles.

- Removed the oversized dark cover and decorative ampersand/orbit artwork.
- Compact university/program identity headers, white side summaries, clear primary and secondary actions.
- Programme cards replace the dense university programme table; metadata and price have separate, responsive regions.
- Country/city layouts use actual scoped catalogue counts and valid hierarchy links.
- Sticky chapter navigation indicates the visible section and respects existing CMS section visibility/order.
- Empty facts, empty fee breakdowns and content-free location overview panels are omitted. Missing tuition is understated confirmation text, not a large imitation price.
- Mobile breadcrumbs avoid repeating the entire long programme title. Mixed-direction factual values use `bdi` for RTL.
- Actual catalogue images/logos are used when available. Missing/invalid/failed media does not create a fake campus photograph or large empty frame.
- An exact programme slug accidentally imported as a requirement is suppressed by the same canonical-path/id-bound rule in API, SSR and SPA. Legitimate hyphenated requirements remain intact; stored data is not rewritten.

## Files changed in this correction

- `artifacts/edcons/src/pages/public/detailEditorial.css`: scoped visual system, cards, hero, responsive/RTL/focus/reduced-motion rules.
- `artifacts/edcons/src/pages/public/DetailEditorial.tsx`: safe images/identity, filtered breadcrumbs/facts, modest unavailable-price rendering.
- `artifacts/edcons/src/pages/public/DetailLayout.tsx`: local active chapter and cleanup; existing layout parser/fetch reused.
- `artifacts/edcons/src/pages/public/CountryDetail.tsx`: destination cover, actual counts, city/university cards and conditional narrative.
- `artifacts/edcons/src/pages/public/CityDetail.tsx`: compact location presentation, linked cards and conditional narrative.
- `artifacts/edcons/src/pages/public/UniversityDetail.tsx`: identity, programme summary/cards and bidi-safe duration.
- `artifacts/edcons/src/pages/public/ProgramDetail.tsx`: programme cover/fee/action panel, factual section presentation and bidi-safe duration.
- `artifacts/edcons/src/pages/public/detailPresentation.ts`: exact canonical-slug requirement exclusion.
- `artifacts/api-server/src/lib/publicCatalogRequirements.ts`: equivalent bounded exclusion for public prose.
- `artifacts/api-server/src/lib/publicCatalogRenderContract.ts`: passes canonical path and ID to the existing sanitizer.
- `artifacts/api-server/src/routes/public-catalog.ts`: passes the same context to the existing sanitizer.
- `artifacts/edcons/scripts/test-public-detail-templates.ts`: visual structure and factual/empty-state/navigation regression coverage.
- `artifacts/api-server/scripts/test-public-catalog-requirements.ts`: exact-slug and genuine prose preservation coverage.
- This document: correction scope, evidence and limitations.

## Browser verification

Computer Use was used to inspect rendered pages, not just source code. A loopback-only Vite preview serves this new frontend. A temporary GET-only fixture service supplies four allowlisted real staging public records, plus explicitly synthetic rich/sparse cases. It does not connect to the database, submit forms, mutate staging data or enable integrations. Preview branding is intentionally labelled `LOCAL VISUAL PREVIEW`.

Real records checked:

- `/en/countries/united-kingdom`
- `/en/cities/london-2`
- `/en/universities/abbey-dld-colleges-1563`
- `/en/programs/international-foundation-programme-one-year-business-abbey-college-manchester-145792`

Desktop and 375px mobile screenshots were reviewed for all four types. A 320px sparse/closed programme case and a 375px Arabic real programme case were also inspected. No horizontal overflow was observed. Missing overview anchors are absent, section links have existing targets, programme fee navigation clears the sticky header, and active chapter state follows the visible content. Keyboard focus has a visible outline. Arabic mixed English/numeric duration stays left-to-right inside the RTL page.

The sparse programme shows no Apply link and a disabled Apply button. The real programme retains its existing `/en/programs?programId=145792` path. No application was submitted.

Local preview routes use port `25197` while its temporary local process is running; they are not staging release URLs.

## Automated verification

- `test-public-detail-templates.ts`: **26/26 PASS** on the final source tree, including price provenance, exact slug cleanup, missing content/media, safe links, mobile rules, bidi/facts markup and section navigation.
- Existing frontend build test group (detail, language-country codes, dashboard localization, page-builder templates, catalogue inventory): **39/39 PASS**.
- `test-public-catalog-requirements.ts` + `test-public-catalog-render-contract.ts`: **18/18 PASS**; includes verified tuition, structured intakes, canonical metadata, guarded redirect/gone routes and SSR escaping.
- Edcons TypeScript `--noEmit`: **PASS**; API typecheck was also reported **PASS** by the requirements-change reviewer.
- 23-locale key/placeholder parity, Vite production build, sitemap generation and existing public bundle budget: **PASS**. Final bundles include the bidi changes. Existing non-blocking sourcemap/mixed-import/large-chunk warnings remain.
- `git diff --check`: **PASS**.
- Independent read-only review found no blocker in the factual, Apply, SEO, layout-order/visibility or exact-slug contracts. The final location overview omission was then covered by the final frontend test/build run and browser check.

## Preserved architecture and limits

No new data model, migration, endpoint, external provider, runtime AI, global design system, authentication, CRM, payment, workflow, CI or deployment change. Existing canonical URLs, locale/SEO policy, JSON-LD factual rules, verified/legacy tuition projection, structured intakes, admissions guard and layout publication mechanisms are reused.

The university model has a logo but no equivalent verified campus-cover field available to this view; London and UK examples also lack narrative/media in the returned records. This correction does not invent those assets or copy prototype facts. Missing editorial content remains a separate content task.

This is local visual and regression evidence, not production readiness certification, new load/Core Web Vitals evidence, a full accessibility audit, or a live form-submission test. Any deployment needs the existing exact-source staging release process and post-deploy smoke verification.

## Follow-up: reuse the public Programs cards and filters

The owner requested the existing public Programs design inside university pages instead of a separate card/filter design. The bespoke university programme card and link-out degree filter were replaced by shared presentation components. This follow-up also remains local and undeployed.

### Implementation

- `PublicProgramCard.tsx`: extracted the existing public Programs card. Programs keeps its existing detail/application dialog callbacks; university pages use canonical detail links and the existing `programId` application path. An explicit tuition slot preserves the university detail's authoritative tuition/null policy and suppresses legacy fee decorations. Unstructured intake text is omitted in detail context.
- `PublicProgramFilters.tsx`: extracted the existing search, collapsible multi-select filters, fee inputs and clear action. The university view exposes level/language/field/fee controls and fixes university identity; it does not show controls that could navigate to a different university.
- `Programs.tsx`: reuses those two components without rewriting its queries, dialog/form flow or pagination.
- `UniversityProgramBrowser.tsx` and `universityProgramQuery.ts`: use the existing Course Finder list/facet endpoints with locked university identity, combinable filters, debounced search, abort/stale-response protection, retry/empty states, and server pagination of 24 records. Clearing filters and changing locale/university reset to page one. A response containing a different university is rejected.
- `UniversityDetail.tsx` and a small scoped `detailEditorial.css` addition: embed the shared browser and keep the surrounding university layout, SEO and section controls.
- `courseFinderDetailContext.ts`, `course-finder.ts`, and `publicWebDiscoveryReadModel.ts`: add an opt-in, strictly validated detail-university context. Published/locale eligibility is applied before SQL count/pagination and to all facets. The detail response batches existing verified tuition projection, excludes internal contact/fee fields, caps pages at 64, and isolates cache entries by university, locale, mode, eligible IDs and the existing generation. The default Course Finder API contract is unchanged.
- Tests: `test-course-finder-detail-context.ts`, `test-postgres-public-web-discovery.ts`, and the existing `test-public-detail-templates.ts` cover this addition.

### Verification

- Frontend detail tests: **34/34 PASS**; full existing frontend build test group: **47/47 PASS**. Tests include actual server-rendered shared card output for authoritative tuition/null, unsafe media/links and closed admissions, 32 filter combinations, 23 locales, immutable university scope/clear, and pagination ranges.
- Existing Course Finder document/apply regression suite: **4/4 PASS**.
- API detail-context, pagination, visibility, filter/list cache, catalogue requirements and SSR contracts: **36/36 PASS** together.
- Disposable PostgreSQL 16.15 discovery test: **1/1 PASS** with six new assertions for the university-bound eligibility helper. Published EN/TR included; missing translation, NOINDEX, other university and other tenant excluded. Only local `127.0.0.1:5433/fasos_apply_local` synthetic fixtures were used; cleanup counts were zero and the temporary cluster was stopped.
- API and frontend typecheck: **PASS**. Frontend 23-locale parity, Vite build, sitemap and bundle budget: **PASS**. The 14 changed/untracked frontend source/test files were hash-stable throughout the build. Existing non-blocking build warnings remain.
- Computer Use browser checks: real Abbey public snapshot, combined search/level/language/field, clear retaining university, empty search results, 375px mobile and Arabic RTL without horizontal overflow. A clearly synthetic 40-program university verified 24/16 pagination and filter-clear reset to page one. The normal Programs page still opens its existing Apply and Info dialogs; no application was submitted.
- Independent read-only review: no blocking regression found. `git diff --check`: **PASS**.

### Limits

The fee filter deliberately retains the existing Course Finder catalogue-price semantics; it is not a new verified-price filter. The university filter panel labels that basis as listed tuition requiring confirmation, while cards retain the authoritative public tuition projection. No global Course Finder business-rule change was made.

Browser results use the bounded GET-only local preview fixture, not a deployed API. The PostgreSQL test exercises the actual scoped SQL helper, not a full HTTP stack. The 10,001-item overflow path has a source assertion but no large runtime fixture. Exact deployed HTTP/facet/pagination verification remains part of staging smoke after a separately authorized deployment. No schema, integration, CI, staging or production changes were made.

## Follow-up correction: consistent Info dialog

The owner reported that the university programme card's Info action behaved incorrectly. Browser reproduction confirmed it navigated to the programme route instead of opening the public Programs information dialog. Some such routes are outside the deliberately bounded local preview allowlist, producing a local not-found message. The shared-card appearance test had not caught the differing Info interaction.

The existing inline information dialog was extracted from `Programs.tsx` into `PublicProgramDetailDialog.tsx`; both Programs and `UniversityProgramBrowser.tsx` now use it. Info opens the selected programme in-place without URL changes or another detail request. The programme title remains a canonical detail link. The university modal preserves authoritative tuition/null, suppresses raw legacy fees/intakes, and uses the existing requirements sanitizer. Closing with Escape or the close control restores focus to the triggering Info button. Long values wrap on narrow screens; RTL direction and close placement are local to the shared dialog. The application dialog/flow is unchanged.

Verification on the final source:

- `test-public-detail-templates.ts`: **37/37 PASS**, including three new Info/modal regressions (source contracts plus rendered card markup); full frontend build test group **50/50 PASS**.
- Frontend TypeScript, 23-locale parity, Vite build, sitemap and bundle budget: **PASS**. Existing non-blocking build warnings remain.
- Computer Use: GCSE Grade 8 Info opens the correct modal and preserves the university URL; Escape and Close restore focus to the same card. Foundation programme title, full duration, authoritative fee and provenance were inspected at 375px in English and Arabic with no page/dialog horizontal overflow. Normal Programs Info and Apply dialogs still open; no form was submitted.
- No API, database, local-preview allowlist, staging or production change was needed for this correction. Canonical navigation to programme routes outside the local preview fixture remains deliberately unsupported; the corrected Info action no longer depends on those routes.

## Follow-up: city programme cards

The owner identified the remaining bespoke cards on the London city page. `CityDetail.tsx` now embeds the local `CityProgramCards.tsx` wrapper around the same `PublicProgramCard` and `PublicProgramDetailDialog` used by Programs and university pages. Info opens in place; titles remain canonical detail links. The city's existing bounded 12-programme sample and country/city-scoped View All Programs link are preserved. No additional browser fetch, filter engine or application flow was added.

The existing city read model and optional response fields were extended with public university identity/location/logo/link, admission flags, programme language/duration/description, sanitized requirements and the existing canonical tuition projection. Prices are read in one batch for at most 12 delivered rows. Verified price priority and explicitly unverified legacy fallback are reused; raw fees, legacy intakes and internal fields are not returned. Older thin responses remain renderable: absent admission flags disable Apply, missing tuition asks for confirmation, and no university URL or fee is invented.

Independent review caught an unpublished-parent link edge case. The delivered programme parents now have their own bounded localization/eligibility batch (at most 12 IDs). In published-only internal-link mode, a programme can remain visible while its university name stays plain text if that university page is not indexable. This also avoids the unrelated university-list localization batch consuming the programme parents' lookup limit.

City programme facts are time-sensitive. City-detail reads now bypass persistent HIT/SWR caches while retaining concurrent-request coalescing; the city JSON endpoint uses `no-store`. Program/university targeted invalidation includes city entries. Other page cache kinds are unchanged. This adds bounded database work per city request, so deployed load/latency should be measured during staging smoke; this is not new performance certification.

### Verification

- Frontend detail tests **42/42 PASS** (five new city regressions); full frontend build test group **55/55 PASS**. Includes actual rendered cards, all admission flag combinations, authoritative/null tuition, old thin payload safety, Arabic links and locale/city modal reset.
- API/SSR tests **19/19 PASS** including `test-city-program-brief.ts`; frontend and API TypeScript **PASS**.
- Disposable PostgreSQL render test **1/1 PASS** exercises the actual city query, public projection, safe website/logo, sanitized requirements, legacy tuition, private-field absence and an uncached admission update. Synthetic fixtures were cleaned and the local cluster stopped.
- After the independent-review correction, API/SSR **19/19** and API TypeScript passed again. The PostgreSQL discovery test **1/1 PASS** additionally verifies a published/indexable university link is present, then omitted after NOINDEX or unpublication while the published programme card remains. Fixture university/programme/content cleanup counts were all zero and the local cluster was stopped.
- 23-locale parity, Vite build, sitemap and bundle budget **PASS**; 16/16 changed frontend source/test files were hash-stable during the build. Existing non-blocking build warnings remain.
- Computer Use: London desktop shared cards, 375px Info dialog, same URL after Info, Escape restoring trigger focus, Arabic long-title/fee/duration dialog without horizontal overflow. A synthetic sparse city shows two disabled Apply buttons and zero application links for closed or absent admission flags.
- London browser evidence uses the existing public staging snapshot plus existing allowlisted Abbey catalogue/detail facts for exactly the same 12 IDs/order. Synthetic sparse/rich fixtures are explicitly separate. This preview is not a deployed API test; PostgreSQL evidence above tests the real read model independently. No application was submitted.

Changed in this follow-up: `CityDetail.tsx`, new `CityProgramCards.tsx`, frontend detail tests, `publicCatalogRenderReadModel.ts`, additive city fields in `publicCatalogRenderContract.ts`, the city response cache header in `public-web.ts`, new `test-city-program-brief.ts`, the PostgreSQL render/discovery tests and this evidence document. Existing unrelated work was preserved. No schema, CI, staging or production deployment change.
