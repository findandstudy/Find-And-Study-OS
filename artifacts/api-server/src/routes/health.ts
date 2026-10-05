import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { readFileSync } from "fs";
import { resolve } from "path";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import { backgroundJobsEnabled } from "../lib/backgroundJobs";
import { collectSystemHealth, createSystemHealthReader } from "../lib/systemHealth";
import { readHealthAggregate, readSystemHealthBackups, readSystemHealthStorage, coalesceHealthFileRead } from "../lib/systemHealthReadStore";
import { getSystemHealthPerformanceSnapshot } from "../lib/systemHealthPerformance";

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

const readStorage = coalesceHealthFileRead(readSystemHealthStorage);
const readBackups = coalesceHealthFileRead(readSystemHealthBackups);
const readOperationalHealth = createSystemHealthReader(() => collectSystemHealth({
  query: (sql) => readHealthAggregate(pool, sql),
  storage: readStorage,
  backups: readBackups,
  performance: getSystemHealthPerformanceSnapshot,
  pool: () => ({
    totalConnections: pool.totalCount,
    idleConnections: pool.idleCount,
    waitingRequests: pool.waitingCount,
    maxConnections: pool.options.max ?? 20,
  }),
  runtime: {
    backgroundJobsEnabled: backgroundJobsEnabled(),
    liveIntegrationsAllowed: process.env.ALLOW_LIVE_INTEGRATIONS === "true",
  },
  releaseId: process.env.RELEASE_ID || "unknown",
}));

// Read-only admin projection. No token values, payloads, private paths, raw errors,
// resource identifiers or student/message content are returned. No repair runs here.
router.get(
  "/admin/system-health",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (_req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      res.json(await readOperationalHealth());
    } catch {
      // Component errors are isolated by the collector. This unexpected failure
      // boundary also avoids raw errors that may contain connection information.
      console.error("[system-health] aggregate collection failed");
      res.status(503).json({
        schemaVersion: 2,
        status: "warning",
        coverage: "partial",
        checkedAt: new Date().toISOString(),
        checks: [],
        metrics: {},
        issues: [{ key: "health.query_failed", severity: "warning", message: "Operational health could not be verified", count: null }],
      });
    }
  },
);

export default router;
