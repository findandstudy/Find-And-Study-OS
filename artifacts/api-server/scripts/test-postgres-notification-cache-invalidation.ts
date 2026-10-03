import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const target = new URL(process.env.DATABASE_URL ?? "");
if (process.env.ALLOW_NOTIFICATION_CACHE_DB_TEST !== "true"
  || process.env.ALLOW_LIVE_INTEGRATIONS !== "false"
  || target.hostname !== "127.0.0.1" || target.port !== "5433"
  || target.pathname !== "/fasos_apply_local") {
  throw new Error("Notification-cache DB test requires explicit disposable PostgreSQL opt-in");
}

const userId = 700001;
if (process.env.NOTIFICATION_CACHE_TEST_CHILD === "listener") {
  const { notificationBus } = await import("../src/lib/notificationBus");
  const { cacheNotificationCounts, getCachedNotificationCounts, invalidateNotificationCounts } = await import("../src/lib/notificationCountCache");
  cacheNotificationCounts(userId, { total: 1, importantTotal: 1, leads: 0, students: 0, applications: 1, tasks: 0 });
  notificationBus.subscribe(event => {
    invalidateNotificationCounts(event.userId);
    process.stdout.write(`COUNT_CACHE ${getCachedNotificationCounts(userId) === null ? "INVALIDATED" : "STALE"}\n`);
    void notificationBus.shutdown().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(2), 10_000).unref();
} else if (process.env.NOTIFICATION_CACHE_TEST_CHILD === "publisher") {
  const { notificationBus } = await import("../src/lib/notificationBus");
  notificationBus.publish({ userId, type: "test.cache", title: "Synthetic" });
  const { pool } = await import("@workspace/db");
  setTimeout(() => { void pool.end().then(() => process.exit(0)); }, 400);
} else {
  const spawnChild = (role: string) => spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
    cwd: process.cwd(), env: { ...process.env, NOTIFICATION_CACHE_TEST_CHILD: role }, stdio: ["ignore", "pipe", "pipe"],
  });
  const listener = spawnChild("listener");
  let output = "";
  let error = "";
  listener.stdout.on("data", chunk => { output += String(chunk); });
  listener.stderr.on("data", chunk => { error += String(chunk); });
  const deadline = Date.now() + 8_000;
  while (!output.includes("LISTEN connection established") && Date.now() < deadline) {
    if (listener.exitCode !== null) throw new Error(`listener exited early: ${error}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.match(output, /LISTEN connection established/);
  const publisher = spawnChild("publisher");
  let publisherError = "";
  publisher.stderr.on("data", chunk => { publisherError += String(chunk); });
  const publisherExit = new Promise<number | null>(resolve => publisher.once("exit", resolve));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`notification timeout: ${output} ${error}`)), 8_000);
    listener.once("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`listener failed (${code}): ${error}`)); });
  });
  assert.equal(await publisherExit, 0, publisherError);
  assert.match(output, /COUNT_CACHE INVALIDATED/);
  console.log("[postgres-notification-cache-invalidation] 3/3 PASS");
}
