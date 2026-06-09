import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { readFileSync } from "fs";
import { resolve } from "path";

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
  res.json({ status: "ok" });
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
  });
});

export default router;
