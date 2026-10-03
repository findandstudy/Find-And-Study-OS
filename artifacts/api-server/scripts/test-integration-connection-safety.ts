/** Actual router middleware/handlers, in-memory DB, mocked providers; no HTTP/DB/provider sockets. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import { syncBuiltinESMExports } from "node:module";
import dns from "node:dns/promises";
import net from "node:net";
import nodemailer from "nodemailer";
import type { NextFunction, Request, Response } from "express";

const previous = {
  NODE_ENV: process.env.NODE_ENV, ALLOW_LIVE_INTEGRATIONS: process.env.ALLOW_LIVE_INTEGRATIONS,
  DATABASE_URL: process.env.DATABASE_URL, ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
};
process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:1/fasos_apply_local";
process.env.ENCRYPTION_KEY = "synthetic-integration-connection-fixture";

let providerCalls = 0, dnsCalls = 0, smtpCreates = 0, smtpVerifies = 0, configReads = 0, dbReads = 0;
let allowProviderDouble = false, integrationExists = true;
const config = {
  apiKey: "synthetic-only-token", model: "fixture-model", host: "smtp.fixture.test", port: "587",
  username: "sender@example.test", password: "synthetic-only-password", phoneNumberId: "fixture-phone",
  accessToken: "synthetic-only-token", pageId: "fixture-page", pageAccessToken: "synthetic-only-token",
  igBusinessAccountId: "fixture-ig", webhookSecret: "synthetic-only-webhook", formId: "fixture-form", secret: "fixture-webform-secret",
};

mock.method(net.Socket.prototype, "connect", () => { throw new Error("REAL_NETWORK_FORBIDDEN"); });
mock.method(dns, "lookup", async () => {
  dnsCalls++;
  assert.equal(allowProviderDouble, true, "disabled verification must not resolve a provider");
  return [{ address: "93.184.216.34", family: 4 }];
});
syncBuiltinESMExports();
mock.method(nodemailer, "createTransport", () => {
  smtpCreates++;
  assert.equal(allowProviderDouble, true, "disabled verification must not create SMTP transports");
  return { async verify() { smtpVerifies++; return true; }, close() {} };
});
mock.method(globalThis, "fetch", async () => {
  providerCalls++;
  assert.equal(allowProviderDouble, true, "disabled verification must not call providers");
  return new Response(JSON.stringify({
    id: "msg_fixture", type: "message", role: "assistant", model: "fixture-model",
    content: [{ type: "text", text: "Fixture" }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { headers: { "Content-Type": "application/json" } });
});

const { db, pool } = await import("@workspace/db");
mock.method(pool, "connect", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(db, "select", () => ({ from: () => ({ where: async () => {
  dbReads++;
  return integrationExists ? [{ id: 1, isEnabled: false, get config() { configReads++; return config; } }] : [];
} }) }));
for (const method of ["insert", "update", "delete", "execute", "transaction"] as const) {
  mock.method(db, method, () => { throw new Error("DATABASE_MUTATION_FORBIDDEN"); });
}
const { default: router } = await import("../src/routes/integrations");
type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
const stack = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Handler }> } }> }).stack;
async function invoke(key: string, path = "/integrations/:key/test", user: unknown = { id: 7, role: "super_admin", isActive: true }) {
  const route = stack.find(layer => layer.route?.path === path)?.route;
  assert.ok(route);
  let body: any, status = 200;
  const req = { params: { key }, user } as unknown as Request;
  const res = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  for (const layer of route.stack) {
    let advanced = false;
    await layer.handle(req, res, ((error?: unknown) => { if (error) throw error; advanced = true; }) as NextFunction);
    if (body !== undefined) break;
    assert.equal(advanced, true, "middleware must terminate or advance");
  }
  return { status, body };
}

beforeEach(() => {
  providerCalls = dnsCalls = smtpCreates = smtpVerifies = configReads = dbReads = 0;
  allowProviderDouble = false; integrationExists = true;
  process.env.NODE_ENV = "production";
  process.env.ALLOW_LIVE_INTEGRATIONS = "false";
});
after(async () => {
  await pool.end();
  mock.restoreAll(); syncBuiltinESMExports();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

for (const flag of ["false", "FALSE", "", "unknown", "TRUE", " true "]) {
  test(`explicit ${JSON.stringify(flag)} blocks every live credential-check branch before secrets, DNS or provider creation`, async () => {
    process.env.ALLOW_LIVE_INTEGRATIONS = flag;
    for (const key of ["claude", "claude:fixture", "anthropic:fixture", "smtp", "whatsapp", "facebook_messenger", "instagram", "zernio", "web_form"]) {
      const result = await invoke(key);
      assert.equal(result.status, 200, key);
      assert.equal(result.body.success, false, key);
      assert.equal(result.body.verified, false, key);
      assert.equal(result.body.simulated, true, key);
      assert.equal(result.body.status, "simulated", key);
    }
    assert.deepEqual({ configReads, providerCalls, dnsCalls, smtpCreates, smtpVerifies },
      { configReads: 0, providerCalls: 0, dnsCalls: 0, smtpCreates: 0, smtpVerifies: 0 });
  });
}

test("auth and role rejection still precede any integration lookup", async () => {
  for (const [user, expected] of [[undefined, 401], [{ id: 8, role: "student", isActive: true }, 403], [{ id: 7, role: "super_admin", isActive: false }, 403]] as const) {
    const result = await invoke("smtp", "/integrations/:key/test", user === undefined ? null : user);
    assert.equal(result.status, expected);
  }
  assert.equal(dbReads, 0); assert.equal(providerCalls, 0); assert.equal(smtpCreates, 0);
});

test("missing and unsupported integrations retain their non-success responses", async () => {
  integrationExists = false;
  assert.equal((await invoke("smtp")).status, 404);
  integrationExists = true;
  const unsupported = await invoke("not_a_provider");
  assert.equal(unsupported.body.status, "not_supported");
  assert.equal(unsupported.body.success, false);
  assert.equal(providerCalls + dnsCalls + smtpCreates, 0);
});

test("mixed-case toggle cannot bypass the explicit deployment disable", async () => {
  for (const key of ["whatsapp", "WhatsApp", "INSTAGRAM", "Zernio"]) {
    const result = await invoke(key, "/integrations/:key/toggle");
    assert.equal(result.status, 403, key);
    assert.equal(result.body.error, "live_integrations_disabled");
  }
  assert.equal(configReads, 0); assert.equal(providerCalls + dnsCalls + smtpCreates, 0);
});

test("unset production default still executes Anthropic and SMTP verification against doubles only", async () => {
  delete process.env.ALLOW_LIVE_INTEGRATIONS;
  allowProviderDouble = true;
  assert.equal((await invoke("claude:fixture")).body.success, true);
  assert.equal((await invoke("smtp")).body.success, true);
  assert.equal(providerCalls, 1); assert.equal(dnsCalls, 1);
  assert.equal(smtpCreates, 1); assert.equal(smtpVerifies, 1);
});
