export const CHECK_KEYS = ["database", "requestPerformance", "apiTokens", "aiRuns24h", "webhook24h", "portalSubmissions", "portalWorkers", "messaging24h", "storage", "backups"] as const;
export type CheckKey = typeof CHECK_KEYS[number];
export type HealthState = "healthy" | "warning" | "critical" | "unknown" | "disabled";
export type DisplayState = HealthState | "stale";
export type HealthCheck = { key: CheckKey; state: HealthState; checkedAt: string; latencyMs: number | null; code: string; limitationCodes?: string[]; href?: string };
export type HealthIssue = { key: string; severity: "warning" | "critical"; message: string; count: number | null; checkKey?: string; impact?: string; nextAction?: string; href?: string; observedAt?: string };
export type MetricRecord = Record<string, unknown>;
export type HealthResponse = {
  schemaVersion?: number; status: "healthy" | "warning" | "critical"; checkedAt: string; latencyMs: number | null;
  releaseId?: string; coverage?: "complete" | "partial"; freshnessSeconds?: number; refreshAfterSeconds?: number;
  checks: HealthCheck[]; metrics: Record<string, MetricRecord | null>; issues: HealthIssue[];
};

const states = new Set(["healthy", "warning", "critical", "unknown", "disabled"]);
const safePaths = new Set(["/admin/api-tokens", "/admin/ai-personas", "/admin/ai-agent", "/admin/audit", "/admin/portal-automation", "/admin/operations", "/admin/settings", "/staff/messages"]);
export function healthHref(value: unknown): string | undefined {
  return typeof value === "string" && safePaths.has(value) ? value : undefined;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function healthNumber(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
export function healthSum(...values: unknown[]): number | null {
  const numbers = values.map(healthNumber);
  return numbers.some(value => value === null) ? null : (numbers as number[]).reduce((sum, value) => sum + value, 0);
}
function hasHealthyEvidence(key: CheckKey, metric: unknown): boolean {
  if (!record(metric)) return false;
  const required: Record<CheckKey, string[]> = {
    database: ["totalConnections", "idleConnections", "waitingRequests", "probeMs"], apiTokens: ["no_expiry", "expired", "expiring_soon"],
    aiRuns24h: ["failed", "rate_limited"], webhook24h: ["auth_failures", "verification_probes", "delivery_failures"],
    portalSubmissions: ["queued", "running", "stale_running", "failed_24h"], portalWorkers: ["registered", "recent", "stale", "future", "real", "dry", "status_check", "lifecycle_execute"],
    messaging24h: ["inbound", "outbound", "failed", "delivered"], storage: ["totalBytes", "freeBytes", "freePercent"], backups: ["count", "latestSizeBytes", "latestAgeHours"],
    requestPerformance: ["sampleCount", "p95Ms", "p99Ms", "errorRatePercent"],
  };
  if (!required[key].every(field => healthNumber(metric[field]) !== null)) return false;
  if ((key === "storage" || key === "backups") && metric.available !== true) return false;
  if (key === "requestPerformance" && (metric.enabled !== true || Number(metric.sampleCount) < 20)) return false;
  return true;
}
export function parseHealthResponse(value: unknown): HealthResponse {
  if (!record(value) || !["healthy", "warning", "critical"].includes(String(value.status)) || typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt)) || !Array.isArray(value.issues)) throw new Error("Invalid health snapshot");
  const metrics = record(value.metrics) ? Object.fromEntries(Object.entries(value.metrics).filter(([, metric]) => metric === null || record(metric))) : {};
  const rawChecks = Array.isArray(value.checks) ? value.checks : [];
  const checks: HealthCheck[] = CHECK_KEYS.map(key => {
    const matches = rawChecks.filter(check => record(check) && check.key === key);
    const check = matches.length === 1 ? matches[0] : undefined;
    if (record(check) && states.has(String(check.state)) && typeof check.checkedAt === "string" && Number.isFinite(Date.parse(check.checkedAt))) {
      const contradiction = check.state === "healthy" && !hasHealthyEvidence(key, metrics[key]);
      return { key, state: contradiction ? "unknown" : check.state as HealthState, checkedAt: check.checkedAt, latencyMs: healthNumber(check.latencyMs), code: contradiction ? "CHECK_UNAVAILABLE" : typeof check.code === "string" ? check.code : "CHECK_UNAVAILABLE", href: healthHref(check.href), limitationCodes: Array.isArray(check.limitationCodes) ? check.limitationCodes.filter((code): code is string => typeof code === "string").slice(0, 12) : [] };
    }
    // Older servers have no per-check evidence. Do not infer green from missing data or a zero counter.
    return { key, state: "unknown", checkedAt: value.checkedAt as string, latencyMs: null, code: "CHECK_UNAVAILABLE" };
  });
  const issues = value.issues.filter(record).filter(issue => typeof issue.key === "string" && ["warning", "critical"].includes(String(issue.severity))).slice(0, 100).map(issue => ({
    key: String(issue.key), severity: issue.severity as "warning" | "critical", message: typeof issue.message === "string" ? issue.message.slice(0, 500) : String(issue.key),
    count: healthNumber(issue.count), checkKey: typeof issue.checkKey === "string" ? issue.checkKey : undefined,
    impact: typeof issue.impact === "string" ? issue.impact.slice(0, 500) : undefined,
    nextAction: typeof issue.nextAction === "string" ? issue.nextAction.slice(0, 500) : undefined,
    href: healthHref(issue.href), observedAt: typeof issue.observedAt === "string" ? issue.observedAt : undefined,
  }));
  return { schemaVersion: healthNumber(value.schemaVersion) ?? undefined, status: value.status as HealthResponse["status"], checkedAt: value.checkedAt, latencyMs: healthNumber(value.latencyMs), releaseId: typeof value.releaseId === "string" ? value.releaseId.slice(0, 100) : undefined, coverage: value.coverage === "complete" && checks.every(check => check.state !== "unknown" && check.state !== "disabled") ? "complete" : "partial", freshnessSeconds: Math.min(300, Math.max(30, healthNumber(value.freshnessSeconds) ?? 90)), refreshAfterSeconds: Math.min(300, Math.max(30, healthNumber(value.refreshAfterSeconds) ?? 30)), checks, metrics: metrics as HealthResponse["metrics"], issues };
}
export function healthIsStale(data: HealthResponse, now: number, receivedAt: number, failed: boolean): boolean {
  const age = now - Date.parse(data.checkedAt);
  const maxAge = (data.freshnessSeconds ?? 90) * 1000;
  return failed || !Number.isFinite(age) || age < -60_000 || age > maxAge || now - receivedAt > maxAge || data.checks.some(check => now - Date.parse(check.checkedAt) > maxAge || Date.parse(check.checkedAt) - now > 60_000);
}
export function healthSummary(data: HealthResponse, stale: boolean): DisplayState {
  if (stale) return "stale";
  if (data.status === "critical" || data.checks.some(check => check.state === "critical") || data.issues.some(issue => issue.severity === "critical")) return "critical";
  if (data.status === "warning" || data.checks.some(check => check.state === "warning") || data.issues.length) return "warning";
  return data.coverage === "partial" || data.checks.some(check => check.state === "unknown" || check.state === "disabled") ? "unknown" : "healthy";
}
export type HealthHistory = { checkedAt: string; state: DisplayState; issueCount: number | null; latencyMs: number | null };
export function appendHealthHistory(history: HealthHistory[], entry: HealthHistory): HealthHistory[] {
  if (history.at(-1)?.checkedAt === entry.checkedAt && history.at(-1)?.state === entry.state) return history;
  return [...history, entry].slice(-20);
}
export function healthRefreshEnabled(automatic: boolean, visibility: string): boolean { return automatic && visibility === "visible"; }

/** One read at a time, bounded timeout, no callbacks after disposal. No retries of mutations. */
export function createHealthReader(options: {
  read: (signal: AbortSignal) => Promise<unknown>;
  onStart: () => void; onSuccess: (data: HealthResponse) => void; onFailure: () => void; onFinish: () => void;
  timeoutMs?: number;
}) {
  let disposed = false;
  let active: AbortController | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return {
    async refresh(): Promise<void> {
      if (disposed || active) return;
      const controller = new AbortController();
      active = controller;
      options.onStart();
      try {
        const request = Promise.resolve().then(() => options.read(controller.signal));
        // Retain the single-flight lock until the transport settles, even if a faulty adapter ignores abort.
        void request.then(() => { if (active === controller) active = null; }, () => { if (active === controller) active = null; });
        const deadline = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => { controller.abort(); reject(new Error("Health read timeout")); }, options.timeoutMs ?? 15_000);
        });
        const result = await Promise.race([request, deadline]);
        if (!disposed) {
          if (controller.signal.aborted) options.onFailure();
          else options.onSuccess(parseHealthResponse(result));
        }
      } catch {
        if (!disposed) options.onFailure();
      } finally {
        clearTimeout(timeout);
        if (!disposed) options.onFinish();
      }
    },
    dispose() { disposed = true; clearTimeout(timeout); active?.abort(); },
  };
}
