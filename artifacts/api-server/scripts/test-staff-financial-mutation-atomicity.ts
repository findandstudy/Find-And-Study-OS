/** Staff salary/commission mutation audit tests with rollback-capable DB doubles. */
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
let salaries: Row[] = [];
let commissions: Row[] = [];
let audits: Row[] = [];
let failAudit = false;
let nextId = 10;

function rowsFor(table: unknown): Row[] {
  if (table === schema.staffSalaryPaymentsTable) return salaries;
  if (table === schema.staffCommissionsTable) return commissions;
  return [];
}

mock.method(db, "insert", (table: unknown) => ({ values: (input: Row | Row[]) => {
  const values = Array.isArray(input) ? input : [input];
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push(...values.map(value => ({ ...value })));
    return Promise.resolve();
  }
  const target = rowsFor(table);
  const created = values.map(value => ({ id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...value }));
  target.push(...created);
  return { returning: async () => created };
} }));
mock.method(db, "update", (table: unknown) => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  const target = rowsFor(table);
  target.splice(0, target.length, ...target.map(row => ({ ...row, ...values })));
  return target;
} }) }) }));
mock.method(db, "delete", (table: unknown) => ({ where: () => ({ returning: async () => {
  const target = rowsFor(table);
  const deleted = target.splice(0, target.length);
  return deleted.map(({ id }) => ({ id }));
} }) }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const salarySnapshot = salaries.map(row => ({ ...row }));
  const commissionSnapshot = commissions.map(row => ({ ...row }));
  const auditSnapshot = audits.map(row => ({ ...row }));
  try {
    return await callback(db);
  } catch (error) {
    salaries = salarySnapshot;
    commissions = commissionSnapshot;
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

function request(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: `/api${path}`,
      method,
      headers: { "Content-Type": "application/json", ...(json ? { "Content-Length": Buffer.byteLength(json) } : {}) },
    }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (json) req.write(json);
    req.end();
  });
}

const salary = () => ({ id: 1, userId: 2, amount: "100.00", currency: "USD", period: "monthly", status: "pending" });
const commission = () => ({ id: 2, userId: 2, amount: "50.00", currency: "USD", status: "pending" });
beforeEach(() => {
  salaries = [salary()];
  commissions = [commission()];
  audits = [];
  failAudit = false;
  nextId = 10;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
  mock.restoreAll();
});

test("salary create and update roll back when audit persistence fails", async () => {
  failAudit = true;
  const created = await request("POST", "/staff-cards/2/salary-payments", { amount: 125, currency: "usd" });
  assert.equal(created.status, 500);
  assert.equal(salaries.length, 1);
  const updated = await request("PATCH", "/staff-cards/2/salary-payments/1", { status: "paid" });
  assert.equal(updated.status, 500);
  assert.equal(salaries[0].status, "pending");
});

test("salary delete rolls back when audit persistence fails", async () => {
  failAudit = true;
  const result = await request("DELETE", "/staff-cards/2/salary-payments/1");
  assert.equal(result.status, 500);
  assert.equal(salaries.length, 1);
});

test("commission create, update and delete roll back with failed audit", async () => {
  failAudit = true;
  assert.equal((await request("POST", "/staff-cards/2/commissions", { amount: 75, currency: "eur" })).status, 500);
  assert.equal(commissions.length, 1);
  assert.equal((await request("PATCH", "/staff-cards/2/commissions/2", { status: "paid" })).status, 500);
  assert.equal(commissions[0].status, "pending");
  assert.equal((await request("DELETE", "/staff-cards/2/commissions/2")).status, 500);
  assert.equal(commissions.length, 1);
});

test("successful staff financial mutation writes bounded audit metadata", async () => {
  const result = await request("PATCH", "/staff-cards/2/salary-payments/1", { status: "paid", notes: "private payroll note" });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(audits.length, 1);
  assert.deepEqual(JSON.parse(audits[0].changes), { fields: ["notes", "status"], id: 1 });
  assert.equal(audits[0].changes.includes("private payroll note"), false);
});

test("oversized notes and invalid dates fail before any mutation", async () => {
  assert.equal((await request("POST", "/staff-cards/2/salary-payments", { amount: 1, notes: "x".repeat(2_001) })).status, 400);
  assert.equal((await request("POST", "/staff-cards/2/commissions", { amount: 1, payDate: "not-a-date" })).status, 400);
  assert.equal(audits.length, 0);
  assert.equal(salaries.length, 1);
  assert.equal(commissions.length, 1);
});

test("malformed and unsafe route identifiers fail before database mutation", async () => {
  assert.equal((await request("POST", "/staff-cards/2oops/salary-payments", { amount: 1 })).status, 400);
  assert.equal((await request("PATCH", "/staff-cards/2/commissions/9007199254740992", { status: "paid" })).status, 400);
  assert.equal(audits.length, 0);
  assert.equal(salaries.length, 1);
  assert.equal(commissions.length, 1);
});
