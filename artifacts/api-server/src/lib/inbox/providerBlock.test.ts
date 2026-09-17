import test from "node:test";
import assert from "node:assert/strict";
import { changeWhatsAppProviderBlock } from "./providerBlock";

const input = { liveEnabled: true, channel: "whatsapp", provider: "direct", active: true, phoneNumberId: "123456", accessToken: "test-only", recipient: "905551234567", blocked: true };
const receipt = (key = "added_users", recipient = input.recipient) => ({ messaging_product: "whatsapp", block_users: { [key]: [{ input: `+${recipient}`, wa_id: recipient }] } });

test("native block and unblock bind exact account, recipient and receipt", async () => {
  for (const blocked of [true, false]) {
    const result = await changeWhatsAppProviderBlock({ ...input, blocked }, (async (url, init) => {
      assert.match(String(url), /^https:\/\/graph.facebook.com\/v[\d.]+\/123456\/block_users$/);
      assert.equal(init?.method, blocked ? "POST" : "DELETE");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      assert.deepEqual(JSON.parse(String(init?.body)), { messaging_product: "whatsapp", block_users: [{ user: input.recipient }] });
      return Response.json(receipt(blocked ? "added_users" : "removed_users"));
    }) as typeof fetch);
    assert.equal(result.confirmed, true);
  }
});

test("disabled, unsupported, inactive or incomplete connections never call provider", async () => {
  for (const override of [{ liveEnabled: false }, { provider: "zernio" }, { channel: "instagram" }, { active: false }, { phoneNumberId: "../other" }, { accessToken: "" }, { recipient: "not-a-phone" }]) {
    const result = await changeWhatsAppProviderBlock({ ...input, ...override }, (async () => { assert.fail("unexpected external call"); }) as typeof fetch);
    assert.equal(result.confirmed, false);
  }
});

test("HTTP 200 without exact successful recipient receipt is not a block", async () => {
  for (const body of [{ success: true }, receipt("removed_users"), receipt("added_users", "905550000000"), { messaging_product: "whatsapp", block_users: { failed_users: [{ input: input.recipient }] } }]) {
    const result = await changeWhatsAppProviderBlock(input, (async () => Response.json(body)) as typeof fetch);
    assert.equal(result.confirmed, false);
  }
});

test("provider failures and uncertain network results never leak raw errors or claim success", async () => {
  const rejected = await changeWhatsAppProviderBlock(input, (async () => Response.json({ error: "SECRET" }, { status: 429 })) as typeof fetch);
  assert.deepEqual(rejected, { confirmed: false, reason: "PROVIDER_REJECTED" });
  const timeout = await changeWhatsAppProviderBlock(input, (async () => { throw new Error("SECRET"); }) as typeof fetch);
  assert.deepEqual(timeout, { confirmed: false, reason: "PROVIDER_RESULT_UNKNOWN" });
});

test("Zernio uses exact receiving account and per-user success for block/unblock", async () => {
  for (const blocked of [true, false]) {
    const result = await changeWhatsAppProviderBlock({ ...input, provider: "zernio", zernioAccountId: "account-7", zernioApiKey: "test-only", blocked }, (async (url, init) => {
      assert.equal(url, "https://zernio.com/api/v1/whatsapp/block-users");
      assert.equal(init?.method, blocked ? "POST" : "DELETE");
      assert.deepEqual(JSON.parse(String(init?.body)), { accountId: "account-7", users: [input.recipient] });
      return Response.json({ [blocked ? "blocked" : "unblocked"]: [{ input: input.recipient, waId: input.recipient }], failed: [] });
    }) as typeof fetch);
    assert.equal(result.confirmed, true);
  }
});

test("Zernio per-user failure, conflicting receipt and wrong recipient never count as success", async () => {
  for (const body of [
    { blocked: [], failed: [{ input: input.recipient, errors: ["Re-engagement required"] }] },
    { blocked: [{ input: input.recipient, waId: input.recipient }], failed: [{ input: input.recipient }] },
    { blocked: [{ input: "905550000000", waId: "905550000000" }], failed: [] },
    { success: true },
  ]) {
    const result = await changeWhatsAppProviderBlock({ ...input, provider: "zernio", zernioAccountId: "account-7", zernioApiKey: "test-only" }, (async () => Response.json(body)) as typeof fetch);
    assert.equal(result.confirmed, false);
  }
});
