import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
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
  return { method: "GET", originalUrl: "/admin/agent-team-preview/", headers: {}, cookies: { sid }, user: user(), ...patch } as Request;
}
async function invoke(req = request(), session: SessionData | null = { user: user(), access_token: "" }, readerError = false) {
  let status = 200, body: unknown, nextCalls = 0, sessionReads = 0;
  const headers: Record<string, string> = {};
  const response = {
    set(key: string, value: string) { headers[key] = value; return this; },
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
    redirect(code: number, path: string) { status = code; headers.Location = path; return this; },
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

async function withHttpAccess(
  run: (base: string, reads: () => number) => Promise<void>,
  session: SessionData | null = null,
) {
  environment();
  let reads = 0;
  const app = express();
  app.use((req, _res, next) => {
    // Synthetic authenticated identity replaces only the upstream middleware;
    // the actual preview access middleware and role guards execute below.
    const actor = req.headers["x-test-actor"];
    if (typeof actor === "string") req.user = { ...user(actor), isActive: actor !== "inactive" };
    if (actor === "inactive") req.user!.role = "admin";
    req.cookies = { sid };
    if (req.headers["x-test-token"]) req.apiTokenAuth = true;
    next();
  });
  app.use("/admin/agent-team-preview", createPersonaTeamPreviewAccess(async () => {
    reads++;
    return session; // A canonical-session test double, never a live DB request.
  }), (_req, res) => res.send("authenticated synthetic preview"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, () => reads);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

// Node fetch overrides Sec-Fetch-Mode with "cors". Send raw HTTP headers so
// these requests exercise actual browser navigation content negotiation.
function httpProbe(url: string, options: { headers: Record<string, string>; method?: string }) {
  return new Promise<{ status: number; headers: { get(name: string): string | null } }>((resolve, reject) => {
    const req = httpRequest(url, options, (res) => {
      res.resume();
      res.on("end", () => resolve({
        status: res.statusCode!,
        headers: { get: (name) => {
          const value = res.headers[name.toLowerCase()];
          return typeof value === "string" ? value : null;
        } },
      }));
      res.on("error", reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error("preview HTTP test timeout")));
    req.on("error", reject);
    req.end();
  });
}

test("browser document entry redirects anonymous or expired sessions only to the fixed login target", async () => {
  await withHttpAccess(async (base, reads) => {
    for (const suffix of ["", "/", "/?returnTo=https%3A%2F%2Funtrusted.invalid%2F&next=%2Fadmin%2Fusers"]) {
      for (const actor of [undefined, "admin", "super_admin"]) {
        const response = await httpProbe(`${base}/admin/agent-team-preview${suffix}`, {
          headers: {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            ...(actor ? { "x-test-actor": actor } : {}),
          },
        });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get("location"), "/en/login?returnTo=%2Fadmin%2Fagent-team-preview%2F");
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
      }
    }
    assert.equal(reads(), 6);
  });
});

test("non-document assets, API-style accepts and HEAD keep unauthenticated JSON responses", async () => {
  await withHttpAccess(async (base) => {
    const cases = [
      { path: "/", accept: "application/json" },
      { path: "/", accept: "*/*" },
      { path: "/", accept: "application/json,text/html;q=0.5" },
      { path: "/", accept: "text/html;q=0,application/json" },
      { path: "/", accept: "text/html", extra: { "sec-fetch-dest": "empty" } },
      { path: "/", accept: "text/html", extra: { "sec-fetch-mode": "cors" } },
      { path: "/", accept: "text/html", extra: { "x-requested-with": "XMLHttpRequest" } },
      ...["/preview.js", "/panel.css", "/team-tree.js", "/team-tree.css", "/nested", "//"].map((path) => ({ path, accept: "text/html" })),
      { path: "/", accept: "text/html", method: "HEAD" },
    ];
    for (const item of cases) {
      for (const actor of [undefined, "admin"]) {
        const response = await httpProbe(`${base}/admin/agent-team-preview${item.path}`, {
          method: item.method ?? "GET",
          headers: { accept: item.accept, ...item.extra, ...(actor ? { "x-test-actor": actor } : {}) },
        });
        assert.equal(response.status, 401, `${item.path} ${item.accept} ${actor}`);
        assert.equal(response.headers.get("location"), null);
        assert.match(response.headers.get("content-type")!, /application\/json/);
      }
    }
  });
});

test("HTML requests never redirect authorization headers, tokens, denied roles or inactive accounts", async () => {
  await withHttpAccess(async (base, reads) => {
    for (const extra of [
      { authorization: "Bearer invalid" }, { authorization: "Basic invalid" }, { authorization: "" },
      { "x-test-token": "1" },
      ...["staff", "student", "agent", "agent_staff", "manager", "inactive"].map((role) => ({ "x-test-actor": role })),
    ]) {
      const response = await httpProbe(`${base}/admin/agent-team-preview/`, {
        headers: { accept: "text/html", ...extra },
      });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("location"), null);
    }
    assert.equal(reads(), 0);
  });
});

test("HTML entry still requires a matching non-impersonated admin session and enabled staging gate", async () => {
  for (const item of [
    { session: { user: user(), access_token: "" }, status: 200 },
    { session: { user: { ...user(), id: 8 }, access_token: "" }, status: 401 },
    { session: { user: user(), access_token: "", originalSid: "b".repeat(64) }, status: 403 },
  ]) {
    await withHttpAccess(async (base) => {
      const response = await httpProbe(`${base}/admin/agent-team-preview/`, {
        headers: { accept: "text/html", "x-test-actor": "admin" },
      });
      assert.equal(response.status, item.status);
      assert.equal(response.headers.get("location"), null);
    }, item.session);
  }
  await withHttpAccess(async (base, reads) => {
    process.env.PERSONA_TEAM_PREVIEW_ENABLED = "false";
    const response = await httpProbe(`${base}/admin/agent-team-preview/`, { headers: { accept: "text/html" } });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("location"), null);
    assert.equal(reads(), 0);
  });
});
