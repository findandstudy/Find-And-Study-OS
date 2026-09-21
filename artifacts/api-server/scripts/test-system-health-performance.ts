import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createSystemHealthPerformanceWindow, isSystemHealthPerformanceRequest } from "../src/lib/systemHealthPerformance";

test("disabled and empty telemetry is unknown, never zero latency or zero error", () => {
  const window = createSystemHealthPerformanceWindow(() => 1_000_000);
  assert.equal(window.snapshot().p95Ms, null);
  assert.equal(window.snapshot().errorRatePercent, null);
  window.record(50, 200, 5);
  assert.equal(window.snapshot(false).enabled, false);
  assert.equal(window.snapshot(false).sampleCount, 0);
  assert.equal(window.snapshot(false).p95Ms, null);
});

test("nearest rank latency, server error rate and observed DB acquire are independent", () => {
  const window = createSystemHealthPerformanceWindow(() => 1_000_000);
  for (let index = 1; index <= 100; index++) window.record(index, index > 95 ? 503 : 200, index % 2 ? null : index / 2);
  const snapshot = window.snapshot();
  assert.equal(snapshot.p95Ms, 95);
  assert.equal(snapshot.p99Ms, 99);
  assert.equal(snapshot.errorRatePercent, 5);
  assert.equal(snapshot.dbAcquireP95Ms, 48);
  assert.equal(snapshot.dbSampleCount, 50);
  assert.equal(snapshot.scope, "process");
  assert.equal(snapshot.windowTruncated, false);
});

test("five minute expiry excludes stale samples and shows observation start", () => {
  let now = 1_000_000;
  const window = createSystemHealthPerformanceWindow(() => now);
  window.record(100, 500);
  now += 299_999;
  assert.equal(window.snapshot().sampleCount, 1);
  now++;
  assert.equal(window.snapshot().sampleCount, 0);
  window.record(25, 200);
  assert.equal(window.snapshot().observedSince, new Date(now).toISOString());
  assert.equal(window.snapshot().errorRatePercent, 0);
});

test("capacity is hard bounded and truncated window is explicitly reported", () => {
  let now = 1_000_000;
  const window = createSystemHealthPerformanceWindow(() => now);
  for (let index = 0; index < 10_000; index++) window.record(index, 200);
  assert.equal(window.snapshot().sampleCount, 4_096);
  assert.equal(window.snapshot().windowTruncated, true);
  now += 300_000;
  assert.equal(window.snapshot().windowTruncated, false);
  assert.equal(window.snapshot().sampleCount, 0);
});

test("invalid metrics are discarded and snapshots contain no request metadata", () => {
  const window = createSystemHealthPerformanceWindow(() => 1_000_000);
  window.record(NaN, 200);
  window.record(Infinity, 200);
  window.record(-1, 200);
  window.record(10, 600);
  assert.equal(window.snapshot().sampleCount, 0);
  window.record(10, 404, NaN);
  assert.equal(window.snapshot().dbAcquireP95Ms, null);
  assert.equal(window.snapshot().errorRatePercent, 0);
  assert.deepEqual(Object.keys(window.snapshot()).sort(), ["enabled", "scope", "windowSeconds", "capacity", "sampleCount", "windowTruncated", "observedSince", "p95Ms", "p99Ms", "errorRatePercent", "dbAcquireP95Ms", "dbSampleCount"].sort());
});

test("health checks, static pages and event streams do not bias application percentiles", () => {
  for (const path of ["/api/health", "/api/healthz", "/api/health/", "/api/admin/system-health", "/api/admin/system-health/", "/en/programs", "/api", "/api/"]) {
    assert.equal(isSystemHealthPerformanceRequest(path, "application/json"), false, path);
  }
  assert.equal(isSystemHealthPerformanceRequest("/api/messages/events", "text/event-stream; charset=utf-8"), false);
  assert.equal(isSystemHealthPerformanceRequest("/api/programs", "application/json"), true);
});

test("existing middleware collects unsampled responses but not probes or response-declared streams", async () => {
  const previousEnv = { ...process.env };
  process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test"; // no DB queries are made
  process.env.REQUEST_PERF_TELEMETRY_ENABLED = "true";
  process.env.REQUEST_PERF_SAMPLE_RATE = "0";
  process.env.REQUEST_PERF_SLOW_MS = "60000";
  const [{ default: express }, middleware, diagnostics, dbMetrics] = await Promise.all([
    import("express"), import("../src/lib/requestPerformance"), import("../src/lib/systemHealthPerformance"), import("../../../lib/db/src/requestMetrics"),
  ]);
  const app = express();
  app.use(middleware.requestPerformanceMiddleware);
  const api = express.Router();
  app.use("/api", api);
  api.get("/test", (_req, res) => {
    dbMetrics.recordDbAcquire(7);
    res.json({ ok: true });
  });
  api.get("/health", (_req, res) => res.json({ status: "ok" }));
  api.get("/admin/system-health", (_req, res) => res.json({ status: "healthy" }));
  api.get("/events", (_req, res) => res.type("text/event-stream").end("event: heartbeat\n\n"));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const before = diagnostics.getSystemHealthPerformanceSnapshot().sampleCount;
    for (const route of ["test?private=never-captured", "health", "admin/system-health", "events"]) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/${route}`);
      await response.arrayBuffer();
    }
    const after = diagnostics.getSystemHealthPerformanceSnapshot();
    assert.equal(after.sampleCount, before + 1);
    assert.equal(after.dbAcquireP95Ms, 7);
    assert.doesNotMatch(JSON.stringify(after), /private|never-captured|\/api\/test/);
    process.env.REQUEST_PERF_TELEMETRY_ENABLED = "false";
    const disabledResponse = await fetch(`http://127.0.0.1:${address.port}/api/test`);
    await disabledResponse.arrayBuffer();
    assert.equal(diagnostics.getSystemHealthPerformanceSnapshot().enabled, false);
    process.env.REQUEST_PERF_TELEMETRY_ENABLED = "true";
    assert.equal(diagnostics.getSystemHealthPerformanceSnapshot().sampleCount, before + 1);
  } finally {
    middleware.stopRequestPerformanceEventLoopMonitor();
    server.closeAllConnections();
    server.close();
    await once(server, "close");
    for (const key of ["DATABASE_URL", "REQUEST_PERF_TELEMETRY_ENABLED", "REQUEST_PERF_SAMPLE_RATE", "REQUEST_PERF_SLOW_MS"]) {
      if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
    }
  }
});
