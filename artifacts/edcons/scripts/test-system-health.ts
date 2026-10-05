import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { appendHealthHistory, CHECK_KEYS, createHealthReader, healthHref, healthIsStale, healthNumber, healthRefreshEnabled, healthSummary, healthSum, parseHealthResponse, type HealthHistory } from "../src/pages/admin/system-health/model";
import { healthCopy, issueCopy } from "../src/pages/admin/system-health/copy";

const time = Date.parse("2026-09-21T10:00:00Z");
const snapshot = () => ({ schemaVersion: 2, status: "healthy", checkedAt: new Date(time).toISOString(), latencyMs: 1, coverage: "complete", freshnessSeconds: 90, metrics: {
  database: { totalConnections: 2, idleConnections: 1, waitingRequests: 0, probeMs: 1 }, apiTokens: { no_expiry: 0, expired: 0, expiring_soon: 0 },
  aiRuns24h: { failed: 0, rate_limited: 0 }, webhook24h: { auth_failures: 0, verification_probes: 0, delivery_failures: 0 }, portalSubmissions: { queued: 0, running: 0, stale_running: 0, failed_24h: 0 },
  portalWorkers: { registered: 1, recent: 1, stale: 0, future: 0, real: 1, dry: 0, status_check: 0, lifecycle_execute: 0 }, messaging24h: { inbound: 0, outbound: 0, failed: 0, delivered: 0 },
  storage: { available: true, totalBytes: 100, freeBytes: 80, freePercent: 80 }, backups: { available: true, count: 1, latestSizeBytes: 100, latestAgeHours: 0 },
  requestPerformance: { enabled: true, sampleCount: 20, p95Ms: 1, p99Ms: 1, errorRatePercent: 0 },
}, issues: [], checks: CHECK_KEYS.map(key => ({ key, state: "healthy", checkedAt: new Date(time).toISOString(), latencyMs: 1, code: "OK" })) });

test("unknown metrics are not zero; real zero survives", () => {
  for (const value of [null, undefined, false, true, "", " ", "bad", {}, [], -1, Infinity]) assert.equal(healthNumber(value), null);
  for (const value of [0, "0"]) assert.equal(healthNumber(value), 0);
  assert.equal(healthSum(0, 2, "3"), 5);
  assert.equal(healthSum(0, undefined), null);
});
test("legacy API compatible but absent per-check evidence cannot show healthy", () => {
  const data = parseHealthResponse({ status: "healthy", checkedAt: new Date(time).toISOString(), metrics: { apiTokens: { expired: 0 } }, issues: [] });
  assert.equal(data.checks.length, 10);
  assert.equal(healthSummary(data, false), "unknown");
  assert.equal(data.metrics.apiTokens?.expired, 0);
});
test("all ten checks participate in coverage; disabled and insufficient evidence are not green", () => {
  for (const key of CHECK_KEYS) {
    for (const state of ["disabled", "unknown"]) {
      const value = snapshot(); value.checks.find(check => check.key === key)!.state = state;
      const data = parseHealthResponse(value);
      assert.equal(data.coverage, "partial");
      assert.equal(healthSummary(data, false), "unknown", key);
    }
  }
  assert.equal(healthSummary(parseHealthResponse(snapshot()), false), "healthy");
});
test("snapshot failures, old server and client timestamps and future clock drift remove green", () => {
  const data = parseHealthResponse(snapshot());
  assert.equal(healthIsStale(data, time, time, false), false);
  for (const [now, received, failed] of [[time, time, true], [time + 91_000, time, false], [time, time - 91_000, false], [time - 61_000, time, false]] as const) {
    assert.equal(healthIsStale(data, now, received, failed), true);
  }
  data.checks[0].checkedAt = new Date(time - 91_000).toISOString();
  assert.equal(healthIsStale(data, time, time, false), true);
  assert.equal(healthSummary(data, true), "stale");
});
test("known critical observations override partial coverage but not staleness", () => {
  const data = parseHealthResponse(snapshot()); data.checks[0].state = "unknown";
  data.issues.push({ key: "portal.stale_running", severity: "critical", count: 1, message: "stuck" });
  assert.equal(healthSummary(data, false), "critical");
  assert.equal(healthSummary(data, true), "stale");
});
test("malformed, duplicate or missing check states fail closed", () => {
  for (const value of [null, {}, { ...snapshot(), checkedAt: "invalid" }, { ...snapshot(), issues: null }]) assert.throws(() => parseHealthResponse(value));
  const duplicate = snapshot(); duplicate.checks.push(duplicate.checks[0]);
  assert.equal(parseHealthResponse(duplicate).checks[0].state, "unknown");
  const unknown = snapshot(); unknown.checks[0].state = "bogus";
  assert.equal(parseHealthResponse(unknown).checks[0].state, "unknown");
});
test("missing or contradictory metric evidence cannot show a healthy check", () => {
  const value = snapshot();
  for (const key of CHECK_KEYS) {
    const data = parseHealthResponse({ ...value, metrics: { ...value.metrics, [key]: null } });
    assert.equal(data.checks.find(check => check.key === key)?.state, "unknown");
    assert.equal(healthSummary(data, false), "unknown");
  }
  assert.equal(healthSummary(parseHealthResponse({ ...value, metrics: {} }), false), "unknown");
  value.metrics.requestPerformance.sampleCount = 0;
  assert.equal(parseHealthResponse(value).checks.find(check => check.key === "requestPerformance")?.state, "unknown");
});
test("drilldowns allow only existing read-only module paths", () => {
  for (const path of ["https://example.com", "//example.com", "javascript:alert(1)", "/admin/audit?token=secret", "/api/admin/restart", "/admin/audit/../settings", "constructor"]) assert.equal(healthHref(path), undefined);
  assert.equal(healthHref("/admin/portal-automation"), "/admin/portal-automation");
  assert.equal(healthHref("/staff/messages"), "/staff/messages");
});
test("bounded in-memory history deduplicates cached snapshots", () => {
  let history: HealthHistory[] = [];
  for (let i = 0; i < 31; i++) history = appendHealthHistory(history, { checkedAt: String(i), state: "healthy", issueCount: 0, latencyMs: 1 });
  assert.equal(history.length, 20); assert.equal(history[0].checkedAt, "11");
  assert.equal(appendHealthHistory(history, history[19]), history);
});
test("automatic refresh pauses for hidden or paused pages", () => {
  assert.equal(healthRefreshEnabled(true, "visible"), true);
  assert.equal(healthRefreshEnabled(true, "hidden"), false);
  assert.equal(healthRefreshEnabled(false, "visible"), false);
});
test("single-flight read rejects overlapping refresh and emits no callbacks after disposal", async () => {
  let calls = 0; let starts = 0; let successes = 0; let finishes = 0;
  let complete!: (value: unknown) => void; let signal: AbortSignal | undefined;
  const reader = createHealthReader({ read: abort => { calls++; signal = abort; return new Promise(resolve => { complete = resolve; }); }, onStart: () => { starts++; }, onSuccess: () => { successes++; }, onFailure: () => assert.fail("disposed read callback"), onFinish: () => { finishes++; } });
  const pending = reader.refresh(); await reader.refresh();
  assert.equal(calls, 1); assert.equal(starts, 1);
  reader.dispose(); assert.equal(signal?.aborted, true);
  complete(snapshot()); await pending; await reader.refresh();
  assert.equal(successes, 0); assert.equal(finishes, 0); assert.equal(calls, 1);
});
test("request timeout fails safely and a subsequent manual recheck recovers", async () => {
  let successes = 0; let failures = 0; let finishes = 0; let calls = 0;
  const reader = createHealthReader({ timeoutMs: 5, read: signal => ++calls === 1 ? new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) : Promise.resolve(snapshot()), onStart: () => {}, onSuccess: () => { successes++; }, onFailure: () => { failures++; }, onFinish: () => { finishes++; } });
  await reader.refresh(); await reader.refresh(); reader.dispose();
  assert.equal(failures, 1); assert.equal(successes, 1); assert.equal(finishes, 2);
});
test("a transport that ignores abort still times out without overlapping reads or late success", async () => {
  let resolve!: (value: unknown) => void; let calls = 0; let failures = 0; let finished = 0;
  const reader = createHealthReader({ timeoutMs: 5, read: () => { calls++; return new Promise(done => { resolve = done; }); }, onStart: () => {}, onSuccess: () => assert.fail("late success"), onFailure: () => { failures++; }, onFinish: () => { finished++; } });
  await reader.refresh(); await reader.refresh();
  assert.equal(failures, 1); assert.equal(finished, 1); assert.equal(calls, 1);
  resolve(snapshot()); await Promise.resolve(); reader.dispose();
});
test("malformed success payload becomes an explicit failed observation", async () => {
  let failures = 0;
  const reader = createHealthReader({ read: async () => ({}), onStart: () => {}, onSuccess: () => assert.fail("bad success"), onFailure: () => { failures++; }, onFinish: () => {} });
  await reader.refresh(); reader.dispose(); assert.equal(failures, 1);
});
test("a synchronous read exception releases the lock for a later recheck", async () => {
  let calls = 0; let failures = 0;
  const reader = createHealthReader({ read: () => { calls++; throw new Error("synchronous adapter failure"); }, onStart: () => {}, onSuccess: () => assert.fail("bad success"), onFailure: () => { failures++; }, onFinish: () => {} });
  await reader.refresh(); await reader.refresh(); reader.dispose(); assert.equal(calls, 2); assert.equal(failures, 2);
});
test("Turkish copy and explicit safe English fallback cover all check states", () => {
  for (const lang of ["en", "tr", "ar", "ru", "hi"]) {
    const copy = healthCopy(lang);
    for (const key of CHECK_KEYS) assert.ok(copy.titles[key]);
    for (const label of Object.values(copy.states)) assert.ok(label);
    const result = issueCopy({ key: "constructor", severity: "warning", message: "Unknown issue", count: null }, copy);
    assert.equal(typeof result.title, "string"); assert.ok(result.nextAction);
  }
  assert.equal(healthCopy("tr").title, "Sistem Sağlığı");
  assert.equal(healthCopy("ar").lang, "en");
  assert.notEqual(healthCopy("tr").limitations.not_end_to_end_delivery, healthCopy("en").limitations.not_end_to_end_delivery);
});
test("UI refresh is read-only and keeps routing/RTL/accessibility boundaries", () => {
  const source = readFileSync(new URL("../src/pages/admin/SystemHealth.tsx", import.meta.url), "utf8");
  assert.match(source, /method: "GET", signal, cache: "no-store"/);
  assert.doesNotMatch(source, /method: "(?:POST|PATCH|DELETE|PUT)"/);
  for (const pattern of [/reader.dispose\(\)/, /clearInterval\(refreshTimer\)/, /removeEventListener\("visibilitychange"/, /dir=\{dir\}/, /aria-live="polite"/, /scope="col"/, /healthHref\(issue.href\)/]) assert.match(source, pattern);
});
