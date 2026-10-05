# Public detail supplementary content — 19 September 2026

## Delivery state

**READY FOR STAGING UAT**, subject to the remaining evidence limits below. Local implementation only: no commit, push, staging deployment, production deployment or public content publication was performed in this task.

Repository: `Find-And-Study-OS-Public-Detail-Release`. Branch: `codex/public-detail-staging-20260919`. Starting HEAD: `d7968818baaa40ae94f166b2c0b83c7a81f0f3d7`.

This report covers the supplementary-content follow-up to the three HTML design references. The earlier visual, shared programme-card/filter/dialog and city-card work remains documented in [the visual rework report](PUBLIC_DETAIL_VISUAL_REWORK_2026-09-19.md). Existing uncommitted work was preserved. The prototypes are design references, not factual sources.

## Completed phases

1. **Content contract and storage — PASS.** Added bounded, plain-text, entity-and-locale-bound supplementary content to the existing CMS page/block/version mechanism. No migration, parallel catalogue or duplicate canonical tuition/intake data. Country content binds to the existing catalogue country ID through the established mapping.
2. **Pages authoring — PASS.** Catalogue Pages inventory opens a structured content editor. Supports sections, cards, tables, steps, galleries, questions/answers, sources and actual review dates. Draft saving, local text preview, published-version comparison and explicit reviewer approval are separate actions. Unsaved close/locale/reload/remove actions use an accessible in-app confirmation dialog.
3. **Four public detail types — PASS.** Country, city, university and programme pages render only approved content for the exact record and locale. Galleries with zoom, keyboard-operable FAQs, accessible tables, application guidance, living/housing/support and programme curriculum sections are supported where applicable. Empty sections remain absent. University/programme mobile actions reuse existing navigation/application paths.
4. **Read-model, SSR and shared cards — PASS.** Supplementary content is available through existing public responses and escaped server-rendered output. Related programme cards now reuse the existing public card/Info components, with bounded public facts and authoritative tuition projection.
5. **Publication, cache and factual safety — PASS.** Distinct direct human author/reviewer, exact snapshot digest, optimistic edit timestamp and transaction locks protect publication. Generic CMS mutations cannot bypass the reserved content workflow. Impersonation/API-token/bearer authoring is rejected. Kind-targeted invalidation is reused. Programme/city time-sensitive reads coalesce concurrent work but do not persist expired tuition in HIT/SWR caches.
6. **Regression/build/browser checks — PASS with staging limits.** See test and browser evidence below. No production-capacity claim is made.

## Changed files in this follow-up

Paths below are relative to the repository. Some files already contained earlier-turn local work; this follow-up extended rather than replaced it.

### API and contracts

- `artifacts/api-server/src/lib/websiteDetailContentContract.ts`: strict content schema, safe URLs/plain text, per-kind keys, 23 locale bindings, source/review-date and size limits.
- `artifacts/api-server/src/lib/websiteDetailContent.ts`: existing CMS draft/version storage, published reads, catalogue identity checks, digest/concurrency and targeted invalidation.
- `artifacts/api-server/src/routes/website-detail-content.ts`: authenticated read, save-draft and explicit reviewed-publication endpoints.
- `artifacts/api-server/src/routes/website.ts`: registers the module-local route and protects reserved records from generic mutation; closes impersonated layout-authoring bypass.
- `artifacts/api-server/src/lib/websiteDetailLayoutContract.ts`: additive v3 section keys and optional mobile actions; retains v1/v2 layout meaning.
- `artifacts/api-server/src/lib/publicCatalogProgramBrief.ts`: bounded public related-programme projection using existing tuition/requirements/media helpers.
- `artifacts/api-server/src/lib/publicCatalogRenderReadModel.ts`: approved content and related-programme projection; programme/city coalesce-only time-sensitive reads.
- `artifacts/api-server/src/lib/publicCatalogRenderContract.ts`: escaped semantic editorial SSR, binding validation and layout visibility/order.
- `artifacts/api-server/src/routes/public-catalog.ts`: additive approved content and public related-programme fields; time-sensitive programme response cache policy.
- `artifacts/api-server/src/routes/destinations.ts`: published country editorial projection with catalogue-country binding.
- `artifacts/api-server/src/routes/public-web.ts`: city editorial projection.
- `artifacts/api-server/src/index.ts`: narrow programme/city SSR no-store policy.

### Frontend

- `artifacts/edcons/src/lib/website/detailContentContract.ts`: identical frontend validator/types, checked against the API contract.
- `artifacts/edcons/src/lib/website/detailLayoutContract.ts`: identical additive layout v3 contract.
- `artifacts/edcons/src/pages/admin/website/DetailContentEditor.tsx`: structured draft, preview, sources and reviewer UI; local validation and unsaved-change protection.
- `artifacts/edcons/src/pages/admin/website/CatalogPagesInventory.tsx`: opens the bound editor from existing catalogue Pages rows.
- `artifacts/edcons/src/pages/public/DetailContentSections.tsx`: shared section renderer, safe gallery/zoom, accessible FAQ/table, provenance and mobile actions.
- `artifacts/edcons/src/pages/public/DetailLayout.tsx`: additive section order/hiding and chapter navigation consistency.
- `artifacts/edcons/src/pages/public/detailEditorial.css`: module-scoped gallery, cards, table, steps, FAQ, mobile/RTL/focus rules.
- `artifacts/edcons/src/pages/public/CountryDetail.tsx`: approved country sections and cancelled/stale fetch protection.
- `artifacts/edcons/src/pages/public/CityDetail.tsx`: approved city sections.
- `artifacts/edcons/src/pages/public/UniversityDetail.tsx`: approved university sections and existing-flow mobile actions.
- `artifacts/edcons/src/pages/public/ProgramDetail.tsx`: approved programme sections, shared related cards and admission-aware mobile actions.
- `artifacts/edcons/package.json`: adds targeted editor/section tests to existing frontend test/build gates.

### Tests and evidence

- `artifacts/api-server/scripts/test-detail-content-contract.ts`
- `artifacts/api-server/scripts/test-public-catalog-program-brief.ts`
- `artifacts/api-server/scripts/test-public-catalog-render-contract.ts`
- `artifacts/api-server/scripts/test-postgres-website-page-authoring.ts`
- `artifacts/api-server/scripts/test-postgres-public-catalog-render.ts`
- `artifacts/edcons/scripts/test-detail-content-editor.ts`
- `artifacts/edcons/scripts/test-detail-content-sections.ts`
- `artifacts/edcons/scripts/test-public-detail-templates.ts`
- This evidence report.

Outside the repository, loopback-only preview helpers under `.staging-tools` and `.local-tools/detail-content-editor-qa` were extended for disposable/synthetic visual testing. They are not product endpoints or deployment changes. The countries preview now reads the bounded, allowlisted real staging public destination list instead of a two-item placeholder. Its GET-only source is not a staging data mutation.

## Reused architecture

Existing catalogue records, country mapping, public route registry, public APIs/read model, SSR shell, CMS pages/blocks/immutable versions, layout publication model, 23 locales, canonical/noindex/hreflang/sitemap rules, factual JSON-LD, tuition/intake projection, scoped cache invalidation, public programme cards/dialogs and Apply/contact paths.

The new local pieces are the supplementary-content contract, CMS adapter/router, structured editor, shared section renderer and bounded related-programme projection. No runtime AI, generic external-provider framework, global design-system refactor or replacement translation engine was added.

## Tests

Counts below are separate test runs and overlap; they must not be summed as a unique-test total.

| Gate | Result |
| --- | --- |
| Final frontend build test group, including content editor/renderer and existing detail/page-builder/inventory regressions | **67/67 PASS** |
| New content renderer tests: exact binding, all allowed sections, actual rendered semantic markup, rejection and four-page integration | **5/5 PASS**, included above |
| Editor + inventory + content renderer after AlertDialog change | **14/14 PASS**, included above |
| API content/SSR/city/cache regression group | **23/23 PASS** |
| Related-programme projection + tuition/city/requirements group | **19/19 PASS** |
| Disposable PostgreSQL HTTP page-authoring integration | **1/1 PASS** |
| Disposable PostgreSQL public read-model/cache integration | **1/1 PASS** |
| API TypeScript and production build | **PASS** |
| Frontend TypeScript, 23-locale parity, Vite production build, sitemap and bundle budget | **PASS** |
| Final frontend bundle | Initial JS gzip **280,295 B**, CSS gzip **41,113 B** |
| Whitespace/diff validation | **PASS** |

PostgreSQL evidence uses only disposable synthetic fixtures at `127.0.0.1:5433/fasos_apply_local`. Tests exercised draft/public separation, generic-publication rejection, stale writes, self-approval rejection, wrong digest, distinct reviewer success, exact locale, replay/conflict, retained previous published version and direct-session restrictions. Fixtures were cleaned (zero remaining scoped rows) and the temporary cluster stopped. No staging/production DB was used.

SSR coverage includes escaped content, exact entity/locale bindings, unchanged noindex/canonical policies and hidden section omission. New editorial FAQs do not automatically create potentially contradictory FAQ/Review JSON-LD. Existing factual tuition/intake JSON-LD remains the authority.

## Browser evidence

The Computer Use skill was used to inspect rendered local pages and keyboard/mobile/RTL behavior, not merely source markup. Rich and sparse fixtures are explicitly synthetic and are never published as real school information.

- Desktop rich university: all 13 supported supplementary sections, gallery mosaic, ordered navigation and source provenance.
- 375px Arabic programme: 12 supplementary sections, RTL, no document horizontal overflow, internally scrollable wide table and bottom actions inside the viewport.
- Gallery opens, closes with Escape and restores focus to its opener. FAQ toggles with the keyboard. RTL close placement and long headings were inspected.
- 375px country/city: conditional rich sections without page overflow. Sparse data remains conditional.
- Real public countries preview: Australia, Canada, United Kingdom and United States appear with returned catalogue counts.
- Existing application paths are preserved; no application was submitted and no outward communication occurred.

Admin editor browser checks use a loopback-only, in-memory API harness with zero real API writes. They supplement, not replace, the actual PostgreSQL API integration evidence above. The harness loaded the actual built Edcons CSS: 375px LTR/RTL had document width 375px and dialog width 359px, with visible fixed footer actions and internal scrolling. Escape opened the discard confirmation; cancellation retained edits. Save showed “Draft saved / public unchanged”; text preview enabled explicit approval; self-approval displayed the denial; simulated distinct reviewer approval displayed success. These were in-memory synthetic UI outcomes, not a real public publication. The helper process and temporary QA tabs were stopped/closed after verification; the normal local page preview remains available.

Skill used: [Computer Use](C:/Users/Find%20And%20Study/.codex/plugins/cache/openai-bundled/computer-use/26.915.31029/skills/computer-use/SKILL.md). Its rendered-page, keyboard, mobile/RTL and cleanup workflow exposed a QA-harness styling issue and informed the in-app unsaved-change confirmation check. No external content was published through the browser.

## Backward compatibility and scope verification

Existing public routes and canonical URLs remain unchanged. Additive response fields do not replace the existing API contract. Old layouts retain their relative section order/visibility; required sections remain protected. Catalogue tuition, intake and deadline facts are not copied into editorial fields by the application. The existing Apply/form business flow was not rewritten or submitted.

No Auth/User/Payment/CRM/global workflow, unrelated admin modules, CI/CD, production configuration, external provider or database migration change. The narrow direct-session checks use existing authentication context solely to secure detail-content/layout authoring. The existing user-requested shared Course Finder presentation changes from earlier turns are preserved; this follow-up does not add new Course Finder business rules.

## Blocked items / deferred backlog

- Real, licensed campus photographs and source-reviewed curriculum, housing, living-cost, admission, visa, scholarship and support narratives require actual editorial inputs. Until then, those sections are absent rather than fabricated.
- Human approval plus a source URL is an editorial accountability mechanism, not independent external fact verification. Editorial prose still needs responsible review; the validator cannot semantically detect every misleading statement or copied price inside free text.
- Prototype testimonials, ratings, partner logos, rankings and outcome claims are not published without evidence/rights. No invented student stories or autonomous eligibility decisions.
- No new external-data providers, country-ID migration, automatic recommendations/ranking engine, live cost calculator or runtime content-generation pipeline.
- New editor controls have English/Turkish UI copy with English fallback; content can be authored separately in all existing 23 locales. This is not a claim of newly translated admin controls in all 23 languages.

## Remaining risks and staging UAT

1. Deploy the exact reviewed source only through a separately authorized staging release; then test real catalogue Pages author/reviewer sessions and public rendering end-to-end.
2. Run deployed latency/load checks: programme/city coalesce-only reads trade stale-price risk for additional bounded database reads. Local correctness tests are not capacity certification.
3. Verify real licensed images, accessibility and long translated editorial content on target devices. Browser fixtures are not an exhaustive accessibility audit or full production content UAT.
4. Verify deployed API responses, cache headers and public SEO/sitemap consistency. Local preview global noindex is not evidence of production indexing configuration.

**Release status: READY FOR STAGING UAT. Production readiness and deployment are not claimed.**
