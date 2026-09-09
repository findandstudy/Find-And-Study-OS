import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.env.ALLOW_PUBLIC_WEB_LOCAL_BENCHMARK !== "true") {
  throw new Error("ALLOW_PUBLIC_WEB_LOCAL_BENCHMARK=true is required");
}

const databaseUrl = new URL(process.env.DATABASE_URL || "");
if (
  !["postgres:", "postgresql:"].includes(databaseUrl.protocol)
  || databaseUrl.hostname !== "127.0.0.1"
  || databaseUrl.port !== "5433"
  || databaseUrl.pathname !== "/fasos_apply_local"
  || databaseUrl.username !== "fas_migrator"
  || databaseUrl.password
) {
  throw new Error("benchmark requires fas_migrator on disposable 127.0.0.1:5433/fasos_apply_local");
}

const port = Number(process.env.PUBLIC_WEB_BENCHMARK_PORT || "25203");
if (!Number.isSafeInteger(port) || port < 24_000 || port > 30_000) {
  throw new Error("PUBLIC_WEB_BENCHMARK_PORT must be between 24000 and 30000");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const serverEntry = path.join(packageRoot, "dist", "index.cjs");
const frontendDist = path.join(repoRoot, "artifacts", "edcons", "dist", "public");
const origin = `http://127.0.0.1:${port}`;
const locales = [
  "en", "tr", "ar", "fr", "ru", "fa", "zh", "hi", "es", "id", "ur",
  "tk", "ky", "kk", "uz", "tg", "bn", "pt", "ne", "vi", "ko", "uk", "it",
];

const child = spawn(process.execPath, [serverEntry], {
  cwd: repoRoot,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    BACKGROUND_JOBS_ENABLED: "false",
    SESSION_SECRET: "disposable-local-public-web-benchmark-only-20260909",
    FRONTEND_DIST_PATH: frontendDist,
    PUBLIC_SITE_URL: "https://findandstudy.com",
    PUBLIC_WEB_RENDER_MODE: "all",
    PUBLIC_WEB_SITEMAP_MODE: "static",
  },
});

let serverLog = "";
const collect = (chunk) => {
  serverLog = `${serverLog}${String(chunk)}`.slice(-8_192);
};
child.stdout.on("data", collect);
child.stderr.on("data", collect);

function percentile(values, ratio) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)] || 0;
}

async function timedFetch(pathname) {
  const startedAt = performance.now();
  const response = await fetch(`${origin}${pathname}`, { redirect: "manual" });
  await response.arrayBuffer();
  return { response, durationMs: performance.now() - startedAt };
}

async function waitUntilReady() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited before ready: ${serverLog}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // bounded readiness retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server readiness timeout: ${serverLog}`);
}

async function measure(paths, concurrency) {
  const pending = [...paths];
  const durations = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (pending.length) {
      const pathname = pending.shift();
      if (!pathname) return;
      const { response, durationMs } = await timedFetch(pathname);
      if (!response.ok) throw new Error(`${pathname} returned ${response.status}`);
      durations.push(durationMs);
    }
  });
  await Promise.all(workers);
  return durations;
}

try {
  await waitUntilReady();
  const originDurations = [];
  for (const locale of locales) {
    const result = await timedFetch(`/${locale}/programs`);
    if (!result.response.ok || result.response.headers.get("x-public-render") !== "ssr-isr-pilot") {
      throw new Error(`render contract failed for ${locale}`);
    }
    originDurations.push(result.durationMs);
  }
  const cacheDurations = await measure(Array.from({ length: 100 }, () => "/en/programs"), 10);
  const apiDurations = await measure(Array.from({ length: 40 }, () => "/api/course-finder?page=1&limit=12&locale=en"), 5);
  const sitemap = await timedFetch("/sitemaps/static.xml");
  if (
    sitemap.response.headers.get("content-type")?.startsWith("application/xml") !== true
    || sitemap.response.headers.get("x-content-type-options") !== "nosniff"
  ) {
    throw new Error("sitemap security headers missing");
  }
  const robots = await fetch(`${origin}/robots.txt`, { redirect: "manual" });
  const robotsText = await robots.text();
  if (
    !robots.ok
    || robots.headers.get("cache-control") !== "no-store"
    || robotsText !== "User-agent: *\nDisallow: /\n"
  ) {
    throw new Error("default-off robots boundary failed");
  }
  for (const llmsPath of ["/llms.txt", "/.well-known/llms.txt"]) {
    const llms = await fetch(`${origin}${llmsPath}`, { redirect: "manual" });
    if (
      llms.status !== 404
      || llms.headers.get("cache-control") !== "no-store"
      || llms.headers.get("x-robots-tag") !== "noindex, nofollow, noarchive"
    ) {
      throw new Error(`default-off AI discovery boundary failed for ${llmsPath}`);
    }
    await llms.arrayBuffer();
  }
  for (const privatePath of ["/admin", "/student", "/en/login", "/sign/test-token"]) {
    const privateRoute = await timedFetch(privatePath);
    if (
      !privateRoute.response.ok
      || privateRoute.response.headers.get("x-robots-tag") !== "noindex, nofollow, noarchive"
    ) {
      throw new Error(`private SPA robots boundary failed for ${privatePath}`);
    }
  }
  const publicHome = await timedFetch("/en");
  if (
    !publicHome.response.ok
    || publicHome.response.headers.get("x-robots-tag") !== "noindex, nofollow, noarchive"
  ) {
    throw new Error("default-off indexing boundary failed for public SPA route");
  }
  const result = {
    schemaVersion: 1,
    samples: {
      origin: originDurations.length,
      cacheHit: cacheDurations.length,
      publicApi: apiDurations.length,
    },
    p95Ms: {
      origin: Number(percentile(originDurations, 0.95).toFixed(1)),
      cacheHit: Number(percentile(cacheDurations, 0.95).toFixed(1)),
      publicApi: Number(percentile(apiDurations, 0.95).toFixed(1)),
    },
  };
  if (result.p95Ms.origin > 800 || result.p95Ms.cacheHit > 250 || result.p95Ms.publicApi > 300) {
    throw new Error(`public web benchmark threshold failed: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}
