import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zernioWebhookChannel, existingZernioWebhookAccount } from "../src/lib/inbox/webhookAccountIdentity";

test("Facebook provider alias resolves to the same canonical Messenger channel", () => {
  assert.equal(zernioWebhookChannel("facebook"), "messenger");
  assert.equal(zernioWebhookChannel("messenger"), "messenger");
  for (const channel of ["whatsapp", "instagram", "telegram"]) assert.equal(zernioWebhookChannel(channel), channel);
  for (const channel of [null, {}, "email", "sms", "unknown", " messenger"]) assert.equal(zernioWebhookChannel(channel), null);
});

test("legacy Facebook account retains its row and historical conversation channel", () => {
  const legacy = { id: 7, channel: "facebook", isActive: true };
  const result = existingZernioWebhookAccount([legacy], "messenger");
  assert.equal(result.kind, "existing");
  if (result.kind === "existing") assert.equal(result.account, legacy);
  assert.equal(legacy.channel, "facebook");
});

test("manually created Messenger account is reused for a Facebook webhook", () => {
  const account = { id: 8, channel: "messenger", isActive: true };
  const result = existingZernioWebhookAccount([account], zernioWebhookChannel("facebook")!);
  assert.equal(result.kind, "existing");
  if (result.kind === "existing") assert.equal(result.account.id, 8);
});

test("inactive provider identity cannot auto-register a replacement", () => {
  assert.deepEqual(existingZernioWebhookAccount([{ channel: "facebook", isActive: false }], "messenger"), { kind: "blocked" });
});

test("ambiguous alias or different-channel identities fail closed", () => {
  assert.deepEqual(existingZernioWebhookAccount([
    { channel: "facebook", isActive: true }, { channel: "messenger", isActive: true },
  ], "messenger"), { kind: "blocked" });
  assert.deepEqual(existingZernioWebhookAccount([{ channel: "whatsapp", isActive: true }], "messenger"), { kind: "blocked" });
});

test("only a new identity is eligible for registration; existing Telegram stays supported", () => {
  assert.deepEqual(existingZernioWebhookAccount([], "telegram"), { kind: "new" });
  assert.equal(existingZernioWebhookAccount([{ channel: "telegram", isActive: true }], "telegram").kind, "existing");
});

test("webhook integration serializes registration and blocks null routing", () => {
  const source = readFileSync(new URL("../src/routes/webhooks.ts", import.meta.url), "utf8");
  const direct = source.slice(source.indexOf("async function ensureChannelAccount"), source.indexOf("const MIME_EXT"));
  assert.match(direct, /pg_advisory_xact_lock\(hashtext\('channel-account-management'\), 0\)/);
  assert.equal((direct.match(/eq\(channelAccountsTable.provider, "direct"\)/g) ?? []).length, 2);
  assert.equal((source.match(/if \(channelAccountId == null\)/g) ?? []).length, 3);
  const zernio = source.slice(source.indexOf('router.post("/webhooks/zernio"'));
  assert.match(zernio, /pg_advisory_xact_lock\(hashtext\('channel-account-management'\), 0\)/);
  assert.match(zernio, /existingZernioWebhookAccount\(rows, canonicalChannel\)/);
  assert.match(zernio, /const platform = acct.channel/);
});
