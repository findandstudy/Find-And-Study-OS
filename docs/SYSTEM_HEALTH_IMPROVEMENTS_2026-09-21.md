# System Health — bounded operational diagnostics

Scope: local implementation of the existing admin System Health screen and its
read-only endpoint. No deployment, migration, provider call, worker activation,
production configuration change, data repair, or outbound notification.

## Implemented design

- Preserve `/api`, `/api/healthz`, `/api/health` and the existing authenticated
  admin role gate. The operational endpoint explicitly returns `private, no-store`.
- Isolate component failures: failed/absent evidence is **unknown**, not zero.
  A failing refresh makes the last displayed snapshot historical/unverified.
- Inspect DB connectivity and pool pressure, token expiry, AI run errors,
  webhook authentication rejections, recorded messaging outcomes, portal queues,
  observable portal execution heartbeats, application filesystem and local backup
  metadata. Each measurement states what it does **not** prove.
- Reuse the existing opt-in request-performance middleware. Keep only the last
  4,096 eligible completed API requests in a five-minute process-local numerical
  ring. Report nearest-rank p95/p99, 5xx rate and p95 of each request's total
  observed DB acquisition wait. Exclude health probes and SSE. No URLs, SQL,
  headers, request/user IDs or contents are stored in this ring.
- Label disabled telemetry, no/insufficient samples, truncated windows, and
  restart/process scope. These measurements are not fleet-wide SLOs, capacity
  certification or browser Core Web Vitals.
- Add stable finding codes, possible impact, safe investigation steps and links
  to existing authorized operations screens. The only operation performed by
  this screen is a read-only recheck.
- Refresh every 30 seconds while visible, with overlap prevention, cancellation,
  manual recheck and a pause control. Last 20 UI observations stay only in the
  mounted component; reloading clears them. This is not durable incident history.
- Turkish/English local copy reuses the current language context; other locales
  explicitly disclose English fallback. The 23-locale platform is unchanged.

## Resource and safety boundaries

The diagnostic service must not amplify an outage. Server-side snapshot
coalescing retains original timestamps and reuses completed results for 30s.
Collection uses at most two concurrent DB inspections, bounded connection waits,
read-only transactions, transaction-local statement/lock timeouts and destruction
of failed/late leases. Pending filesystem reads retain their single-flight slot;
backup scanning is asynchronous, non-recursive and entry/time bounded, skips
symlinks, and returns only aggregate metadata. Raw paths/errors/secrets/PII are
not exposed. There is no SQL/shell console or new mutation endpoint.

Portal heartbeat freshness is not proof of execution readiness. Long work may
delay heartbeats; absent rows do not prove a worker should be running. Dry/test
and real-execution observations must remain distinct. The API's background-job
switch is not authority for independently configured workers.

## Verification commands

Use the pinned project package manager if invoking package scripts. The shell's
bundled pnpm may be a different version; no install/lockfile update is necessary.

From `artifacts/api-server`:

```powershell
node --import tsx --test scripts/test-system-health.ts scripts/test-system-health-performance.ts scripts/test-read-path-performance.ts scripts/test-security-regressions.ts
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

From `artifacts/edcons`:

```powershell
node --import tsx --test scripts/test-system-health.ts
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node scripts/check-i18n.mjs
node node_modules/vite/bin/vite.js build --config vite.config.ts
node scripts/test-system-health-browser.mjs
```

The browser regression serves the built app on loopback, mocks all API responses
and blocks external requests. No real accounts or credentials are needed.
Windows sandbox `uv_os_get_passwd` failures may require running the same approved
local test command outside that sandbox; this is not an application test failure.

## Explicitly not completed by this change

- External uptime watchdog and real on-call notification channel ownership.
- Durable incident storage, acknowledgement/assignment, cross-process trends,
  correlation and escalation policies.
- Browser error/CWV ingestion and host-wide CPU/memory/disk-volume monitoring.
- Tenant-scoped social worker health aggregation into this global legacy screen.
- Verified offsite backup/restore/DR evidence.
- Mutation/retry/remediation buttons: existing authorized domain workflows remain
  authoritative. Never blindly replay external submissions/messages, revoke
  tokens, delete files, restart services or repair database records.

These require explicit operational wiring/owners and, for mutations, verified
preflight, authorization, idempotency, receipts, audit and rollback semantics.

## Staging UAT and rollback

Deploy only with separate authorization. Validate the exact deployed release,
admin allow/deny, real-schema aggregate queries, no raw data exposure and DB
query budget. Check backup mount visibility and intended worker/telemetry mode;
do not enable them just to turn a badge green. Exercise partial query failure and
recovery, TR/EN/mobile/RTL, and existing drilldown permissions.

Rollback consists of restoring the preceding application artifact. No database
rollback or storage restore is needed because this change adds no schema or
business-data mutation. Local tests do not replace this runtime UAT.

## Results

Local verification on 2026-09-21:

| Check | Result |
| --- | --- |
| Backend health collector/read-store safety | 21/21 PASS |
| Performance window + real loopback middleware | 7/7 PASS |
| Existing read-path regression | 13/13 PASS |
| Existing security regression | 37/37 PASS |
| Frontend parsing, stale states, polling, copy and safety | 17/17 PASS |
| Built-app browser regression | 3/3 PASS: EN 1440px, TR 390px, AR/RTL 390px |
| API and Edcons TypeScript | PASS |
| API and Edcons production builds (local only) | PASS |
| i18n key/placeholder parity | PASS: 23 locales |
| Public initial-bundle budget | PASS: JS gzip 280,287 bytes |
| Package-manager guard | 6/6 PASS |
| Whitespace/diff check | PASS |

The browser cases cover healthy evidence, failed refresh overriding green,
recovery to partial data, safe links, worker field rendering, no application
errors and no horizontal overflow. All non-loopback requests are blocked; the
existing global Google Fonts stylesheet attempt is explicitly accounted for.
No new runtime dependency, install, lockfile, schema or deployment change.

Independent read-only code review re-ran health/performance/frontend suites and
found no remaining actionable blocker in this scope. Existing Vite source-map,
mixed import and large-chunk warnings remain; the builds and budget gate pass.

**Not run:** actual PostgreSQL aggregate-query smoke, live staging UAT, external
provider delivery, restore/DR, production-load validation. These are not implied
by the injected tests or synthetic browser fixtures.

Status: **READY FOR STAGING UAT**, with deployment requiring separate approval.

## Staging adoption authorization and preflight

The user subsequently authorized staging deployment on 2026-09-21. Production,
merge, migrations, provider activation and runtime feature flag changes remain
excluded. The observed baseline is commit
`2fc9f58c389c05b8bff73a1db74998f01ba33590`, release
`staging-20260919T162312Z-2fc9f58c389c`, healthy with zero restarts and about
48 GB available. Source is clean at that baseline on the dedicated staging host.

The new suites are wired into existing API security-regression and frontend
build commands, so existing CI runs them without a workflow change. The health
route fingerprint and conservative read-store writer classification are updated;
quarantine remains. Route inventory (79/867), writer inventory (198/198) and
migration inventory (124/124) pass. Exact-head CI, staged backup/isolated restore,
image identity, code-only rollback and deployed read-only smoke are required
before declaring this deployment complete. Final runtime evidence is recorded
separately; this candidate section is not itself evidence of deployment.
