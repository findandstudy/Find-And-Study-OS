/**
 * Narrow, synthetic HTTP auth/local-storage corridor. Requires a NEW disposable
 * PostgreSQL cluster prepared by the caller; never starts/migrates/drops a DB.
 * Composes actual auth/CSRF/storage routes, upload processing and object policy.
 * Deliberately does NOT import app.ts/index.ts (unrelated route imports currently
 * start LISTEN connections and seed notification rules as module side effects).
 * One rollback-only DB connection intentionally replaces normal pool behavior.
 * Not browser E2E, application workflow, or transaction-concurrency certification.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, lstat, readdir, unlink, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Server } from "node:http";
import type { PoolClient } from "pg";
import {
  assertDisposableDatabaseIdentity, assertDisposableRouteEnvironment, assertEmptyBusinessRows,
  bindRollbackOnlyPool, EMPTY_BUSINESS_TABLES, installLocalRouteFence, localCorridorUrl,
} from "./disposable-route-e2e-safety";

async function removeOwnedTree(root: string, device: number, inode: number) {
  const actual = await lstat(root);
  if (actual.isSymbolicLink() || actual.dev !== device || actual.ino !== inode
    || path.dirname(root) !== await realpath(os.tmpdir()) || !path.basename(root).startsWith("fas-route-e2e-")) {
    throw new Error("E2E_STORAGE_OWNERSHIP_CHANGED");
  }
  let entries = 0;
  async function walk(directory: string) {
    for (const name of await readdir(directory)) {
      if (++entries > 100) throw new Error("E2E_STORAGE_CLEANUP_BUDGET_EXCEEDED");
      const child = path.join(directory, name);
      const metadata = await lstat(child);
      // Do not traverse links/reparse points; only remove the owned link itself.
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) { await walk(child); await rmdir(child); }
      else await unlink(child);
    }
  }
  await walk(root);
  await rmdir(root);
  await assert.rejects(lstat(root), { code: "ENOENT" });
}

function sanitizeEnvironment(databaseUrl: string, root: string) {
  // The fresh child must not inherit provider credentials, NODE_OPTIONS hooks,
  // proxy URLs or alternative database/search-path variables from a user shell.
  const keep = new Set(["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]);
  for (const key of Object.keys(process.env)) if (!keep.has(key.toUpperCase())) delete process.env[key];
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl, NODE_ENV: "test", ALLOW_LIVE_INTEGRATIONS: "false",
    EMAIL_DELIVERY_DISABLED: "true", BACKGROUND_JOBS_ENABLED: "false",
    AI_EXTERNAL_AUTO_REPLY_KILL_SWITCH: "true", STUDENT_JOURNEY_V1_MODE: "off",
    SOCIAL_PUBLICATION_ENABLED: "false", SOCIAL_PROVIDER_EXECUTION_ENABLED: "false",
    PIPELINE_EMAIL_AUTOMATION_ENABLED: "false", STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: root,
    DB_POOL_MAX: "1", DB_CONNECT_TIMEOUT_MS: "5000", DB_QUERY_TIMEOUT_MS: "5000", DB_STATEMENT_TIMEOUT_MS: "5000",
    DB_QUERY_RETRIES: "1", SESSION_SECRET: randomBytes(32).toString("hex"), ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  });
}

async function emptyCounts(query: PoolClient["query"]) {
  const result: Record<string, number> = {};
  for (const table of EMPTY_BUSINESS_TABLES) {
    const row = await query(`SELECT count(*)::int AS count FROM public."${table}"`);
    result[table] = row.rows[0].count;
  }
  return result;
}

async function tableCounts(query: PoolClient["query"]) {
  const tables = await query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  if (tables.rows.length > 1000) throw new Error("E2E_TABLE_BUDGET_EXCEEDED");
  const counts: Record<string, number> = {};
  for (const { tablename } of tables.rows) {
    const quoted = String(tablename).replaceAll('"', '""');
    counts[tablename] = (await query(`SELECT count(*)::int AS count FROM public."${quoted}"`)).rows[0].count;
  }
  return counts;
}

export async function runDisposableRouteE2e() {
  // Must run before imports that initialize DB clients, storage or routes.
  const expected = assertDisposableRouteEnvironment(process.env);
  if ((await lstat(expected.pgdata)).isSymbolicLink()) throw new Error("E2E_PGDATA_LINK_DENIED");
  expected.pgdata = await realpath(expected.pgdata);
  const fence = installLocalRouteFence();
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "fas-route-e2e-"));
  const ownedRoot = await lstat(root);
  sanitizeEnvironment(expected.databaseUrl, root);
  let server: Server | undefined;
  let client: PoolClient | undefined;
  let pool: (typeof import("@workspace/db"))["pool"] | undefined;
  let binding: ReturnType<typeof bindRollbackOnlyPool> | undefined;
  let began = false;
  let baseline: Record<string, number> | undefined;
  let primaryError: unknown;
  const cleanupErrors: unknown[] = [];
  const passed: string[] = [];
  const deadline = Date.now() + 90_000;
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) throw new Error("E2E_RUN_BUDGET_EXCEEDED");
    return value;
  };
  try {
    const database = await import("@workspace/db");
    pool = database.pool;
    client = await pool.connect();
    const rawQuery = client.query.bind(client);
    const query = ((...args: unknown[]) => {
      remaining(); return Reflect.apply(rawQuery, undefined, args);
    }) as PoolClient["query"];
    const identity = (await query(`SELECT current_database() AS name, inet_server_addr()::text AS host,
      inet_server_port() AS port, shobj_description(oid,'pg_database') AS comment,
      current_setting('data_directory') AS "dataDirectory" FROM pg_database WHERE datname=current_database()`)).rows[0];
    identity.dataDirectory = await realpath(identity.dataDirectory);
    assertDisposableDatabaseIdentity(identity, expected);
    // No lazy/new DB client can escape the one rollback-only connection, even
    // if a route dependency independently constructs its own PostgreSQL pool.
    fence.closeDatabaseAdmission();
    if (!(await query("SELECT pg_try_advisory_lock(731942615, 28092026) AS locked")).rows[0].locked) {
      throw new Error("E2E_CONCURRENT_RUN_DENIED");
    }
    // The lock is cooperative; also reject every other client connection in
    // this freshly provisioned DB before any fixture write.
    const peers = await query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'");
    assert.equal(peers.rows[0].count, 0, "E2E_DATABASE_NOT_EXCLUSIVE");
    assertEmptyBusinessRows(await emptyCounts(query));
    baseline = await tableCounts(query);
    const role = (await query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='fas_app'")).rows[0];
    assert(role && !role.rolsuper && !role.rolbypassrls && !role.rolcreatedb && !role.rolcreaterole,
      "E2E_UNPRIVILEGED_APP_ROLE_REQUIRED");
    await query("BEGIN"); began = true;
    await query("SET LOCAL statement_timeout='5s'");
    await query("SET LOCAL lock_timeout='2s'");
    await query("SET LOCAL ROLE fas_app");
    binding = bindRollbackOnlyPool(pool, query);
    const bcrypt = (await import("bcryptjs")).default;
    const password = randomBytes(24).toString("base64url");
    const hash = await bcrypt.hash(password, 10);
    const emails = ["owner", "other"].map(role => `${role}-${expected.runId}@example.test`);
    const users = (await query(`INSERT INTO users(email,first_name,last_name,role,password_hash,is_active,email_verified)
      VALUES($1,'Synthetic','Owner','student',$3,true,true),($2,'Synthetic','Other','student',$3,true,true)
      RETURNING id,email`, [emails[0], emails[1], hash])).rows;
    const express = (await import("express")).default;
    const cookieParser = (await import("cookie-parser")).default;
    const { authMiddleware } = await import("../src/middlewares/authMiddleware");
    const { csrfProtection } = await import("../src/middlewares/csrf");
    const authRouter = (await import("../src/routes/auth")).default;
    const storageRouter = (await import("../src/routes/storage")).default;
    const app = express();
    app.set("trust proxy", 1);
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    app.use(express.urlencoded({ extended: true, limit: "1mb" }));
    app.use(authMiddleware);
    app.use(csrfProtection);
    app.use("/api", authRouter, storageRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server!.once("listening", resolve); server!.once("error", reject); });
    const address = server.address();
    assert(address && typeof address !== "string");
    fence.allowHttpPort(address.port);
    const origin = `http://127.0.0.1:${address.port}`;
    class Session {
      cookies = new Map<string, string>();
      async request(route: string, method = "GET", body?: Buffer | object, csrf = true) {
        const headers: Record<string, string> = {};
        if (this.cookies.size) headers.cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
        if (csrf && this.cookies.has("csrf_token")) headers["x-csrf-token"] = this.cookies.get("csrf_token")!;
        let payload: Uint8Array<ArrayBuffer> | string | undefined;
        if (Buffer.isBuffer(body)) { payload = new Uint8Array(body); headers["content-type"] = "image/png"; }
        else if (body) { payload = JSON.stringify(body); headers["content-type"] = "application/json"; }
        const response = await fetch(localCorridorUrl(origin, route), {
          method, headers, body: payload, redirect: "error", signal: AbortSignal.timeout(Math.min(10_000, remaining())),
        });
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(";", 1)[0]; const equals = pair.indexOf("=");
          const key = pair.slice(0, equals); const value = pair.slice(equals + 1);
          if (value) this.cookies.set(key, value); else this.cookies.delete(key);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        const json = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(bytes.toString()) : undefined;
        return { status: response.status, bytes, json };
      }
    }
    const owner = new Session(), other = new Session(), anonymous = new Session();
    for (const [session, email] of [[owner, emails[0]], [other, emails[1]]] as const) {
      assert.equal((await session.request("/api/auth/me")).status, 401);
      assert.equal((await session.request("/api/auth/login", "POST", { email, password })).status, 200);
      const me = await session.request("/api/auth/me");
      assert.equal(me.status, 200); assert.equal(me.json.email, email);
    }
    passed.push("real login/session isolation");
    const sharp = (await import("sharp")).default;
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#2244aa" } }).png().toBuffer();
    const differentImage = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ff2211" } }).png().toBuffer();
    const upload = { name: "synthetic.png", contentType: "image/png", size: image.length, prefix: `e2e/${expected.runId}` };
    assert.equal((await owner.request("/api/storage/uploads/request-url", "POST", upload, false)).status, 403);
    passed.push("actual CSRF rejects missing token");
    const issued = await owner.request("/api/storage/uploads/request-url", "POST", upload);
    assert.equal(issued.status, 200);
    const uploadUrl = issued.json.uploadURL as string;
    const objectKey = (issued.json.objectPath as string).replace(/^\/objects\//, "");
    assert(objectKey.startsWith(`e2e/${expected.runId}/`));
    assert.equal((await query("SELECT uploaded_by FROM object_owners WHERE object_key=$1", [objectKey])).rows[0].uploaded_by,
      users.find(user => user.email === emails[0])!.id);
    assert.equal((await other.request(uploadUrl, "PUT", image)).status, 403);
    await anonymous.request("/api/auth/me");
    assert.equal((await anonymous.request(uploadUrl, "PUT", image)).status, 401);
    passed.push("upload grant bound to authenticated owner");
    assert.equal((await owner.request(uploadUrl, "PUT", image)).status, 200);
    assert.equal((await owner.request(uploadUrl, "PUT", image)).status, 200);
    assert.equal((await owner.request(uploadUrl, "PUT", differentImage)).status, 409);
    passed.push("actual upload processing: initial publish, exact retry, immutable conflict");
    const downloadPath = `/api/storage/objects/${objectKey}`;
    const download = await owner.request(downloadPath);
    assert.equal(download.status, 200);
    assert(download.bytes.length > 0);
    assert.equal((await sharp(download.bytes).metadata()).width, 16);
    const secondDownload = await owner.request(downloadPath);
    assert.deepEqual(secondDownload.bytes, download.bytes);
    assert.equal((await other.request(downloadPath)).status, 403);
    assert.equal((await anonymous.request(downloadPath)).status, 401);
    assert.equal((await other.request(`/api/storage/public-objects/${objectKey}`)).status, 403);
    passed.push("private download and historical public alias deny other/anonymous users");
    const invalid = await owner.request("/api/storage/uploads/request-url", "POST", { ...upload, prefix: ".local-upload-internal" });
    assert.equal(invalid.status, 400);
    passed.push("reserved local path rejected before grant issuance");
    for (const session of [owner, other]) {
      const revokedCookies = new Map(session.cookies);
      assert.equal((await session.request("/api/auth/logout", "POST")).status, 204);
      assert.equal((await session.request("/api/auth/me")).status, 401);
      // Replay the previously authenticated cookie, rather than proving only
      // that the client removed its cookie in response to logout.
      const replay = new Session();
      replay.cookies = revokedCookies;
      assert.equal((await replay.request("/api/auth/me")).status, 401);
    }
    passed.push("logout revokes HTTP sessions including replay of the old authenticated cookie");
    assert.equal((await query("SELECT count(*)::int AS count FROM email_queue")).rows[0].count, 0);
    assert.equal(fence.denied, 0, "E2E unexpected external-effect attempt");
    passed.push("no email queue or attempted standard Node external effect");
  } catch (error) { primaryError = error; }
  finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    // Drain audit's existing setImmediate callback before closing SQL admission.
    await new Promise(resolve => setImmediate(resolve));
    if (binding) await binding.close();
    if (client) {
      try {
        if (began) await client.query("ROLLBACK");
        if (baseline) {
          const cleanupDeadline = Date.now() + 20_000;
          const rawCleanupQuery = client.query.bind(client);
          const cleanupQuery = ((...args: unknown[]) => {
            if (Date.now() >= cleanupDeadline) throw new Error("E2E_CLEANUP_BUDGET_EXCEEDED");
            return Reflect.apply(rawCleanupQuery, undefined, args);
          }) as PoolClient["query"];
          assert.deepEqual(await tableCounts(cleanupQuery), baseline,
            "E2E row residue remains after rollback");
          assertEmptyBusinessRows(await emptyCounts(cleanupQuery));
          passed.push("all public table row counts restored; business fixtures absent");
        }
      } catch (error) { cleanupErrors.push(error); }
      client.release(true);
    }
    if (pool) { try { await pool.end(); } catch (error) { cleanupErrors.push(error); } }
    try { await removeOwnedTree(root, ownedRoot.dev, ownedRoot.ino); passed.push("owned temporary storage removed"); }
    catch (error) { cleanupErrors.push(error); }
    if (binding?.lateQueries) cleanupErrors.push(new Error("E2E_LATE_QUERIES_DENIED"));
    if (fence.denied) cleanupErrors.push(new Error("E2E_EXTERNAL_EFFECT_ATTEMPT_DENIED"));
  }
  if (primaryError || cleanupErrors.length) {
    throw new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], "E2E_CORRIDOR_FAILED");
  }
  return { status: "PASS", corridor: "transactional-http-auth-local-storage", runId: expected.runId,
    passed, limitations: ["No browser/application journey", "Single rollback-only DB connection; sequences may advance",
      "Standard Node egress fence is not an OS firewall", "Narrow route composition, not full app bootstrap or global route gates",
      "No full pool concurrency, real provider, or deployment proof"] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runDisposableRouteE2e().then(result => { console.log(JSON.stringify(result, null, 2)); }, error => {
    console.error(error); process.exitCode = 1;
  });
}
