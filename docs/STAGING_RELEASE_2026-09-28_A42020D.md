# Staging Release Evidence — 28 September 2026

## Scope

This record covers the staging-only release of the public-program dialog
deferment and atomic contract-brand audit changes. Production, the `Next`
repository, external-delivery providers and background workers were not
changed.

## Exact source and image

- Source commit: `a42020d038318da4e5d9dc9622b88223e25ff2fb`
- Staging release: `staging-20260928T234501Z-a42020d03831`
- Image: `findandstudy-staging-app:a42020d03831`
- Image ID: `sha256:09a0960df0097d0aaf2b67bef2b683ee025c86aaa55cb2a906a555a8e1a226ef`
- Image user: `findandstudy`; `.git` and `.github` are absent from the runtime
  image and the API production artifact is present.

## Pre-deployment data safety

- Checksum-attested backup:
  `staging-predeploy-20260928T234139Z-a42020d03831-fasos_staging.dump`
- Restore target: disposable PostgreSQL 16.15 container with `--network none`
  and tmpfs data/runtime directories.
- Restore result: PASS.
- Restored database name: `fasos_staging_restore_drill`.
- Restored migration ledger: `132`.
- Restored ordinary tables in the public schema: `256`.
- Restored synthetic users: `13`.
- Drill containers were removed after the checks. The staging database was not
  restarted or restored.

## Runtime acceptance

- App container: healthy, restart count `0`.
- Database container: healthy, restart count `0`; its original start identity
  remained `2026-09-01T18:14:26.114902524Z` before and after the app switch.
- `/api/health`: HTTP 200, exact release ID, `dbConnected=true`.
- `/api/healthz`: HTTP 200.
- Runtime boundary: UID/GID `10042:10042`, read-only root filesystem,
  `cap_drop=ALL`, `no-new-privileges=true`.
- HTTPS HSTS and global `X-Robots-Tag: noindex, nofollow`: PASS.
- Live staging ledger remained `132`.
- Recent app logs: zero fatal/unhandled/uncaught matches.
- External delivery, social providers/workers, background jobs and AI external
  auto-reply remained fail-closed. Email delivery remained disabled.

Public smoke checks returned HTTP 200 for the homepage, program list, country
list/detail, city detail, university detail and program detail examples. The
authenticated System Health route returned HTTP 200. Synthetic RBAC UAT passed
for 11 roles and 126 checks against the exact release.

## Core Web Vitals lab gate

The post-release staging lab run used the mobile 390 / Fast 4G / 4x CPU profile,
three repetitions and the existing thresholds (`LCP <= 2500 ms`, `CLS <= 0.1`,
`TBT <= 200 ms`). This is lab evidence, not field p75 data.

| Route | Median LCP | Median TBT | Median CLS | Result |
| --- | ---: | ---: | ---: | --- |
| `/en` | 3120 ms | 67 ms | 0 | FAIL LCP |
| `/en/programs` | 3288 ms | 234 ms | 0 | FAIL LCP/TBT |
| `/en/countries` | 3036 ms | 97 ms | 0.0004 | FAIL LCP |
| `/en/cities/london-2` | 3440 ms | 196 ms | 0 | FAIL LCP |
| `/en/universities/abbey-dld-colleges-1563` | 2360 ms | 222 ms | 0 | FAIL TBT |
| Representative program detail | 2304 ms | 218 ms | 0 | FAIL TBT |

Aggregate median: LCP `3036 ms`, TBT `196 ms`, CLS `0`. The gate therefore
remains **FAIL**. The dialog deferment is present in the immutable image and
keeps the detail component out of the three initial route graphs, but it is not
sufficient to close the full performance gate. The main remaining measured
costs are roughly one-second cold TTFB, the shared React/application/CSS/icons
chain and the 150 KB branding-logo response on detail pages.

## Release status

**STAGING DEPLOYED — RUNTIME/RBAC PASS, CWV LAB GATE OPEN.**

The release is suitable for staging UAT. It is not a production GO, a
high-volume capacity certificate, field-CWV proof or permission to enable any
external integration.

## Performance follow-up release — 29 September 2026

The public Programs application flow was moved out of the initial Programs
route graph and into a lazy dialog chunk without changing its API or upload
contract.

- Source commit: `4b484b5cf27d2e7adc03f15f3535ea91f5478ca0`
- Staging release: `staging-20260929T001404Z-4b484b5cf27d`
- Image: `findandstudy-staging-app:4b484b5cf27d`
- Image ID: `sha256:f26c4cdf20fb2def7586d631df76e4b8467da0557ffbca8d5343595a53d3ba1d`
- Programs route chunk transfer: `4,828` bytes in the staging lab run; the
  deferred application-dialog chunk is absent until the application flow is
  opened.

The pre-switch backup
`staging-predeploy-20260929T001247Z-4b484b5cf27d-fasos_staging.dump` passed its
SHA-256 check and an isolated PostgreSQL 16.15 restore. The restored ledger was
`132`, the public ordinary-table count was `256`, and the synthetic user count
was `13`. The production database was not accessed. The staging database
container retained the exact same container ID, start time and restart count
(`0`) across the app-only switch.

Runtime, HSTS/noindex, critical public-route, System Health and delivery-gate
checks passed. The app is healthy with restart count `0`, runs as
`10042:10042` with a read-only root filesystem, all capabilities dropped and
`no-new-privileges`. Exact-release RBAC UAT passed for 11 roles and 126 checks.

The repeated mobile Fast 4G / 4x CPU lab run still failed the CWV release gate:

| Route | Median LCP | Median TBT | Median CLS | Result |
| --- | ---: | ---: | ---: | --- |
| `/en` | 3204 ms | 64 ms | 0 | FAIL LCP |
| `/en/programs` | 3196 ms | 230 ms | 0 | FAIL LCP/TBT |
| `/en/countries` | 3160 ms | 102 ms | 0.0004 | FAIL LCP |
| `/en/cities/london-2` | 3392 ms | 175 ms | 0 | FAIL LCP |
| `/en/universities/abbey-dld-colleges-1563` | 2328 ms | 191 ms | 0 | PASS |
| Representative program detail | 2316 ms | 214 ms | 0 | FAIL TBT |

Aggregate median: LCP `3160 ms`, TBT `175 ms`, CLS `0`, TTFB `1042.6 ms`.
The route split is therefore deployed and verified, but the full lab gate stays
open. Remaining measured work is the SSR-shell/client handoff, the shared
React/application/CSS/icon critical chain, and the 150 KB branding asset on
detail pages. This follow-up remains staging-only and is not a production GO.
