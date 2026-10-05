// Built-app regression with synthetic API fixtures only. Never contacts staging,
// production, real users, providers, or a database.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { chromium } = requireApi("playwright-core");
const root = fileURLToPath(new URL("../dist/public/", import.meta.url));
const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const target = path.resolve(root, path.extname(pathname) ? pathname.slice(1) : "index.html");
    if (!target.startsWith(path.resolve(root) + path.sep)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", mime[path.extname(target)] || "text/html");
    res.end(await readFile(target));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chrome" }) });

function fixture() {
  const checkedAt = new Date().toISOString();
  const keys = ["database", "apiTokens", "aiRuns24h", "webhook24h", "portalSubmissions", "portalWorkers", "messaging24h", "storage", "backups", "requestPerformance"];
  return {
    schemaVersion: 2, status: "healthy", checkedAt, releaseId: "synthetic-health-test", latencyMs: 42,
    coverage: "complete", freshnessSeconds: 90, refreshAfterSeconds: 30,
    checks: keys.map(key => ({ key, state: "healthy", checkedAt, latencyMs: 5, code: "OK", limitationCodes: [] })),
    metrics: {
      database: { connected: true, probeMs: 5, totalConnections: 4, idleConnections: 3, waitingRequests: 0, maxConnections: 20 },
      apiTokens: { no_expiry: 0, expired: 0, expiring_soon: 0 },
      aiRuns24h: { failed: 0, rate_limited: 0 }, webhook24h: { auth_failures: 0, verification_probes: 0, delivery_failures: 0 },
      portalSubmissions: { queued: 0, running: 0, stale_running: 0, failed_24h: 0, oldest_queued_age_seconds: null },
      portalWorkers: { registered: 1, recent: 1, stale: 0, future: 0, last_observed_at: checkedAt, real: 0, dry: 1, status_check: 0, lifecycle_execute: 0 },
      messaging24h: { inbound: 10, outbound: 10, failed: 0, delivered: 9 },
      storage: { available: true, freePercent: 40, freeBytes: 40_000_000_000, totalBytes: 100_000_000_000 },
      backups: { available: true, count: 3, latestAt: checkedAt, latestSizeBytes: 10000, latestAgeHours: 1 },
      requestPerformance: { enabled: true, scope: "process", sampleCount: 100, windowSeconds: 300, capacity: 4096, windowTruncated: false, p95Ms: 210, p99Ms: 320, dbAcquireP95Ms: 5, dbSampleCount: 80, errorRatePercent: 0, observedSince: checkedAt },
    }, issues: [],
  };
}

try {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [locale, width] of [["en", 1440], ["tr", 390], ["ar", 390]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    const unmocked = [];
    let responseStatus = 200;
    let snapshot = fixture();
    let healthRequests = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(lang => localStorage.setItem("edcons_lang", lang), locale);
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) {
        // The existing global shell requests a Google Fonts stylesheet. Block it
        // too; allow only this known attempted origin, never an actual request.
        if (url.origin !== "https://fonts.googleapis.com") unmocked.push(url.origin);
        await route.abort(); return;
      }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
      let body = {};
      let status = 200;
      if (url.pathname === "/api/admin/system-health") {
        healthRequests++;
        assert.equal(route.request().method(), "GET");
        body = snapshot; status = responseStatus;
      } else if (url.pathname === "/api/auth/me") {
        body = { id: 987654, firstName: "Synthetic", lastName: "Admin", role: "super_admin", language: locale, isActive: true, emailVerified: true, permissions: [], createdAt: "2026-01-01T00:00:00Z" };
      } else if (url.pathname === "/api/conversations") body = { data: [] };
      else if (url.pathname === "/api/settings/available-years") body = { years: [2026] };
      else if (url.pathname.includes("popup") || url.pathname.includes("notifications")) body = [];
      if (url.pathname.endsWith("/events")) { await route.fulfill({ status: 200, contentType: "text/event-stream", body: ": synthetic\n\n" }); return; }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/admin/system-health`);
    const panel = page.getByTestId("page-system-health");
    await panel.waitFor();
    const healthyText = locale === "tr" ? "Ölçülen sinyaller sağlıklı" : "Measured signals healthy";
    await page.getByTestId("health-summary").getByText(healthyText, { exact: true }).waitFor();
    assert.ok(await panel.locator("button").count() > 0);
    assert.equal(await page.getByTestId("health-check-portalWorkers").locator("dd").first().innerText(), new Intl.NumberFormat(locale).format(1) + " / " + new Intl.NumberFormat(locale).format(0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale} horizontal overflow`);
    if (locale === "ar") assert.equal(await page.locator("html").getAttribute("dir"), "rtl");

    // A failed refresh must override the previously green summary.
    responseStatus = 503;
    await page.getByTestId("health-refresh").click();
    await page.getByTestId("health-error").waitFor();
    assert.equal(await page.getByTestId("health-summary").getByText(healthyText, { exact: true }).count(), 0);

    // Recovery, partial data, and safe inspection links.
    responseStatus = 200;
    snapshot = fixture();
    snapshot.coverage = "partial";
    snapshot.metrics.backups = null;
    snapshot.checks.find(check => check.key === "backups").state = "unknown";
    snapshot.checks.find(check => check.key === "backups").code = "CHECK_UNAVAILABLE";
    snapshot.status = "warning";
    snapshot.issues = [{ key: "messaging.failed", checkKey: "messaging24h", severity: "warning", message: "Recorded delivery failure", count: 2, impact: "Delivery not confirmed", nextAction: "Inspect receipts before any retry", href: "/staff/messages", observedAt: snapshot.checkedAt }];
    await page.getByTestId("health-refresh").click();
    await page.getByTestId("health-check-backups").getByText(locale === "tr" ? "Bilinmiyor / eksik ölçüm" : "Unknown / incomplete", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("health-error").count(), 0);
    assert.ok(await panel.locator('a[href="/staff/messages"]').count() > 0);
    assert.equal(await panel.locator('a[href^="javascript:"],a[href^="http"]').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale} partial-state overflow`);
    assert.ok(healthRequests >= 3);
    assert.deepEqual(errors, [], `${locale} application errors`);
    assert.deepEqual(unmocked, [], `${locale} must not contact external services`);
    console.log(`PASS ${locale}/${width}px: healthy, refresh failure/stale, recovery, partial unknown, read-only links, layout`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
