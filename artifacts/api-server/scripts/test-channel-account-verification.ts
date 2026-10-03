import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyZernioManagedAccount } from "../src/lib/inbox/channelAccountVerification";
const account = "fixture_account";
const token = "synthetic-only-token";
const allowed = () => true;
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
test("verification is fixed-origin, redirect-denied, header-authenticated and exact identity/profile-bound", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://zernio.com/api/v1/accounts?platform=whatsapp&includeOverLimit=true");
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`); assert.ok(init?.signal);
    return json({ accounts: [{ _id: account, profileId: { _id: "profile_1" } }] });
  };
  assert.equal(await verifyZernioManagedAccount(token, account, { allowed, fetcher }), true);
});
test("missing, duplicate, malformed and unbound identities fail closed", async () => {
  for (const data of [{ accounts: [] }, [{ _id: "other", profileId: "profile" }], [{ _id: account }],
    [{ _id: account, profileId: "profile" }, { _id: account, profileId: "profile" }], { accounts: "not-array" }]) {
    assert.equal(await verifyZernioManagedAccount(token, account, { allowed, fetcher: async () => json(data) }), false);
  }
});
test("advertised and streaming oversized bodies are rejected without unbounded parsing", async () => {
  const advertised = new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": "65537" } });
  assert.equal(await verifyZernioManagedAccount(token, account, { allowed, fetcher: async () => advertised }), false);
  const streamed = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); controller.close(); } }), { headers: { "Content-Type": "application/json" } });
  assert.equal(await verifyZernioManagedAccount(token, account, { allowed, fetcher: async () => streamed }), false);
});
test("deadline aborts stalled metadata fetch and returns no false success", async () => {
  let aborted = false;
  const fetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("synthetic timeout")); }, { once: true });
  });
  assert.equal(await verifyZernioManagedAccount(token, account, { allowed, fetcher, timeoutMs: 5 }), false);
  assert.equal(aborted, true);
});
test("disabled gate, revoked midflight, provider errors and non-JSON bodies do not verify", async () => {
  let called = false;
  assert.equal(await verifyZernioManagedAccount(token, account, { allowed: () => false, fetcher: async () => { called = true; return json([]); } }), false);
  assert.equal(called, false);
  let enabled = true;
  assert.equal(await verifyZernioManagedAccount(token, account, { allowed: () => enabled, fetcher: async () => { enabled = false; return json([{ _id: account, profileId: "profile" }]); } }), false);
  for (const response of [new Response("failure echoes a secret", { status: 401 }), new Response("<html>wrong</html>")]) {
    assert.equal(await verifyZernioManagedAccount(token, account, { allowed, fetcher: async () => response }), false);
  }
});
