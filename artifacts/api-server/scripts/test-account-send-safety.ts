import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  __setZernioAccountSendableOverrideForTests,
  __setZernioApiKeyOverrideForTests,
  sendViaZernio,
  sendZernioTemplate,
} from "../src/lib/inbox/zernioSend";

const previousLive = process.env.ALLOW_LIVE_INTEGRATIONS;
const previousMode = process.env.NODE_ENV;
const previousFetch = globalThis.fetch;
let networkCalls = 0;
let resolvedAccounts: string[] = [];

beforeEach(() => {
  networkCalls = 0;
  resolvedAccounts = [];
  process.env.NODE_ENV = "production";
  process.env.ALLOW_LIVE_INTEGRATIONS = "true";
  __setZernioApiKeyOverrideForTests("synthetic-test-key");
  __setZernioAccountSendableOverrideForTests(async (id) => {
    resolvedAccounts.push(id);
    return false;
  });
  globalThis.fetch = (async () => {
    networkCalls += 1;
    throw new Error("Real provider calls are forbidden in this test");
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = previousFetch;
  if (previousLive === undefined) delete process.env.ALLOW_LIVE_INTEGRATIONS;
  else process.env.ALLOW_LIVE_INTEGRATIONS = previousLive;
  if (previousMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousMode;
  __setZernioApiKeyOverrideForTests(null);
  __setZernioAccountSendableOverrideForTests(null);
});

test("disabled/missing/ambiguous Zernio account cannot deliver text or attachments", async () => {
  const result = await sendViaZernio({
    externalAccountId: "disabled-account", externalThreadId: "synthetic-thread",
    text: "Synthetic only", attachments: [{ url: "https://example.invalid/test.pdf" }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "zernio_account_inactive_missing_or_ambiguous");
  assert.deepEqual(resolvedAccounts, ["disabled-account"]);
  assert.equal(networkCalls, 0);
});

test("disabled Zernio account cannot create a template broadcast", async () => {
  const result = await sendZernioTemplate({
    externalAccountId: "disabled-template-account", templateName: "synthetic",
    language: "en", toPhoneE164: "+12025550100",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(resolvedAccounts, ["disabled-template-account"]);
  assert.equal(networkCalls, 0);
});

test("explicit false or invalid outbound flag wins over production mode for text and templates", async () => {
  for (const flag of ["false", "FALSE", "", "unknown"]) {
    process.env.ALLOW_LIVE_INTEGRATIONS = flag;
    const text = await sendViaZernio({ externalAccountId: "test", externalThreadId: "test", text: "Test" });
    const template = await sendZernioTemplate({
      externalAccountId: "test", templateName: "test", language: "en", toPhoneE164: "+12025550100",
    });
    assert.equal(text.simulated, true);
    assert.equal(template.simulated, true);
    assert.equal(networkCalls, 0);
    assert.deepEqual(resolvedAccounts, []);
  }
});
