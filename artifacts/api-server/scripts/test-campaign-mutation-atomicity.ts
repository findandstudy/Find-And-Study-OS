/** Campaign mutation/audit tests with rollback-capable DB doubles. */
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

const chain = (read: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit"]) result[method] = () => result;
  return result;
};
mock.method(db, "select", () => ({ from: (table: unknown) => chain(() => {
  if (table === schema.campaignsTable) return rows;
  if (table === schema.universitiesTable) return [{ id: 1 }];
  return [];
}) }));
mock.method(db, "selectDistinct", () => ({ from: () => chain(() => []) }));
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values });
    return Promise.resolve();
  }
  const row = { id: nextId++, archivedAt: null, createdAt: new Date(), ...values };
  rows.push(row);
  return { returning: async () => [row] };
} }));
mock.method(db, "update", () => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  rows = rows.map(row => ({ ...row, ...values }));
  return rows;
} }) }) }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const rowSnapshot = rows.map(row => ({ ...row }));
  const auditSnapshot = audits.map(row => ({ ...row }));
  try { return await callback(db); } catch (error) { rows = rowSnapshot; audits = auditSnapshot; throw error; }
});

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 7, role: "super_admin", isActive: true } as any; next(); });
const router = (await import("../src/routes/campaigns")).default;
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

const existing = (archivedAt: Date | null = null) => ({ id: 1, name: "Existing", description: null, changeType: "discount",
  changePercent: 10, startDate: "2026-01-01", endDate: "2026-12-31", universityIds: [1], agentCountries: [],
  isActive: true, archivedAt, createdBy: 7, createdAt: new Date() });
const createBody = { name: "New", description: "private campaign details", changeType: "discount", changePercent: 10,
  startDate: "2026-01-01", endDate: "2026-12-31", universityIds: [1] };
beforeEach(() => { rows = [existing()]; audits = []; failAudit = false; nextId = 10; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); mock.restoreAll(); });

test("create rolls back when audit persistence fails", async () => {
  failAudit = true;
  const result = await request("POST", "/campaigns", createBody);
  assert.equal(result.status, 500);
  assert.equal(rows.length, 1);
});

test("update rolls back when audit persistence fails", async () => {
  failAudit = true;
  const result = await request("PUT", "/campaigns/1", { description: "changed" });
  assert.equal(result.status, 500);
  assert.equal(rows[0].description, null);
});

test("archive rolls back when audit persistence fails", async () => {
  failAudit = true;
  const result = await request("DELETE", "/campaigns/1");
  assert.equal(result.status, 500);
  assert.equal(rows[0].archivedAt, null);
});

test("restore rolls back when audit persistence fails", async () => {
  rows = [existing(new Date("2026-09-01T00:00:00Z"))];
  failAudit = true;
  const result = await request("POST", "/campaigns/1/restore");
  assert.equal(result.status, 500);
  assert.ok(rows[0].archivedAt instanceof Date);
});

test("university identifiers are strict, positive and deduplicated", async () => {
  rows = [];
  const result = await request("POST", "/campaigns", { ...createBody, universityIds: [1, "1", "1x", -1] });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.deepEqual(rows[0].universityIds, [1]);
});

test("successful update audits field names without campaign content", async () => {
  const result = await request("PUT", "/campaigns/1", { description: "confidential campaign body", changePercent: 15 });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(audits.length, 1);
  assert.deepEqual(JSON.parse(audits[0].changes), { changedFields: ["changePercent", "description"] });
  assert.equal(audits[0].changes.includes("confidential campaign body"), false);
});
