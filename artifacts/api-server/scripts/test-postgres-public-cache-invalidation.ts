import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const target = new URL(process.env.DATABASE_URL ?? "");
if (process.env.ALLOW_PUBLIC_CACHE_DB_TEST !== "true"
  || process.env.ALLOW_LIVE_INTEGRATIONS !== "false"
  || target.hostname !== "127.0.0.1" || target.port !== "5433"
  || target.pathname !== "/fasos_apply_local") {
  throw new Error("Public-cache DB test requires explicit disposable PostgreSQL opt-in");
}

if (process.env.PUBLIC_CACHE_TEST_CHILD === "listener") {
  const { publicCatalogInvalidationBus } = await import("../src/lib/publicCatalogInvalidationBus");
  const { applyPublicCatalogRenderCacheInvalidation, getPublicCatalogCacheGeneration } = await import("../src/lib/publicCatalogRenderReadModel");
  const before = getPublicCatalogCacheGeneration();
  publicCatalogInvalidationBus.subscribe(invalidation => {
    applyPublicCatalogRenderCacheInvalidation(invalidation);
    process.stdout.write(`CACHE_EVENT ${before} ${getPublicCatalogCacheGeneration()} ${JSON.stringify(invalidation)}\n`);
    void publicCatalogInvalidationBus.shutdown().then(() => process.exit(0));
  });
  setTimeout(() => { process.stderr.write("listener timeout\n"); process.exit(2); }, 10_000).unref();
} else if (process.env.PUBLIC_CACHE_TEST_CHILD === "publisher") {
  const { publicCatalogInvalidationBus } = await import("../src/lib/publicCatalogInvalidationBus");
  const { invalidatePublicCatalogRenderCache } = await import("../src/lib/publicCatalogRenderReadModel");
  publicCatalogInvalidationBus.subscribe(() => {});
  setTimeout(() => invalidatePublicCatalogRenderCache({ entityType: "catalog", locale: "en" }), 200);
  setTimeout(() => { void publicCatalogInvalidationBus.shutdown().then(() => process.exit(0)); }, 700);
} else {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    cwd: process.cwd(),
    env: { ...process.env, PUBLIC_CACHE_TEST_CHILD: "listener" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const readyDeadline = Date.now() + 8_000;
  while (!stdout.includes("LISTEN connection established") && Date.now() < readyDeadline) {
    if (child.exitCode !== null) throw new Error(`listener exited early: ${stderr}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.match(stdout, /LISTEN connection established/);

  const publisher = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    cwd: process.cwd(),
    env: { ...process.env, PUBLIC_CACHE_TEST_CHILD: "publisher" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let publisherError = "";
  publisher.stderr.on("data", chunk => { publisherError += String(chunk); });
  const publisherExit = new Promise<number | null>(resolve => publisher.once("exit", resolve));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`listener event timeout: ${stdout} ${stderr}`)), 8_000);
    child.once("exit", code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`listener failed (${code}): ${stdout} ${stderr}`));
    });
  });
  assert.equal(await publisherExit, 0, publisherError);
  assert.match(stdout, /CACHE_EVENT 0 1 \{"entityType":"catalog","locale":"en"\}/);
  console.log("[postgres-public-cache-invalidation] 4/4 PASS");
}
