import assert from "node:assert/strict";
import test from "node:test";

import {
  EXACT_STAGING_ORIGIN,
  Session,
  listRows,
  parseSetCookies,
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
