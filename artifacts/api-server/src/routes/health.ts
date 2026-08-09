import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { readFileSync } from "fs";
import { resolve } from "path";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";

const router: IRouter = Router();

let cachedVersion: string | undefined;
function getVersion(): string {
  if (!cachedVersion) {
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf-8")
      );
      cachedVersion = pkg.version ?? "0.0.0";
    } catch {
      cachedVersion = "0.0.0";
    }
  }
  return cachedVersion!;
}

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok", releaseId: process.env.RELEASE_ID || "unknown" });
});

// Deployment healthchecks probe GET /api directly. Keep this endpoint
// DB-independent so a slow database connection at boot doesn't make the
// platform kill an otherwise healthy instance (DB health is on /health).
router.get("/", (_req, res) => {
  res.json({ status: "ok", uptime: Math.floor(process.uptime()) });
});

router.get("/health", async (_req, res) => {
  let dbConnected = false;
  try {
    await pool.query("SELECT 1");
    dbConnected = true;
  } catch {
    dbConnected = false;
  }

  const status = dbConnected ? "ok" : "degraded";

  res.status(dbConnected ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    dbConnected,
    version: getVersion(),
    releaseId: process.env.RELEASE_ID || "unknown",
  });
});

type HealthIssue = {
  key: string;
  severity: "warning" | "critical";
  message: string;
  count: number;
};

// Operational health is intentionally separate from the public liveness probes.
// It is read-only, admin-scoped and never returns credentials, payloads, prompts,
// webhook bodies or student data.
router.get(
  "/admin/system-health",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    const startedAt = Date.now();
    try {
      const [tokenResult, aiResult, webhookResult, portalResult] = await Promise.all([
        pool.query(`
          SELECT
            count(*) FILTER (WHERE revoked_at IS NULL AND expires_at IS NULL)::int AS no_expiry,
            count(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= now())::int AS expired,
            count(*) FILTER (
              WHERE revoked_at IS NULL AND expires_at > now()
                AND expires_at <= now() + interval '7 days'
            )::int AS expiring_soon
          FROM api_tokens
        `),
        pool.query(`
          SELECT
            count(*) FILTER (WHERE status = 'error')::int AS failed,
            count(*) FILTER (WHERE status = 'rate_limited')::int AS rate_limited
          FROM ai_persona_runs
          WHERE created_at >= now() - interval '24 hours'
        `),
        pool.query(`
          SELECT count(*)::int AS auth_failures
          FROM audit_logs
          WHERE action = 'webhook_auth_failed'
            AND created_at >= now() - interval '24 hours'
        `),
        pool.query(`
          SELECT
            count(*) FILTER (WHERE status = 'queued')::int AS queued,
            count(*) FILTER (WHERE status = 'running')::int AS running,
            count(*) FILTER (
              WHERE status = 'running' AND locked_at < now() - interval '20 minutes'
            )::int AS stale_running,
            count(*) FILTER (
              WHERE status = 'failed' AND updated_at >= now() - interval '24 hours'
            )::int AS failed_24h
          FROM portal_submissions
          WHERE deleted_at IS NULL
        `),
      ]);

      const tokens = tokenResult.rows[0] ?? {};
      const ai = aiResult.rows[0] ?? {};
      const webhooks = webhookResult.rows[0] ?? {};
      const portal = portalResult.rows[0] ?? {};
      const issues: HealthIssue[] = [];
      const addIssue = (key: string, severity: HealthIssue["severity"], message: string, value: unknown) => {
        const count = Number(value ?? 0);
        if (count > 0) issues.push({ key, severity, message, count });
      };

      addIssue("tokens.no_expiry", "critical", "Active API tokens without an expiry must be rotated", tokens.no_expiry);
      addIssue("tokens.expired", "critical", "Expired API tokens should be revoked", tokens.expired);
      addIssue("tokens.expiring_soon", "warning", "API tokens expire within seven days", tokens.expiring_soon);
      addIssue("ai.failed", "warning", "AI runs failed during the last 24 hours", ai.failed);
      addIssue("ai.rate_limited", "warning", "AI runs were rate limited during the last 24 hours", ai.rate_limited);
      addIssue("webhooks.auth_failed", "critical", "Webhook authentication failures occurred during the last 24 hours", webhooks.auth_failures);
      addIssue("portal.stale_running", "critical", "Portal submissions appear stuck in running state", portal.stale_running);
      addIssue("portal.failed", "warning", "Portal submissions failed during the last 24 hours", portal.failed_24h);

      const status = issues.some((issue) => issue.severity === "critical")
        ? "critical"
        : issues.length > 0
          ? "warning"
          : "healthy";

      res.json({
        status,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        releaseId: process.env.RELEASE_ID || "unknown",
        metrics: {
          apiTokens: tokens,
          aiRuns24h: ai,
          webhook24h: webhooks,
          portalSubmissions: portal,
        },
        issues,
      });
    } catch (error) {
      console.error("[system-health] read-only health query failed", error);
      res.status(503).json({
        status: "critical",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        issues: [{
          key: "health.query_failed",
          severity: "critical",
          message: "Operational health data could not be read",
          count: 1,
        }],
      });
    }
  },
);

export default router;
