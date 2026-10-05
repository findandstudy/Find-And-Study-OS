import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSystemHealth, createSystemHealthReader, HEALTH_QUERIES, type HealthDependencies } from "../src/lib/systemHealth";
import { coalesceHealthFileRead, HEALTH_READ_LIMITS, readHealthAggregate, readSystemHealthBackups, SystemHealthReadError, withinHealthDeadline, type HealthReadClient } from "../src/lib/systemHealthReadStore";

const NOW = Date.parse("2026-09-21T12:00:00Z");
const rows: Record<keyof typeof HEALTH_QUERIES, Record<string, unknown>> = {
  database: { connected: 1 },
  apiTokens: { no_expiry: 0, expired: 0, expiring_soon: 0 },
  aiRuns24h: { failed: 0, rate_limited: 0 },
  webhook24h: { auth_failures: 0, verification_probes: 0, delivery_failures: 0 },
  portalSubmissions: { queued: 0, running: 0, stale_running: 0, failed_24h: 0, oldest_queued_age_seconds: 0 },
  messaging24h: { inbound: 2, outbound: 1, failed: 0, delivered: 1, last_inbound_at: new Date(NOW), last_outbound_at: new Date(NOW) },
  portalWorkers: { registered: 1, recent: 1, stale: 0, future: 0, last_observed_at: new Date(NOW), real: 0, dry: 1, status_check: 1, lifecycle_execute: 0 },
};
function deps(overrides: Partial<HealthDependencies> = {}): HealthDependencies {
  return {
    query: async (sql) => structuredClone(rows[Object.keys(HEALTH_QUERIES).find((key) => HEALTH_QUERIES[key as keyof typeof HEALTH_QUERIES] === sql) as keyof typeof rows]),
    storage: async () => ({ available: true, totalBytes: 1000, freeBytes: 300, freePercent: 30 }),
    backups: async () => ({ available: true, count: 1, latestAt: new Date(NOW).toISOString(), latestSizeBytes: 128, latestAgeHours: 0 }),
    pool: () => ({ totalConnections: 3, idleConnections: 2, waitingRequests: 0, maxConnections: 20 }),
    performance: () => ({ enabled: true, scope: "process", sampleCount: 25, p95Ms: 150, p99Ms: 200, errorRatePercent: 0 }),
    runtime: { backgroundJobsEnabled: false, liveIntegrationsAllowed: false },
    releaseId: "fixture-release",
    now: () => NOW,
    ...overrides,
  };
}
const knownRows = deps().query;

test("complete bounded health preserves aggregate compatibility and explicitly states gaps", async () => {
  const value = await collectSystemHealth(deps());
  assert.equal(value.schemaVersion, 2);
  assert.equal(value.status, "healthy");
  assert.equal(value.coverage, "complete");
  assert.equal(value.checks.length, 10);
  assert.ok(value.checks.every((check) => check.state === "healthy"));
  assert.deepEqual(value.metrics.apiTokens, rows.apiTokens);
  assert.equal(value.metrics.portalSubmissions?.oldest_queued_age_seconds, null);
  assert.ok(value.coverageGaps.includes("backup_restore"));
  assert.equal(value.metrics.messaging24h?.last_inbound_at, new Date(NOW).toISOString());
  assert.equal(value.runtime.liveIntegrationsAllowed, false);
});

test("one failed source is unknown, not zero and does not discard successful sources", async () => {
  const value = await collectSystemHealth(deps({ query: async (sql) => {
    if (sql === HEALTH_QUERIES.apiTokens) throw new Error("SECRET postgres://private-host/password");
    return knownRows(sql);
  } }));
  assert.equal(value.coverage, "partial");
  assert.equal(value.metrics.apiTokens, null);
  assert.equal(value.checks.find((x) => x.key === "apiTokens")?.state, "unknown");
  assert.equal(value.checks.find((x) => x.key === "messaging24h")?.state, "healthy");
  assert.equal(value.issues.find((x) => x.checkKey === "apiTokens")?.count, null);
  assert.doesNotMatch(JSON.stringify(value), /SECRET|private-host|postgres:\/\//);
});

test("database outage leaves storage and backup evidence visible", async () => {
  const value = await collectSystemHealth(deps({ query: async () => { throw new SystemHealthReadError("CHECK_TIMEOUT"); } }));
  assert.equal(value.checks.filter((x) => x.state === "unknown").length, 7);
  assert.equal(value.metrics.storage?.freePercent, 30);
  assert.equal(value.metrics.backups?.count, 1);
  assert.notEqual(value.status, "healthy");
});

test("invalid or missing numeric values are never silently projected as zero", async () => {
  for (const invalid of [null, undefined, "", NaN, -1, false]) {
    const value = await collectSystemHealth(deps({ query: async (sql) => sql === HEALTH_QUERIES.apiTokens ? { ...rows.apiTokens, expired: invalid } : knownRows(sql) }));
    assert.equal(value.metrics.apiTokens, null);
  }
});

test("pool waiting and queue age expose impact, approved navigation and cautious next actions", async () => {
  const value = await collectSystemHealth(deps({
    pool: () => ({ totalConnections: 20, idleConnections: 0, waitingRequests: 4, maxConnections: 20 }),
    query: async (sql) => sql === HEALTH_QUERIES.portalSubmissions ? { queued: 3, running: 1, stale_running: 1, failed_24h: 2, oldest_queued_age_seconds: 3600 } : knownRows(sql),
  }));
  assert.equal(value.metrics.database?.waitingRequests, 4);
  assert.equal(value.issues.find((x) => x.key === "database.pool_waiting")?.count, 4);
  const issue = value.issues.find((x) => x.key === "portal.stale_running")!;
  assert.equal(issue.severity, "critical");
  assert.equal(issue.href, "/admin/portal-automation");
  assert.match(issue.nextAction, /do not unlock or resubmit blindly/);
  assert.ok(value.issues.some((x) => x.key === "portal.queue_age"));
  assert.ok(value.issues.every((x) => x.impact && x.nextAction && x.observedAt));
});

test("portal worker no-evidence is unknown; stale and future heartbeats are not false-green or auto-restarted", async () => {
  const empty = { registered: 0, recent: 0, stale: 0, future: 0, last_observed_at: null, real: 0, dry: 0, status_check: 0, lifecycle_execute: 0 };
  const collect = (worker: Record<string, unknown>) => collectSystemHealth(deps({ query: async (sql) => sql === HEALTH_QUERIES.portalWorkers ? worker : knownRows(sql) }));
  const noEvidence = await collect(empty);
  assert.equal(noEvidence.checks.find((x) => x.key === "portalWorkers")?.state, "unknown");
  assert.equal(noEvidence.checks.find((x) => x.key === "portalWorkers")?.code, "NO_WORKER_OBSERVATIONS");
  const stale = await collect({ ...empty, registered: 1, stale: 1, last_observed_at: new Date(NOW - 120_000) });
  assert.equal(stale.checks.find((x) => x.key === "portalWorkers")?.state, "warning");
  assert.match(stale.issues.find((x) => x.key === "portalWorkers.stale")!.nextAction, /Do not restart/);
  const future = await collect({ ...empty, registered: 1, future: 1 });
  assert.equal(future.checks.find((x) => x.key === "portalWorkers")?.code, "FUTURE_WORKER_OBSERVATIONS");
  assert.match(HEALTH_QUERIES.portalWorkers, /BETWEEN now\(\) - interval '60 seconds' AND now\(\)/);
  assert.doesNotMatch(HEALTH_QUERIES.portalWorkers, /worker_id|runtime_release_id/);
});

test("webhook authentication and delivery receipts are distinct; free-form resource data is discarded", async () => {
  const value = await collectSystemHealth(deps({ query: async (sql) => {
    if (sql === HEALTH_QUERIES.webhook24h) return { auth_failures: 2, verification_probes: 0, delivery_failures: 2, by_resource: { "secret-contact@example.com": 2 } };
    if (sql === HEALTH_QUERIES.messaging24h) return { ...rows.messaging24h, failed: 1, content: "private message" };
    return knownRows(sql);
  } }));
  assert.ok(value.issues.some((x) => x.key === "webhooks.delivery_auth_failed"));
  assert.ok(value.issues.some((x) => x.key === "messaging.failed"));
  assert.ok(value.checks.find((x) => x.key === "webhook24h")?.limitationCodes.includes("not_end_to_end_delivery"));
  assert.doesNotMatch(JSON.stringify(value), /secret-contact|private message/);
});

test("unreadable backup location is unknown, while a successfully scanned empty location is critical", async () => {
  const inaccessible = await collectSystemHealth(deps({ backups: async () => { throw new Error("EACCES private path"); } }));
  assert.equal(inaccessible.metrics.backups, null);
  assert.equal(inaccessible.checks.find((x) => x.key === "backups")?.state, "unknown");
  assert.equal(inaccessible.issues.find((x) => x.checkKey === "backups")?.severity, "warning");
  const empty = await collectSystemHealth(deps({ backups: async () => ({ count: 0, latestAt: null, latestAgeHours: null, latestSizeBytes: null }) }));
  assert.equal(empty.issues.find((x) => x.key === "backups.empty")?.severity, "critical");
});

test("an old zero-byte backup remains critical even when its age is only warning-level", async () => {
  const value = await collectSystemHealth(deps({ backups: async () => ({ count: 1, latestAt: new Date(NOW - 72 * 3600_000), latestAgeHours: 72, latestSizeBytes: 0 }) }));
  assert.equal(value.issues.find((x) => x.key === "backups.stale")?.severity, "warning");
  assert.equal(value.issues.find((x) => x.key === "backups.empty_file")?.severity, "critical");
});

test("disabled and insufficient performance telemetry never imply measured health", async () => {
  const disabled = await collectSystemHealth(deps({ performance: () => ({ enabled: false, scope: "process", sampleCount: 0, p95Ms: null, p99Ms: null, errorRatePercent: null }) }));
  assert.equal(disabled.checks.find((x) => x.key === "requestPerformance")?.state, "disabled");
  assert.equal(disabled.coverage, "partial");
  const insufficient = await collectSystemHealth(deps({ performance: () => ({ enabled: true, scope: "process", sampleCount: 1, p95Ms: 9000, p99Ms: 9000, errorRatePercent: 100 }) }));
  assert.equal(insufficient.checks.find((x) => x.key === "requestPerformance")?.code, "INSUFFICIENT_SAMPLES");
  assert.equal(insufficient.checks.find((x) => x.key === "requestPerformance")?.state, "unknown");
});

test("performance error-rate/latency warnings require sufficient samples and snapshot errors stay isolated", async () => {
  const high = await collectSystemHealth(deps({ performance: () => ({ enabled: true, scope: "process", sampleCount: 20, p95Ms: 2100, p99Ms: 5000, errorRatePercent: 0 }) }));
  assert.ok(high.issues.some((x) => x.key === "performance.degraded"));
  const failed = await collectSystemHealth(deps({ performance: () => { throw new Error("sensitive"); } }));
  assert.equal(failed.metrics.requestPerformance, null);
  assert.equal(failed.metrics.apiTokens?.no_expiry, 0);
});

test("aggregate reads have at most two concurrent queries", async () => {
  let active = 0;
  let max = 0;
  await collectSystemHealth(deps({ query: async (sql) => {
    active++;
    max = Math.max(max, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return knownRows(sql);
  } }));
  assert.equal(max, 2);
});

test("snapshot reader coalesces refreshes and preserves observation time during its 30-second TTL", async () => {
  let now = NOW;
  let calls = 0;
  const reader = createSystemHealthReader(async () => { calls++; return collectSystemHealth(deps({ now: () => now })); }, () => now);
  const [first, second] = await Promise.all([reader(), reader()]);
  assert.equal(first, second);
  assert.equal(calls, 1);
  now += 29_999;
  assert.equal((await reader()).checkedAt, first.checkedAt);
  now += 1;
  assert.notEqual((await reader()).checkedAt, first.checkedAt);
  assert.equal(calls, 2);
});

function clientFixture(read: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> = async () => ({ rows: [{ count: 4 }] })) {
  const queries: string[] = [];
  const releases: unknown[] = [];
  const client: HealthReadClient = {
    query: async (sql) => { queries.push(sql); return read(sql); },
    release: (destroy) => { releases.push(destroy); },
  };
  return { client, queries, releases, pool: { connect: async () => client } };
}

test("read lease uses READ ONLY, transaction-local statement limits, rollback and clean release", async () => {
  const fixture = clientFixture();
  const row = await readHealthAggregate(fixture.pool, "SELECT count(*) AS count FROM example");
  assert.deepEqual(row, { count: 4 });
  assert.deepEqual(fixture.queries, ["BEGIN READ ONLY", "SET LOCAL statement_timeout = '1500ms'", "SET LOCAL lock_timeout = '500ms'", "SELECT count(*) AS count FROM example", "ROLLBACK"]);
  assert.deepEqual(fixture.releases, [false]);
});

test("query failure destroys the aborted lease and exposes only a fixed code", async () => {
  const fixture = clientFixture(async (sql) => {
    if (sql.startsWith("SELECT")) throw Object.assign(new Error("SQL secret"), { code: "57014" });
    return { rows: [] };
  });
  await assert.rejects(readHealthAggregate(fixture.pool, "SELECT 1"), (error: unknown) => error instanceof SystemHealthReadError && error.code === "CHECK_TIMEOUT" && !error.message.includes("secret"));
  assert.deepEqual(fixture.releases, [true]);
});

test("hard transaction deadline destroys a hung lease and never submits later transaction commands", async () => {
  let resume!: () => void;
  const fixture = clientFixture(async () => { await new Promise<void>((resolve) => { resume = resolve; }); return { rows: [] }; });
  await assert.rejects(readHealthAggregate(fixture.pool, "SELECT 1"), /CHECK_TIMEOUT/);
  assert.deepEqual(fixture.releases, [true]);
  resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fixture.queries, ["BEGIN READ ONLY"]);
});

test("late acquired leases are destroyed, not queried; unresolved acquisition slots remain bounded", async () => {
  const fixture = clientFixture();
  const resolvers: Array<(client: HealthReadClient) => void> = [];
  const pool = { connect: () => new Promise<HealthReadClient>((resolve) => resolvers.push(resolve)) };
  const one = readHealthAggregate(pool, "SELECT 1");
  const two = readHealthAggregate(pool, "SELECT 1");
  await Promise.all([assert.rejects(one, /CHECK_TIMEOUT/), assert.rejects(two, /CHECK_TIMEOUT/)]);
  await assert.rejects(readHealthAggregate(pool, "SELECT 1"), /CHECK_UNAVAILABLE/);
  assert.equal(resolvers.length, 2);
  resolvers.forEach((resolve) => resolve(fixture.client));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fixture.queries, []);
  assert.deepEqual(fixture.releases, [true, true]);
});

test("filesystem timeout does not free its underlying single-flight slot until physical completion", async () => {
  let now = NOW;
  let calls = 0;
  let resume!: (value: number) => void;
  const read = coalesceHealthFileRead(() => { calls++; return new Promise<number>((resolve) => { resume = resolve; }); }, () => now);
  const first = read();
  assert.equal(read(), first);
  await assert.rejects(withinHealthDeadline(read, 1), /CHECK_TIMEOUT/);
  now += HEALTH_READ_LIMITS.fileMs;
  await assert.rejects(read(), /CHECK_TIMEOUT/);
  assert.equal(calls, 1);
  resume(2);
  assert.equal(await first, 2);
});

test("backup scan returns only bounded regular-file metadata and rejects future clock data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fas-system-health-"));
  try {
    await writeFile(join(directory, "private-student-name.dump"), "fixture");
    await writeFile(join(directory, "ignored.txt"), "not a backup");
    await mkdir(join(directory, "directory.dump"));
    const now = Date.now();
    const result = await readSystemHealthBackups(directory, now);
    assert.equal(result.count, 1);
    assert.equal(result.latestSizeBytes, 7);
    assert.doesNotMatch(JSON.stringify(result), /private-student|fas-system-health/);
    await utimes(join(directory, "private-student-name.dump"), new Date(now + 120_000), new Date(now + 120_000));
    await assert.rejects(readSystemHealthBackups(directory, now), /CHECK_UNAVAILABLE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("backup directory entry budget fails closed instead of returning a truncated successful count", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fas-system-health-budget-"));
  try {
    for (let start = 0; start <= HEALTH_READ_LIMITS.backupEntries; start += 100) {
      await Promise.all(Array.from({ length: Math.min(100, HEALTH_READ_LIMITS.backupEntries + 1 - start) }, (_, offset) => writeFile(join(directory, `ignored-${start + offset}.txt`), "")));
    }
    await assert.rejects(readSystemHealthBackups(directory), (error: unknown) => error instanceof SystemHealthReadError && ["BACKUP_SCAN_LIMIT", "CHECK_TIMEOUT"].includes(error.code));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("route remains admin-only, no-store, read-only and preserves deployment probe contracts", async () => {
  const source = await readFile(new URL("../src/routes/health.ts", import.meta.url), "utf8");
  assert.match(source, /"\/admin\/system-health",\s*requireAuth,\s*requireRole\(\.\.\.ADMIN_ROLES\)/);
  assert.match(source, /"Cache-Control", "private, no-store"/);
  assert.match(source, /router\.get\("\/healthz"/);
  assert.match(source, /res\.json\(\{ status: "ok", uptime: Math\.floor\(process\.uptime\(\)\) \}\)/);
  assert.match(source, /res\.status\(dbConnected \? 200 : 503\)/);
  assert.doesNotMatch(source, /router\.(post|put|patch|delete)\(/);
  Object.values(HEALTH_QUERIES).forEach((sql) => assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CALL)\b/i));
});
