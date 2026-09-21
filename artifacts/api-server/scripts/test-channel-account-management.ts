import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { accountCapabilities, accountFilter, accountKind, accountRecord, accountText, accountVerificationAllowed,
  ACCOUNT_SECRET_MASK, managedAccountConfig, managedExternalId, safeManagedAccountConfig } from "../src/lib/inbox/channelAccountManagementPolicy";

const botToken = "123456789:synthetic_BOT_TOKEN_value_012345";
const twilio = { accountSid: `AC${"a".repeat(32)}`, authToken: "b".repeat(32), fromNumber: "+441234567890" };
test("supported native/provider combinations exclude SMTP and dummy Zernio channels", () => {
  for (const channel of ["whatsapp", "messenger", "instagram", "telegram", "sms"]) assert.equal(accountKind(channel).provider, "direct");
  for (const channel of ["whatsapp", "messenger", "instagram", "telegram"]) assert.equal(accountKind(channel, "zernio").provider, "zernio");
  assert.deepEqual(accountKind("facebook", "zernio"), { channel: "messenger", provider: "zernio" });
  for (const [channel, provider] of [["email", "smtp"], ["email", "direct"], ["zernio", "direct"], ["sms", "zernio"], ["telegram", "unknown"]]) assert.throws(() => accountKind(channel, provider));
});
test("channel and provider filters intersect and reject arrays/unknown values", () => {
  assert.deepEqual(accountFilter({ channel: "telegram", provider: "zernio" }), { channel: "telegram", provider: "zernio" });
  for (const query of [{ channel: ["sms"] }, { provider: ["direct"] }, { channel: "email" }, { provider: "smtp" }, { channel: "sms", provider: "zernio" }]) assert.throws(() => accountFilter(query));
});
test("Telegram credentials and optional default chat ID are validated without calls", () => {
  const config = managedAccountConfig("telegram", "direct", { botToken, defaultChatId: "-100123456789" });
  assert.equal(managedExternalId("telegram", "direct", config), "123456789");
  assert.equal(config.defaultChatId, "-100123456789");
  for (const value of ["bad", "enc::v1::stored", "••••••••", `${botToken}\r\n`]) assert.throws(() => managedAccountConfig("telegram", "direct", { botToken: value }));
  assert.throws(() => managedAccountConfig("telegram", "direct", { botToken, defaultChatId: "https://example.test" }));
});
test("Twilio config requires account SID, auth token and an E.164 sender", () => {
  assert.deepEqual(managedAccountConfig("sms", "direct", twilio), twilio);
  assert.equal(managedExternalId("sms", "direct", twilio), twilio.fromNumber);
  for (const field of Object.keys(twilio)) assert.throws(() => managedAccountConfig("sms", "direct", { ...twilio, [field]: "invalid" }));
});
test("unknown config fields, nested secrets, arrays and SMTP settings are refused", () => {
  for (const config of [[], { nested: { botToken } }, { botToken, host: "smtp.example.test" }, { botToken, token: "other" }]) {
    assert.throws(() => managedAccountConfig("telegram", "direct", config));
  }
  assert.throws(() => accountRecord(null)); assert.throws(() => accountRecord([]));
});
test("masked/blank/omitted secrets retain a previous value; create never accepts a mask", () => {
  for (const value of [ACCOUNT_SECRET_MASK, "", undefined]) assert.equal(managedAccountConfig("telegram", "direct", { botToken: value }, { botToken }).botToken, botToken);
  assert.throws(() => managedAccountConfig("telegram", "direct", { botToken: ACCOUNT_SECRET_MASK }));
  assert.throws(() => managedAccountConfig("telegram", "direct", {}, { botToken: "enc::v1::failed-decryption" }));
});
test("short and long secrets are fully masked; unknown/nested/ciphertext fields never leave API", () => {
  const masked = safeManagedAccountConfig("whatsapp", "direct", { accessToken: "abc", appSecret: "s", phoneNumberId: "123", nested: { raw: "secret" }, unknownToken: "value" });
  assert.deepEqual(masked, { accessToken: ACCOUNT_SECRET_MASK, appSecret: ACCOUNT_SECRET_MASK, phoneNumberId: "123" });
  assert.deepEqual(safeManagedAccountConfig("sms", "direct", { authToken: "enc::v1::unreadable" }), {});
  assert.deepEqual(safeManagedAccountConfig("email", "smtp", { password: "raw" }), {});
});
test("Zernio account references never accept API keys, native Meta credentials or unused profile ID", () => {
  assert.deepEqual(managedAccountConfig("whatsapp", "zernio", {}), {});
  assert.equal(managedExternalId("whatsapp", "zernio", {}, "acct_123-abc"), "acct_123-abc");
  for (const config of [{ apiKey: "secret" }, { accessToken: "secret" }, { profileId: "unused" }]) assert.throws(() => managedAccountConfig("whatsapp", "zernio", config));
  for (const id of [undefined, "", "abc/../../", "https://example.test"]) assert.throws(() => managedExternalId("whatsapp", "zernio", {}, id));
  assert.throws(() => managedExternalId("whatsapp", "direct", {}, "manually-override"));
});
test("native Telegram/SMS capabilities are honestly configuration-only, unlike provider Telegram", () => {
  for (const channel of ["telegram", "sms"]) {
    const cap = accountCapabilities(channel, "direct");
    assert.equal(cap.configurationOnly, true); assert.equal(cap.inboxSupported, false);
    assert.equal(cap.verificationSupported, false); assert.equal(cap.webhookPath, null);
  }
  assert.equal(accountCapabilities("telegram", "zernio").inboxSupported, true);
  assert.equal(accountCapabilities("telegram", "zernio").verificationSupported, false);
});
test("callback paths match existing routes and omit unsupported callbacks", () => {
  assert.equal(accountCapabilities("whatsapp", "direct").webhookPath, "/api/webhooks/whatsapp");
  assert.equal(accountCapabilities("messenger", "direct").webhookPath, "/api/webhooks/meta");
  assert.equal(accountCapabilities("instagram", "direct").webhookPath, "/api/webhooks/meta");
  assert.equal(accountCapabilities("whatsapp", "zernio").webhookPath, "/api/webhooks/zernio");
});
test("explicit false/invalid live flag wins even in production-mode staging", () => {
  assert.equal(accountVerificationAllowed({ NODE_ENV: "production", ALLOW_LIVE_INTEGRATIONS: "false" }), false);
  assert.equal(accountVerificationAllowed({ NODE_ENV: "production", ALLOW_LIVE_INTEGRATIONS: "TRUE" }), false);
  assert.equal(accountVerificationAllowed({ NODE_ENV: "test" }), false);
  assert.equal(accountVerificationAllowed({ NODE_ENV: "production" }), true);
  assert.equal(accountVerificationAllowed({ ALLOW_LIVE_INTEGRATIONS: "true" }), true);
});
test("names and flat metadata reject header controls or oversized content", () => {
  assert.throws(() => accountText("name\nsecret", 120, "INVALID"));
  assert.throws(() => accountText("a".repeat(121), 120, "INVALID"));
  assert.equal(accountText("  Name  ", 120, "INVALID"), "Name");
});
test("all mutations require non-impersonated human authority; SMTP remains separately managed", async () => {
  const source = await readFile(new URL("../src/routes/channelAccounts.ts", import.meta.url), "utf8");
  assert.equal((source.match(/router\.(?:post|put|patch|delete)\(/g) ?? []).length, 6);
  assert.equal((source.match(/requireAuth, requireRole\(\.\.\.ADMIN_ROLES\), humanAdmin, handle/g) ?? []).length, 6);
  assert.match(source, /emailAutomationHumanAllowed\(req\)/);
  assert.equal((source.match(/managed_email_sender/g) ?? []).length, 5);
  assert.match(source, /ne\(channelAccountsTable.channel, "email"\)/);
  assert.match(source, /private, no-store/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.doesNotMatch(source, /err\?\.message|error\.message|response\.text\(/);
});
