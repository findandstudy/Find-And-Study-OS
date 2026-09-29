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

type TokenRow = Record<string, any>;
let tokens: TokenRow[] = [];
let audits: Record<string, any>[] = [];
let failAudit = false;
let nextId = 100;

const chain = (read: () => TokenRow[]) => {
  const result: any = { then: (resolve: any, reject: any) => Promise.resolve().then(read).then(resolve, reject) };
  for (const method of ["where", "orderBy", "limit", "for"]) result[method] = () => result;
  return result;
};

mock.method(db, "select", () => ({ from: (table: unknown) => chain(() => table === schema.apiTokensTable ? tokens : []) }));
mock.method(db, "insert", (table: unknown) => ({ values: (values: Record<string, any>) => {
  if (table === schema.auditLogsTable) {
    if (failAudit) return Promise.reject(new Error("SYNTHETIC_AUDIT_FAILURE"));
    audits.push({ ...values });
    return Promise.resolve();
  }
  const row = { id: nextId++, lastUsedAt: null, revokedAt: null, createdAt: new Date(), ...values };
  tokens.push(row);
  return { returning: async () => [row] };
} }));
mock.method(db, "update", () => ({ set: (values: Record<string, any>) => ({ where: () => {
  tokens = tokens.map((row) => ({ ...row, ...values }));
  const promise: any = Promise.resolve();
  promise.returning = async () => tokens.slice(-1);
  return promise;
} }) }));
mock.method(db, "transaction", async (callback: (tx: typeof db) => Promise<unknown>) => {
  const tokenSnapshot = tokens.map((row) => ({ ...row }));
  const auditSnapshot = audits.map((row) => ({ ...row }));
  try { return await callback(db); }
  catch (error) { tokens = tokenSnapshot; audits = auditSnapshot; throw error; }
});
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 7, role: "super_admin", isActive: true } as any;
  next();
});
const router = (await import("../src/routes/apiTokens")).default;
app.use("/api", router);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: "fixture_failure" }));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;

async function request(method: string, path: string, body?: unknown) {
  return new Promise<{ status: number; data: any }>((resolve, reject) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port, path: `/api${path}`, method,
      headers: { "Content-Type": "application/json", ...(json ? { "Content-Length": Buffer.byteLength(json) } : {}) } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: text ? JSON.parse(text) : null }));
    });
    req.on("error", reject);
    if (json) req.write(json);
    req.end();
  });
}

beforeEach(() => { tokens = []; audits = []; failAudit = false; nextId = 100; });
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  mock.restoreAll();
});

test("create rolls back the credential when its audit insert fails", async () => {
  failAudit = true;
  const result = await request("POST", "/api-tokens", { name: "atomic", scopes: ["applications:read"] });
  assert.equal(result.status, 500);
  assert.deepEqual(tokens, []);
  assert.deepEqual(audits, []);
});

test("revoke rolls back revokedAt when its audit insert fails", async () => {
  tokens = [{ id: 42, userId: 7, name: "active", tokenPrefix: "fas_x", tokenHash: "hash", scopes: [], revokedAt: null, createdAt: new Date() }];
  failAudit = true;
  const result = await request("POST", "/api-tokens/42/revoke");
  assert.equal(result.status, 500);
  assert.equal(tokens[0].revokedAt, null);
});

test("rotate rolls back both replacement and revocation when audit fails", async () => {
  tokens = [{ id: 42, userId: 7, name: "active", tokenPrefix: "fas_x", tokenHash: "hash", scopes: ["students:read"], revokedAt: null, createdAt: new Date() }];
  failAudit = true;
  const result = await request("POST", "/api-tokens/42/rotate", {});
  assert.equal(result.status, 500);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].revokedAt, null);
});

test("successful create returns the secret once and persists one bounded audit row", async () => {
  const result = await request("POST", "/api-tokens", { name: "atomic", scopes: ["applications:read"] });
  assert.equal(result.status, 201);
  assert.match(result.data.token, /^fas_live_/);
  assert.equal(tokens.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "create");
  assert.equal(audits[0].resource, "api_token");
  assert.equal(audits[0].resourceId, tokens[0].id);
  assert.equal(JSON.stringify(audits[0]).includes(result.data.token), false);
});
