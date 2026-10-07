import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import type { SessionData, SessionUser } from "../src/lib/replitAuth";
import { createPersonaTeamPreviewAccess, isPersonaTeamPreviewEnabled } from "../src/lib/personaTeamPreviewAccess";

// Existing requireAuth/requireRole import the DB module; no test makes a DB
// connection. Only the canonical session reader is replaced with a test double.
process.env.DATABASE_URL ??= "postgresql://preview_unit:unused@127.0.0.1:1/preview_unit";
const sid = "a".repeat(64);
function environment() {
  process.env.NODE_ENV = "production";
  process.env.APP_BASE_URL = "https://staging.findandstudy.com";
  process.env.ALLOW_LIVE_INTEGRATIONS = "false";
  process.env.PERSONA_TEAM_PREVIEW_ENABLED = "true";
}
const user = (role = "admin") => ({ id: 7, role, isActive: true }) as SessionUser;
function request(patch: Partial<Request> = {}): Request {
  return { method: "GET", headers: {}, cookies: { sid }, user: user(), ...patch } as Request;
}
async function invoke(req = request(), session: SessionData | null = { user: user(), access_token: "" }, readerError = false) {
  let status = 200, body: unknown, nextCalls = 0, sessionReads = 0;
  const headers: Record<string, string> = {};
  const response = {
    set(key: string, value: string) { headers[key] = value; return this; },
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  await createPersonaTeamPreviewAccess(async (value) => {
    sessionReads++;
    assert.equal(value, sid);
    if (readerError) throw new Error("DO_NOT_LEAK_SECRET_OR_DATABASE_DETAILS");
    return session;
  })(req, response, () => { nextCalls++; });
  return { status, body, headers, nextCalls, sessionReads };
}
test("preview is default-off and exact staging config rejects missing/drifting values", async () => {
  for (const [key, value] of [
    ["NODE_ENV", "test"], ["NODE_ENV", "development"],
    ["APP_BASE_URL", "https://apply.findandstudy.com"], ["APP_BASE_URL", "https://staging.findandstudy.com/"],
    ["ALLOW_LIVE_INTEGRATIONS", "true"], ["ALLOW_LIVE_INTEGRATIONS", ""],
    ["PERSONA_TEAM_PREVIEW_ENABLED", "false"], ["PERSONA_TEAM_PREVIEW_ENABLED", ""], ["PERSONA_TEAM_PREVIEW_ENABLED", "1"],
  ]) {
    environment(); process.env[key] = value;
    assert.equal(isPersonaTeamPreviewEnabled(), false);
    const result = await invoke();
    assert.equal(result.status, 404); assert.equal(result.nextCalls, 0); assert.equal(result.sessionReads, 0);
  }
});
test("GET and HEAD reuse existing admin/super_admin guards and bind the session-reader test double", async () => {
  environment();
  for (const role of ["admin", "super_admin"]) for (const method of ["GET", "HEAD"]) {
    const result = await invoke(request({ method, user: user(role) }));
    assert.equal(result.status, 200); assert.equal(result.nextCalls, 1); assert.equal(result.sessionReads, 1);
    assert.equal(result.headers["Cache-Control"], "private, no-store");
    assert.equal(result.headers["X-Robots-Tag"], "noindex, nofollow");
  }
});
test("anonymous, inactive, student, staff, agent and manager users cannot reach preview content", async () => {
  environment();
  const anon = await invoke(request({ user: undefined }));
  assert.equal(anon.status, 401); assert.equal(anon.sessionReads, 0);
  for (const role of ["student", "staff", "agent", "agent_staff", "manager", "forged"]) {
    const result = await invoke(request({ user: user(role) }));
    assert.equal(result.status, 403); assert.equal(result.nextCalls, 0); assert.equal(result.sessionReads, 0);
  }
  const inactive = await invoke(request({ user: { ...user(), isActive: false } }));
  assert.equal(inactive.status, 403); assert.equal(inactive.nextCalls, 0);
});
test("API tokens and any Authorization header cannot fall back to an admin cookie", async () => {
  environment();
  for (const patch of [
    { apiTokenAuth: true }, { tokenScopes: [] }, { tokenScopes: ["admin"] },
    { headers: { authorization: "Bearer example" } }, { headers: { authorization: "Basic example" } }, { headers: { authorization: "" } },
  ]) {
    const result = await invoke(request(patch));
    assert.equal(result.status, 403); assert.equal(result.sessionReads, 0); assert.equal(result.nextCalls, 0);
  }
});
test("missing/invalid cookie, expired or mismatched sessions fail closed", async () => {
  environment();
  for (const cookies of [{}, { sid: "invalid" }]) {
    const result = await invoke(request({ cookies }));
    assert.equal(result.status, 401); assert.equal(result.sessionReads, 0);
  }
  for (const session of [null, { user: { ...user(), id: 8 }, access_token: "" }]) {
    const result = await invoke(request(), session);
    assert.equal(result.status, 401); assert.equal(result.nextCalls, 0);
  }
});
test("canonical session impersonation is rejected even when request role is admin", async () => {
  environment();
  for (const originalSid of ["b".repeat(64), "", null]) {
    const result = await invoke(request(), { user: user(), access_token: "", originalSid } as SessionData);
    assert.equal(result.status, 403); assert.equal(result.nextCalls, 0);
  }
});
test("no mutation method reaches session reader or content", async () => {
  environment();
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]) {
    const result = await invoke(request({ method }));
    assert.equal(result.status, 405); assert.equal(result.headers.Allow, "GET, HEAD");
    assert.equal(result.nextCalls, 0); assert.equal(result.sessionReads, 0);
  }
});
test("session failures return a fixed error without raw exception or details", async () => {
  environment();
  const result = await invoke(request(), null, true);
  assert.equal(result.status, 503); assert.equal(result.nextCalls, 0);
  assert.deepEqual(result.body, { error: "PERSONA_TEAM_PREVIEW_AUTH_UNAVAILABLE" });
});
test("runtime kill switch is checked again after awaiting the session read", async () => {
  environment();
  let status = 200, nextCalls = 0;
  const response = { set() { return this; }, status(value: number) { status = value; return this; }, json() { return this; } } as unknown as Response;
  await createPersonaTeamPreviewAccess(async () => {
    process.env.PERSONA_TEAM_PREVIEW_ENABLED = "false";
    return { user: user(), access_token: "" };
  })(request(), response, () => { nextCalls++; });
  assert.equal(status, 404); assert.equal(nextCalls, 0);
});
