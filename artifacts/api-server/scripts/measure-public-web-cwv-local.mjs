import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "@playwright/test";
import pg from "pg";

if (process.env.ALLOW_PUBLIC_WEB_LOCAL_BENCHMARK !== "true") {
  throw new Error("ALLOW_PUBLIC_WEB_LOCAL_BENCHMARK=true is required");
}

const databaseUrl = new URL(process.env.DATABASE_URL || "");
const databaseName = databaseUrl.pathname.slice(1);
if (
  !["postgres:", "postgresql:"].includes(databaseUrl.protocol)
  || databaseUrl.hostname !== "127.0.0.1"
  || databaseUrl.port !== "5433"
  || !/^(?:fasos_apply_local|fas_dev_[a-z0-9_]+)$/.test(databaseName)
  || databaseUrl.username !== "fas_migrator"
  || databaseUrl.password
) {
  throw new Error("CWV lab requires fas_migrator on a named disposable loopback database");
}

const port = Number(process.env.PUBLIC_WEB_CWV_PORT || "25204");
if (!Number.isSafeInteger(port) || port < 24_000 || port > 30_000) {
  throw new Error("PUBLIC_WEB_CWV_PORT must be between 24000 and 30000");
}

const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error("No supported system Chromium executable found");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const serverEntry = path.join(packageRoot, "dist", "index.cjs");
const frontendDist = path.join(repoRoot, "artifacts", "edcons", "dist", "public");
if (!existsSync(serverEntry) || !existsSync(frontendDist)) {
  throw new Error("Build artifacts are missing; build API and frontend before the CWV lab");
}

const origin = `http://127.0.0.1:${port}`;
const fixturePool = new pg.Pool({ connectionString: databaseUrl.toString(), max: 1 });
const fixturePrefix = `CWV Lab ${crypto.randomUUID().slice(0, 8)}`;
let fixtureUniversityId = null;
let fixtureProgramId = null;
if (!process.env.PUBLIC_WEB_CWV_PATHS) {
  const fixture = await fixturePool.connect();
  try {
    await fixture.query("BEGIN");
    fixtureUniversityId = (await fixture.query(
      `INSERT INTO universities(name,country,city,is_active,university_type)
       VALUES($1,'United Kingdom','London',true,'Private') RETURNING id`,
      [`${fixturePrefix} University`],
    )).rows[0].id;
    fixtureProgramId = (await fixture.query(
      `INSERT INTO programs(university_id,name,degree,field,language,duration,tuition_fee,currency,is_active)
       VALUES($1,$2,'Bachelor','Business','English','3 Years',12000,'GBP',true) RETURNING id`,
      [fixtureUniversityId, `${fixturePrefix} Programme`],
    )).rows[0].id;
    await fixture.query("COMMIT");
  } catch (error) {
    await fixture.query("ROLLBACK");
    throw error;
  } finally {
    fixture.release();
  }
}
const paths = (process.env.PUBLIC_WEB_CWV_PATHS || [
  "/en",
  "/en/programs",
  `/en/programs/${fixturePrefix.toLowerCase().replaceAll(" ", "-")}-programme-${fixtureProgramId}`,
  `/en/universities/${fixturePrefix.toLowerCase().replaceAll(" ", "-")}-university-${fixtureUniversityId}`,
].join(","))
  .split(",")
  .map((value) => value.trim())
  .filter((value) => /^\/[a-z0-9/_-]+$/i.test(value));
if (paths.length < 1 || paths.length > 12) throw new Error("PUBLIC_WEB_CWV_PATHS must contain 1-12 safe paths");

const child = spawn(process.execPath, [serverEntry], {
  cwd: repoRoot,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    BACKGROUND_JOBS_ENABLED: "false",
    ALLOW_LIVE_INTEGRATIONS: "false",
    SIGNED_CONTRACT_PDF_WORKER_ENABLED: "false",
    SESSION_SECRET: "disposable-local-public-web-cwv-only-20260928",
    FRONTEND_DIST_PATH: frontendDist,
    PUBLIC_SITE_URL: "https://findandstudy.com",
    PUBLIC_WEB_RENDER_MODE: "all",
    PUBLIC_WEB_SITEMAP_MODE: "static",
  },
});

let serverLog = "";
const collect = (chunk) => { serverLog = `${serverLog}${String(chunk)}`.slice(-16_384); };
child.stdout.on("data", collect);
child.stderr.on("data", collect);

async function waitUntilReady() {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited before ready: ${serverLog}`);
    try {
      const response = await fetch(`${origin}/api/health`, { redirect: "manual" });
      if (response.ok) return;
    } catch {
      // bounded readiness retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server readiness timeout: ${serverLog}`);
}

function percentile(values, ratio) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)] || 0;
}

let browser;
try {
  await waitUntilReady();
  browser = await chromium.launch({ executablePath, headless: true, args: ["--lang=en-US"] });
  const measurements = [];
  for (const pathname of paths) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "en-US",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1_600 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      connectionType: "cellular4g",
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      window.__cwvLab = { lcp: 0, lcpElement: null, lcpUrl: null, cls: 0, longTasks: [] };
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const latest = entries[entries.length - 1];
        if (latest) {
          window.__cwvLab.lcp = latest.startTime;
          window.__cwvLab.lcpElement = latest.element?.tagName || null;
          window.__cwvLab.lcpUrl = latest.url || null;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__cwvLab.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__cwvLab.longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    });

    const response = await page.goto(`${origin}${pathname}`, { waitUntil: "networkidle", timeout: 45_000 });
    if (!response?.ok()) throw new Error(`${pathname} returned ${response?.status() ?? "no response"}`);
    await page.waitForTimeout(1_000);
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const state = window.__cwvLab;
      const tbt = state.longTasks.reduce((total, duration) => total + Math.max(0, duration - 50), 0);
      return {
        lcpMs: state.lcp,
        lcpElement: state.lcpElement,
        lcpUrl: state.lcpUrl,
        cls: state.cls,
        tbtMs: tbt,
        ttfbMs: navigation?.responseStart || 0,
        domContentLoadedMs: navigation?.domContentLoadedEventEnd || 0,
        slowResources: performance.getEntriesByType("resource")
          .map((entry) => ({ name: entry.name.replace(location.origin, ""), durationMs: entry.duration }))
          .sort((left, right) => right.durationMs - left.durationMs)
          .slice(0, 5),
      };
    });
    measurements.push({
      path: pathname,
      lcpMs: Number(metrics.lcpMs.toFixed(1)),
      lcpElement: metrics.lcpElement,
      lcpUrl: metrics.lcpUrl,
      cls: Number(metrics.cls.toFixed(4)),
      tbtMs: Number(metrics.tbtMs.toFixed(1)),
      ttfbMs: Number(metrics.ttfbMs.toFixed(1)),
      domContentLoadedMs: Number(metrics.domContentLoadedMs.toFixed(1)),
      slowResources: metrics.slowResources.map((resource) => ({
        name: resource.name,
        durationMs: Number(resource.durationMs.toFixed(1)),
      })),
    });
    await context.close();
  }

  const result = {
    schemaVersion: 1,
    kind: "LOCAL_LAB_NOT_FIELD_DATA",
    profile: "mobile-390-fast4g-4xCPU",
    thresholds: { lcpMs: 2500, cls: 0.1, tbtMs: 200 },
    pages: measurements,
    p95: {
      lcpMs: Number(percentile(measurements.map((item) => item.lcpMs), 0.95).toFixed(1)),
      cls: Number(percentile(measurements.map((item) => item.cls), 0.95).toFixed(4)),
      tbtMs: Number(percentile(measurements.map((item) => item.tbtMs), 0.95).toFixed(1)),
    },
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (measurements.some((item) => item.lcpMs <= 0) || result.p95.lcpMs > result.thresholds.lcpMs || result.p95.cls > result.thresholds.cls || result.p95.tbtMs > result.thresholds.tbtMs) {
    throw new Error(`local CWV lab threshold failed: ${JSON.stringify(result.p95)}`);
  }
} finally {
  await browser?.close().catch(() => undefined);
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  try {
    if (fixtureUniversityId !== null) {
      await fixturePool.query("DELETE FROM universities WHERE id=$1 AND name=$2", [fixtureUniversityId, `${fixturePrefix} University`]);
    }
  } finally {
    await fixturePool.end();
  }
}
