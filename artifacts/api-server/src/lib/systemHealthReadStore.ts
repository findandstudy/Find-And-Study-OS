import { opendir, lstat, statfs } from "node:fs/promises";
import { resolve } from "node:path";

export class SystemHealthReadError extends Error {
  constructor(public readonly code: "CHECK_TIMEOUT" | "CHECK_UNAVAILABLE" | "BACKUP_SCAN_LIMIT" | "BACKUP_NOT_CONFIGURED") {
    super(code);
  }
}

export type HealthReadClient = {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
  release(error?: Error | boolean): void;
};
export type HealthReadPool = { connect(): Promise<HealthReadClient> };

export const HEALTH_READ_LIMITS = Object.freeze({
  acquireMs: 1_000,
  transactionMs: 2_500,
  statementMs: 1_500,
  fileMs: 1_500,
  backupEntries: 2_000,
});

const pendingAcquisitions = new WeakMap<HealthReadPool, number>();

/** Health inspection must not sit in the application's connection queue indefinitely.
 * A lease arriving after our deadline is destroyed, never used for a query. */
export async function readHealthAggregate(pool: HealthReadPool, sql: string): Promise<Record<string, unknown>> {
  const pendingCount = pendingAcquisitions.get(pool) ?? 0;
  if (pendingCount >= 2) throw new SystemHealthReadError("CHECK_UNAVAILABLE");
  pendingAcquisitions.set(pool, pendingCount + 1);
  let acquireExpired = false;
  let acquireTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.resolve().then(() => pool.connect()).finally(() => {
    pendingAcquisitions.set(pool, (pendingAcquisitions.get(pool) ?? 1) - 1);
  }).then((client) => {
    if (acquireExpired) {
      client.release(true);
      throw new SystemHealthReadError("CHECK_TIMEOUT");
    }
    return client;
  });
  let client: HealthReadClient;
  try {
    client = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        acquireTimer = setTimeout(() => {
          acquireExpired = true;
          reject(new SystemHealthReadError("CHECK_TIMEOUT"));
        }, HEALTH_READ_LIMITS.acquireMs);
      }),
    ]);
  } finally {
    clearTimeout(acquireTimer);
  }

  let released = false;
  const release = (destroy: boolean) => {
    if (!released) { released = true; client.release(destroy); }
  };
  let transactionTimer: ReturnType<typeof setTimeout> | undefined;
  const query = async (text: string) => {
    if (released) throw new SystemHealthReadError("CHECK_TIMEOUT");
    return client.query(text);
  };
  try {
    return await Promise.race([
      (async () => {
        await query("BEGIN READ ONLY");
        // Transaction-local settings cannot leak into normal application requests.
        await query(`SET LOCAL statement_timeout = '${HEALTH_READ_LIMITS.statementMs}ms'`);
        await query("SET LOCAL lock_timeout = '500ms'");
        const result = await query(sql);
        await query("ROLLBACK");
        if (!result.rows[0]) throw new SystemHealthReadError("CHECK_UNAVAILABLE");
        release(false);
        return result.rows[0];
      })(),
      new Promise<never>((_, reject) => {
        transactionTimer = setTimeout(() => {
          release(true);
          reject(new SystemHealthReadError("CHECK_TIMEOUT"));
        }, HEALTH_READ_LIMITS.transactionMs);
      }),
    ]);
  } catch (error) {
    // Destroy rather than return an aborted/unknown transaction to the shared pool.
    release(true);
    if (error instanceof SystemHealthReadError) throw error;
    const pgCode = (error as { code?: unknown } | null)?.code;
    throw new SystemHealthReadError(pgCode === "57014" || pgCode === "55P03" ? "CHECK_TIMEOUT" : "CHECK_UNAVAILABLE");
  } finally {
    clearTimeout(transactionTimer);
  }
}

export async function withinHealthDeadline<T>(read: () => Promise<T>, timeoutMs = HEALTH_READ_LIMITS.fileMs): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SystemHealthReadError("CHECK_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Filesystem promises cannot be cancelled. Retain their single-flight slot even
 * after a caller times out, so an unresponsive mount cannot accumulate probes. */
export function coalesceHealthFileRead<T>(read: () => Promise<T>, now = Date.now): () => Promise<T> {
  let pending: Promise<T> | undefined;
  let startedAt = 0;
  return () => {
    if (pending && now() - startedAt >= HEALTH_READ_LIMITS.fileMs) {
      return Promise.reject(new SystemHealthReadError("CHECK_TIMEOUT"));
    }
    if (!pending) {
      startedAt = now();
      pending = Promise.resolve().then(read).finally(() => { pending = undefined; });
    }
    return pending;
  };
}

export async function readSystemHealthStorage() {
  const stats = await statfs(process.cwd());
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes) || freeBytes < 0) {
    throw new SystemHealthReadError("CHECK_UNAVAILABLE");
  }
  return { available: true, totalBytes, freeBytes, freePercent: Math.round(freeBytes / totalBytes * 1000) / 10 };
}

/** Metadata only: no file content, names, absolute paths, recursive traversal or
 * symlink targets are returned. A capped scan is UNKNOWN, never a partial success. */
export async function readSystemHealthBackups(backupDir = process.env.BACKUP_DIR, now = Date.now()) {
  let directory;
  const location = backupDir || "/opt/findandstudy/backups";
  try { directory = await opendir(location); }
  catch (error) {
    if (!backupDir && (error as { code?: unknown }).code === "ENOENT") {
      throw new SystemHealthReadError("BACKUP_NOT_CONFIGURED");
    }
    throw new SystemHealthReadError("CHECK_UNAVAILABLE");
  }
  const deadline = Date.now() + HEALTH_READ_LIMITS.fileMs;
  let scanned = 0;
  let count = 0;
  let latest: { mtimeMs: number; size: number } | undefined;
  try {
    for await (const entry of directory) {
      if (++scanned > HEALTH_READ_LIMITS.backupEntries) throw new SystemHealthReadError("BACKUP_SCAN_LIMIT");
      if (Date.now() > deadline) throw new SystemHealthReadError("CHECK_TIMEOUT");
      if (!entry.isFile() || !/\.(?:dump|backup|sql(?:\.gz)?)$/i.test(entry.name)) continue;
      const stat = await lstat(resolve(location, entry.name));
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (stat.mtimeMs > now + 60_000) throw new SystemHealthReadError("CHECK_UNAVAILABLE");
      count++;
      if (!latest || stat.mtimeMs > latest.mtimeMs) latest = stat;
    }
  } finally {
    // for-await closes the handle, including when the bounded loop throws.
    await directory.close().catch(() => undefined);
  }
  return {
    available: true,
    count,
    latestAt: latest ? new Date(latest.mtimeMs).toISOString() : null,
    latestSizeBytes: latest?.size ?? null,
    latestAgeHours: latest ? Math.max(0, Math.round((now - latest.mtimeMs) / 360_000) / 10) : null,
  };
}
