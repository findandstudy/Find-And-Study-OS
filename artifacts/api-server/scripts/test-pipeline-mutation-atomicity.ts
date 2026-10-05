/** Pipeline replacement/audit rollback tests; no real DB or delivery provider. */
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
let writes = 0;
let nextId = 50;

const chain = (read: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit", "innerJoin", "for"]) result[method] = () => result;
  return result;
};
mock.method(db, "select", () => ({ from: () => chain(() => rows) }));
mock.method(db, "delete", () => ({ where: async () => { writes++; rows = []; } }));
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row | Row[]) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...(values as Row) });
    return Promise.resolve();
  }
  writes++;
  const input = Array.isArray(values) ? values : [values];
  const inserted = input.map(value => ({ id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...value }));
  rows.push(...inserted);
  return { returning: async () => inserted };
} }));
mock.method(db, "update", () => ({ set: () => ({ where: async () => { writes++; } }) }));
mock.method(db, "execute", async () => []);
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const rowSnapshot = rows.map(row => ({ ...row }));
  const auditSnapshot = audits.map(row => ({ ...row }));
  const writeSnapshot = writes;
  try { return await callback(db); }
  catch (error) { rows = rowSnapshot; audits = auditSnapshot; writes = writeSnapshot; throw error; }
});

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use((req, _res, next) => { req.user = { id: 7, role: "super_admin", isActive: true } as any; next(); });
const router = (await import("../src/routes/pipeline")).default;
app.use("/api", router);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "fixture_failure" }));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;

function request(body: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path: "/api/pipeline-stages/lead", method: "PUT",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) } }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    req.write(json);
    req.end();
  });
}

beforeEach(() => { rows = [{ id: 1, entityType: "lead", key: "old", label: "Old", automaticEmail: null }]; audits = []; failAudit = false; writes = 0; nextId = 50; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); mock.restoreAll(); });

test("pipeline replacement rolls back when its audit insert fails", async () => {
  failAudit = true;
  const result = await request({ stages: [{ key: "new", label: "New" }] });
  assert.equal(result.status, 500);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "old");
  assert.deepEqual(audits, []);
});

test("successful replacement commits one bounded pipeline audit", async () => {
  const result = await request({ stages: [{ key: "new", label: "New" }] });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "new");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "pipeline_stages.updated");
  assert.deepEqual(JSON.parse(audits[0].changes), {
    entityType: "lead", stageCount: 1, stageKeys: ["new"], automaticMessageStages: [], automaticEmailStages: [],
  });
});

test("more than 100 stages is rejected before any mutation", async () => {
  const result = await request({ stages: Array.from({ length: 101 }, (_, index) => ({ key: `s_${index}`, label: `Stage ${index}` })) });
  assert.equal(result.status, 400);
  assert.equal(writes, 0);
  assert.deepEqual(audits, []);
  assert.equal(rows[0].key, "old");
});
