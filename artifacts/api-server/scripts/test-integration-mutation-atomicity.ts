/** Real integration handlers against rollback-capable in-memory DB doubles. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import express from "express";
import http from "node:http";
import { once } from "node:events";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5433/fasos_apply_local";
process.env.ENCRYPTION_KEY = "synthetic-integration-route-fixture";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
process.env.NODE_ENV = "test";

const schema = await import("@workspace/db");
const { db, pool } = schema;
mock.method(pool, "connect", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(globalThis, "fetch", () => { throw new Error("PROVIDER_CALL_FORBIDDEN"); });

type Row = Record<string, any>;
let rows: Row[] = [];
let audits: Row[] = [];
let failAudit = false;
let conflict = false;
let nextId = 10;

const chain = (read: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit", "for"]) result[method] = () => result;
  return result;
};

mock.method(db, "select", () => ({ from: (table: unknown) => chain(() => table === schema.integrationsTable ? rows : []) }));
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values });
    return Promise.resolve();
  }
  const row = { id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...values };
  rows.push(row);
  return { returning: async () => [row] };
} }));
mock.method(db, "update", () => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  if (conflict) return [];
  rows = rows.map((row) => ({ ...row, ...values, updatedAt: new Date(row.updatedAt.getTime() + 1) }));
  return rows.slice(-1);
} }) }) }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const rowSnapshot = rows.map((row) => ({ ...row }));
  const auditSnapshot = audits.map((row) => ({ ...row }));
  try { return await callback(db); }
  catch (error) { rows = rowSnapshot; audits = auditSnapshot; throw error; }
});

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 7, role: "super_admin", isActive: true } as any; next(); });
const router = (await import("../src/routes/integrations")).default;
app.use("/api", router);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "fixture_failure" }));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;

function request(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api${path}`, method,
      headers: { "Content-Type": "application/json", ...(json ? { "Content-Length": Buffer.byteLength(json) } : {}) } }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (json) req.write(json);
    req.end();
  });
}

beforeEach(() => { rows = []; audits = []; failAudit = false; conflict = false; nextId = 10; });
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
  mock.restoreAll();
});

test("PUT rolls back a newly-created integration when its audit insert fails", async () => {
  failAudit = true;
  const result = await request("PUT", "/integrations/custom", { name: "Custom", category: "communication", config: { apiKey: "do-not-log" } });
  assert.equal(result.status, 500);
  assert.deepEqual(rows, []);
  assert.deepEqual(audits, []);
});

test("PUT rolls back an existing integration update when its audit insert fails", async () => {
  rows = [{ id: 4, key: "custom", name: "Before", category: "communication", isEnabled: false, config: {}, createdAt: new Date(), updatedAt: new Date() }];
  failAudit = true;
  const result = await request("PUT", "/integrations/custom", { name: "After", category: "communication", isEnabled: true, config: {} });
  assert.equal(result.status, 500);
  assert.equal(rows[0].name, "Before");
  assert.equal(rows[0].isEnabled, false);
});

test("toggle rolls back enabled state when its audit insert fails", async () => {
  rows = [{ id: 4, key: "custom", name: "Custom", category: "communication", isEnabled: false, config: {}, createdAt: new Date(), updatedAt: new Date() }];
  failAudit = true;
  const result = await request("PATCH", "/integrations/custom/toggle");
  assert.equal(result.status, 500);
  assert.equal(rows[0].isEnabled, false);
});

test("optimistic conflict reports 409 without audit or cache-visible success", async () => {
  rows = [{ id: 4, key: "custom", name: "Custom", category: "communication", isEnabled: false, config: {}, createdAt: new Date(), updatedAt: new Date() }];
  conflict = true;
  const result = await request("PATCH", "/integrations/custom/toggle");
  assert.equal(result.status, 409);
  assert.equal(result.data.error, "integration_version_conflict");
  assert.equal(rows[0].isEnabled, false);
  assert.deepEqual(audits, []);
});

test("successful update writes one bounded audit without credential material", async () => {
  const result = await request("PUT", "/integrations/custom", { name: "Custom", category: "communication", isEnabled: false, config: { apiKey: "secret-value" } });
  assert.equal(result.status, 200);
  assert.equal(rows.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "update_integration");
  assert.equal(audits[0].resource, "integration");
  assert.equal(JSON.stringify(audits[0]).includes("secret-value"), false);
});

test("live-gated enable remains fail-closed before mutation", async () => {
  rows = [{ id: 4, key: "instagram", name: "Instagram", category: "communication", isEnabled: false, config: {}, createdAt: new Date(), updatedAt: new Date() }];
  const result = await request("PATCH", "/integrations/instagram/toggle");
  assert.equal(result.status, 403);
  assert.equal(result.data.error, "live_integrations_disabled");
  assert.equal(rows[0].isEnabled, false);
  assert.deepEqual(audits, []);
});
