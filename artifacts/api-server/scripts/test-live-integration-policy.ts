import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import net from "node:net";
import { isLiveIntegrationsEnabled, liveModeReason } from "../src/lib/inbox/liveMode";
import { sendWhatsAppText, sendWhatsAppTemplate } from "../src/lib/inbox/channels/whatsapp";
import { sendMessengerText } from "../src/lib/inbox/channels/messenger";
import { sendInstagramText } from "../src/lib/inbox/channels/instagram";

const previous = { NODE_ENV: process.env.NODE_ENV, ALLOW_LIVE_INTEGRATIONS: process.env.ALLOW_LIVE_INTEGRATIONS };
const disabledValues = ["false", "FALSE", "", "unknown", "TRUE", " true "];
let providerCalls = 0;
let allowMockProvider = false;

beforeEach(() => {
  providerCalls = 0;
  allowMockProvider = false;
  mock.method(net.Socket.prototype, "connect", () => { throw new Error("REAL_NETWORK_FORBIDDEN"); });
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    providerCalls++;
    assert.equal(allowMockProvider, true, "disabled delivery must never reach a provider");
    assert.equal(new URL(String(input)).origin, "https://graph.facebook.com");
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify({ messages: [{ id: "fixture-wa" }], message_id: "fixture-meta" }), {
      headers: { "Content-Type": "application/json" },
    });
  });
});

afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  mock.restoreAll();
});

for (const environment of ["production", "development", "test"]) {
  test(`explicit false and invalid values deny live mode in ${environment}`, () => {
    process.env.NODE_ENV = environment;
    for (const value of disabledValues) {
      process.env.ALLOW_LIVE_INTEGRATIONS = value;
      assert.equal(isLiveIntegrationsEnabled(), false, JSON.stringify(value));
      assert.match(liveModeReason(), /^simulated/);
    }
    process.env.ALLOW_LIVE_INTEGRATIONS = "true";
    assert.equal(isLiveIntegrationsEnabled(), true);
    assert.equal(liveModeReason(), "live");
  });
}

test("unset flag preserves only the existing production default", () => {
  delete process.env.ALLOW_LIVE_INTEGRATIONS;
  for (const environment of ["production", "development", "test", "staging", ""]) {
    process.env.NODE_ENV = environment;
    assert.equal(isLiveIntegrationsEnabled(), environment === "production", environment);
  }
  delete process.env.NODE_ENV;
  assert.equal(isLiveIntegrationsEnabled(), false);
});

async function sendAllDirectChannels() {
  const config = { phoneNumberId: "fixture-phone", accessToken: "synthetic-only-token" };
  const metaConfig = { pageAccessToken: "synthetic-only-token" };
  return [
    await sendWhatsAppText({ config, toPhoneE164: "+12025550100", text: "Fixture" }),
    await sendWhatsAppTemplate({ config, toPhoneE164: "+12025550100", templateName: "fixture", language: "en" }),
    await sendMessengerText({ config: metaConfig, recipientId: "fixture-recipient", text: "Fixture" }),
    await sendInstagramText({ config: metaConfig, recipientId: "fixture-recipient", text: "Fixture" }),
  ];
}

for (const environment of ["production", "development", "test"]) {
  test(`direct WhatsApp text/template and Meta sends make zero provider calls when disabled in ${environment}`, async () => {
    process.env.NODE_ENV = environment;
    for (const value of disabledValues) {
      process.env.ALLOW_LIVE_INTEGRATIONS = value;
      const results = await sendAllDirectChannels();
      assert.ok(results.every(result => result.simulated === true));
      assert.equal(providerCalls, 0, `${environment} ${JSON.stringify(value)}`);
    }
  });
}

test("production unset default still reaches only the injected direct-provider double", async () => {
  process.env.NODE_ENV = "production";
  delete process.env.ALLOW_LIVE_INTEGRATIONS;
  allowMockProvider = true;
  const results = await sendAllDirectChannels();
  assert.ok(results.every(result => result.ok && !result.simulated));
  assert.equal(providerCalls, 4);
});
