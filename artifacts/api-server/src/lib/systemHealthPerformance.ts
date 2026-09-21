// Numeric-only, process-local diagnostics. This is not an SLO store or a
// fleet-wide monitor: samples disappear on restart and never contain URLs,
// query strings, user IDs, request IDs, SQL, headers or message contents.
const WINDOW_MS = 300_000;
const CAPACITY = 4_096;

type Sample = { at: number; durationMs: number; serverError: boolean; dbAcquireMs: number | null };

export type SystemHealthPerformanceSnapshot = {
  enabled: boolean;
  scope: "process";
  windowSeconds: number;
  capacity: number;
  sampleCount: number;
  windowTruncated: boolean;
  observedSince: string | null;
  p95Ms: number | null;
  p99Ms: number | null;
  errorRatePercent: number | null;
  dbAcquireP95Ms: number | null;
  dbSampleCount: number;
};

function percentile(values: number[], percentile: number): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return Math.round(values[Math.max(0, Math.ceil(values.length * percentile) - 1)]! * 10) / 10;
}

export function createSystemHealthPerformanceWindow(clock: () => number = Date.now) {
  const samples: Array<Sample | undefined> = new Array(CAPACITY);
  let cursor = 0;
  let overwrittenAt: number | null = null;
  return {
    record(durationMs: number, status: number, dbAcquireMs: number | null = null): void {
      if (!Number.isFinite(durationMs) || durationMs < 0 || !Number.isInteger(status) || status < 100 || status > 599) return;
      const at = clock();
      if (!Number.isFinite(at)) return;
      const previous = samples[cursor];
      if (previous) overwrittenAt = previous.at;
      samples[cursor] = {
        at,
        durationMs,
        serverError: status >= 500,
        dbAcquireMs: dbAcquireMs !== null && Number.isFinite(dbAcquireMs) && dbAcquireMs >= 0 ? dbAcquireMs : null,
      };
      cursor = (cursor + 1) % CAPACITY;
    },
    snapshot(enabled = true): SystemHealthPerformanceSnapshot {
      const now = clock();
      const current = enabled ? samples.filter((sample): sample is Sample => !!sample && sample.at > now - WINDOW_MS && sample.at <= now) : [];
      const dbValues = current.flatMap(sample => sample.dbAcquireMs === null ? [] : [sample.dbAcquireMs]);
      return {
        enabled,
        scope: "process",
        windowSeconds: WINDOW_MS / 1_000,
        capacity: CAPACITY,
        sampleCount: current.length,
        windowTruncated: enabled && overwrittenAt !== null && overwrittenAt > now - WINDOW_MS && overwrittenAt <= now,
        observedSince: current.length ? new Date(Math.min(...current.map(sample => sample.at))).toISOString() : null,
        p95Ms: percentile(current.map(sample => sample.durationMs), 0.95),
        p99Ms: percentile(current.map(sample => sample.durationMs), 0.99),
        errorRatePercent: current.length ? Math.round(current.filter(sample => sample.serverError).length / current.length * 10_000) / 100 : null,
        dbAcquireP95Ms: percentile(dbValues, 0.95),
        dbSampleCount: dbValues.length,
      };
    },
  };
}

const window = createSystemHealthPerformanceWindow();

export function recordSystemHealthRequest(durationMs: number, status: number, dbAcquireMs: number | null): void {
  if (process.env.REQUEST_PERF_TELEMETRY_ENABLED === "true") window.record(durationMs, status, dbAcquireMs);
}

export function getSystemHealthPerformanceSnapshot(): SystemHealthPerformanceSnapshot {
  return window.snapshot(process.env.REQUEST_PERF_TELEMETRY_ENABLED === "true");
}

export function isSystemHealthPerformanceRequest(path: string, contentType: string): boolean {
  return path.startsWith("/api/") && path !== "/api/" && !contentType.toLowerCase().includes("text/event-stream") &&
    !/^\/api\/(?:healthz?|admin\/system-health)\/?$/.test(path);
}
