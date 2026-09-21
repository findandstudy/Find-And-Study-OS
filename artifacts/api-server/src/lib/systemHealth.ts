import { SystemHealthReadError, withinHealthDeadline } from "./systemHealthReadStore";

export type HealthCheckKey = "database" | "apiTokens" | "aiRuns24h" | "webhook24h" | "portalSubmissions" | "portalWorkers" | "messaging24h" | "storage" | "backups" | "requestPerformance";
export type HealthState = "healthy" | "warning" | "critical" | "unknown" | "disabled";
export type HealthIssue = {
  key: string;
  checkKey: HealthCheckKey;
  severity: "warning" | "critical";
  message: string;
  count: number | null;
  impact: string;
  nextAction: string;
  href?: string;
  observedAt: string;
};
export type HealthCheck = {
  key: HealthCheckKey;
  state: HealthState;
  checkedAt: string;
  latencyMs: number;
  code: string;
  source: string;
  summary: string;
  limitations: string[];
  limitationCodes: string[];
  href?: string;
};
type Aggregate = Record<string, unknown>;
type PerformanceMetrics = {
  enabled: boolean;
  scope: string;
  sampleCount: number;
  p95Ms: number | null;
  p99Ms: number | null;
  errorRatePercent: number | null;
  [key: string]: unknown;
};
export type HealthDependencies = {
  query: (sql: string) => Promise<Aggregate>;
  storage: () => Promise<Aggregate>;
  backups: () => Promise<Aggregate>;
  pool: () => { totalConnections: number; idleConnections: number; waitingRequests: number; maxConnections: number };
  performance: () => PerformanceMetrics;
  runtime: { backgroundJobsEnabled: boolean; liveIntegrationsAllowed: boolean };
  releaseId: string;
  now?: () => number;
};

const targets: Record<HealthCheckKey, string | undefined> = {
  database: undefined,
  apiTokens: "/admin/api-tokens",
  aiRuns24h: "/admin/ai-personas",
  webhook24h: "/admin/audit",
  portalSubmissions: "/admin/portal-automation",
  portalWorkers: "/admin/portal-automation",
  messaging24h: "/staff/messages",
  storage: undefined,
  backups: undefined,
  requestPerformance: undefined,
};

export const HEALTH_QUERIES = Object.freeze({
  database: "SELECT 1 AS connected",
  apiTokens: `SELECT
    count(*) FILTER (WHERE revoked_at IS NULL AND expires_at IS NULL)::int AS no_expiry,
    count(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= now())::int AS expired,
    count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now() AND expires_at <= now() + interval '7 days')::int AS expiring_soon
    FROM api_tokens`,
  aiRuns24h: `SELECT count(*) FILTER (WHERE status = 'error')::int AS failed,
    count(*) FILTER (WHERE status = 'rate_limited')::int AS rate_limited
    FROM ai_persona_runs WHERE created_at >= now() - interval '24 hours'`,
  webhook24h: `SELECT count(*)::int AS auth_failures,
    count(*) FILTER (WHERE resource LIKE '%:verify')::int AS verification_probes,
    count(*) FILTER (WHERE resource NOT LIKE '%:verify' OR resource IS NULL)::int AS delivery_failures
    FROM audit_logs WHERE action = 'webhook_auth_failed' AND created_at >= now() - interval '24 hours'`,
  portalSubmissions: `SELECT
    count(*) FILTER (WHERE status = 'queued')::int AS queued,
    count(*) FILTER (WHERE status = 'running')::int AS running,
    count(*) FILTER (WHERE status = 'running' AND (locked_at IS NULL OR locked_at < now() - interval '20 minutes'))::int AS stale_running,
    count(*) FILTER (WHERE status = 'failed' AND updated_at >= now() - interval '24 hours')::int AS failed_24h,
    greatest(0, extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'queued')))::float8 AS oldest_queued_age_seconds
    FROM portal_submissions WHERE deleted_at IS NULL`,
  messaging24h: `SELECT
    count(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
    count(*) FILTER (WHERE direction = 'outbound')::int AS outbound,
    count(*) FILTER (WHERE direction = 'outbound' AND status = 'failed')::int AS failed,
    count(*) FILTER (WHERE direction = 'outbound' AND status IN ('delivered', 'read'))::int AS delivered,
    max(created_at) FILTER (WHERE direction = 'inbound') AS last_inbound_at,
    max(created_at) FILTER (WHERE direction = 'outbound') AS last_outbound_at
    FROM messages WHERE created_at >= now() - interval '24 hours' AND channel IN ('whatsapp', 'instagram', 'facebook')`,
  portalWorkers: `SELECT count(*)::int AS registered,
    count(*) FILTER (WHERE updated_at BETWEEN now() - interval '60 seconds' AND now())::int AS recent,
    count(*) FILTER (WHERE updated_at < now() - interval '60 seconds')::int AS stale,
    count(*) FILTER (WHERE updated_at > now())::int AS future,
    max(updated_at) FILTER (WHERE updated_at <= now()) AS last_observed_at,
    count(*) FILTER (WHERE updated_at BETWEEN now() - interval '60 seconds' AND now() AND 'real' = ANY(execution_modes))::int AS real,
    count(*) FILTER (WHERE updated_at BETWEEN now() - interval '60 seconds' AND now() AND 'dry' = ANY(execution_modes))::int AS dry,
    count(*) FILTER (WHERE updated_at BETWEEN now() - interval '60 seconds' AND now() AND 'status_check' = ANY(execution_modes))::int AS status_check,
    count(*) FILTER (WHERE updated_at BETWEEN now() - interval '60 seconds' AND now() AND 'lifecycle_execute' = ANY(execution_modes))::int AS lifecycle_execute
    FROM portal_worker_heartbeats WHERE worker_kind = 'portal_execution'`,
});

const definitions: Record<HealthCheckKey, { source: string; limitations: string[]; limitationCodes: string[] }> = {
  database: { source: "Read-only database probe and this API process connection pool", limitations: ["Point-in-time pool pressure, not a database capacity certification."], limitationCodes: ["snapshot_only"] },
  apiTokens: { source: "API token expiry metadata", limitations: ["Does not verify external provider credentials or their scopes."], limitationCodes: ["token_metadata_only"] },
  aiRuns24h: { source: "Stored AI run outcomes in the last 24 hours", limitations: ["No new AI run or external call is executed."], limitationCodes: ["read_only_no_execution"] },
  webhook24h: { source: "Rejected webhook authentication audit events in the last 24 hours", limitations: ["Not all delivery failures. Does not prove that absent events reached this server."], limitationCodes: ["not_end_to_end_delivery"] },
  portalSubmissions: { source: "Stored portal submission queue, leases and queue age", limitations: ["Queue state is not a worker heartbeat. Separate worker runtime settings may differ."], limitationCodes: ["no_worker_heartbeat"] },
  portalWorkers: { source: "Stored portal execution worker heartbeats; freshness threshold 60 seconds", limitations: ["An old heartbeat can be caused by long-running work and does not prove a dead worker.", "Reported modes do not prove matching release, current partner approvals or readiness to execute."], limitationCodes: ["worker_heartbeat_only", "worker_modes_not_readiness"] },
  messaging24h: { source: "WhatsApp, Instagram and Facebook message statuses recorded in the last 24 hours", limitations: ["Delivery depends on recorded provider receipts; this does not send a test message or prove end-to-end availability."], limitationCodes: ["provider_receipts_only", "not_end_to_end_delivery"] },
  storage: { source: "Filesystem containing this API process working directory", limitations: ["Other database, private-storage and backup volumes are not measured."], limitationCodes: ["filesystem_only"] },
  backups: { source: "Bounded local backup file metadata scan", limitations: ["File presence does not prove a successful restore.", "Offsite copies and recovery time are not verified."], limitationCodes: ["no_restore_proof", "no_offsite_proof"] },
  requestPerformance: { source: "Bounded request telemetry window in this API process", limitations: ["Not a cluster-wide or browser Core Web Vitals measurement.", "Restart resets the window; bounded samples may not cover every request."], limitationCodes: ["performance_process_only", "performance_sampled"] },
};

function numeric(value: unknown): number {
  if (value == null || value === "" || typeof value === "boolean") throw new SystemHealthReadError("CHECK_UNAVAILABLE");
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new SystemHealthReadError("CHECK_UNAVAILABLE");
  return result;
}
function nullableTime(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new SystemHealthReadError("CHECK_UNAVAILABLE");
  return date.toISOString();
}
function selectCounts(row: Aggregate, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, numeric(row[key])]));
}

export async function collectSystemHealth(deps: HealthDependencies) {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  // Capture before health queries add their own demand to the shared pool.
  const poolSnapshot = deps.pool();
  const metrics: Partial<Record<HealthCheckKey, Aggregate | null>> = {};
  const checks: HealthCheck[] = [];
  const issues: HealthIssue[] = [];
  const add = (checkKey: HealthCheckKey, key: string, severity: HealthIssue["severity"], message: string, count: number | null, impact: string, nextAction: string) => {
    issues.push({ key, checkKey, severity, message, count, impact, nextAction, href: targets[checkKey], observedAt: new Date(now()).toISOString() });
  };
  const inspect = async (key: HealthCheckKey, read: () => Promise<Aggregate>, project: (row: Aggregate) => Aggregate, evaluate: (row: Aggregate) => void) => {
    const start = now();
    let code = "OK";
    let state: HealthState = "healthy";
    try {
      const data = project(await read());
      metrics[key] = data;
      evaluate(data);
      const own = issues.filter((issue) => issue.checkKey === key);
      state = own.some((issue) => issue.severity === "critical") ? "critical" : own.length ? "warning" : "healthy";
      if (state !== "healthy") code = "ATTENTION_REQUIRED";
    } catch (error) {
      metrics[key] = null;
      state = "unknown";
      code = error instanceof SystemHealthReadError ? error.code : "CHECK_UNAVAILABLE";
      add(key, `${key}.unavailable`, "warning", "This check could not be completed; absence of a result is not a healthy result", null,
        "Current health of this component is unknown.", "Recheck once. If it persists, inspect the component's access, timeout and configuration without enabling integrations or restarting services.");
    }
    checks.push({ key, state, code, checkedAt: new Date(now()).toISOString(), latencyMs: Math.max(0, now() - start),
      ...definitions[key], summary: state === "unknown" ? "Health could not be verified" : state === "healthy" ? "No issue found within this check's coverage" : "Observed issues need review", href: targets[key] });
  };
  const sqlChecks: Array<() => Promise<void>> = [
    () => inspect("database", () => deps.query(HEALTH_QUERIES.database), (row) => {
      if (Number(row.connected) !== 1) throw new SystemHealthReadError("CHECK_UNAVAILABLE");
      return { ...selectCounts(poolSnapshot, ["totalConnections", "idleConnections", "waitingRequests", "maxConnections"]), probeMs: Math.max(0, now() - startedAt) };
    }, (row) => {
      if (Number(row.waitingRequests) > 0) add("database", "database.pool_waiting", "warning", "Application requests are waiting for database connections", Number(row.waitingRequests), "Requests may be delayed before their queries start.", "Review request latency and long-running queries. Confirm pressure across repeated samples before changing capacity.");
    }),
    () => inspect("apiTokens", () => deps.query(HEALTH_QUERIES.apiTokens), (row) => selectCounts(row, ["no_expiry", "expired", "expiring_soon"]), (row) => {
      if (Number(row.no_expiry)) add("apiTokens", "tokens.no_expiry", "critical", "Active API tokens have no expiry", Number(row.no_expiry), "Unbounded token lifetime increases exposure.", "Review the token owner and consuming integration, then plan a controlled rotation; do not revoke blindly.");
      if (Number(row.expired)) add("apiTokens", "tokens.expired", "warning", "Expired, unrevoked API token records require review", Number(row.expired), "An integration still configured with these tokens may be unable to authenticate.", "Identify consumers and rotate through the existing token management workflow.");
      if (Number(row.expiring_soon)) add("apiTokens", "tokens.expiring_soon", "warning", "API tokens expire within seven days", Number(row.expiring_soon), "Integrations may stop when a token expires.", "Schedule and verify token rotation before expiry.");
    }),
    () => inspect("aiRuns24h", () => deps.query(HEALTH_QUERIES.aiRuns24h), (row) => selectCounts(row, ["failed", "rate_limited"]), (row) => {
      if (Number(row.failed)) add("aiRuns24h", "ai.failed", "warning", "AI runs failed in the last 24 hours", Number(row.failed), "Some assisted tasks may not have completed.", "Review failed runs and provider configuration; do not replay actions that may have external effects.");
      if (Number(row.rate_limited)) add("aiRuns24h", "ai.rate_limited", "warning", "AI runs were rate limited", Number(row.rate_limited), "Automated assistance may be delayed.", "Review provider quota and scheduling before a bounded retry.");
    }),
    () => inspect("webhook24h", () => deps.query(HEALTH_QUERIES.webhook24h), (row) => ({ ...selectCounts(row, ["auth_failures", "verification_probes", "delivery_failures"]), by_resource: {} }), (row) => {
      if (Number(row.delivery_failures)) add("webhook24h", "webhooks.delivery_auth_failed", "critical", "Incoming webhook events failed authentication", Number(row.delivery_failures), "Rejected events were not accepted; failed authentication alone does not prove a legitimate provider outage.", "Compare provider webhook configuration and signing-secret references. Never disable signature verification to clear this alert.");
      if (Number(row.verification_probes) >= 100) add("webhook24h", "webhooks.verification_probes", "warning", "High volume of rejected webhook verification probes", Number(row.verification_probes), "This may be invalid configuration or unsolicited probes.", "Review aggregate audit evidence and provider configuration without exposing webhook payloads.");
    }),
    () => inspect("portalSubmissions", () => deps.query(HEALTH_QUERIES.portalSubmissions), (row) => ({ ...selectCounts(row, ["queued", "running", "stale_running", "failed_24h"]), oldest_queued_age_seconds: Number(row.queued) === 0 ? null : numeric(row.oldest_queued_age_seconds) }), (row) => {
      if (Number(row.stale_running)) add("portalSubmissions", "portal.stale_running", "critical", "Portal jobs have missing or stale execution leases", Number(row.stale_running), "Their outcome is uncertain; replay could create duplicate applications.", "Inspect the job and its provider receipt in Portal Automation. Reconcile the outcome before any retry; do not unlock or resubmit blindly.");
      if (Number(row.failed_24h)) add("portalSubmissions", "portal.failed", "warning", "Portal submissions failed in the last 24 hours", Number(row.failed_24h), "Some applications may need manual review.", "Open Portal Automation and review failure categories and evidence before retrying.");
      if (Number(row.oldest_queued_age_seconds) > 1_800) add("portalSubmissions", "portal.queue_age", "warning", "The oldest queued portal job has waited over 30 minutes", Number(row.queued), "Pending submissions are delayed; a queue does not establish whether a worker is running.", "Check the intended worker/automation mode and partner readiness. A deliberately paused environment must not be enabled automatically.");
    }),
    () => inspect("messaging24h", () => deps.query(HEALTH_QUERIES.messaging24h), (row) => ({ ...selectCounts(row, ["inbound", "outbound", "failed", "delivered"]), last_inbound_at: nullableTime(row.last_inbound_at), last_outbound_at: nullableTime(row.last_outbound_at) }), (row) => {
      if (Number(row.failed)) add("messaging24h", "messaging.failed", "warning", "Outbound messages have recorded failure statuses", Number(row.failed), "Some messages may not have reached their recipients.", "Inspect the relevant conversations and provider delivery status. Confirm consent and receipt state before sending again.");
    }),
    () => inspect("portalWorkers", () => deps.query(HEALTH_QUERIES.portalWorkers), (row) => ({ ...selectCounts(row, ["registered", "recent", "stale", "future", "real", "dry", "status_check", "lifecycle_execute"]), last_observed_at: nullableTime(row.last_observed_at) }), (row) => {
      if (Number(row.registered) > 0 && Number(row.recent) === 0 && Number(row.stale) > 0) add("portalWorkers", "portalWorkers.stale", "warning", "No recent portal execution worker heartbeat was observed", Number(row.stale), "Worker availability is not currently confirmed; long-running jobs may delay heartbeat updates.", "Inspect the intended worker deployment, active jobs and release compatibility. Do not restart workers or replay submissions automatically.");
      if (Number(row.future) > 0) add("portalWorkers", "portalWorkers.future", "warning", "Portal worker heartbeat timestamps are in the future", Number(row.future), "Clock skew prevents reliable freshness assessment.", "Compare host and database clocks. Future timestamps must not be treated as healthy worker evidence.");
    }),
  ];
  // At most two read-only DB leases per API process snapshot, even under many refreshes.
  let next = 0;
  const runQueries = async () => { while (next < sqlChecks.length) await sqlChecks[next++](); };
  await Promise.all([
    runQueries(), runQueries(),
    inspect("storage", () => withinHealthDeadline(deps.storage), (row) => ({ available: true, ...selectCounts(row, ["totalBytes", "freeBytes", "freePercent"]) }), (row) => {
      if (Number(row.freePercent) < 20) add("storage", "storage.disk_free", Number(row.freePercent) < 10 ? "critical" : "warning", "The application filesystem is running low on free space", 1, "Writes or releases on this filesystem may fail.", "Ask the operator to identify growth and retention safely. Do not delete uploaded documents, backups or releases from this screen.");
    }),
    inspect("backups", () => withinHealthDeadline(deps.backups), (row) => ({ available: true, count: numeric(row.count), latestAt: nullableTime(row.latestAt), latestSizeBytes: row.latestSizeBytes == null ? null : numeric(row.latestSizeBytes), latestAgeHours: row.latestAgeHours == null ? null : numeric(row.latestAgeHours) }), (row) => {
      if (Number(row.count) === 0) add("backups", "backups.empty", "critical", "No backup files were found in the inspected local directory", 1, "No local backup evidence is visible here; other backup systems are not inspected.", "Check backup scheduling and the configured directory. Verify checksum and an isolated restore before claiming recoverability.");
      else if (Number(row.latestAgeHours) > 48) add("backups", "backups.stale", Number(row.latestAgeHours) > 168 ? "critical" : "warning", "The latest local backup file is old", 1, "Recent data may not be covered by the visible backup.", "Review the backup job and recovery-point requirement, then validate an isolated restore and offsite copy.");
      if (Number(row.count) > 0 && row.latestSizeBytes === 0) add("backups", "backups.empty_file", "critical", "The latest local backup file is empty", 1, "An empty file cannot be used as backup evidence.", "Review the backup job outcome; preserve older copies and validate a new backup before any release.");
    }),
  ]);

  const workerCheck = checks.find((check) => check.key === "portalWorkers");
  const workers = metrics.portalWorkers;
  if (workerCheck && workers) {
    if (workers.registered === 0) {
      workerCheck.state = "unknown";
      workerCheck.code = "NO_WORKER_OBSERVATIONS";
      workerCheck.summary = "No worker heartbeat evidence is registered; worker enablement is unknown";
    } else if (Number(workers.future) > 0) workerCheck.code = "FUTURE_WORKER_OBSERVATIONS";
    else if (workers.recent === 0) workerCheck.code = "STALE_WORKER_OBSERVATIONS";
  }

  let performanceState: HealthState = "unknown";
  let performanceCode = "CHECK_UNAVAILABLE";
  try {
    const performance = deps.performance();
    metrics.requestPerformance = performance;
    performanceState = performance.enabled ? (performance.sampleCount >= 20 ? "healthy" : "unknown") : "disabled";
    performanceCode = !performance.enabled ? "TELEMETRY_DISABLED" : performance.sampleCount === 0 ? "NO_SAMPLES" : performance.sampleCount < 20 ? "INSUFFICIENT_SAMPLES" : "OK";
    if (performance.enabled && performance.sampleCount >= 20 && ((performance.errorRatePercent ?? 0) >= 5 || (performance.p95Ms ?? 0) > 2_000)) {
      performanceState = "warning";
      performanceCode = "ATTENTION_REQUIRED";
      add("requestPerformance", "performance.degraded", "warning", "Observed API latency or server error rate needs attention", performance.sampleCount, "Users may encounter slow responses or failed requests in this process.", "Compare repeated samples, database wait and recent releases; this limited observation is not a load-test result.");
    }
  } catch {
    metrics.requestPerformance = null;
    add("requestPerformance", "requestPerformance.unavailable", "warning", "Request telemetry could not be read", null, "Request performance is unknown.", "Recheck the read-only telemetry snapshot; do not change runtime settings automatically.");
  }
  checks.push({ key: "requestPerformance", state: performanceState, code: performanceCode, checkedAt: new Date(now()).toISOString(), latencyMs: 0,
    ...definitions.requestPerformance, summary: performanceState === "disabled" ? "Request performance telemetry is disabled by configuration" : "Process-local request telemetry" });
  const order: HealthCheckKey[] = ["database", "requestPerformance", "apiTokens", "aiRuns24h", "webhook24h", "messaging24h", "portalSubmissions", "portalWorkers", "storage", "backups"];
  checks.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  issues.sort((a, b) => (a.severity === b.severity ? a.key.localeCompare(b.key) : a.severity === "critical" ? -1 : 1));
  return {
    schemaVersion: 2,
    status: issues.some((issue) => issue.severity === "critical") ? "critical" : issues.length ? "warning" : "healthy",
    coverage: checks.some((check) => check.state === "unknown" || check.state === "disabled") ? "partial" : "complete",
    checkedAt: new Date(now()).toISOString(),
    latencyMs: Math.max(0, now() - startedAt),
    releaseId: deps.releaseId,
    refreshAfterSeconds: 30,
    freshnessSeconds: 90,
    runtime: deps.runtime,
    // Explicit non-claims: these capabilities require separately verified operational wiring.
    coverageGaps: ["external_uptime", "non_portal_worker_heartbeats", "frontend_errors", "backup_restore", "backup_offsite", "durable_incidents", "external_alert_delivery"],
    metrics,
    checks,
    issues,
  };
}

/** Short-lived aggregate snapshot, shared only behind the unchanged admin role gate.
 * The original checkedAt is retained; repeated clicks cannot masquerade as new probes. */
export function createSystemHealthReader(read: () => Promise<Awaited<ReturnType<typeof collectSystemHealth>>>, now = Date.now) {
  let completed: Awaited<ReturnType<typeof collectSystemHealth>> | undefined;
  let finishedAt = 0;
  let inFlight: Promise<Awaited<ReturnType<typeof collectSystemHealth>>> | undefined;
  return async () => {
    if (completed && now() - finishedAt < 30_000) return completed;
    if (!inFlight) {
      inFlight = read().then((result) => { completed = result; finishedAt = now(); return result; }).finally(() => { inFlight = undefined; });
    }
    return inFlight;
  };
}
