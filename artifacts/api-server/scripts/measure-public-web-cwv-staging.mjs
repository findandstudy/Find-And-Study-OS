import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

if (process.env.ALLOW_STAGING_PUBLIC_WEB_CWV !== "true") {
  throw new Error("ALLOW_STAGING_PUBLIC_WEB_CWV=true is required");
}

const origin = new URL(process.env.STAGING_PUBLIC_WEB_ORIGIN || "https://staging.findandstudy.com");
if (origin.origin !== "https://staging.findandstudy.com" || origin.pathname !== "/") {
  throw new Error("CWV staging lab is pinned to https://staging.findandstudy.com");
}

const repetitions = Number(process.env.STAGING_PUBLIC_WEB_CWV_REPETITIONS || "3");
if (!Number.isSafeInteger(repetitions) || repetitions < 3 || repetitions > 5) {
  throw new Error("STAGING_PUBLIC_WEB_CWV_REPETITIONS must be between 3 and 5");
}

const consentMode = process.env.STAGING_PUBLIC_WEB_CWV_CONSENT_MODE || "fresh";
if (!["fresh", "essential"].includes(consentMode)) {
  throw new Error("STAGING_PUBLIC_WEB_CWV_CONSENT_MODE must be fresh or essential");
}

const paths = (process.env.STAGING_PUBLIC_WEB_CWV_PATHS || [
  "/en",
  "/en/programs",
  "/en/countries",
  "/en/cities/london-2",
  "/en/universities/abbey-dld-colleges-1563",
  "/en/programs/international-foundation-programme-one-year-business-abbey-college-manchester-145792",
].join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (
  paths.length < 1
  || paths.length > 12
  || paths.some((value) => !/^\/[a-z0-9/_-]+$/i.test(value))
) {
  throw new Error("STAGING_PUBLIC_WEB_CWV_PATHS must contain 1-12 safe public paths");
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

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)] || 0;
}

function median(values) {
  return percentile(values, 0.5);
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--lang=en-US"],
});

const attempts = [];
try {
  for (const pathname of paths) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        locale: "en-US",
        serviceWorkers: "block",
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
      await page.addInitScript((selectedConsentMode) => {
        if (selectedConsentMode === "essential") {
          // Match a returning browser on the current persisted-state schema;
          // otherwise the application's version guard intentionally clears
          // all stale storage before CookieBanner reads the preference.
          localStorage.setItem("edcons_client_state_version", "2026-06-06");
          localStorage.setItem("cookie_consent", "essential");
        }
        window.__cwvLab = { lcp: 0, lcpElement: null, lcpUrl: null, lcpHistory: [], cls: 0, shifts: [], longTasks: [] };
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const latest = entries[entries.length - 1];
          if (latest) {
            window.__cwvLab.lcp = latest.startTime;
            window.__cwvLab.lcpElement = latest.element?.tagName || null;
            window.__cwvLab.lcpUrl = latest.url || null;
            window.__cwvLab.lcpHistory.push({
              startTime: latest.startTime,
              element: latest.element?.tagName || null,
              className: typeof latest.element?.className === "string" ? latest.element.className.slice(0, 240) : null,
              text: String(latest.element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240) || null,
              shell: latest.element?.closest?.("[data-public-render-shell]")?.getAttribute("data-public-render-shell") || null,
            });
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              window.__cwvLab.cls += entry.value;
              window.__cwvLab.shifts.push({
                startTime: entry.startTime,
                value: entry.value,
                sources: (entry.sources || []).slice(0, 5).map((source) => ({
                  element: source.node?.tagName || null,
                  className: typeof source.node?.className === "string" ? source.node.className.slice(0, 240) : null,
                  text: String(source.node?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240) || null,
                  previousRect: source.previousRect ? { x: source.previousRect.x, y: source.previousRect.y, width: source.previousRect.width, height: source.previousRect.height } : null,
                  currentRect: source.currentRect ? { x: source.currentRect.x, y: source.currentRect.y, width: source.currentRect.width, height: source.currentRect.height } : null,
                })),
              });
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__cwvLab.longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration,
              attribution: (entry.attribution || []).slice(0, 5).map((item) => ({
                name: item.name || null,
                containerType: item.containerType || null,
                containerName: item.containerName || null,
                containerSrc: item.containerSrc || null,
              })),
            });
          }
        }).observe({ type: "longtask", buffered: true });
      }, consentMode);

      const response = await page.goto(`${origin.origin}${pathname}`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      if (!response?.ok() || page.url().startsWith(`${origin.origin}/en/login`)) {
        throw new Error(`${pathname} returned ${response?.status() ?? "no response"} or redirected to login`);
      }
      await page.waitForTimeout(1_000);
      const metrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const state = window.__cwvLab;
        return {
          lcpMs: state.lcp,
          lcpElement: state.lcpElement,
          lcpUrl: state.lcpUrl,
          lcpHistory: state.lcpHistory,
          cls: state.cls,
          shifts: state.shifts,
          longTasks: state.longTasks,
          tbtMs: state.longTasks.reduce((total, entry) => total + Math.max(0, entry.duration - 50), 0),
          ttfbMs: navigation?.responseStart || 0,
          transferredBytes: performance.getEntriesByType("resource")
            .reduce((total, entry) => total + (entry.transferSize || 0), 0),
          slowResources: performance.getEntriesByType("resource")
            .map((entry) => ({
              name: entry.name.replace(location.origin, ""),
              durationMs: entry.duration,
              transferSize: entry.transferSize || 0,
            }))
            .sort((left, right) => right.durationMs - left.durationMs)
            .slice(0, 8),
        };
      });
      attempts.push({
        path: pathname,
        repetition,
        lcpMs: round(metrics.lcpMs),
        lcpElement: metrics.lcpElement,
        lcpUrl: metrics.lcpUrl,
        lcpHistory: metrics.lcpHistory.map((entry) => ({
          startTime: round(entry.startTime),
          element: entry.element,
          className: entry.className,
          text: entry.text,
          shell: entry.shell,
        })),
        cls: round(metrics.cls, 4),
        shifts: metrics.shifts.map((entry) => ({
          startTime: round(entry.startTime),
          value: round(entry.value, 4),
          sources: entry.sources,
        })),
        longTasks: metrics.longTasks.map((entry) => ({
          startTime: round(entry.startTime),
          duration: round(entry.duration),
          attribution: entry.attribution,
        })),
        tbtMs: round(metrics.tbtMs),
        ttfbMs: round(metrics.ttfbMs),
        transferredBytes: Math.round(metrics.transferredBytes),
        slowResources: metrics.slowResources.map((resource) => ({
          name: resource.name,
          durationMs: round(resource.durationMs),
          transferSize: Math.round(resource.transferSize),
        })),
      });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const pages = paths.map((pathname) => {
  const samples = attempts.filter((attempt) => attempt.path === pathname);
  return {
    path: pathname,
    samples: samples.length,
    median: {
      lcpMs: round(median(samples.map((sample) => sample.lcpMs))),
      cls: round(median(samples.map((sample) => sample.cls)), 4),
      tbtMs: round(median(samples.map((sample) => sample.tbtMs))),
      ttfbMs: round(median(samples.map((sample) => sample.ttfbMs))),
      transferredBytes: Math.round(median(samples.map((sample) => sample.transferredBytes))),
    },
  };
});

const result = {
  schemaVersion: 1,
  kind: "STAGING_LAB_NOT_FIELD_DATA",
  origin: origin.origin,
  profile: "mobile-390-fast4g-4xCPU",
  consentMode,
  repetitions,
  thresholds: { lcpMs: 2_500, cls: 0.1, tbtMs: 200 },
  attempts,
  pages,
  aggregateMedian: {
    lcpMs: round(median(pages.map((page) => page.median.lcpMs))),
    cls: round(median(pages.map((page) => page.median.cls)), 4),
    tbtMs: round(median(pages.map((page) => page.median.tbtMs))),
    ttfbMs: round(median(pages.map((page) => page.median.ttfbMs))),
  },
};

process.stdout.write(`${JSON.stringify(result)}\n`);
if (
  pages.some((page) => page.samples !== repetitions || page.median.lcpMs <= 0)
  || pages.some((page) => page.median.lcpMs > result.thresholds.lcpMs)
  || pages.some((page) => page.median.cls > result.thresholds.cls)
  || pages.some((page) => page.median.tbtMs > result.thresholds.tbtMs)
) {
  throw new Error("staging CWV lab threshold failed; inspect the emitted JSON evidence");
}
