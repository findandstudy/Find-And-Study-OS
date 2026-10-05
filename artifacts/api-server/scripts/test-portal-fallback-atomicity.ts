/** Portal program-fallback mutation/audit tests with rollback-capable DB doubles. */
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
let rows: Row[] = []; let audits: Row[] = []; let failAudit = false; let nextId = 10; let locks = 0;
const chain = (read: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit", "for"]) result[method] = () => result;
  return result;
};
mock.method(db, "select", () => ({ from: (table: unknown) => chain(() => {
  if (table === schema.portalProgramFallbacksTable) return rows;
  if (table === schema.programsTable) return [{ id: 10, name: "Source" }, { id: 20, name: "Fallback" }];
  return [];
}) }));
mock.method(db, "execute", async () => { locks++; return []; });
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values }); return Promise.resolve();
  }
  const row = { id: nextId++, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...values };
  rows.push(row); return { returning: async () => [row] };
} }));
mock.method(db, "update", () => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  rows = rows.map(row => ({ ...row, ...values })); return rows;
} }) }) }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const rowSnapshot = rows.map(row => ({ ...row })); const auditSnapshot = audits.map(row => ({ ...row }));
  try { return await callback(db); } catch (error) { rows = rowSnapshot; audits = auditSnapshot; throw error; }
});
const app = express(); app.use(express.json());
app.use((req, _res, next) => { req.user = { id: 7, role: "super_admin", isActive: true } as any; next(); });
const router = (await import("../src/routes/portalProgramFallbacks")).default;
app.use("/api", router);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "fixture_failure" }));
const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
const port = (server.address() as { port: number }).port;
function request(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api${path}`, method,
      headers: { "Content-Type": "application/json", ...(json ? { "Content-Length": Buffer.byteLength(json) } : {}) } }, res => {
      let text = ""; res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    }); req.on("error", reject); if (json) req.write(json); req.end();
  });
}
const existing = () => ({ id: 1, universityKey: "topkapi", sourceProgramId: 10, fallbackProgramIds: [20], autoSubmit: true,
  enabled: true, deletedAt: null, createdAt: new Date(), updatedAt: new Date() });
beforeEach(() => { rows = [existing()]; audits = []; failAudit = false; nextId = 10; locks = 0; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); mock.restoreAll(); });

test("create rolls back when audit persistence fails", async () => {
  rows = []; failAudit = true;
  const result = await request("POST", "/portal-program-fallbacks", { universityKey: "topkapi", sourceProgramId: 10, fallbackProgramIds: [20] });
  assert.equal(result.status, 500); assert.deepEqual(rows, []); assert.equal(locks, 1);
});
test("duplicate create is rejected while holding the serialized key", async () => {
  const result = await request("POST", "/portal-program-fallbacks", { universityKey: "topkapi", sourceProgramId: 10, fallbackProgramIds: [20] });
  assert.equal(result.status, 409); assert.equal(locks, 1); assert.deepEqual(audits, []);
});
test("source program cannot reference itself", async () => {
  rows = [];
  const result = await request("POST", "/portal-program-fallbacks", { universityKey: "topkapi", sourceProgramId: 10, fallbackProgramIds: [10] });
  assert.equal(result.status, 400); assert.deepEqual(rows, []); assert.equal(locks, 0);
});
test("update rolls back when audit persistence fails", async () => {
  failAudit = true;
  const result = await request("PATCH", "/portal-program-fallbacks/1", { fallbackProgramIds: [20, 20] });
  assert.equal(result.status, 500); assert.deepEqual(rows[0].fallbackProgramIds, [20]);
});
test("delete rolls back when audit persistence fails", async () => {
  failAudit = true;
  const result = await request("DELETE", "/portal-program-fallbacks/1");
  assert.equal(result.status, 500); assert.equal(rows[0].deletedAt, null);
});
test("successful update deduplicates ids and audits only field names", async () => {
  const result = await request("PATCH", "/portal-program-fallbacks/1", { fallbackProgramIds: [20, 20], autoSubmit: false });
  assert.equal(result.status, 200, JSON.stringify(result.data)); assert.deepEqual(rows[0].fallbackProgramIds, [20]);
  assert.deepEqual(JSON.parse(audits[0].changes), { changedFields: ["autoSubmit", "fallbackProgramIds"] });
});
