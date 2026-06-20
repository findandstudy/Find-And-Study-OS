import {
  db,
  conversationsTable,
  messagesTable,
  externalContactsTable,
  integrationsTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { getAnthropicClient } from "@workspace/integrations-anthropic-ai";
import {
  sendWhatsAppText,
  isWithin24hWindow,
  type WhatsAppConfig,
} from "./channels/whatsapp";
import { decryptConfig } from "../encryption";
import { inboxBus } from "./eventBus";
import {
  buildBotSystemPrompt,
  DEFAULT_ESCALATION_KEYWORDS,
  type BotLanguage,
  type EscalationTopic,
} from "./botBrain";
import { getAiAgentConfig, DEFAULT_BOT_MODEL } from "./aiAgentConfig";

// Re-export so existing consumers of EscalationTopic from this module keep working.
export type { EscalationTopic };

// Dedicated reply model default, intentionally independent of the inbox
// SUMMARIZE_MODEL. The live model comes from the ai_agent config; this constant
// remains the fallback default.
export const BOT_REPLY_MODEL = DEFAULT_BOT_MODEL;

// How many of the most recent messages we feed the model as conversation
// context. Keep small to bound token cost — the intake flow is short-turn.
const BOT_HISTORY_LIMIT = 20;

// ---------------------------------------------------------------------------
// Escalation detection
// ---------------------------------------------------------------------------

/**
 * Detect whether an inbound message touches an escalation topic that must be
 * deferred to a human (contract / payment-fee / commission / partner-agency).
 * Returns the first matching topic, or null when none match. The keyword sets
 * default to the built-in multilingual defaults but can be supplied from the
 * live ai_agent config.
 */
export function detectEscalation(
  text: string,
  keywords: Record<EscalationTopic, string[]> = DEFAULT_ESCALATION_KEYWORDS,
): EscalationTopic | null {
  const haystack = ` ${text.toLowerCase()} `;
  for (const topic of Object.keys(keywords) as EscalationTopic[]) {
    for (const kw of keywords[topic]) {
      if (kw && haystack.includes(kw.toLowerCase())) return topic;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Language detection (heuristic) — picks the reply language for the brain.
// Supported intake languages: TR / EN / AR / RU / FR.
// ---------------------------------------------------------------------------

const TR_HINTS = [
  "merhaba", "selam", "üniversite", "universite", "bölüm", "bolum", "burs",
  "kayıt", "kayit", "başvuru", "basvuru", "istiyorum", "nasıl", "nasil",
  "teşekkür", "tesekkur", "okumak", "yüksek lisans", "lisans",
];
const FR_HINTS = [
  "bonjour", "salut", "université", "universite", "merci", "inscription",
  "bourse", "je veux", "comment", "s'il vous plaît", "étudier", "etudier",
  "licence", "master",
];

/**
 * Detect the student's language from their message text. Script ranges decide
 * Arabic/Cyrillic; Turkish-specific characters and common Turkish/French words
 * disambiguate the Latin-script cases. Falls back to English.
 */
export function detectLanguage(text: string): BotLanguage {
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  const lower = text.toLowerCase();
  // Turkish-specific letters are a strong signal.
  if (/[ışğİ]/.test(text) || /[çöü]/.test(lower) && TR_HINTS.some((h) => lower.includes(h))) {
    return "tr";
  }
  if (TR_HINTS.some((h) => lower.includes(h))) return "tr";
  if (FR_HINTS.some((h) => lower.includes(h))) return "fr";
  return "en";
}

// ---------------------------------------------------------------------------
// Test injection seams — let unit tests replace the Anthropic call and the
// channel send without a live API key or real WhatsApp send.
// ---------------------------------------------------------------------------

export interface BotReplyInput {
  systemPrompt: string;
  language: BotLanguage;
  model: string;
  temperature: number;
  messages: Array<{ direction: string; content: string }>;
}
let __botReplyOverride: ((input: BotReplyInput) => Promise<string>) | null = null;
export function __setBotReplyOverrideForTests(
  fn: ((input: BotReplyInput) => Promise<string>) | null,
): void {
  __botReplyOverride = fn;
}

export interface BotSendInput {
  channel: string;
  toPhoneE164: string;
  text: string;
}
export interface BotSendResult {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
  simulated?: boolean;
}
let __botSendOverride: ((input: BotSendInput) => Promise<BotSendResult>) | null = null;
export function __setBotSendOverrideForTests(
  fn: ((input: BotSendInput) => Promise<BotSendResult>) | null,
): void {
  __botSendOverride = fn;
}

async function generateBotReply(input: BotReplyInput): Promise<string> {
  if (__botReplyOverride) return __botReplyOverride(input);
  const anthropic = await getAnthropicClient();
  const message = await anthropic.messages.create({
    model: input.model,
    max_tokens: 600,
    temperature: input.temperature,
    system: input.systemPrompt,
    messages: input.messages.map((m) => ({
      role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    })),
  });
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Bot AI returned no text content");
  }
  return textBlock.text.trim();
}

// Channel-aware send. Only WhatsApp is wired today; a future channel can be
// slotted in here without touching the engine logic.
async function sendBotReply(input: BotSendInput): Promise<BotSendResult> {
  if (__botSendOverride) return __botSendOverride(input);
  if (input.channel === "whatsapp") {
    const [integ] = await db
      .select()
      .from(integrationsTable)
      .where(eq(integrationsTable.key, "whatsapp"));
    const cfg: WhatsAppConfig =
      (decryptConfig(integ?.config as Record<string, any>) as WhatsAppConfig) || {};
    const result = await sendWhatsAppText({
      config: cfg,
      toPhoneE164: input.toPhoneE164,
      text: input.text,
    });
    return result;
  }
  return { ok: false, error: `unsupported_channel:${input.channel}` };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface AutoReplyOutcome {
  acted: boolean;
  reason:
    | "sent"
    | "globally_disabled"
    | "bot_disabled"
    | "already_handled"
    | "not_inbound_text"
    | "escalated"
    | "handoff"
    | "outside_window"
    | "no_phone"
    | "send_failed"
    | "not_found";
  topic?: EscalationTopic;
}

/**
 * Decide and (when appropriate) send an automatic intake reply for the given
 * inbound message. Safe to call for every inbound — it cheaply short-circuits
 * when the per-conversation bot is disabled.
 *
 * Idempotency: claims the inbound message id via a conditional UPDATE so a
 * duplicate webhook delivery (or a re-trigger) can never answer the same
 * message twice. Human takeover: a staff manual reply disables the bot, which
 * this function honours on its next call.
 */
export async function maybeAutoReply(opts: {
  conversationId: number;
  inboundMessageId: number;
}): Promise<AutoReplyOutcome> {
  const { conversationId, inboundMessageId } = opts;

  // Load the live, DB-managed agent config (global switch, model, escalation
  // keywords, handoff threshold + message, knowledge base).
  const config = await getAiAgentConfig();

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId));
  if (!conv) return { acted: false, reason: "not_found" };

  // Global master switch: when the bot is off agency-wide, no auto-replies are
  // sent regardless of the per-conversation toggle.
  if (!config.enabled) return { acted: false, reason: "globally_disabled" };

  // Human takeover / per-conversation opt-in gate.
  if (!conv.botEnabled) return { acted: false, reason: "bot_disabled" };

  // Confirm the triggering message is an inbound text message.
  const [msg] = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.id, inboundMessageId));
  if (!msg || msg.conversationId !== conversationId) {
    return { acted: false, reason: "not_found" };
  }
  if (msg.direction !== "inbound" || !msg.content || !msg.content.trim()) {
    return { acted: false, reason: "not_inbound_text" };
  }

  // Escalation gate (code layer): never auto-reply on sensitive topics. Flag
  // the conversation "needs human" and turn the bot off so staff take over.
  const topic = detectEscalation(msg.content, config.escalationKeywords);
  if (topic) {
    await db
      .update(conversationsTable)
      .set({ botEnabled: false, needsHuman: true, botLastHandledMessageId: inboundMessageId })
      .where(eq(conversationsTable.id, conversationId));
    inboxBus.publish({
      type: "message",
      conversationId,
      channel: conv.channel,
      assignedToId: conv.assignedToId ?? null,
      unmatched: conv.unmatched,
      direction: "inbound",
    });
    return { acted: true, reason: "escalated", topic };
  }

  // Idempotency claim: only the worker that advances the marker proceeds.
  const claimed = await db
    .update(conversationsTable)
    .set({ botLastHandledMessageId: inboundMessageId })
    .where(
      and(
        eq(conversationsTable.id, conversationId),
        sql`(${conversationsTable.botLastHandledMessageId} IS NULL OR ${conversationsTable.botLastHandledMessageId} < ${inboundMessageId})`,
      ),
    )
    .returning({ id: conversationsTable.id });
  if (claimed.length === 0) {
    return { acted: false, reason: "already_handled" };
  }

  // 24h service window: free-form replies are only allowed within 24h of the
  // last inbound message (WhatsApp policy). Outside it we must use a template,
  // which the bot does not do — defer to staff.
  if (conv.channel === "whatsapp" && !isWithin24hWindow(conv.lastInboundAt)) {
    return { acted: false, reason: "outside_window" };
  }

  // Resolve the contact phone for the outbound send.
  const [contact] = conv.externalContactId
    ? await db
        .select()
        .from(externalContactsTable)
        .where(eq(externalContactsTable.id, conv.externalContactId))
    : [null];
  const toPhone = contact?.phoneE164 || contact?.phone || null;
  if (conv.channel === "whatsapp" && !toPhone) {
    return { acted: false, reason: "no_phone" };
  }

  // Consecutive-reply safety: after too many bot replies in a row (configurable
  // threshold; 0 = no limit) hand the conversation to a human — flip needs-human,
  // turn the bot off, and send the handoff message exactly once. Disabling the
  // bot here means subsequent inbound messages short-circuit on the per-conv
  // gate, so the handoff is never sent twice.
  if (config.maxConsecutiveReplies > 0 && (conv.botReplyCount ?? 0) >= config.maxConsecutiveReplies) {
    const handoffText = config.handoffMessage.trim();
    let sendOk = true;
    if (handoffText) {
      const [pendingHandoff] = await db
        .insert(messagesTable)
        .values({
          conversationId,
          senderId: null,
          content: handoffText,
          channel: conv.channel,
          direction: "outbound",
          status: "pending",
          metadata: { botSent: true, botHandoff: true },
        })
        .returning();
      const handoffResult = await sendBotReply({
        channel: conv.channel,
        toPhoneE164: toPhone || "",
        text: handoffText,
      });
      sendOk = handoffResult.ok;
      await db
        .update(messagesTable)
        .set({
          status: handoffResult.ok ? "sent" : "failed",
          externalMessageId: handoffResult.externalMessageId || null,
          failedReason: handoffResult.ok ? null : handoffResult.error || "send_failed",
          sentAt: handoffResult.ok ? new Date() : null,
          metadata: {
            botSent: true,
            botHandoff: true,
            simulated: handoffResult.simulated,
            ...(handoffResult.ok ? {} : { error: handoffResult.error }),
          },
        })
        .where(eq(messagesTable.id, pendingHandoff.id));
    }
    await db
      .update(conversationsTable)
      .set({
        botEnabled: false,
        needsHuman: true,
        ...(sendOk && handoffText
          ? { lastMessageAt: new Date(), lastMessagePreview: handoffText.slice(0, 200) }
          : {}),
      })
      .where(eq(conversationsTable.id, conversationId));
    inboxBus.publish({
      type: "message",
      conversationId,
      channel: conv.channel,
      assignedToId: conv.assignedToId ?? null,
      unmatched: conv.unmatched,
      direction: "outbound",
    });
    return { acted: true, reason: "handoff" };
  }

  // Build context from the last N messages (oldest → newest for the model).
  const recent = await db
    .select({ direction: messagesTable.direction, content: messagesTable.content })
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(asc(messagesTable.createdAt));
  const history = recent.slice(-BOT_HISTORY_LIMIT);

  const language = detectLanguage(msg.content);
  const systemPrompt = buildBotSystemPrompt(language, config.knowledgeBase);

  const replyText = await generateBotReply({
    systemPrompt,
    language,
    model: config.model,
    temperature: config.temperature,
    messages: history.map((m) => ({ direction: m.direction, content: m.content })),
  });
  if (!replyText) return { acted: false, reason: "send_failed" };

  // Persist a pending outbound row first so the lifecycle is observable.
  const [pending] = await db
    .insert(messagesTable)
    .values({
      conversationId,
      senderId: null,
      content: replyText,
      channel: conv.channel,
      direction: "outbound",
      status: "pending",
      metadata: { botSent: true, model: config.model, language },
    })
    .returning();

  const sendResult = await sendBotReply({
    channel: conv.channel,
    toPhoneE164: toPhone || "",
    text: replyText,
  });

  await db
    .update(messagesTable)
    .set({
      status: sendResult.ok ? "sent" : "failed",
      externalMessageId: sendResult.externalMessageId || null,
      failedReason: sendResult.ok ? null : sendResult.error || "send_failed",
      sentAt: sendResult.ok ? new Date() : null,
      metadata: {
        botSent: true,
        model: config.model,
        language,
        simulated: sendResult.simulated,
        ...(sendResult.ok ? {} : { error: sendResult.error }),
      },
    })
    .where(eq(messagesTable.id, pending.id));

  if (sendResult.ok) {
    // Count this bot reply toward the consecutive-reply handoff threshold.
    await db
      .update(conversationsTable)
      .set({
        lastMessageAt: new Date(),
        lastMessagePreview: replyText.slice(0, 200),
        botReplyCount: sql`${conversationsTable.botReplyCount} + 1`,
      })
      .where(eq(conversationsTable.id, conversationId));
  }

  inboxBus.publish({
    type: "message",
    conversationId,
    channel: conv.channel,
    assignedToId: conv.assignedToId ?? null,
    unmatched: conv.unmatched,
    direction: "outbound",
  });

  return sendResult.ok
    ? { acted: true, reason: "sent" }
    : { acted: false, reason: "send_failed" };
}
