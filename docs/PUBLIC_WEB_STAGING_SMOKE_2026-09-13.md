# Public web staging smoke — 13 September 2026

This is a read-only HTTP smoke record against the canonical staging origin
`https://staging.findandstudy.com`. It does not authorize public indexing,
external delivery, portal submission, advertising, or a production deploy.

## Accepted environment

- origin: `https://staging.findandstudy.com`
- API release: `staging-20260913T045212Z-c64e1592`
- database: `fasos_staging`, ledger `124/124`, `dbConnected=true`
- staging safety: `ALLOW_LIVE_INTEGRATIONS=false`, background jobs disabled,
  email delivery disabled, Student Journey mode `off`
- public web render/indexing: noindex policy active; publication inventory has
  no city rows, so public city rendering remains fail-closed

## Read-only results

| Check | Result |
| --- | --- |
| Locale root routes (`/en`, `/tr`, and all 23 supported locales) | **23/23 PASS** — HTTP 200 and `X-Robots-Tag: noindex, nofollow` |
| Program detail API for the same published source program in all 23 locales | **23/23 PASS** — HTTP 200, stable program id and locale echo |
| University detail API (`sample-1563`) | **PASS** — HTTP 200, canonical `Content-Location` returned |
| Public SPA shells (`/tr`, `/en`, `/tr/programs`) | **PASS** — HTTP 200 and noindex |
| Invalid program route | **PASS** — HTTP 400 `PUBLIC_CATALOG_ROUTE_INVALID` |
| Existing but unpublished city route (`istanbul-1`) | **PASS** — HTTP 404 `PUBLIC_CITY_NOT_FOUND` |
| Unknown city route | **PASS** — HTTP 404 |
| `/api/health` | **PASS** — HTTP 200, database connected, expected staging release |

The tested program/university samples were selected by id from the synthetic
staging catalog. No student, applicant, credential, or private document data
was read or emitted.

## Remaining release gates

1. Create and approve real city/publication records before city-detail UAT;
   do not enable `PUBLIC_WEB_RENDER_MODE=allowlist` or `all` beforehand.
2. Perform the browser UAT checklist with approved real content: mobile
   breakpoints, forms, keyboard/screen-reader checks, canonical/hreflang,
   404/410 behavior, and representative program/university/city pages.
3. Measure Lighthouse/Core Web Vitals, cache hit ratio, API p95/p99, database
   pool wait, queue saturation and error budget on representative volume.
4. Keep sitemap/internal-link publication and every external provider disabled
   until the separate review, content approval and canary gates pass.
