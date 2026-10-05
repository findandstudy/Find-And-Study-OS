/** AI-default mutation/audit/version tests using rollback-capable DB doubles. */
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

type Row = Record<string, any>;
let rows: Row[] = [];
let audits: Row[] = [];
let failAudit = false;
let nextTime = 2;

const chain = (read: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit"]) result[method] = () => result;
  return result;
};
mock.method(db, "select", () => ({ from: (table: unknown) => chain(() => table === schema.aiDefaultConfigsTable ? rows : []) }));
mock.method(db, "execute", async () => []);
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values });
    return Promise.resolve();
  }
  const row = { createdAt: new Date(0), updatedAt: new Date(nextTime++), ...values };
  rows = [row];
  return { returning: async () => [row] };
} }));
mock.method(db, "update", () => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  rows = rows.map(row => ({ ...row, ...values }));
  return rows;
} }) }) }));
mock.method(db, "delete", () => ({ where: async () => { rows = []; } }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const rowSnapshot = rows.map(row => ({ ...row }));
  const auditSnapshot = audits.map(row => ({ ...row }));
  try { return await callback(db); }
  catch (error) { rows = rowSnapshot; audits = auditSnapshot; throw error; }
});

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use((req, _res, next) => { req.user = { id: 7, role: "super_admin", isActive: true } as any; next(); });
const router = (await import("../src/routes/ai-defaults")).default;
app.use("/api", router);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "fixture_failure" }));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;

function request(method: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path: "/api/ai-defaults/persona.builtin.systemPrompt", method,
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

const initial = () => ({ key: "persona.builtin.systemPrompt", value: { text: "before" }, updatedBy: 1, createdAt: new Date(0), updatedAt: new Date(1) });
beforeEach(() => { rows = [initial()]; audits = []; failAudit = false; nextTime = 2; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); mock.restoreAll(); });

test("PUT rolls back the AI default when its audit insert fails", async () => {
  failAudit = true;
  const result = await request("PUT", { value: { text: "after" }, expectedUpdatedAt: new Date(1).toISOString() });
  assert.equal(result.status, 500);
  assert.deepEqual(rows[0].value, { text: "before" });
  assert.deepEqual(audits, []);
});

test("DELETE rolls back reset when its audit insert fails", async () => {
  failAudit = true;
  const result = await request("DELETE", { expectedUpdatedAt: new Date(1).toISOString() });
  assert.equal(result.status, 500);
  assert.equal(rows.length, 1);
  assert.deepEqual(audits, []);
});

test("stale editor cannot overwrite a newer AI default", async () => {
  const result = await request("PUT", { value: { text: "stale" }, expectedUpdatedAt: new Date(0).toISOString() });
  assert.equal(result.status, 409);
  assert.equal(result.data.error, "ai_default_version_conflict");
  assert.deepEqual(rows[0].value, { text: "before" });
  assert.deepEqual(audits, []);
});

test("oversized configuration is rejected before mutation", async () => {
  const result = await request("PUT", { value: { text: "x".repeat(65_537) }, expectedUpdatedAt: new Date(1).toISOString() });
  assert.equal(result.status, 413);
  assert.deepEqual(rows[0].value, { text: "before" });
  assert.deepEqual(audits, []);
});

test("successful PUT writes bounded version metadata without prompt content", async () => {
  const result = await request("PUT", { value: { text: "confidential prompt" }, expectedUpdatedAt: new Date(1).toISOString() });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(rows[0].value, { text: "confidential prompt" });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "update_ai_default");
  assert.equal(JSON.stringify(audits[0]).includes("confidential prompt"), false);
});
