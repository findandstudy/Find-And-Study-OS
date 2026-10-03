/** AI extractor CRUD integrity tests with transaction-capable DB doubles. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import express from "express";
import http from "node:http";
import { once } from "node:events";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5433/fasos_apply_local";
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
let hasRun = false;
let hasWidget = false;
let nextId = 10;

const chain = (read: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit", "for", "groupBy"]) result[method] = () => result;
  return result;
};
mock.method(db, "select", () => ({ from: (table: unknown) => chain(() => {
  if (table === schema.aiExtractorsTable) return rows;
  if (table === schema.aiExtractorRunsTable) return hasRun ? [{ id: 70 }] : [];
  if (table === schema.embedWidgetsTable) return hasWidget ? [{ id: 80 }] : [];
  return [];
}) }));
mock.method(db, "execute", async () => []);
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
mock.method(db, "update", () => ({ set: (values: Row) => ({ where: () => {
  rows = rows.map(row => ({ ...row, ...values, updatedAt: new Date() }));
  const promise: any = Promise.resolve();
  promise.returning = async () => rows.slice(-1);
  return promise;
} }) }));
mock.method(db, "delete", () => ({ where: async () => { rows = []; } }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const rowSnapshot = rows.map(row => ({ ...row }));
  const auditSnapshot = audits.map(row => ({ ...row }));
  try { return await callback(db); }
  catch (error) { rows = rowSnapshot; audits = auditSnapshot; throw error; }
});

const app = express();
app.use((req, _res, next) => { req.user = { id: 7, role: "super_admin", isActive: true } as any; next(); });
const router = (await import("../src/routes/ai-extractors")).default;
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

const existing = () => ({ id: 1, name: "Existing", slug: "existing", provider: "anthropic", model: "model", systemPrompt: "old",
  systemPromptByLang: {}, fields: [{ key: "name", label: "Name", type: "string" }], rules: {}, scopes: ["staff"], documentTypes: [],
  temperature: "0.2", maxTokens: 4096, isActive: true, isDefault: true, createdAt: new Date(), updatedAt: new Date() });
const createBody = { name: "New", slug: "new", model: "model", systemPrompt: "confidential prompt",
  fields: [{ key: "name", label: "Name", type: "string" }], scopes: ["staff"], isDefault: true };
beforeEach(() => { rows = [existing()]; audits = []; failAudit = false; hasRun = false; hasWidget = false; nextId = 10; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); mock.restoreAll(); });

test("create rolls back both default reassignment and new extractor when audit fails", async () => {
  failAudit = true;
  const result = await request("POST", "/ai-extractors", createBody);
  assert.equal(result.status, 503);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isDefault, true);
  assert.deepEqual(audits, []);
});

test("update rolls back config when audit fails", async () => {
  failAudit = true;
  const result = await request("PUT", "/ai-extractors/1", { description: "after" });
  assert.equal(result.status, 500);
  assert.equal(rows[0].description, undefined);
  assert.deepEqual(audits, []);
});

test("referenced or evidence-bearing extractor cannot be deleted", async () => {
  hasRun = true;
  const result = await request("DELETE", "/ai-extractors/1");
  assert.equal(result.status, 409);
  assert.equal(result.data.error, "AI_EXTRACTOR_IN_USE");
  assert.equal(rows.length, 1);
  assert.deepEqual(audits, []);
});

test("delete rolls back when audit fails", async () => {
  failAudit = true;
  const result = await request("DELETE", "/ai-extractors/1");
  assert.equal(result.status, 500);
  assert.equal(rows.length, 1);
  assert.deepEqual(audits, []);
});

test("successful create writes bounded metadata without prompt content", async () => {
  const result = await request("POST", "/ai-extractors", createBody);
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].isDefault, false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "create_ai_extractor");
  assert.equal(JSON.stringify(audits[0]).includes("confidential prompt"), false);
});
