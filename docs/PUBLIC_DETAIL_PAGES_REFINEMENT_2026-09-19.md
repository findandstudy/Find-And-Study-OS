# Public detail pages — implementation and verification

## Isolated staging release candidate

This report records the original implementation below. The 2026-09-19 deployment candidate is isolated in `codex/public-detail-staging-20260919` from `f2bc366b76c151daa904cb42733c85ecd3e3db96`.
It excludes the separate contract/Other and university-admissions workflow changes, keeps the baseline inactive-university visibility policy, and includes only the pure frontend admissions helper required by detail rendering. Closing admission independently of catalogue visibility is NOT delivered by this release.
The local preview script and unrelated output artifacts are not included. Source-navigation and page/detail tests remain included. SSR requirements now prioritize the same published translation as the API. Inventory tests assert the retained baseline visibility policy.
The two security inventories are refreshed/classified from this isolated source only; authorization and rollout policies are unchanged. Exact-candidate tests, CI, staging backup/restore and runtime smoke results are recorded separately in the deployment evidence.

Date: 2026-09-19

Repository: `C:\Yeni WEBSİTESİ\Find-And-Study-OS-Claude-Review`

Branch: `codex/public-web-foundation-20260908`

## Completed phases

| Phase | Result | Delivered |
| --- | --- | --- |
| 1 — Consistent catalogue facts | PASS | Shared verified tuition projection for API/cards/SSR; labelled legacy fallback, valid currency/minor units, source and intake validity checks, bounded price batches and safe Offer behavior. |
| 2 — Country/city access | PASS | Catalogue-only country fallback without migration; safe name/code/slug mapping; university/program/country/city links; readable noindex fallback city pages; inactive/ambiguous records remain closed. |
| 3 — Pages inventory | PASS | Admin-only read-only dynamic catalogue inventory, type/locale/search/pagination, source IDs, preview and exact source-edit links. Visibility, admissions and publication/index approval are distinct. |
| 4 — Detail presentation | PASS | Country, City, University and Program editorial layouts with stronger hero, hierarchy, facts, anchors, cards, fee summary and programme table. Real media only; deliberate non-photographic artwork when unavailable. |
| 5 — Real section controls | PASS | Version 2 shared layouts expose actual detail sections, maintain v1 compatibility, preserve mandatory sections, hide obsolete anchors, and reuse existing draft/review/publication controls. |
| 6 — Verification and review fixes | PASS | Unit/contract suites, disposable PostgreSQL/HTTP integration, builds, typechecks, 23-locale checks and local desktop/mobile/RTL browser checks. |

No push, commit, merge, staging deployment or production deployment was performed by this task. The working tree already contained unrelated changes; they were preserved.

## Behavior and factual guarantees

- Verified `priceComponents` are preferred only with active sources and verified/current source records. Prices bound to expired/inactive intakes are excluded.
- Comparable multiple tuition choices are labelled as a starting price; ambiguous currency/basis and truncated price sets are not presented as a single price.
- Legacy fees can be displayed with an explicit confirmation-required label; they cannot create an Offer. Missing/invalid tuition does not make the whole page noindex.
- SPA Offer uses the same authoritative tuition projection rather than the first price row. SSR preserves the price overflow signal. Unverified, ambiguous, range and admissions-closed cases cannot create a misleading Offer.
- Intake and deadline facts continue to use structured programme intake records. Raw imported intake-year / offer-turnaround claims and importer/source references are removed from public requirements. Existing catalogue records are not rewritten.
- Institution location is identified as such, separate from imported campus/mode information. Ambiguous duration strings are retained with a confirmation note, not silently reduced to one guessed duration.
- Catalogue-only country and rollout-off city fallback pages remain noindex with no hreflang alternatives. Their accessibility is not publication approval.
- Existing numeric-suffix URLs are preserved for stable entity resolution. IDs are not visitor-tracking identifiers. No risky URL migration or mass redirect was introduced.

## Changed files

Paths below are relative to the repository root above. These are the files changed for this task, not an attribution of every pre-existing working-tree diff.

### API and rendering

| File | Reason |
| --- | --- |
| `artifacts/api-server/src/lib/publicCatalogTuition.ts` | New deterministic tuition/currency/minor-unit projection. |
| `artifacts/api-server/src/lib/publicCatalogPriceReadModel.ts` | New bounded shared price reader with source/intake validity guards. |
| `artifacts/api-server/src/lib/publicCatalogRequirements.ts` | New public-safe requirements sanitizer. |
| `artifacts/api-server/src/lib/publicCatalogLocationLinks.ts` | New local mapping, hierarchy links and scoped counts. |
| `artifacts/api-server/src/lib/websiteCatalogFilters.ts` | Reuse existing normalized country aliases for mapping. |
| `artifacts/api-server/src/lib/publicCatalogRenderReadModel.ts` | Reuse price/location helpers and preserve SSR fallback/overflow semantics. |
| `artifacts/api-server/src/lib/publicCatalogRenderContract.ts` | SSR tuition, metadata hygiene, layout sections and accurate anchors. |
| `artifacts/api-server/src/lib/websiteDetailLayoutContract.ts` | Backward-compatible v2 actual section contract. |
| `artifacts/api-server/src/lib/websiteCatalogInventory.ts` | New read-only inventory projection using existing catalogue and publication stores. |
| `artifacts/api-server/src/lib/websiteCatalogInventoryContract.ts` | New bounded inventory query/response helper. |
| `artifacts/api-server/src/lib/publicWebDiscoveryReadModel.ts` | Reuse scoped publication-state reads for inventory; do not activate rollout. |
| `artifacts/api-server/src/routes/public-catalog.ts` | Additive tuition and location links, safe public requirements; existing fields retained. |
| `artifacts/api-server/src/routes/destinations.ts` | Catalogue-only fallback directory/detail and city reachability. |
| `artifacts/api-server/src/routes/website.ts` | Admin-only GET catalogue inventory route. |

### Frontend

| File | Reason |
| --- | --- |
| `artifacts/edcons/src/pages/public/ProgramDetail.tsx` | Editorial layout, factual fee/intake sections, safe Offer, clear campus/duration context. |
| `artifacts/edcons/src/pages/public/UniversityDetail.tsx` | University hero, facts and readable programme table sharing tuition behavior. |
| `artifacts/edcons/src/pages/public/CountryDetail.tsx` | Country hero, valid city/university navigation and conditional factual sections. |
| `artifacts/edcons/src/pages/public/CityDetail.tsx` | Linked country/city/university/programme hierarchy and conditional content. |
| `artifacts/edcons/src/pages/public/DetailEditorial.tsx` | New module-local reusable presentation primitives and safe media fallback. |
| `artifacts/edcons/src/pages/public/detailEditorial.css` | New scoped responsive, RTL, focus, reduced-motion and print styles. |
| `artifacts/edcons/src/pages/public/detailPresentation.ts` | New local price/metadata/duration/link helpers and UI copy. |
| `artifacts/edcons/src/pages/public/detailPresentationLocales.ts` | New additional locale copy; all 23 supported locales covered for detail UI additions. |
| `artifacts/edcons/src/pages/public/DetailLayout.tsx` | Apply real section order/visibility and remove hidden-section anchors. |
| `artifacts/edcons/src/lib/website/detailLayoutContract.ts` | Frontend parity with v2/v1 layout contract. |
| `artifacts/edcons/src/pages/admin/website/Pages.tsx` | Integrate dynamic inventory separately from CMS pages/templates. |
| `artifacts/edcons/src/pages/admin/website/CatalogPagesInventory.tsx` | New searchable, paginated, read-only source inventory UI. |
| `artifacts/edcons/src/lib/catalogEntryNavigation.ts` | New bounded exact source navigation parser. |
| `artifacts/edcons/src/pages/admin/Catalog.tsx` | Minimal source-link handling: select tab/filter and open the exact editor, without autosave. |

### Tests and local tooling

- `artifacts/api-server/scripts/test-public-catalog-tuition.ts` — currency, verified priority, fallback, ranges and overflow.
- `artifacts/api-server/scripts/test-postgres-public-catalog-tuition.ts` — actual PostgreSQL source/date/intake/batch validation; transaction rollback.
- `artifacts/api-server/scripts/test-public-catalog-location-links.ts` — mapping ambiguity and inactive records.
- `artifacts/api-server/scripts/test-public-catalog-locations-http.ts` — real country/city HTTP, noindex, numeric counts and cache invalidation.
- `artifacts/api-server/scripts/test-public-catalog-requirements.ts` — imported private metadata/unstructured timing filtering.
- `artifacts/api-server/scripts/test-website-catalog-inventory.ts` — query bounds and inventory contract.
- `artifacts/api-server/scripts/test-postgres-website-catalog-inventory.ts` — authorization, HTTP validation, pagination, current data, admissions/visibility separation and no CMS duplication.
- `artifacts/api-server/scripts/test-public-catalog-render-contract.ts` — updated SSR factual and section assertions.
- `artifacts/api-server/scripts/test-public-catalog-route-contract.ts` — assertions now follow the shared price helper and its stronger source/time/batch guards.
- `artifacts/api-server/scripts/test-detail-layout-contract.ts` — valid v1 upgrade and strict v2 mandatory-section tests.
- `artifacts/edcons/scripts/test-public-detail-templates.ts` — shared rendered markup, v2/v1 behavior, 23 locales, metadata, duration and safe tuition/Offer.
- `artifacts/edcons/scripts/test-catalog-pages-inventory.ts` — inventory navigation and no-write behavior.
- `artifacts/api-server/scripts/preview-public-pages-local.ts` — explicitly opted-in GET-only loopback preview, synthetic records, scoped cleanup; never application startup code.
- `artifacts/api-server/package.json`, `artifacts/edcons/package.json` — relevant test commands; inventory included in frontend build verification.

## Reused architecture

Existing Program/University/Country/City records, public route keys, destination routes, source records, price components, structured intakes, SSR/read-models, public publication/discovery policy, cache invalidation, JSON-LD, translations, CMS draft/review/publish controls and Apply destinations remain in use.

The inventory lists source records; it does not manufacture CMS page copies. Shared templates still control a type of page, while source editors control factual records. There is no parallel CMS, new page database, migration, runtime AI service or generic external provider framework.

## New local additions

Only catalogue-specific price/requirements/location/inventory helpers, four-page presentation primitives/styles/copy, exact catalogue-editor navigation, and focused tests/preview tooling were added. No global design-system rewrite.

## Tests

| Verification | Result |
| --- | --- |
| API public route/render/discovery/publication/localization/layout/authoring/inventory/location/tuition/requirements/scaling/translation/admissions group — 16 files | PASS 96/96 |
| Frontend templates/inventory/admissions/application-error/language flags/Page Builder group — 6 files | PASS 30/30 |
| Final disposable PostgreSQL tuition reader | PASS |
| Final disposable PostgreSQL inventory HTTP | PASS |
| Final disposable PostgreSQL country/city HTTP | PASS |
| API and Edcons TypeScript noEmit | PASS |
| API build and Edcons Vite production build | PASS |
| i18n key/placeholder parity — 23 languages | PASS (5,035 used keys, 6,444 English keys) |
| Sitemap generation and public bundle budget | PASS |
| Diff whitespace check | PASS |

The three final DB tests ran serially against `127.0.0.1:5433/fasos_apply_local`, with live integrations disabled. They are not staging or production tests. Temporary pool-pressure diagnostics occurred during parallel read projections; the tests passed. This is not a capacity certification.

### Browser verification

- Actual local React pages with synthetic database fixtures, not static mock screenshots.
- Desktop program/university/country/city views loaded; university → country → city → programme links worked.
- Programme and university table showed the same legacy £30,000 value with confirmation labels. Blank currency displayed a safe adviser fallback.
- Browser review caught and fixed: inaccurate internal university-link wording, overconfident legacy-fee explanation, imported intake-year text, and `undefined Programs` on country cards.
- Mobile programme and Pages inventory had no document-level horizontal overflow (375px content width in a 390px viewport including scrollbar).
- Arabic mobile view used RTL; missing translated factual content remained source-language fallback, noindex and no hreflang alternatives.
- Programme section anchors had no missing target.
- Pages search by exact source ID returned one matching record. “Kaynağı düzenle” opened that exact programme in the existing catalogue editor. No save was submitted.
- Desktop/mobile visual checks, meaningful headings/labels, image alternatives, focus styles and anchor checks are basic accessibility evidence, not a full audited accessibility certification.
- Temporary viewport override was reset; agent-created tabs and preview servers were closed. Synthetic catalogue fixtures were removed, verified remaining programme/university counts zero in this initially empty disposable catalogue, and the local DB was stopped.

## Backward compatibility

- Existing URL suffix IDs and canonical route shape retained.
- Existing API fields retained, with safe requirements filtering and additive projections.
- Existing v1 shared templates accepted and upgraded to v2 in memory.
- No Course Finder business logic, application submission flow or public form contract changed in this task.
- No real application, contact, payment, provider send or publication action was executed during browser QA.
- Missing tuition alone does not force noindex; locale/publication fallback policy remains separate.

## Scope verification

Only public catalogue/detail rendering, directly related Pages inventory/source navigation, module-local helpers and tests were changed by this task. No Auth, account, payment, CRM, global workflow, CI/CD, deployment configuration or unrelated database table changes. Prior contract/Other and university-admissions edits remain in the working tree and are not counted as work performed here.

## Blocked items

No implementation blocker remains in the scoped local changes. Actual staging validation and deployment have not been performed in this turn; this report is not deployment approval.

## Deferred backlog

- Actual institution/campus photography and reviewed editorial descriptions where missing; no fake prototype facts or photographs were seeded.
- Verified external living cost, housing, visa, climate, curriculum and similar content where no provider/source exists.
- Optional ID-free URL migration requires a separately reviewed uniqueness/redirect/canonical strategy. Existing URLs were intentionally kept stable.
- New inventory-specific admin copy is EN/TR with existing shared multilingual controls; remaining specialized admin copy/localization can be extended separately. Detail-page additions cover all 23 locales.
- Existing CMS/template editor labels outside the new inventory still include English wording in Turkish admin; not a global localization rewrite in this task.
- Real-content staging UAT after an authorized deployment, including long/localized titles, real media, configured published template variants and a non-submitting Apply/form walkthrough.

## Remaining risks

- Synthetic local data cannot establish production content accuracy or guarantee every legacy import format. Source/catalogue cleanup remains editorial work.
- The read-only inventory does not turn source visibility into publication approval and does not auto-publish missing translations.
- University admission closure is independent of public visibility; existing related working-tree changes require inclusion in staging regression as a coherent release.
- Global CSS, real branding/media and published layouts may change appearance relative to local defaults; staging visual acceptance is still required.
- No claim of SEO ranking, GEO/AEO placement, Core Web Vitals field performance or high-volume capacity follows from these tests.

## Release status

**READY FOR STAGING UAT** — local implementation and scoped verification complete; not deployed. Production remains untouched.
