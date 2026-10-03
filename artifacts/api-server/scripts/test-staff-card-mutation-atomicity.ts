/** Staff profile and collection mutation audit tests with rollback-capable DB doubles. */
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
let users: Row[] = [];
let schedules: Row[] = [];
let audits: Row[] = [];
let failAudit = false;

function rowsFor(table: unknown): Row[] {
  if (table === schema.usersTable) return users;
  if (table === schema.staffWorkSchedulesTable) return schedules;
  return [];
}

mock.method(db, "insert", (table: unknown) => ({ values: (input: Row | Row[]) => {
  const values = Array.isArray(input) ? input : [input];
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push(...values.map(value => ({ ...value })));
    return Promise.resolve();
  }
  rowsFor(table).push(...values.map(value => ({ ...value })));
  return Promise.resolve();
} }));
mock.method(db, "update", (table: unknown) => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  const target = rowsFor(table);
  target.splice(0, target.length, ...target.map(row => ({ ...row, ...values })));
  return target;
} }) }) }));
mock.method(db, "delete", (table: unknown) => ({ where: async () => {
  rowsFor(table).splice(0);
} }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const userSnapshot = users.map(row => ({ ...row }));
  const scheduleSnapshot = schedules.map(row => ({ ...row }));
  const auditSnapshot = audits.map(row => ({ ...row }));
  try {
    return await callback(db);
  } catch (error) {
    users = userSnapshot;
    schedules = scheduleSnapshot;
    audits = auditSnapshot;
    throw error;
  }
});

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, role: "super_admin", isActive: true, email: "admin@example.test" } as any;
  next();
});
const router = (await import("../src/routes/staffCards")).default;
app.use("/api", router);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: "fixture_failure" });
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;

function request(method: string, path: string, body: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: `/api${path}`,
      method,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) },
    }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    req.write(json);
    req.end();
  });
}

beforeEach(() => {
  users = [{ id: 2, firstName: "Before", lastName: "User" }];
  schedules = [{ userId: 2, weekday: 1, startMinutes: 540, endMinutes: 1020 }];
  audits = [];
  failAudit = false;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
  mock.restoreAll();
});

test("profile mutation rolls back when its audit cannot be persisted", async () => {
  failAudit = true;
  const result = await request("PUT", "/staff-cards/2/profile", { firstName: "After" });
  assert.equal(result.status, 500);
  assert.equal(users[0].firstName, "Before");
  assert.equal(audits.length, 0);
});

test("schedule replacement rolls back when its audit cannot be persisted", async () => {
  failAudit = true;
  const result = await request("PUT", "/staff-cards/2/schedule", {
    entries: [{ weekday: 2, startMinutes: 600, endMinutes: 900 }],
  });
  assert.equal(result.status, 500);
  assert.deepEqual(schedules, [{ userId: 2, weekday: 1, startMinutes: 540, endMinutes: 1020 }]);
});

test("profile audit records field names without personal values", async () => {
  const result = await request("PUT", "/staff-cards/2/profile", { firstName: "Private Name", phone: "+905551112233" });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(JSON.parse(audits[0].changes), { fields: ["firstName", "phone"] });
  assert.equal(audits[0].changes.includes("Private Name"), false);
  assert.equal(audits[0].changes.includes("+905551112233"), false);
});

test("bounded inputs and strict identifiers fail before mutation", async () => {
  assert.equal((await request("PUT", "/staff-cards/2oops/profile", { firstName: "Valid" })).status, 400);
  assert.equal((await request("PUT", "/staff-cards/2/profile", { homeAddress: "x".repeat(1001) })).status, 400);
  assert.equal((await request("PUT", "/staff-cards/2/schedule", { entries: Array.from({ length: 101 }, () => ({ weekday: 1, startMinutes: 1, endMinutes: 2 })) })).status, 400);
  assert.equal(users[0].firstName, "Before");
  assert.equal(audits.length, 0);
});
