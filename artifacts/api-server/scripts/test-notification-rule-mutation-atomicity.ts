/** Real notification-rule handlers against rollback-capable in-memory DB doubles. */
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
let rules: Row[] = [];
let audits: Row[] = [];
let failAudit = false;
let conflict = false;
let nextId = 10;

const chain = (read: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit", "for"]) result[method] = () => result;
  return result;
};

mock.method(db, "select", () => ({ from: (table: unknown) => chain(() => {
  if (table === schema.notificationRulesTable) return rules;
  if (table === schema.sessionsTable) return [{
    sid: "synthetic-human-session",
    sess: { user: { id: 7, role: "super_admin", isActive: true }, issued_at: Date.now() },
    expire: new Date(Date.now() + 60_000),
  }];
  return [];
}) }));
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values });
    return Promise.resolve();
  }
  const row = { id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...values };
  rules.push(row);
  return { returning: async () => [row] };
} }));
mock.method(db, "update", () => ({ set: (values: Row) => ({ where: () => ({ returning: async () => {
  if (conflict) return [];
  const current = rules[0];
  if (!current) return [];
  const updated = { ...current, ...values, updatedAt: new Date(current.updatedAt.getTime() + 1) };
  rules = [updated];
  return [updated];
} }) }) }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const ruleSnapshot = rules.map((row) => ({ ...row }));
  const auditSnapshot = audits.map((row) => ({ ...row }));
  try { return await callback(db); }
  catch (error) { rules = ruleSnapshot; audits = auditSnapshot; throw error; }
});

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, role: "super_admin", isActive: true } as any;
  next();
});
const router = (await import("../src/routes/notifications")).default;
app.use("/api", router);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "fixture_failure" }));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;

function request(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api${path}`, method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-human-session",
        ...(json ? { "Content-Length": Buffer.byteLength(json) } : {}) } }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (json) req.write(json);
    req.end();
  });
}

beforeEach(() => { rules = []; audits = []; failAudit = false; conflict = false; nextId = 10; });
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
  mock.restoreAll();
});

test("create rolls back the notification rule when audit persistence fails", async () => {
  failAudit = true;
  const result = await request("POST", "/notification-rules", { event: "message.new", name: "Fixture" });
  assert.equal(result.status, 500);
  assert.deepEqual(rules, []);
  assert.deepEqual(audits, []);
});

test("update rolls back the notification rule when audit persistence fails", async () => {
  const updatedAt = new Date(1);
  rules = [{ id: 4, event: "message.new", name: "Before", channels: ["in_app"], template: {}, updatedAt }];
  failAudit = true;
  const result = await request("PATCH", "/notification-rules/4", { channels: ["email"], expectedUpdatedAt: updatedAt.toISOString() });
  assert.equal(result.status, 500);
  assert.deepEqual(rules[0].channels, ["in_app"]);
  assert.deepEqual(audits, []);
});

test("stale update returns conflict without mutation or audit", async () => {
  const updatedAt = new Date(1);
  rules = [{ id: 4, event: "message.new", name: "Before", channels: ["in_app"], template: {}, updatedAt }];
  conflict = true;
  const result = await request("PATCH", "/notification-rules/4", { channels: ["email"], expectedUpdatedAt: updatedAt.toISOString() });
  assert.equal(result.status, 409);
  assert.equal(result.data.code, "NOTIFICATION_RULE_VERSION_CONFLICT");
  assert.deepEqual(rules[0].channels, ["in_app"]);
  assert.deepEqual(audits, []);
});

test("successful update writes bounded audit metadata without template content", async () => {
  const updatedAt = new Date(1);
  rules = [{ id: 4, event: "message.new", name: "Before", channels: ["in_app"], template: {}, updatedAt }];
  const result = await request("PATCH", "/notification-rules/4", {
    template: { subject: "Secret subject", body: "Sensitive message body" },
    expectedUpdatedAt: updatedAt.toISOString(),
  });
  assert.equal(result.status, 200);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "update_notification_rule");
  assert.deepEqual(JSON.parse(audits[0].changes).changedFields, ["template"]);
  assert.equal(JSON.stringify(audits[0]).includes("Sensitive message body"), false);
});
