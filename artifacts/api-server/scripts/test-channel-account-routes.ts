/** Real Express handlers against in-memory DB doubles. No PostgreSQL/provider connection. */
import assert from "node:assert/strict";
import { test, mock, after, beforeEach } from "node:test";
import http from "node:http";
import express from "express";
import { once } from "node:events";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:5433/fasos_apply_local";
process.env.ENCRYPTION_KEY = "synthetic-account-route-fixture";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
process.env.EMAIL_DELIVERY_DISABLED = "true";
process.env.NODE_ENV = "test";
const w = await import("@workspace/db");
const { db, pool } = w;
mock.method(pool, "connect", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(globalThis, "fetch", () => { throw new Error("PROVIDER_CALL_FORBIDDEN"); });
const { serializeAccountConfig, parseAccountConfig } = await import("../src/lib/inbox/channelAccountConfig");
const { default: router } = await import("../src/routes/channelAccounts");
type Row = Record<string, any>;
const user = { id: 7, role: "super_admin", isActive: true };
let rows: Row[] = [], audits: Row[] = [], deleted = 0, writes = 0, lockQueries: string[] = [], failAudit = false;
let linked: unknown = null, impersonated = false, role = "super_admin", apiToken = false, noSession = false;
const chain = (get: () => Row[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(get).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit", "for"]) result[method] = () => result;
  return result;
};
mock.method(db, "select", (projection?: unknown) => ({ from: (table: unknown) => chain(() => {
  if (table === w.sessionsTable) return [{ expire: new Date(Date.now() + 60_000), sess: { user, access_token: "fixture", issued_at: Date.now(), ...(impersonated ? { originalSid: "parent" } : {}) } }];
  if (table === w.channelAccountsTable) return projection ? [] : rows;
  return table === linked ? [{ id: 44 }] : [];
}) }));
mock.method(db, "insert", (table: unknown) => ({ values: (values: Row) => {
  if (table === w.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values }); return Promise.resolve();
  }
  writes++;
  const row = { id: 42, createdAt: new Date(), updatedAt: new Date(), ...values }; rows = [row];
  return { returning: async () => [row] };
} }));
mock.method(db, "update", () => ({ set: (values: Row) => ({ where: () => {
  writes++; rows = rows.map(row => ({ ...row, ...values }));
  return Object.assign(Promise.resolve(), { returning: async () => rows });
} }) }));
mock.method(db, "delete", () => ({ where: async () => { deleted++; rows = []; } }));
mock.method(db, "execute", async (query: unknown) => { lockQueries.push(String(query)); return []; });
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const snapshot = rows.map(row => ({ ...row })), auditSnapshot = audits.map(row => ({ ...row }));
  const writeSnapshot = writes, deleteSnapshot = deleted;
  try { return await callback(db); }
  catch (error) { rows = snapshot; audits = auditSnapshot; writes = writeSnapshot; deleted = deleteSnapshot; throw error; }
});

const app = express(); app.use(express.json());
app.use((req, _res, next) => { req.user = { ...user, role } as any; req.apiTokenAuth = apiToken; req.cookies = noSession ? {} : { sid: "synthetic" }; next(); });
app.use("/api", router);
const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
const port = (server.address() as { port: number }).port;
function request(method: string, path = "/channel-accounts", body?: unknown): Promise<{ status: number; data: any; cache: string | undefined }> {
  return new Promise((resolve, reject) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api${path}`, method,
      headers: { "Content-Type": "application/json", ...(json ? { "Content-Length": Buffer.byteLength(json) } : {}) } }, res => {
      let text = ""; res.on("data", chunk => { text += chunk; }); res.on("end", () => resolve({ status: res.statusCode!, data: JSON.parse(text), cache: res.headers["cache-control"] }));
    }); req.on("error", reject); if (json) req.write(json); req.end();
  });
}
beforeEach(() => { rows = []; audits = []; deleted = 0; writes = 0; lockQueries = []; failAudit = false; linked = null; impersonated = false; role = "super_admin"; apiToken = false; noSession = false; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await new Promise<void>(resolve => setImmediate(resolve)); await pool.end(); mock.restoreAll(); });

test("POST persists encrypted Telegram/Twilio config but never activates unsupported delivery", async () => {
  for (const [channel, config] of [["telegram", { botToken: "123456789:synthetic_BOT_token_0123456789", defaultChatId: "@ExampleChannel" }], ["sms", { accountSid: `AC${"a".repeat(32)}`, authToken: "b".repeat(32), fromNumber: "+441234567890" }]] as const) {
    const result = await request("POST", "/channel-accounts", { channel, displayName: "Fixture", isActive: true, isDefault: true, config });
    assert.equal(result.status, 201, JSON.stringify(result)); assert.equal(result.data.isActive, false); assert.equal(result.data.isDefault, false);
    assert.equal(result.data.capabilities.configurationOnly, true); assert.equal(result.cache, "private, no-store");
    assert.deepEqual(parseAccountConfig(rows[0].configEncrypted), config); assert.ok(rows[0].configEncrypted.includes("enc::v1::"));
    assert.equal((await request("PATCH", "/channel-accounts/42/toggle-active")).data.error, "ACCOUNT_DELIVERY_UNSUPPORTED");
    assert.equal((await request("PATCH", "/channel-accounts/42/set-default")).data.error, "ACCOUNT_DELIVERY_UNSUPPORTED");
    assert.equal((await request("POST", "/channel-accounts/42/test")).data.status, "not_supported");
  }
  assert.ok(lockQueries.length >= 6);
});
test("Zernio reuses canonical channel and global credentials; SMTP creation and per-account API keys are rejected", async () => {
  assert.equal((await request("POST", "/channel-accounts", { channel: "email", provider: "smtp", displayName: "Bad" })).status, 400);
  assert.equal((await request("POST", "/channel-accounts", { channel: "telegram", provider: "zernio", displayName: "Bad", externalAccountId: "acct1", config: { apiKey: "secret" } })).status, 400);
  const result = await request("POST", "/channel-accounts", { channel: "facebook", provider: "zernio", displayName: "Linked", externalAccountId: "acct1", config: {} });
  assert.equal(result.status, 201); assert.equal(result.data.channel, "messenger"); assert.equal(result.data.isActive, false);
  assert.equal(result.data.capabilities.credentialsSource, "integration"); assert.deepEqual(result.data.config, {});
  assert.equal((await request("PUT", "/channel-accounts/42", { externalAccountId: "acct2" })).status, 409);
});
test("all six write/test endpoints reject manager, bearer-token, impersonation and missing session", async () => {
  for (const denied of ["manager", "token", "impersonated", "no-session"]) {
    role = denied === "manager" ? "manager" : "super_admin"; apiToken = denied === "token"; impersonated = denied === "impersonated"; noSession = denied === "no-session";
    for (const [method, path] of [["POST", "/channel-accounts"], ["PUT", "/channel-accounts/42"], ["PATCH", "/channel-accounts/42/toggle-active"], ["PATCH", "/channel-accounts/42/set-default"], ["DELETE", "/channel-accounts/42"], ["POST", "/channel-accounts/42/test"]]) {
      assert.equal((await request(method, path, {})).status, 403, `${denied} ${method} ${path}`);
    }
  }
  assert.equal(writes, 0); assert.equal(deleted, 0);
});
test("SMTP is excluded from GET and remains unreachable through all generic mutations", async () => {
  rows = [{ id: 42, channel: "email", provider: "smtp", configEncrypted: serializeAccountConfig({ password: "secret" }) }];
  assert.deepEqual((await request("GET")).data.accounts, []);
  for (const [method, path] of [["PUT", "/channel-accounts/42"], ["PATCH", "/channel-accounts/42/toggle-active"], ["PATCH", "/channel-accounts/42/set-default"], ["DELETE", "/channel-accounts/42"], ["POST", "/channel-accounts/42/test"]]) {
    const result = await request(method, path, {}); assert.equal(result.status, 409); assert.equal(result.data.error, "managed_email_sender");
  }
  assert.equal(writes, 0); assert.equal(deleted, 0);
});
test("pipeline, stage, dispatch and recipient links block deletion rather than cascading", async () => {
  rows = [{ id: 42, channel: "whatsapp", provider: "direct", isActive: false }];
  for (const table of [w.communicationPipelineAccountsTable, w.pipelineStagesTable, w.pipelineStageMessageDispatchesTable, w.messageCampaignRecipientsTable]) {
    linked = table;
    const result = await request("DELETE", "/channel-accounts/42"); assert.equal(result.status, 409); assert.equal(result.data.error, "ACCOUNT_IN_USE");
  }
  assert.equal(deleted, 0);
});
test("explicit live-disabled staging returns simulated NOT success with no provider request", async () => {
  rows = [{ id: 42, channel: "whatsapp", provider: "direct", configEncrypted: serializeAccountConfig({ phoneNumberId: "123", accessToken: "synthetic-token" }) }];
  process.env.NODE_ENV = "production";
  try {
    const result = await request("POST", "/channel-accounts/42/test"); assert.equal(result.status, 200); assert.equal(result.data.simulated, true); assert.equal(result.data.success, false);
  } finally { process.env.NODE_ENV = "test"; }
});
test("account mutation and audit commit or roll back together", async () => {
  failAudit = true;
  const failed = await request("POST", "/channel-accounts", { channel: "telegram", displayName: "Atomic", config: { botToken: "123456789:synthetic_BOT_token_0123456789", defaultChatId: "@Atomic" } });
  assert.equal(failed.status, 503);
  assert.deepEqual(rows, []);
  assert.deepEqual(audits, []);
  assert.equal(writes, 0);

  failAudit = false;
  const created = await request("POST", "/channel-accounts", { channel: "telegram", displayName: "Atomic", config: { botToken: "123456789:synthetic_BOT_token_0123456789", defaultChatId: "@Atomic" } });
  assert.equal(created.status, 201);
  assert.equal(rows.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "create_channel_account");
  assert.equal(audits[0].resourceId, rows[0].id);
  assert.equal(JSON.stringify(audits[0]).includes("synthetic_BOT_token"), false);
});
