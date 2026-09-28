/** Real SSO router handlers, in-memory DB and captured redirect; no Academy/DB/network access. */
import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import crypto from "node:crypto";
import net from "node:net";
import type { NextFunction, Request, Response } from "express";
import { canUseProductionAcademyReceiver } from "../src/lib/academySsoPolicy";

process.env.NODE_ENV = "test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:1/fasos_apply_local";
process.env.SSO_SHARED_SECRET = "synthetic-academy-sso-fixture-secret";
process.env.APP_BASE_URL = "https://staging.findandstudy.com";
process.env.BASE_URL = "https://staging.findandstudy.com";

let dbReads = 0, piiReads = 0, signedTokens = 0;
const originalCreateHmac = crypto.createHmac;
mock.method(crypto, "createHmac", (...args: Parameters<typeof crypto.createHmac>) => {
  signedTokens++;
  return originalCreateHmac(...args);
});
mock.method(net.Socket.prototype, "connect", () => { throw new Error("REAL_NETWORK_FORBIDDEN"); });
mock.method(globalThis, "fetch", () => { throw new Error("PROVIDER_CALL_FORBIDDEN"); });
const { db, pool } = await import("@workspace/db");
mock.method(pool, "connect", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(pool, "query", () => { throw new Error("REAL_DATABASE_FORBIDDEN"); });
mock.method(db, "select", () => ({ from: () => ({ where: async () => {
  dbReads++;
  return [{ agentStaffPermissions: [], managingAgentId: null, companyName: "Fixture Company" }];
} }) }));
for (const method of ["insert", "update", "delete", "execute", "transaction"] as const) {
  mock.method(db, method, () => { throw new Error("DATABASE_MUTATION_FORBIDDEN"); });
}
const { default: router } = await import("../src/routes/academySso");
type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
const route = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Handler }> } }> })
  .stack.find(layer => layer.route?.path === "/academy-sso")?.route;
assert.ok(route);

function actor(role = "super_admin") {
  return { id: 7, role, isActive: true, effectivePermissions: [],
    get email() { piiReads++; return "fixture@example.test"; }, firstName: "Fixture", lastName: "User", phone: null };
}
async function invoke(user: unknown = actor()) {
  let body: any, status = 200, redirect: string | undefined;
  const headers: Record<string, string> = {};
  const req = { user } as unknown as Request;
  const res = {
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; return this; },
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
    send(value: unknown) { body = value; return this; },
    redirect(value: string) { redirect = value; status = 302; return this; },
  } as unknown as Response;
  for (const layer of route!.stack) {
    let advanced = false;
    await layer.handle(req, res, ((error?: unknown) => { if (error) throw error; advanced = true; }) as NextFunction);
    if (body !== undefined || redirect !== undefined) break;
    assert.equal(advanced, true);
  }
  return { body, status, redirect, headers };
}

beforeEach(() => {
  dbReads = piiReads = signedTokens = 0;
  process.env.NODE_ENV = "production";
  process.env.ALLOW_LIVE_INTEGRATIONS = "false";
  process.env.SSO_SHARED_SECRET = "synthetic-academy-sso-fixture-secret";
  process.env.APP_BASE_URL = "https://apply.findandstudy.com";
  process.env.BASE_URL = "https://apply.findandstudy.com";
  delete process.env.RELEASE_ID;
});
after(async () => { await pool.end(); mock.restoreAll(); });

test("production-mode staging explicit false/invalid blocks handoff before PII, DB, signing or redirect", async () => {
  for (const value of ["false", "FALSE", "", "unknown", "TRUE", " true "]) {
    process.env.ALLOW_LIVE_INTEGRATIONS = value;
    const result = await invoke();
    assert.equal(result.status, 403, JSON.stringify(value));
    assert.equal(result.body.error, "live_integrations_disabled");
    assert.equal(result.redirect, undefined);
    assert.equal(result.headers["cache-control"], "private, no-store");
    assert.equal(result.headers["referrer-policy"], "no-referrer");
  }
  assert.deepEqual({ dbReads, piiReads, signedTokens }, { dbReads: 0, piiReads: 0, signedTokens: 0 });
});

test("deployment deny precedes the missing-secret diagnostic", async () => {
  delete process.env.SSO_SHARED_SECRET;
  const result = await invoke();
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "live_integrations_disabled");
  assert.equal(result.redirect, undefined);
  assert.equal(dbReads + piiReads + signedTokens, 0);
});

test("unset non-production environments do not mint a production Academy token", async () => {
  delete process.env.ALLOW_LIVE_INTEGRATIONS;
  for (const environment of ["development", "test", "staging", ""]) {
    process.env.NODE_ENV = environment;
    const result = await invoke();
    assert.equal(result.status, 403);
    assert.equal(result.redirect, undefined);
  }
  assert.equal(dbReads + piiReads + signedTokens, 0);
});

test("authentication and role gates remain in front of SSO", async () => {
  assert.equal((await invoke(null)).status, 401);
  assert.equal((await invoke(actor("student"))).status, 403);
  assert.equal((await invoke({ ...actor(), isActive: false })).status, 403);
  assert.equal(dbReads + signedTokens, 0);
});

test("production unset preserves the exact receiver handoff and short-lived HS256 contract", async () => {
  delete process.env.ALLOW_LIVE_INTEGRATIONS;
  const result = await invoke();
  assert.equal(result.status, 302);
  assert.equal(result.headers["cache-control"], "private, no-store");
  assert.equal(result.headers["referrer-policy"], "no-referrer");
  const url = new URL(result.redirect!);
  assert.equal(url.origin, "https://academy.findandstudy.com");
  assert.equal(url.pathname, "/api/sso");
  const [header, body, signature] = url.searchParams.get("token")!.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  assert.equal(payload.sub, "7"); assert.equal(payload.email, "fixture@example.test");
  assert.equal(payload.exp - payload.iat, 120);
  assert.match(payload.jti, /^[0-9a-f-]{36}$/);
  assert.equal(signature, originalCreateHmac("sha256", "synthetic-academy-sso-fixture-secret").update(`${header}.${body}`).digest("base64url"));
  assert.equal(signedTokens, 1);
});

test("explicit true permits the existing authorized production handoff", async () => {
  process.env.NODE_ENV = "production";
  process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  assert.equal((await invoke()).status, 302);
  assert.equal(signedTokens, 1);
});

test("staging and local deployments cannot mint production tokens even with the live flag enabled or unset", async () => {
  for (const flag of [undefined, "true"]) {
    if (flag === undefined) delete process.env.ALLOW_LIVE_INTEGRATIONS;
    else process.env.ALLOW_LIVE_INTEGRATIONS = flag;
    for (const origin of ["https://staging.findandstudy.com", "http://127.0.0.1:25197", "https://apply.findandstudy.com.attacker.test"]) {
      process.env.APP_BASE_URL = process.env.BASE_URL = origin;
      const result = await invoke();
      assert.equal(result.status, 403);
      assert.equal(result.body.error, "academy_environment_not_allowed");
      assert.equal(result.redirect, undefined);
    }
  }
  assert.equal(dbReads + piiReads + signedTokens, 0);
});

test("missing or contradictory deployment identity fails before PII, secrets, database or redirect", async () => {
  process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  for (const variant of ["missing", "conflicting", "staging-release", "development"]) {
    process.env.NODE_ENV = "production";
    process.env.APP_BASE_URL = process.env.BASE_URL = "https://apply.findandstudy.com";
    delete process.env.RELEASE_ID;
    if (variant === "missing") { delete process.env.APP_BASE_URL; delete process.env.BASE_URL; }
    if (variant === "conflicting") process.env.BASE_URL = "https://findandstudy.com";
    if (variant === "staging-release") process.env.RELEASE_ID = "staging-20260928T070000Z-aaaaaaaaaaaa";
    if (variant === "development") process.env.NODE_ENV = "development";
    const result = await invoke();
    assert.equal(result.status, 403, variant);
    assert.equal(result.body.error, "academy_environment_not_allowed");
    assert.equal(result.redirect, undefined);
  }
  assert.equal(dbReads + piiReads + signedTokens, 0);
});

test("Academy deployment identity accepts exact HTTPS origins only", () => {
  for (const origin of ["https://apply.findandstudy.com", "https://findandstudy.com/"]) {
    assert.equal(canUseProductionAcademyReceiver({ NODE_ENV: "production", APP_BASE_URL: origin }), true);
  }
  for (const origin of ["", "invalid", "http://apply.findandstudy.com", "https://x@apply.findandstudy.com", "https://apply.findandstudy.com:444", "https://apply.findandstudy.com:443", "https://apply.findandstudy.com/path", "https://apply.findandstudy.com?x=1", "https://apply.findandstudy.com#x", " https://apply.findandstudy.com", "https://APPLY.findandstudy.com", "https://apply.findandstudy.com."]) {
    assert.equal(canUseProductionAcademyReceiver({ NODE_ENV: "production", APP_BASE_URL: origin }), false, origin);
  }
});

test("live mode does not bypass a revoked Academy permission", async () => {
  process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  const result = await invoke(actor("staff"));
  assert.equal(result.status, 403);
  assert.equal(result.body, "Academy access not granted");
  assert.equal(result.redirect, undefined);
  assert.equal(signedTokens, 0);
});

test("enabled but unconfigured SSO keeps its existing fail-closed response", async () => {
  delete process.env.ALLOW_LIVE_INTEGRATIONS;
  delete process.env.SSO_SHARED_SECRET;
  const result = await invoke();
  assert.equal(result.status, 500);
  assert.equal(result.body, "SSO not configured");
  assert.equal(result.redirect, undefined);
  assert.equal(dbReads + piiReads + signedTokens, 0);
});
