/**
 * Inbox chatbot auto-reply (Claude intake brain) unit tests.
 *
 * Verifies the decision logic of the per-conversation auto-reply engine
 * without any live Anthropic call or real WhatsApp send — both seams are
 * mocked via __setBotReplyOverrideForTests / __setBotSendOverrideForTests.
 *
 * Coverage:
 *   - detectEscalation: contract / payment-fee / commission / partner-agency
 *     across TR/EN/AR/RU/FR, and a clean message returning null.
 *   - detectLanguage: TR/EN/AR/RU/FR selection.
 *   - maybeAutoReply engine, against a real DB row set:
 *       * bot OFF  → no send (per-conversation opt-in / human takeover gate)
 *       * normal   → exactly one send, outbound row recorded, bot stays ON
 *       * escalation → no send, needs_human=true, bot_enabled=false
 *       * idempotency → same inbound message answered at most once
 *       * outside 24h window → no send
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:inbox-bot
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  db,
  conversationsTable,
  messagesTable,
  externalContactsTable,
  channelAccountsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  detectEscalation,
  detectLanguage,
  maybeAutoReply,
  __setBotReplyOverrideForTests,
  __setBotSendOverrideForTests,
  type BotSendInput,
} from "../src/lib/inbox/botAutoReply";

const RUN_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// Mock send: record every call so tests can assert on count/text.
// ---------------------------------------------------------------------------
let sentCalls: BotSendInput[] = [];
let sendSeq = 0;
__setBotSendOverrideForTests(async (input) => {
  sentCalls.push(input);
  // Globally unique across tests — the messages table has a unique index on
  // (channel, external_message_id), so a per-test-reset counter would collide.
  return { ok: true, externalMessageId: `mock_${RUN_ID}_${sendSeq++}` };
});
// Mock reply: deterministic canned text, no Anthropic call.
__setBotReplyOverrideForTests(async () => "Mock intake reply");

function resetMocks(): void {
  sentCalls = [];
}

// ---------------------------------------------------------------------------
// DB seeding helpers
// ---------------------------------------------------------------------------
const createdConvIds: number[] = [];
const createdContactIds: number[] = [];
let channelAccountId = 0;
let seedCounter = 0;

async function ensureChannelAccount(): Promise<number> {
  if (channelAccountId) return channelAccountId;
  const externalAccountId = `wa_bot_${RUN_ID}`;
  const [created] = await db
    .insert(channelAccountsTable)
    .values({ channel: "whatsapp", displayName: "Bot Test WA", externalAccountId, status: "active" })
    .returning({ id: channelAccountsTable.id });
  channelAccountId = created.id;
  return channelAccountId;
}

async function seedConversation(opts: {
  botEnabled: boolean;
  lastInboundAt?: Date;
}): Promise<{ conversationId: number; contactId: number }> {
  const accId = await ensureChannelAccount();
  const n = seedCounter++;
  const suffix = `${RUN_ID}_${n}_${Math.random().toString(36).slice(2, 7)}`;
  const phone = `+1555${String(n).padStart(3, "0")}${Math.floor(Math.random() * 9000 + 1000)}`;
  const [contact] = await db
    .insert(externalContactsTable)
    .values({
      channel: "whatsapp",
      externalId: `bot_contact_${suffix}`,
      displayName: `Bot Test ${suffix}`,
      phone,
      phoneE164: phone,
    })
    .returning({ id: externalContactsTable.id });
  createdContactIds.push(contact.id);

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      type: "inbox",
      channel: "whatsapp",
      channelAccountId: accId,
      externalContactId: contact.id,
      externalThreadId: `bot_thread_${suffix}`,
      status: "open",
      botEnabled: opts.botEnabled,
      lastInboundAt: opts.lastInboundAt ?? new Date(),
    })
    .returning({ id: conversationsTable.id });
  createdConvIds.push(conv.id);
  return { conversationId: conv.id, contactId: contact.id };
}

async function seedInbound(conversationId: number, content: string): Promise<number> {
  const [msg] = await db
    .insert(messagesTable)
    .values({
      conversationId,
      content,
      channel: "whatsapp",
      direction: "inbound",
      status: "received",
    })
    .returning({ id: messagesTable.id });
  return msg.id;
}

async function outboundCount(conversationId: number): Promise<number> {
  const rows = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(eq(messagesTable.conversationId, conversationId), eq(messagesTable.direction, "outbound")));
  return rows.length;
}

// ---------------------------------------------------------------------------
// Escalation detection
// ---------------------------------------------------------------------------
test("detectEscalation flags contract topic (multilingual)", () => {
  assert.equal(detectEscalation("Can you send me the contract?"), "contract");
  assert.equal(detectEscalation("Sözleşme imzalayabilir miyim?"), "contract");
  assert.equal(detectEscalation("أريد توقيع العقد"), "contract");
  assert.equal(detectEscalation("где договор?"), "contract");
  assert.equal(detectEscalation("Je veux signer le contrat"), "contract");
});

test("detectEscalation flags payment/fee topic (multilingual)", () => {
  assert.equal(detectEscalation("How much is the fee?"), "payment");
  assert.equal(detectEscalation("Ödeme nasıl yapılır?"), "payment");
  assert.equal(detectEscalation("ما هي الرسوم؟"), "payment");
  assert.equal(detectEscalation("когда оплата?"), "payment");
  assert.equal(detectEscalation("Quels sont les frais ?"), "payment");
});

test("detectEscalation flags commission topic", () => {
  assert.equal(detectEscalation("What is your commission?"), "commission");
  assert.equal(detectEscalation("komisyon oranınız nedir"), "commission");
});

test("detectEscalation flags partner/agency topic", () => {
  assert.equal(detectEscalation("I want to become a partner agency"), "partner");
  assert.equal(detectEscalation("acente olmak istiyorum"), "partner");
});

test("detectEscalation returns null for a clean intake message", () => {
  assert.equal(detectEscalation("Hello, I want to study computer science in Istanbul"), null);
  assert.equal(detectEscalation("Merhaba, üniversite okumak istiyorum"), null);
});

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------
test("detectLanguage picks the student's language", () => {
  assert.equal(detectLanguage("Merhaba, nasıl başvuru yapabilirim?"), "tr");
  assert.equal(detectLanguage("Hello, I would like to apply"), "en");
  assert.equal(detectLanguage("مرحبا أريد الدراسة في تركيا"), "ar");
  assert.equal(detectLanguage("Здравствуйте, я хочу учиться"), "ru");
  assert.equal(detectLanguage("Bonjour, je veux étudier en Turquie"), "fr");
});

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
test("maybeAutoReply: bot OFF → no send", async () => {
  resetMocks();
  const { conversationId } = await seedConversation({ botEnabled: false });
  const msgId = await seedInbound(conversationId, "Hi, I want to study in Istanbul");
  const outcome = await maybeAutoReply({ conversationId, inboundMessageId: msgId });
  assert.equal(outcome.reason, "bot_disabled");
  assert.equal(sentCalls.length, 0);
  assert.equal(await outboundCount(conversationId), 0);
});

test("maybeAutoReply: normal inbound → one send, outbound recorded, bot stays ON", async () => {
  resetMocks();
  const { conversationId } = await seedConversation({ botEnabled: true });
  const msgId = await seedInbound(conversationId, "Hello, I want to study computer science");
  const outcome = await maybeAutoReply({ conversationId, inboundMessageId: msgId });
  assert.equal(outcome.reason, "sent");
  assert.equal(sentCalls.length, 1);
  assert.equal(sentCalls[0].text, "Mock intake reply");
  assert.equal(await outboundCount(conversationId), 1);
  const [conv] = await db
    .select({ botEnabled: conversationsTable.botEnabled, marker: conversationsTable.botLastHandledMessageId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId));
  assert.equal(conv.botEnabled, true);
  assert.equal(conv.marker, msgId);
});

test("maybeAutoReply: escalation → no send, needs_human set, bot OFF", async () => {
  resetMocks();
  const { conversationId } = await seedConversation({ botEnabled: true });
  const msgId = await seedInbound(conversationId, "Can you send me the contract to sign?");
  const outcome = await maybeAutoReply({ conversationId, inboundMessageId: msgId });
  assert.equal(outcome.reason, "escalated");
  assert.equal(outcome.topic, "contract");
  assert.equal(sentCalls.length, 0);
  assert.equal(await outboundCount(conversationId), 0);
  const [conv] = await db
    .select({ botEnabled: conversationsTable.botEnabled, needsHuman: conversationsTable.needsHuman })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId));
  assert.equal(conv.botEnabled, false);
  assert.equal(conv.needsHuman, true);
});

test("maybeAutoReply: idempotent — same inbound answered at most once", async () => {
  resetMocks();
  const { conversationId } = await seedConversation({ botEnabled: true });
  const msgId = await seedInbound(conversationId, "Hi, what programs do you offer?");
  const [a, b] = await Promise.all([
    maybeAutoReply({ conversationId, inboundMessageId: msgId }),
    maybeAutoReply({ conversationId, inboundMessageId: msgId }),
  ]);
  const reasons = [a.reason, b.reason].sort();
  assert.deepEqual(reasons, ["already_handled", "sent"]);
  assert.equal(sentCalls.length, 1);
  assert.equal(await outboundCount(conversationId), 1);
});

test("maybeAutoReply: outside 24h window → no send", async () => {
  resetMocks();
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const { conversationId } = await seedConversation({ botEnabled: true, lastInboundAt: old });
  const msgId = await seedInbound(conversationId, "Hi, can I still apply?");
  const outcome = await maybeAutoReply({ conversationId, inboundMessageId: msgId });
  assert.equal(outcome.reason, "outside_window");
  assert.equal(sentCalls.length, 0);
  assert.equal(await outboundCount(conversationId), 0);
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
test("cleanup seeded rows", async () => {
  for (const id of createdConvIds) {
    await db.delete(conversationsTable).where(eq(conversationsTable.id, id)).catch(() => {});
  }
  for (const id of createdContactIds) {
    await db.delete(externalContactsTable).where(eq(externalContactsTable.id, id)).catch(() => {});
  }
  if (channelAccountId) {
    await db.delete(channelAccountsTable).where(eq(channelAccountsTable.id, channelAccountId)).catch(() => {});
  }
  __setBotReplyOverrideForTests(null);
  __setBotSendOverrideForTests(null);
  // The inboxBus LISTEN client keeps the pool open; exit cleanly after tests.
  setTimeout(() => process.exit(0), 100);
});
