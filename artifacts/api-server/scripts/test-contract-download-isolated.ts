/** Disposable-only HTTP smoke. Never import app.ts/index.ts or invoke signing/send APIs.
 * Run from the exact candidate image, sharing a --network none PostgreSQL namespace.
 * This harness injects synthetic request principals; it does NOT attest browser login.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";

const timer = setTimeout(() => { console.error("FAIL: harness exceeded 90 seconds"); process.exit(1); }, 90_000);
timer.unref();
assert.equal(process.platform, "linux", "Run only in the isolated Linux candidate container");
assert.notEqual(process.getuid?.(), 0, "Candidate must retain its non-root runtime user");
assert.equal(process.env.CONTRACT_HTTP_TEST_DISPOSABLE, "1", "Explicit disposable-test acknowledgement required");
assert.equal(process.env.CONTRACT_HTTP_TEST_EXPECT_EMPTY, "1", "Use an empty, freshly migrated test database");
const dbUrl = new URL(process.env.DATABASE_URL || "invalid:");
assert.ok(["postgres:", "postgresql:"].includes(dbUrl.protocol));
assert.equal(dbUrl.hostname, "127.0.0.1");
assert.equal(dbUrl.port || "5432", "5432");
assert.equal(dbUrl.search, "");
assert.equal(dbUrl.hash, "");
const databaseName = decodeURIComponent(dbUrl.pathname.slice(1));
assert.match(databaseName, /^fas_pdf_http_test_[a-z0-9_]{6,48}$/);
for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
  assert.ok(name === "lo" && addresses?.every(item => item.internal), "Only a loopback network namespace is allowed");
}
for (const key of Object.keys(process.env)) {
  if (/^(SMTP|SENDGRID|RESEND|POSTMARK|MAILGUN|TWILIO|AWS_ACCESS_KEY|AWS_SECRET_ACCESS_KEY|GOOGLE_APPLICATION_CREDENTIALS)/.test(key)) {
    assert.ok(!process.env[key], `Provider configuration forbidden: ${key}`);
  }
}
Object.assign(process.env, {
  NODE_ENV: "test", ALLOW_LIVE_INTEGRATIONS: "false", EMAIL_DELIVERY_DISABLED: "true",
  BACKGROUND_JOBS_ENABLED: "false", SIGNED_CONTRACT_PDF_WORKER_ENABLED: "false",
  AI_AUTO_REPLY_KILL_SWITCH: "true", STORAGE_DRIVER: "local", DB_POOL_MAX: "1",
  DB_CONNECT_TIMEOUT_MS: "5000", DB_QUERY_TIMEOUT_MS: "10000", DB_STATEMENT_TIMEOUT_MS: "10000",
  DB_IDLE_TIMEOUT_MS: "120000", APP_BASE_URL: "http://127.0.0.1", WEBSITE_TRANSLATION_QUEUE_ENABLED: "false",
});
const runId = crypto.randomBytes(6).toString("hex");
const storageRoot = await fs.mkdtemp(`/tmp/fas-pdf-http-${runId}-`);
process.env.STORAGE_LOCAL_DIR = storageRoot;
let httpPort = 0;
let blockedConnections = 0;
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: any[]) {
  // net.createConnection can forward Node's normalized [options, callback]
  // array as its sole argument. Inspect it without changing original arguments.
  const inspected = Array.isArray(args[0]) ? args[0] : args;
  const first = inspected[0];
  const options = typeof first === "object" && !Array.isArray(first) ? first : null;
  const host = options ? (options.host ?? options.hostname) : inspected[1];
  const port = Number(options ? options.port : first);
  if (host !== "127.0.0.1" || ![5432, httpPort].includes(port) || !port) {
    blockedConnections++;
    throw new Error("HTTP_SMOKE_FORBIDDEN_NETWORK_CONNECTION");
  }
  return Reflect.apply(originalConnect, this, args);
} as typeof net.Socket.prototype.connect;
syncBuiltinESMExports();

const apiRoot = path.resolve("artifacts/api-server");
assert.equal(apiRoot, "/app/artifacts/api-server", "Run from /app in the candidate image");
const apiRequire = createRequire(path.join(apiRoot, "package.json"));
const dependency = async (name: string) => import(pathToFileURL(apiRequire.resolve(name)).href);
const source = async (name: string) => import(pathToFileURL(path.join(apiRoot, "src", name)).href);
let pool: any;
let server: http.Server | undefined;
let browser: any;
let exitCode = 1;
const results: Record<string, unknown>[] = [];
try {
  const workspace = await dependency("@workspace/db");
  const { db, usersTable, agentsTable, contractTemplatesTable, signingSessionsTable, signedContractsTable } = workspace;
  pool = workspace.pool;
  const identity = (await pool.query("select current_database() as name, inet_server_addr()::text as address, inet_server_port() as port")).rows[0];
  assert.equal(identity.name, databaseName);
  assert.equal(identity.address, "127.0.0.1");
  assert.equal(identity.port, 5432);
  for (const table of ["users", "agents", "contract_templates", "signing_sessions", "signed_contracts", "email_queue"]) {
    assert.equal((await pool.query(`select count(*)::int as count from public.${table}`)).rows[0].count, 0, `Database not empty: ${table}`);
  }
  const playwright = await dependency("playwright-core");
  browser = await playwright.chromium.launch({ executablePath: "/usr/bin/chromium", headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--single-process", "--no-zygote",
      "--disable-gpu", "--disable-software-rasterizer", "--disable-extensions", "--disable-background-networking"] });
  const page = await browser.newPage();
  await page.route("**/*", (route: any) => route.abort());
  await page.setContent("<!doctype html><html lang='en'><body><h1>TEST ONLY — NOT A SIGNED AGREEMENT</h1><p>Synthetic PDF download route fixture. No signature, no legal effect.</p></body></html>");
  const pdf: Buffer = await page.pdf({ format: "A4", printBackground: true });
  await browser.close(); browser = undefined;
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const pdfHash = crypto.createHash("sha256").update(pdf).digest("hex");
  const relativeKey = `signed-contracts/test-download-${runId}.pdf`;
  await fs.mkdir(path.join(storageRoot, "signed-contracts"), { mode: 0o700 });
  await fs.writeFile(path.join(storageRoot, relativeKey), pdf, { mode: 0o600, flag: "wx" });
  const objectKey = `/objects/${relativeKey}`;
  const principals: Record<string, any> = {};
  for (const name of ["admin", "ready", "pending", "stranger"]) {
    const [row] = await db.insert(usersTable).values({ email: `test-${runId}-${name}@example.invalid`,
      firstName: "TEST ONLY", lastName: name, role: name === "admin" ? "super_admin" : "agent", isActive: true, emailVerified: true }).returning();
    principals[name] = row;
  }
  const agencies: Record<string, any> = {};
  for (const name of ["ready", "pending", "stranger"]) {
    const [row] = await db.insert(agentsTable).values({ userId: principals[name].id, firstName: "TEST ONLY", lastName: name,
      email: principals[name].email, status: "provisional", accessTier: "provisional", contractUrl: name === "pending" ? objectKey : null }).returning();
    agencies[name] = row;
  }
  const [template] = await db.insert(contractTemplatesTable).values({ name: `TEST ONLY download ${runId}`,
    title: "TEST ONLY — NOT A SIGNED AGREEMENT", language: "en", entityType: "company", isActive: false,
    publicationStatus: "draft", bodyHtml: "<h1>TEST ONLY — NOT A SIGNED AGREEMENT</h1>" }).returning();
  const fixtures: Record<string, any> = {};
  for (const [name, owner, ready, age] of [["ready", "ready", true, 60_000], ["oldReady", "pending", true, 120_000], ["pending", "pending", false, 0]] as const) {
    const token = crypto.randomBytes(32).toString("base64url");
    const signedAt = new Date(Date.now() - age);
    const [session] = await db.insert(signingSessionsTable).values({ templateId: template.id, agentId: agencies[owner].id,
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"), status: "signed", mode: "admin_driven",
      signerEmail: principals[owner].email, expectedEmail: principals[owner].email, verifiedEmail: principals[owner].email,
      signerName: `TEST ONLY ${name}`, emailVerificationMethod: "test_fixture", emailVerifiedAt: signedAt,
      subjectType: "other", subjectLabel: `TEST ONLY ${runId}`, signedAt, expiresAt: new Date(Date.now() + 86_400_000),
      templateVersionSnapshot: 1, templateBodyHtmlSnapshot: template.bodyHtml, isPrimaryOnboarding: name !== "pending" }).returning();
    const [signed] = await db.insert(signedContractsTable).values({ signingSessionId: session.id, agentId: agencies[owner].id,
      templateId: template.id, signerEmail: principals[owner].email, signerName: `TEST ONLY ${name}`, signedAt,
      pdfObjectKey: ready ? objectKey : null, evidenceHash: ready ? pdfHash : null,
      signatureImageBase64: null, subjectType: "other", subjectLabel: `TEST ONLY ${runId}`, emailedAt: null }).returning();
    fixtures[name] = { session, signed, token };
  }
  const { default: express } = await dependency("express");
  const adminRouter = (await source("routes/contracts.ts")).default;
  const agentRouter = (await source("routes/agentOnboarding.ts")).default;
  const publicRouter = (await source("routes/publicSigning.ts")).default;
  const app = express();
  app.use((req: any, res: any, next: any) => {
    if (req.method !== "GET") return res.status(405).json({ error: "GET_ONLY_TEST_HARNESS" });
    const name = String(req.headers["x-test-principal"] ?? "");
    if (principals[name]) req.user = principals[name];
    req.cookies = {};
    next();
  });
  app.use("/api", adminRouter, agentRouter, publicRouter);
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  httpPort = (server.address() as net.AddressInfo).port;
  // Existing one-connection pool becomes read-only before HTTP requests. Any future
  // connection is likewise set read-only before it can execute queued queries.
  pool.on("connect", (client: any) => { void client.query("SET default_transaction_read_only = on"); });
  await pool.query("SET default_transaction_read_only = on");
  assert.equal((await pool.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only, "on");
  const tables = (await pool.query("select tablename from pg_tables where schemaname = 'public' order by tablename")).rows.map((row: any) => String(row.tablename));
  assert.ok(tables.length > 5 && tables.length < 800);
  async function databaseSnapshot() {
    const snapshot: Record<string, unknown> = {};
    for (const table of tables) {
      assert.match(table, /^[a-zA-Z0-9_]+$/);
      snapshot[table] = (await pool.query(`select count(*)::int as count, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by md5(to_jsonb(t)::text)), '')) as digest from public."${table}" t`)).rows[0];
    }
    return snapshot;
  }
  const before = await databaseSnapshot();
  const beforeStorage = (await fs.readdir(path.join(storageRoot, "signed-contracts"))).sort();
  async function check(label: string, url: string, principal: string | null, status: number, expectedPdf = false) {
    const response = await fetch(`http://127.0.0.1:${httpPort}${url}`, { redirect: "manual",
      headers: principal ? { "x-test-principal": principal } : {}, signal: AbortSignal.timeout(10_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, status, `${label}: ${bytes.subarray(0, 120).toString()}`);
    if (expectedPdf) {
      assert.match(response.headers.get("content-type") || "", /^application\/pdf(?:;|$)/i);
      assert.match(response.headers.get("content-disposition") || "", /^attachment;.*_signed\.pdf/);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(bytes.length, pdf.length);
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), pdfHash);
    } else {
      assert.match(response.headers.get("content-type") || "", /application\/json/);
      if (status === 202) { assert.equal(JSON.parse(bytes.toString()).status, "pending"); assert.equal(response.headers.get("retry-after"), "30"); }
    }
    results.push({ label, status, ...(expectedPdf ? { bytes: bytes.length, sha256: pdfHash } : {}) });
  }
  await check("admin-ready", `/api/contracts/signed/${fixtures.ready.signed.id}/pdf`, "admin", 200, true);
  await check("admin-ready-repeat", `/api/contracts/signed/${fixtures.ready.signed.id}/pdf`, "admin", 200, true);
  await check("admin-missing", `/api/contracts/signed/${fixtures.pending.signed.id}/pdf`, "admin", 202);
  await check("public-ready", `/api/public/sign/${fixtures.ready.token}/pdf`, null, 200, true);
  await check("public-missing", `/api/public/sign/${fixtures.pending.token}/pdf`, null, 202);
  await check("agent-ready", "/api/contracts/me/pdf", "ready", 200, true);
  await check("agent-newest-pending-never-old-pdf", "/api/contracts/me/pdf", "pending", 202);
  await check("agent-stranger-has-no-pdf", "/api/contracts/me/pdf", "stranger", 404);
  await check("admin-anonymous-denied", `/api/contracts/signed/${fixtures.ready.signed.id}/pdf`, null, 401);
  await check("agent-anonymous-denied", "/api/contracts/me/pdf", null, 401);
  await check("agent-cannot-use-admin-download", `/api/contracts/signed/${fixtures.ready.signed.id}/pdf`, "stranger", 403);
  await check("unknown-public-token-denied", `/api/public/sign/${crypto.randomBytes(32).toString("base64url")}/pdf`, null, 404);
  assert.deepEqual(await databaseSnapshot(), before, "GET routes changed persistent data");
  assert.deepEqual((await fs.readdir(path.join(storageRoot, "signed-contracts"))).sort(), beforeStorage);
  assert.equal(crypto.createHash("sha256").update(await fs.readFile(path.join(storageRoot, relativeKey))).digest("hex"), pdfHash);
  assert.equal(blockedConnections, 0, "Unexpected network attempt occurred");
  console.log(JSON.stringify({ result: "PASS", routeChecks: results, allPublicTablesUnchanged: tables.length,
    storageUnchanged: true, noExternalConnections: true, noSigningOrSendAPI: true,
    authentication: "SYNTHETIC_PRINCIPAL_ADAPTER_ONLY_NOT_REAL_LOGIN", database: databaseName }));
  exitCode = 0;
} catch (error) {
  console.error("FAIL", error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : "unknown");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  if (pool) await pool.end().catch(() => {});
  net.Socket.prototype.connect = originalConnect;
  syncBuiltinESMExports();
  clearTimeout(timer);
  // Do not DELETE signed evidence via an application route. The whole disposable
  // database/container/tmpfs is discarded by the operator after this process.
  process.exit(exitCode);
}
