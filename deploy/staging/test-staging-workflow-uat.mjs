import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXACT_STAGING_ORIGIN,
  Session,
  WORKFLOW_UAT_QUARANTINE_REASON,
  listRows,
  parseSetCookies,
  run,
} from "./run-staging-workflow-uat.mjs";

test("set-cookie parsing retains only name/value pairs", () => {
  const headers = new Headers();
  headers.append("set-cookie", "csrf_token=abc; Path=/; Secure");
  assert.deepEqual(parseSetCookies(headers), ["csrf_token=abc"]);
});

test("listRows accepts only the supported list envelopes", () => {
  assert.deepEqual(listRows([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(listRows({ data: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepEqual(listRows({ students: [{ id: 3 }] }), [{ id: 3 }]);
  assert.deepEqual(listRows({ unexpected: [{ id: 4 }] }), []);
});

test("session refuses to transmit outside the fixed staging origin", async () => {
  const session = new Session(EXACT_STAGING_ORIGIN);
  await assert.rejects(
    session.request("https://example.com/api/health"),
    /escaped the fixed staging origin/,
  );
});

const quarantined = (error) => error instanceof Error
  && error.message === `[staging-workflow-uat] BLOCKED: ${WORKFLOW_UAT_QUARANTINE_REASON}`;

function forbidFetch(context) {
  let calls = 0;
  context.mock.method(globalThis, "fetch", () => {
    calls++;
    throw new Error("NETWORK_FORBIDDEN_IN_PURE_TEST");
  });
  return () => assert.equal(calls, 0, "quarantine must reject before any fetch");
}

test("workflow is quarantined even with every legacy opt-in and release confirmation", async (context) => {
  const assertNoFetch = forbidFetch(context);
  const synthetic = {
    ALLOW_STAGING_WORKFLOW_UAT: "true",
    ALLOW_LIVE_INTEGRATIONS: "false",
    STAGING_BASE_URL: EXACT_STAGING_ORIGIN,
    RBAC_E2E_PASSWORD: "synthetic-not-a-real-password",
    STAGING_EXPECTED_SOURCE_COMMIT: "a".repeat(40),
    STAGING_EXPECTED_RELEASE_ID: `staging-20260923T120000Z-${"a".repeat(12)}`,
  };
  const previous = new Map(Object.keys(synthetic).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, synthetic);
    await assert.rejects(run(), quarantined);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assertNoFetch();
});

for (const [method, path] of [
  ["GET", "/api/health"],
  ["POST", "/api/leads/1/convert"],
  ["PATCH", "/api/students/1"],
  ["POST", "/api/documents"],
  ["PUT", "/api/storage/local-upload/synthetic"],
  ["DELETE", "/api/students/1"],
  ["POST", "/api/students/1/purge"],
  ["POST", "/api/applications/1/purge"],
]) {
  test(`exported Session cannot bypass quarantine with ${method} ${path}`, async (context) => {
    const assertNoFetch = forbidFetch(context);
    const session = new Session(EXACT_STAGING_ORIGIN);
    session.cookies.set("sid", "synthetic-session");
    session.csrf = "synthetic-csrf";
    await assert.rejects(session.request(path, { method }), quarantined);
    assertNoFetch();
  });
}

test("changing the Session origin cannot reopen the quarantined transport", async (context) => {
  const assertNoFetch = forbidFetch(context);
  const session = new Session("https://unrelated.example.test");
  await assert.rejects(session.request("/api/health"), quarantined);
  assertNoFetch();
});

test("login and cleanup helpers cannot transmit through an imported Session", async (context) => {
  const assertNoFetch = forbidFetch(context);
  const session = new Session(EXACT_STAGING_ORIGIN);
  await assert.rejects(session.login("synthetic@audit.test", "synthetic-password", "student"), quarantined);
  session.cookies.set("sid", "synthetic-session");
  await assert.rejects(session.logout(), quarantined);
  assertNoFetch();
});

test("execution fence precedes credential reads and the first network boundary", async () => {
  const source = await readFile(new URL("./run-staging-workflow-uat.mjs", import.meta.url), "utf8");
  const runBody = source.slice(source.indexOf("async function run()"));
  const runFence = runBody.indexOf("assertWorkflowExecutionAvailable();");
  assert.ok(runFence >= 0 && runFence < runBody.indexOf("process.env."));
  const requestBody = source.slice(source.indexOf("async request("), source.indexOf("async call("));
  const requestFence = requestBody.indexOf("assertWorkflowExecutionAvailable();");
  assert.ok(requestFence >= 0 && requestFence < requestBody.indexOf("await fetch("));
});
