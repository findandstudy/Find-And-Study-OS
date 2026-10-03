import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { accountListPath, accountTestState, accountWebhookPath, canManageIntegrationAccounts, integrationAccountScope, integrationAccountsCopy } from "../src/components/integrationAccountModel";

test("SMTP reuses its separate approval-bound sender surface", () => {
  assert.deepEqual(integrationAccountScope("smtp"), { kind: "email" });
  const manager = readFileSync(new URL("../src/components/IntegrationsManager.tsx", import.meta.url), "utf8");
  assert.match(manager, /<EmailAutomationManager view="senders"/);
  assert.doesNotMatch(manager, /channel:\s*["']email["']/);
  assert.match(manager, /def\.key === "claude" && <Button[^\n]+openNewAnthropicConnection/);
});
test("direct and Zernio accounts use explicit independent provider filters", () => {
  for (const [key, channel] of [["whatsapp", "whatsapp"], ["facebook_messenger", "messenger"], ["instagram", "instagram"], ["telegram", "telegram"], ["sms_twilio", "sms"]]) {
    const scope = integrationAccountScope(key); assert.equal(scope?.kind, "channel");
    if (scope?.kind !== "channel") throw new Error("Expected channel");
    assert.equal(accountListPath(scope), `/api/channel-accounts?channel=${channel}&provider=direct`);
  }
  const scope = integrationAccountScope("zernio");
  assert.equal(scope?.kind, "channel");
  if (scope?.kind !== "channel") throw new Error("Expected channel");
  assert.deepEqual(scope.channels, ["whatsapp", "instagram", "messenger", "telegram"]);
  assert.equal(accountListPath(scope), "/api/channel-accounts?provider=zernio");
});
test("unknown and inherited integration keys do not create account surfaces", () => {
  for (const key of ["email", "unknown", "toString", "__proto__", "claude", "claude:lane"]) assert.equal(integrationAccountScope(key), null);
});
test("native unsupported channels do not advertise Meta webhook URLs", () => {
  assert.equal(accountWebhookPath("direct", "telegram"), null);
  assert.equal(accountWebhookPath("direct", "sms"), null);
  assert.equal(accountWebhookPath("smtp", "email"), null);
  assert.equal(accountWebhookPath("zernio", "instagram"), "/api/webhooks/zernio");
  assert.equal(accountWebhookPath("direct", "messenger"), "/api/webhooks/meta");
});
test("a simulated or unsupported test never becomes verified success", () => {
  for (const result of [{ success: true, simulated: true }, { success: true, status: "not_supported" }, { success: false, status: "simulated" }]) assert.equal(accountTestState(result), "unverified");
  for (const result of [{}, { success: false }, { success: true }, { success: true, verified: false }, { success: true, verified: true, status: "failed" }]) assert.equal(accountTestState(result), "failed");
  assert.equal(accountTestState({ success: true, verified: true }), "verified");
});
test("only active non-impersonated admins get account mutation controls", () => {
  for (const role of ["admin", "super_admin"]) assert.equal(canManageIntegrationAccounts({ role, isActive: true }), true);
  for (const user of [undefined, null, { role: "manager", isActive: true }, { role: "staff", isActive: true }, { role: "admin", isActive: false }, { role: "admin", isActive: true, isImpersonating: true }]) assert.equal(canManageIntegrationAccounts(user), false);
});
test("new account help is localized and honestly describes unsupported delivery", () => {
  assert.match(integrationAccountsCopy("en").nativeHint, /delivery.*not connected/);
  assert.match(integrationAccountsCopy("tr").nativeHint, /gönderimi.*bağlı değildir/);
  assert.match(integrationAccountsCopy("tr").emailHint, /OAuth/);
  assert.equal(integrationAccountsCopy("ar").nativeHint, integrationAccountsCopy("en").nativeHint);
});
test("new account configuration preserves existing immutable Zernio routing and inactive native registration", () => {
  const manager = readFileSync(new URL("../src/components/IntegrationsManager.tsx", import.meta.url), "utf8");
  assert.match(manager, /externalAccountId: externalAccountId\.trim\(\), isActive: false/);
  assert.match(manager, /configurationOnly \? \{ isActive: false \}/);
  assert.match(manager, /scope\.provider === "zernio"\s*\? \[\]/);
  assert.match(manager, /disabled=\{editingId !== null\}/);
  assert.match(manager, /configurationOnly \|\| acc\.capabilities\?\.configurationOnly/);
});
