# Pages authoring — local implementation, 16 September 2026

Base: `02f8399375ebdc548acaea5960c43eb9def8c5ec`.
Branch: `codex/public-web-foundation-20260908`.
This is a **partial implementation** of the remaining Pages work, not a complete automated publishing system. No commit, push, staging adoption, production deployment, migration, grant or content publication was performed in this task.

## Completed phases

1. Explicit page-draft creation: blank or one of four live catalogue starters; source locale and country/city filters; atomic page + hero + catalogue block creation. Always DRAFT/NOINDEX, no factual duplication. Existing page CRUD remains compatible through a separate additive `/website/pages/drafts` endpoint.
2. Real catalogue preview: admin-only, no-store, bounded 1–12 cards, same canonical public projection as published CMS blocks. Debounced/cancellable requests, refresh, error/retry/empty states. No preview results are written into block content.
3. Editor usability: source locale replaces hardcoded English; responsive panel navigation, keyboard-accessible block selection, labelled tools, RTL preview. Fixed the ProgramDetail requirements anchor to point to requirements rather than the description.
4. Local verification: pure regressions, browser fixture and real disposable PostgreSQL HTTP tests; frontend/API builds and bundle budget.

## Changed files

- `artifacts/api-server/src/lib/websitePageAuthoring.ts`: strict module-local creation/preview input validation and existing-block starters.
- `artifacts/api-server/src/lib/publicCatalogRenderReadModel.ts`: exports the existing bounded catalogue projection for reuse, without changing public selection policy.
- `artifacts/api-server/src/routes/website.ts`: additive guarded draft/preview routes; transaction, server-derived author, safe conflict/error responses. Existing CRUD and publication operations retained.
- `artifacts/api-server/package.json`: adds pure authoring tests to the existing public-render test command; no workflow modification.
- `artifacts/api-server/scripts/test-website-page-authoring.ts`: input, publication/fact injection, locale, limits, route wiring contracts.
- `artifacts/api-server/scripts/test-postgres-website-page-authoring.ts`: local-only HTTP/DB test for auth denial, duplicate race, draft/noindex, canonical fresh preview and no publication.
- `artifacts/edcons/src/pages/admin/website/Pages.tsx`: explicit creation dialog, source language/starters, recoverable errors; removes implicit write-on-read empty-list seeding.
- `artifacts/edcons/src/pages/admin/website/CatalogBlockPreview.tsx`: live bounded preview, no content mutation.
- `artifacts/edcons/src/pages/admin/website/PageEditor.tsx`: preview wiring, source language and mobile/keyboard/RTL improvements.
- `artifacts/edcons/src/pages/public/ProgramDetail.tsx`: requirements anchor correction; Apply link unchanged.
- `artifacts/edcons/scripts/test-public-detail-templates.ts`: current preview regression assertions.
- `artifacts/edcons/tests/authoring/pages.spec.ts`, `tests/fixtures/page-authoring.html`, `tests/fixtures/page-authoring.tsx`, `tests/page-authoring.config.ts`: isolated real-browser tests with mocked HTTP; never production/staging login or writes.
- `security/legacy-role-gate-registry.json`: only website route hash and two additive registration counts; quarantine and role policy unchanged.

## Reused architecture / new local additions

Reuses website pages, page blocks, existing immutable publication versions, public catalogue query policy and projection, React Query, existing UI controls, 23-locale catalogue, route registry, cache invalidation and admin guards. New local pieces are strict authoring input parsing, a preview component and tests. No parallel CMS, runtime AI, provider abstraction or entity model was added.

## Tests

- Pure public rendering/routes/localization/discovery/detail/authoring: **48 PASS**.
- Disposable PostgreSQL public-render + new authoring HTTP integration: **2 PASS**. Initial authoring fixture lacked the `Private` university type required by the public policy; fixture corrected, policy was not weakened.
- Browser: **4 PASS** — creation, live preview/mobile/RTL, recoverable preview error and duplicate-address input retention.
- API and Edcons TypeScript: **PASS**.
- API production build and Vite production build: **PASS**. Existing sourcemap/chunk-size warnings remain non-fatal.
- Bundle budget: **PASS**, initial JS 264497 gzip bytes, CSS 41199 bytes, 23 locale chunks.
- 23-language key/placeholder parity: **PASS**.
- Tenant writer inventory and legacy role inventory: **PASS**, no new allowlist or guard weakening.
- Public-web CI wiring contracts: **4 PASS**; CI workflows unchanged.
- `git diff --check`: **PASS**.

Browser tests use `tests/page-authoring.config.ts`, a local-only Vite server at `127.0.0.1:25198`, and mocked API responses. They prove UI behaviour, **not** full staging UAT. The PostgreSQL test independently exercises real routes and DB writes at exact `127.0.0.1:5433/fasos_apply_local` with `ALLOW_LIVE_INTEGRATIONS=false`. Post-test pages/blocks/universities/programs/users/applications counts were all zero; the isolated cluster was stopped. No real records were deleted.

## Backward compatibility / scope verification

Existing page CRUD, public routes, catalogue policy, detail factual projections, Apply flow and publication/version routes retained. No changes to auth, CRM, payment, Course Finder logic, other service contracts, migrations, CI/CD or deployment configuration. Registry changes only acknowledge the two guarded routes. This does not certify full Apply workflow UAT.

## Blocked items

- Automated bulk publication must not bypass the existing Publication Center's `DEFAULT_UNWIRED` / `mutationsEnabled=false` boundary, signed context, executor grant and approval requirements. This task did not change authorization or grant activation.
- Approved real-city content, media provenance and editorial/translation review cannot be invented or silently approved by the coding agent. No public content was published.

## Deferred / still incomplete

- Shared, versioned Country/City/University/Program **detail** layout management from Pages. The four new starters are catalogue landing pages; they do not replace the existing detail components or claim this feature is complete.
- Operator-facing governed batch creation/approval/publishing workflow.
- Representative real-content staging UAT, all supported device/browser combinations, Apply/forms, runtime invalidation/SEO rollout and realistic performance measurements for this new version.
- External visa/ranking/housing/cost data remains optional, conditional and source-dependent.

## Remaining risks / release status

Legacy CMS routes retain their existing privileged/global quarantine boundary; this work does not certify tenant-safe external self-service. Admin authoring copy remains in the existing English UI style; full authoring-copy translation is not completed. No new high-volume or field Core Web Vitals claim is made.

**PARTIALLY READY** for the full requested Pages automation scope. The completed draft/preview slice has local evidence; these new changes are not yet on staging. Production remains untouched.
