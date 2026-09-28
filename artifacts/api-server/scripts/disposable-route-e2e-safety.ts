/** Test-only boundaries. Never imported by a deployed entrypoint. */
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const EMPTY_BUSINESS_TABLES = [
  "users", "students", "agents", "leads", "applications", "documents",
  "object_owners", "sessions", "integrations", "channel_accounts", "email_queue",
  "conversations", "messages", "external_contacts", "notifications", "audit_logs",
] as const;

export function assertDisposableRouteEnvironment(env: NodeJS.ProcessEnv) {
  if (env.LOCAL_ROUTE_E2E_ALLOW_MUTATION !== "1") throw new Error("E2E_MUTATION_OPT_IN_REQUIRED");
  if (!UUID_V4.test(env.LOCAL_E2E_RUN_ID ?? "")) throw new Error("E2E_UUID_RUN_ID_REQUIRED");
  if (!path.isAbsolute(env.LOCAL_E2E_PGDATA ?? "")) throw new Error("E2E_PGDATA_REQUIRED");
  if (env.NODE_ENV !== "test" || env.ALLOW_LIVE_INTEGRATIONS !== "false"
    || env.EMAIL_DELIVERY_DISABLED !== "true") throw new Error("E2E_DELIVERY_FENCE_REQUIRED");
  let target: URL;
  try { target = new URL(env.DATABASE_URL ?? ""); } catch { throw new Error("E2E_DATABASE_TARGET_DENIED"); }
  if (!["postgres:", "postgresql:"].includes(target.protocol)
    || target.hostname !== "127.0.0.1" || target.port !== "5433"
    || target.pathname !== "/fasos_apply_local" || target.search || target.hash
    || !target.username) throw new Error("E2E_DATABASE_TARGET_DENIED");
  return { runId: env.LOCAL_E2E_RUN_ID!, databaseUrl: target.href, pgdata: path.resolve(env.LOCAL_E2E_PGDATA!) };
}

export function assertDisposableDatabaseIdentity(
  row: { name: string; host: string; port: number; comment: string; dataDirectory: string },
  expected: { runId: string; pgdata: string },
) {
  if (row.name !== "fasos_apply_local" || !["127.0.0.1", "127.0.0.1/32"].includes(row.host)
    || row.port !== 5433 || row.comment !== `fas-disposable-route-e2e:${expected.runId}`
    || path.resolve(row.dataDirectory) !== path.resolve(expected.pgdata)) {
    throw new Error("E2E_DATABASE_IDENTITY_MISMATCH");
  }
}

export function assertEmptyBusinessRows(counts: Record<string, number>) {
  for (const name of EMPTY_BUSINESS_TABLES) {
    if (counts[name] !== 0) throw new Error(`E2E_DATABASE_NOT_EMPTY:${name}`);
  }
}

export function assertLoopbackSocketTarget(args: unknown[], ports: ReadonlySet<number>) {
  // Node internally passes a normalized [options, callback] tuple to connect.
  if (Array.isArray(args[0])) args = args[0];
  const first = args[0];
  const options = first && typeof first === "object" ? first as Record<string, unknown> : null;
  const host = options ? options.host : args[1];
  const port = Number(options ? options.port : first);
  if (options?.path || host !== "127.0.0.1" || !ports.has(port)) throw new Error("E2E_EGRESS_DENIED");
}

export function createLocalRouteSocketPolicy() {
  const ports = new Set<number>([5433]);
  let databaseOpen = true;
  let httpAssigned = false;
  return {
    assertTarget(args: unknown[]) { assertLoopbackSocketTarget(args, ports); },
    closeDatabaseAdmission() { ports.delete(5433); databaseOpen = false; },
    allowHttpPort(port: number) {
      if (databaseOpen || httpAssigned || !Number.isInteger(port) || port < 1024 || port > 65535 || port === 5433) {
        throw new Error("E2E_HTTP_PORT_DENIED");
      }
      ports.add(port); httpAssigned = true;
    },
  };
}

/** Numeric loopback resolution needs no DNS/network access. Node's listen()
 * still invokes dns.lookup for a literal IP, so supply that one answer locally.
 */
export function resolveLoopbackLookup(hostname: unknown, options?: unknown) {
  if (hostname !== "127.0.0.1") throw new Error("E2E_DNS_DENIED");
  const configuration = typeof options === "number" ? { family: options }
    : options == null ? {} : options;
  if (!configuration || typeof configuration !== "object") throw new Error("E2E_DNS_OPTIONS_DENIED");
  const { family, all } = configuration as { family?: unknown; all?: unknown };
  if (family !== undefined && family !== 0 && family !== 4) throw new Error("E2E_DNS_FAMILY_DENIED");
  if (all !== undefined && typeof all !== "boolean") throw new Error("E2E_DNS_OPTIONS_DENIED");
  const result = { address: "127.0.0.1", family: 4 };
  return all ? [result] : result;
}

/** Standard Node socket/DNS/TLS/subprocess fence, not an OS sandbox claim. */
export function installLocalRouteFence() {
  const policy = createLocalRouteSocketPolicy();
  let denied = 0;
  const deny = (): never => { denied++; throw new Error("E2E_EXTERNAL_EFFECT_DENIED"); };
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    try { policy.assertTarget(args); } catch { return deny(); }
    return Reflect.apply(originalConnect, this, args);
  } as typeof originalConnect;
  tls.connect = deny as typeof tls.connect;
  dns.lookup = ((hostname: unknown, options: unknown, callback?: (...args: unknown[]) => void) => {
    if (typeof options === "function") { callback = options as (...args: unknown[]) => void; options = undefined; }
    if (typeof callback !== "function") return deny();
    let result: ReturnType<typeof resolveLoopbackLookup>;
    try { result = resolveLoopbackLookup(hostname, options); } catch { return deny(); }
    const done = callback;
    queueMicrotask(() => {
      if (Array.isArray(result)) done(null, result);
      else done(null, result.address, result.family);
    });
  }) as typeof dns.lookup;
  dns.promises.lookup = (async (hostname: unknown, options?: unknown) => {
    try { return resolveLoopbackLookup(hostname, options); } catch { return deny(); }
  }) as typeof dns.promises.lookup;
  for (const key of ["resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "reverse"] as const) {
    (dns as unknown as Record<string, unknown>)[key] = deny;
    (dns.promises as unknown as Record<string, unknown>)[key] = deny;
  }
  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) {
    (childProcess as unknown as Record<string, unknown>)[key] = deny;
  }
  syncBuiltinESMExports();
  return {
    ...policy,
    get denied() { return denied; },
  };
}

type Query = (...args: any[]) => any;
type PoolBoundary = { query: Query; connect: Query };

/** All route SQL shares one disposable rollback-only transaction. No new pool
 * checkout or late background write can escape it, including during teardown.
 * This deliberately does NOT simulate normal pool concurrency/commit behavior.
 */
export function bindRollbackOnlyPool(pool: PoolBoundary, query: Query) {
  let accepting = true;
  let lateQueries = 0;
  const pending = new Set<Promise<unknown>>();
  pool.connect = () => { throw new Error("E2E_ADDITIONAL_CONNECTION_DENIED"); };
  pool.query = (...args: any[]) => {
    if (!accepting) { lateQueries++; return Promise.reject(new Error("E2E_TRANSACTION_CLOSED")); }
    const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
    // Real corridor statements use parameterized SELECT/INSERT/UPDATE/DELETE.
    // Transaction management/DDL cannot escape rollback via a route dependency.
    if (typeof text !== "string" || !/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(text)
      || /;\s*\S/.test(text)) return Promise.reject(new Error("E2E_SQL_OUTSIDE_CORRIDOR"));
    if (args.some(arg => typeof arg === "function")) return Promise.reject(new Error("E2E_CALLBACK_QUERY_DENIED"));
    const result = Promise.resolve().then(() => query(...args));
    pending.add(result);
    void result.then(() => pending.delete(result), () => pending.delete(result));
    return result;
  };
  return {
    async close() { accepting = false; await Promise.allSettled([...pending]); },
    get lateQueries() { return lateQueries; },
  };
}

export function localCorridorUrl(origin: string, route: string) {
  const base = new URL(origin);
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || !base.port || base.username || base.password) {
    throw new Error("E2E_HTTP_ORIGIN_DENIED");
  }
  if (!/^\/api\/(auth\/(login|logout|me)|storage\/(uploads\/request-url|local-upload\/[A-Za-z0-9_-]+|(?:public-)?objects\/[A-Za-z0-9_./-]+))$/.test(route)
    || route.includes("..")) throw new Error("E2E_HTTP_ROUTE_DENIED");
  const resolved = new URL(route, base);
  if (resolved.origin !== base.origin) throw new Error("E2E_HTTP_ORIGIN_DENIED");
  return resolved;
}
