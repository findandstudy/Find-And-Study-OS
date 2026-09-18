import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../../routes/inbox.ts", import.meta.url), "utf8");

test("account filter options are staff-only, no-store, and omit credentials", () => {
  const route = source.slice(source.indexOf('router.get("/inbox/filter-accounts"'), source.indexOf('router.get("/inbox/filter-accounts"') + 900);
  assert.match(route, /requireAuth, requireRole\(\.\.\.STAFF_ROLES, \.\.\.ADMIN_ROLES\)/);
  assert.match(route, /private, no-store/);
  assert.doesNotMatch(route, /configEncrypted|webhookSecret|metadata:/);
});

test("receiving account and assignment filters append to existing status predicates", () => {
  assert.match(source, /parseInboxAccountFilter\(req.query.channelAccountId\)/);
  assert.match(source, /accountId === 0 \? isNull\(conversationsTable.channelAccountId\) : eq\(conversationsTable.channelAccountId, accountId\)/);
  assert.match(source, /assignment === "mine"\) where.push/);
  assert.match(source, /assignment === "unassigned"\) where.push/);
  assert.match(source, /assignedToId !== null/);
});

test("provider mutation requires confirmation, access, enablement and exact receiving account", () => {
  const route = source.slice(source.indexOf('"/inbox/conversations/:id/provider-block"'), source.indexOf('"/inbox/conversations/:id/block"'));
  assert.match(route, /requireAuth/);
  assert.match(route, /requireRole\(\.\.\.STAFF_ROLES, \.\.\.ADMIN_ROLES\)/);
  assert.match(route, /isConversationEntityBlocked\(req.user!, id\)/);
  assert.match(route, /z.literal\("PROVIDER_BLOCK_CHANGE"\)/);
  assert.match(route, /INBOX_PROVIDER_BLOCK_ENABLED !== "true"/);
  assert.match(route, /providerBlockRateLimiter.consume/);
  assert.match(route, /eq\(channelAccountsTable.id, conversation.channelAccountId\)/);
  assert.match(route, /account.channel !== conversation.channel/);
  assert.doesNotMatch(route, /resolveOutboundConfig\(|resolveZernioAccount\(/);
  assert.match(route, /integration\?\.enabled/);
  assert.match(route, /provider_block_requested/);
  assert.match(route, /provider_block_result/);
  assert.match(route, /result.confirmed \? 200 : 409/);
  assert.doesNotMatch(route, /set\(\{ isBlocked/); // no silent local substitute
});
