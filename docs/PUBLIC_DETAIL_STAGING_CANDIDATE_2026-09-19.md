# Public detail content — staging follow-up candidate

User authorized staging deployment on 19 September 2026. Production, unrelated services, migrations, integrations and editorial publication are excluded.

## Exact baseline

- Feature branch: `codex/public-detail-staging-20260919`; existing draft PR #35.
- Source baseline: `d7968818baaa40ae94f166b2c0b83c7a81f0f3d7`.
- Read-only host preflight: staging checkout clean at that baseline, image `findandstudy-staging-app:d7968818baaa`, healthy, restart 0.
- Health: `staging-20260919T073233Z-d7968818baaa`, database connected.
- Staging ledger: 124. No migration files changed.
- Host available space at preflight: 50,580,578,304 bytes, 51% used. Deployment rechecks 15 GiB / 15% reserve and does not prune.

## Included scope

The local presentation/shared cards/filter/Info follow-ups in `PUBLIC_DETAIL_VISUAL_REWORK_2026-09-19.md` and supplemental Pages content work in `PUBLIC_DETAIL_CONTENT_COMPLETION_2026-09-19.md`. Those implementation reports describe the pre-deployment state; release/runtime evidence is recorded separately after adoption.

Preflight additionally found and fixed:

- The API layout regression fixture still constructed an incomplete v3 object from the six old city section keys. Tests now explicitly exercise v1/v2 upgrade with retained relative order/visibility, complete v3 round-trip and rejection of incomplete v3. Parser strictness was not reduced.
- The opt-in university detail programme list could retain expired verified tuition in its 15-second list cache. Only this detail-scope list now bypasses persistent read/write caching and sends `no-store`. Concurrent request coalescing, ordinary Course Finder/Programs caching and facet caching remain unchanged.
- The four new API contract suites are included in the existing `test:public-catalog-render` command, so existing CI executes them without a workflow change.
- Two security registries classify the new legacy CMS writer/router and refresh changed route hashes. Legacy quarantine and external-pilot deny remain; no Control Plane grant or cutover authorization was created.

## Local gates

- Frontend: 67/67 tests, 23-locale parity, Vite build, sitemap and bundle budget PASS.
- Full workspace typecheck PASS; API typecheck repeated after the detail-list cache fix PASS.
- Fresh API content/layout/SSR/card/context/tuition test run: 44/44 PASS before the additional cache regression; focused cache-related group afterwards: 19/19 PASS.
- Migration validator 124/124 and package-manager guard 6/6 PASS.
- Earlier disposable PostgreSQL HTTP authoring and read-model/cache integration evidence is retained in the content report; no staging data is replaced with local data.

## Deployment conditions

Commit and push the exact scoped source to the same feature branch. Require green exact-head Staging Adoption plus normal feature-PR Convergence/Institution/Portal checks; do not dispatch the historical frozen-convergence review gate against an unrelated feature branch. Do not weaken any CI gate.

Before switching runtime: fresh staging-only checksum backup and network-none PostgreSQL restore drill, clean exact source, immutable image identity, pinned current release, unchanged unrelated containers and disabled core/social/provider execution flags. Use the existing non-root hardened staging Dockerfile. Switch only the staging app container; no database/service-wide restart or migration.

Rollback is code-only to the pinned previous staging image/configuration. Never restore an old database to undo this code deployment. Do not publish drafts, seed real content or submit applications during smoke checks.

Post-deploy evidence must include exact release health, runtime UID/read-only filesystem/capability boundaries, unchanged external execution flags and containers, readonly catalogue/Pages smoke plus desktop/mobile checks. Missing real editorial content remains absent until independently reviewed and published by authorized users.
