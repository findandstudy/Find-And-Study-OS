import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createPersonaScopedMockRouter } from "../src/routes/persona-scoped-mock";
import { createPersonaLocalPanel } from "../src/routes/persona-local-panel";
import { PersonaSessionRateLimited } from "../src/lib/personaCookieSession";

test("local persona HTTP boundaries fail closed without database/provider access", async (t) => {
  const previous = {
    mode: process.env.NODE_ENV,
    live: process.env.ALLOW_LIVE_INTEGRATIONS,
  };
  process.env.NODE_ENV = "test";
  process.env.ALLOW_LIVE_INTEGRATIONS = "false";
  const app = express();
  let sessionCalls = 0;
  // These requests MUST terminate before touching an application service.
  const service = new Proxy(
    {},
    {
      get() {
        throw Error("SERVICE_MUST_NOT_BE_CALLED");
      },
    },
  ) as Parameters<typeof createPersonaScopedMockRouter>[0];
  app.use(
    "/mock",
    createPersonaScopedMockRouter(service, async () => {
      sessionCalls++;
      throw new PersonaSessionRateLimited(1250);
    }),
  );
  app.use(createPersonaLocalPanel("018f6000-0000-7000-8000-000000000100"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`,
    path = "/mock/018f6000-0000-7000-8000-000000000100";
  try {
    await t.test(
      "rate limit has bounded Retry-After and no cache",
      async () => {
        const response = await fetch(origin + path + "/personas");
        assert.equal(response.status, 429);
        assert.equal(response.headers.get("retry-after"), "2");
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store",
        );
        assert.deepEqual(await response.json(), {
          error: "PERSONA_SESSION_RATE_LIMITED",
          retryAfterSeconds: 2,
        });
        assert.equal(sessionCalls, 1);
        for (const value of [NaN, -1, Infinity, 1000000])
          assert.equal(
            new PersonaSessionRateLimited(value).retryAfterSeconds,
            60,
          );
      },
    );
    await t.test(
      "malformed and oversized JSON never reaches session and leaks no body",
      async () => {
        for (const body of [
          '{"private":"DO_NOT_ECHO",',
          JSON.stringify({ private: "DO_NOT_ECHO".repeat(5000) }),
        ]) {
          const response = await fetch(origin + path + "/proposals", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          });
          assert.equal(response.status, 400);
          assert.equal(
            response.headers.get("cache-control"),
            "private, no-store",
          );
          assert.deepEqual(await response.json(), {
            error: "PERSONA_INVALID_BODY",
          });
        }
        assert.equal(sessionCalls, 1);
      },
    );
    await t.test(
      "runtime live toggle denies panel, scripts and API before session",
      async () => {
        process.env.ALLOW_LIVE_INTEGRATIONS = "true";
        try {
          for (const url of [
            "/",
            "/panel.js",
            "/panel.css",
            path + "/personas",
          ]) {
            const response = await fetch(origin + url);
            assert.equal(response.status, 403);
            assert.match(await response.text(), /PERSONA_MOCK_ONLY/);
          }
        } finally {
          process.env.ALLOW_LIVE_INTEGRATIONS = "false";
        }
        assert.equal(sessionCalls, 1);
      },
    );
    await t.test(
      "runtime production mode denies previously constructed routes",
      async () => {
        process.env.NODE_ENV = "production";
        try {
          assert.equal((await fetch(origin + path + "/personas")).status, 403);
          assert.equal((await fetch(origin)).status, 403);
        } finally {
          process.env.NODE_ENV = "test";
        }
        assert.equal(sessionCalls, 1);
      },
    );
    await t.test(
      "panel never interpolates uncontrolled project identifiers",
      () => {
        assert.throws(
          () => createPersonaLocalPanel("<script>alert(1)</script>"),
          /PERSONA_SCOPE_REQUIRED/,
        );
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (previous.mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.mode;
    if (previous.live === undefined) delete process.env.ALLOW_LIVE_INTEGRATIONS;
    else process.env.ALLOW_LIVE_INTEGRATIONS = previous.live;
  }
});
