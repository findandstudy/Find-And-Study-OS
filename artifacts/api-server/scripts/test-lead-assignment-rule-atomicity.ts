/** Lead-assignment rule mutation/audit tests with rollback-capable DB doubles. */
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
let nextId = 10;

const returning = (read: () => Row[]) => ({ returning: async () => read() });
mock.method(db, "select", () => ({ from: () => ({ orderBy: async () => rows }) }));
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values });
    return Promise.resolve();
  }
  const row = { id: nextId++, ...values };
  rows.push(row);
  return returning(() => [row]);
} }));
mock.method(db, "update", () => ({ set: (values: Row) => ({ where: () => returning(() => {
  if (rows.length === 0) return [];
  rows[0] = { ...rows[0], ...values };
  return [rows[0]];
}) }) }));
mock.method(db, "delete", () => ({ where: () => returning(() => {
  const removed = rows.slice(0, 1);
  rows = [];
  return removed;
}) }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const rowSnapshot = rows.map(row => ({ ...row }));
  const auditSnapshot = audits.map(row => ({ ...row }));
  try { return await callback(db); } catch (error) { rows = rowSnapshot; audits = auditSnapshot; throw error; }
});

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 7, role: "super_admin", isActive: true } as any; next(); });
const router = (await import("../src/routes/leadAssignmentRules")).default;
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

const existing = () => ({ id: 1, name: "Existing", staffUserIds: [4], strategy: "first" });
beforeEach(() => { rows = [existing()]; audits = []; failAudit = false; nextId = 10; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); mock.restoreAll(); });

test("create rolls back when audit persistence fails", async () => {
  failAudit = true;
  const result = await request("POST", "/settings/lead-assignment-rules", { name: "New", staffUserIds: [4] });
  assert.equal(result.status, 500);
  assert.deepEqual(rows, [existing()]);
  assert.deepEqual(audits, []);
});

test("update rolls back when audit persistence fails", async () => {
  failAudit = true;
  const result = await request("PATCH", "/settings/lead-assignment-rules/1", { name: "Changed" });
  assert.equal(result.status, 500);
  assert.equal(rows[0].name, "Existing");
  assert.deepEqual(audits, []);
});

test("delete rolls back when audit persistence fails", async () => {
  failAudit = true;
  const result = await request("DELETE", "/settings/lead-assignment-rules/1");
  assert.equal(result.status, 500);
  assert.equal(rows.length, 1);
  assert.deepEqual(audits, []);
});

test("staff identifiers are strict, positive and deduplicated", async () => {
  rows = [];
  const result = await request("POST", "/settings/lead-assignment-rules", { name: "Strict", staffUserIds: ["4", "4", "4x", -1, 5] });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.deepEqual(rows[0].staffUserIds, [4, 5]);
});

test("successful update emits bounded field metadata instead of submitted values", async () => {
  const result = await request("PATCH", "/settings/lead-assignment-rules/1", { name: "Changed", countries: ["TR"] });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "update_lead_assignment_rule");
  assert.deepEqual(JSON.parse(audits[0].changes), { changedFields: ["countries", "name"] });
});
