import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { csrfProtection } from "../src/middlewares/csrf";

function invoke(overrides: Record<string, unknown> = {}) {
  const request = { path: "/api/storage/uploads/request-url", method: "GET", cookies: {}, headers: {}, secure: false,
    ...overrides } as any;
  const state = { next: 0, status: 200, json: undefined as unknown, cookies: [] as any[] };
  const response = {
    cookie: (...args: unknown[]) => { state.cookies.push(args); },
    status: (code: number) => { state.status = code; return response; },
    json: (value: unknown) => { state.json = value; return response; },
  } as any;
  csrfProtection(request, response, () => { state.next++; });
  return { request, ...state };
}

test("safe methods issue a fresh token and flag the response without changing request cookies", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const result = invoke({ method });
    assert.equal(result.next, 1); assert.equal(result.cookies.length, 1);
    assert.equal(result.cookies[0][0], "csrf_token");
    assert.match(result.cookies[0][1], /^[0-9a-f]{64}$/);
    assert.equal(result.request.csrfCookieIssued, true);
    assert.equal(result.request.cookies.csrf_token, undefined);
  }
});

test("first unsafe request remains denied even when a new response cookie is issued", () => {
  const result = invoke({ method: "POST", headers: { "x-csrf-token": "untrusted" } });
  assert.equal(result.status, 403); assert.equal(result.next, 0);
  assert.equal(result.cookies.length, 1);
  assert.deepEqual(result.json, { error: "CSRF token missing or invalid" });
});

test("matching existing cookie/header allows each unsafe method without replacing its token", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    const result = invoke({ method, cookies: { csrf_token: "existing" }, headers: { "x-csrf-token": "existing" } });
    assert.equal(result.next, 1); assert.equal(result.cookies.length, 0);
  }
});

test("missing, mismatched and duplicate headers do not authorize cookie-authenticated mutation", () => {
  for (const token of [undefined, "different", ["existing", "existing"]]) {
    const result = invoke({ method: "POST", cookies: { csrf_token: "existing" }, headers: { "x-csrf-token": token } });
    assert.equal(result.status, 403); assert.equal(result.next, 0);
  }
});

test("verified API-token auth retains its cookie-independent exemption", () => {
  const result = invoke({ method: "POST", apiTokenAuth: true });
  assert.equal(result.next, 1); assert.equal(result.cookies.length, 0);
});

test("existing public/webhook and exact onboarding exemptions are unchanged", () => {
  for (const path of ["/api/public/apply", "/api/webhooks/whatsapp", "/api/agents/onboarding/verify-with-link", "/api/agents/onboarding/resend-public"]) {
    const result = invoke({ method: "POST", path });
    assert.equal(result.next, 1); assert.equal(result.cookies.length, 0);
  }
  for (const path of ["/api/publicity/edit", "/api/webhooks-extra", "/api/agents/onboarding/resend-public-extra"]) {
    assert.equal(invoke({ method: "POST", path }).status, 403);
  }
});

test("cookie security flags, lifetime and path reuse existing helper behavior", () => {
  const result = invoke({ secure: true });
  assert.deepEqual(result.cookies[0][2], { httpOnly: false, secure: true, sameSite: "lax", path: "/", maxAge: 604800000 });
});

test("deployed app retains cookie parsing/auth/CSRF/router order and shares the tested middleware", () => {
  const app = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
  assert.match(app, /import \{ csrfProtection \} from "\.\/middlewares\/csrf"/);
  const positions = ["app.use(cookieParser())", "app.use(authMiddleware)", "app.use(csrfProtection)", 'app.use("/api", router)'].map(s => app.indexOf(s));
  assert(positions.every(p => p >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert(!app.includes('const CSRF_COOKIE ='));
});
