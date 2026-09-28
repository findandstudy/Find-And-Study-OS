/** Public CMS mutation/audit tests with rollback-capable DB doubles. */
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
let teamRows: Row[] = [];
let officeRows: Row[] = [];
let audits: Row[] = [];
let failAudit = false;
let nextId = 10;

const chain = (read: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit"]) result[method] = () => result;
  return result;
};
const rowsFor = (table: unknown) => table === schema.websiteCollectionsTeamMembersTable ? teamRows : officeRows;
const setRowsFor = (table: unknown, rows: Row[]) => {
  if (table === schema.websiteCollectionsTeamMembersTable) teamRows = rows;
  else officeRows = rows;
};
mock.method(db, "select", () => ({ from: (table: unknown) => chain(() => rowsFor(table)) }));
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values });
    return Promise.resolve();
  }
  const row = { id: nextId++, translationsJson: null, ...values };
  setRowsFor(table, [...rowsFor(table), row]);
  return { returning: async () => [row] };
} }));
mock.method(db, "update", (table: unknown) => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  const rows = rowsFor(table).map(row => ({ ...row, ...values }));
  setRowsFor(table, rows);
  return rows;
} }) }) }));
mock.method(db, "delete", (table: unknown) => ({ where: () => ({ returning: async () => {
  const removed = rowsFor(table).slice(0, 1);
  setRowsFor(table, []);
  return removed;
} }) }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const teamSnapshot = teamRows.map(row => ({ ...row }));
  const officeSnapshot = officeRows.map(row => ({ ...row }));
  const auditSnapshot = audits.map(row => ({ ...row }));
  try { return await callback(db); } catch (error) {
    teamRows = teamSnapshot; officeRows = officeSnapshot; audits = auditSnapshot; throw error;
  }
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => { req.user = { id: 7, role: "super_admin", isActive: true } as any; next(); });
const router = (await import("../src/routes/cms")).default;
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

const team = () => ({ id: 1, name: "Existing member", title: null, bio: null, translationsJson: null, isActive: true, sortOrder: 0 });
const office = () => ({ id: 2, name: "Existing office", city: null, country: null, address: null, translationsJson: null, isActive: true, sortOrder: 0 });
beforeEach(() => { teamRows = [team()]; officeRows = [office()]; audits = []; failAudit = false; nextId = 10; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); mock.restoreAll(); });

for (const fixture of [
  { label: "team create", method: "POST", path: "/cms/team-members", body: { name: "New" }, count: () => teamRows.length },
  { label: "team update", method: "PATCH", path: "/cms/team-members/1", body: { bio: "changed" }, count: () => teamRows[0]?.bio },
  { label: "team delete", method: "DELETE", path: "/cms/team-members/1", body: undefined, count: () => teamRows.length },
  { label: "office create", method: "POST", path: "/cms/offices", body: { name: "New" }, count: () => officeRows.length },
  { label: "office update", method: "PATCH", path: "/cms/offices/2", body: { address: "changed" }, count: () => officeRows[0]?.address },
  { label: "office delete", method: "DELETE", path: "/cms/offices/2", body: undefined, count: () => officeRows.length },
] as const) {
  test(`${fixture.label} rolls back when audit persistence fails`, async () => {
    const before = fixture.count();
    failAudit = true;
    const result = await request(fixture.method, fixture.path, fixture.body);
    assert.equal(result.status, 500);
    assert.deepEqual(fixture.count(), before);
    assert.deepEqual(audits, []);
  });
}

test("oversized translations are rejected before mutation", async () => {
  const result = await request("POST", "/cms/team-members", { name: "New", translationsJson: { en: { bio: "x".repeat(132_000) } } });
  assert.equal(result.status, 400);
  assert.equal(teamRows.length, 1);
});

test("successful update audits field names without public content", async () => {
  const result = await request("PATCH", "/cms/team-members/1", { bio: "private draft biography", title: "Director" });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(audits.length, 1);
  assert.deepEqual(JSON.parse(audits[0].changes), { changedFields: ["bio", "title"] });
  assert.equal(audits[0].changes.includes("private draft biography"), false);
});
