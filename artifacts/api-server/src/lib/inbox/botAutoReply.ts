import {
  db,
  conversationsTable,
  messagesTable,
  externalContactsTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { getAnthropicClient } from "@workspace/integrations-anthropic-ai";
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  isWithin24hWindow,
  type WhatsAppConfig,
} from "./channels/whatsapp";
import { sendMessengerText, type MessengerConfig } from "./channels/messenger";
import { sendInstagramText, type InstagramConfig } from "./channels/instagram";
import { resolveOutboundConfig } from "./channelAccountConfig";
import { messageTemplatesTable } from "@workspace/db";
import {
  captureLeadFromConversation,
  recordInboundDocuments,
  computeMissingDocGroups,
  buildMissingDocsInstruction,
} from "./leadCapture";
import { inboxBus } from "./eventBus";
import {
  buildBotSystemPrompt,
  DEFAULT_ESCALATION_KEYWORDS,
  sanitizeWhatsAppText,
  type BotLanguage,
  type EscalationTopic,
} from "./botBrain";
import { getAiAgentConfig, DEFAULT_BOT_MODEL } from "./aiAgentConfig";
import { resolveZernioAccount, sendViaZernio } from "./zernioSend";
import { assignStuckConversationById } from "../stuckConversationAssigner";
import {
  searchProgramsToolDefinition,
  executeSearchProgramsTool,
  SEARCH_PROGRAMS_TOOL_NAME,
} from "./programSearchTool";
import { isProgramSearchToolEnabled } from "./knowledgeSources";
import { retrieveKnowledgeChunks } from "./knowledgeRetrieval";

// Faz 2 handoff hook: fire-and-forget so we never delay the webhook response
// or the bot-reply flow on assignment work. Errors are logged, not thrown.
function triggerStuckConversationAssignment(conversationId: number): void {
  assignStuckConversationById(conversationId).catch((err) => {
    console.error(`[botAutoReply] stuck-conversation auto-assign failed for conversation #${conversationId}:`, err?.message || err);
  });
}

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
  // For WhatsApp this is the E.164 phone number; for Messenger / Instagram it
  // is the user's page-/IG-scoped recipient id.
  recipient: string;
  text: string;
  // The conversation's connected account (multi-account-per-channel). When null
  // the legacy single-config integrations row is used (resolveOutboundConfig).
  channelAccountId?: number | null;
  // Set when the conversation is Zernio-hosted: the reply MUST go through the
  // Zernio API (same path as manual staff replies), never the direct Meta
  // senders — those fail with "The account is not registered".
  zernio?: { externalAccountId: string; externalThreadId: string } | null;
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

// Max tool-use round trips per reply. Bounds cost and guarantees the loop
// terminates even if the model keeps calling tools — after the cap we force
// a final plain-text turn by simply not offering tools again.
const MAX_TOOL_ROUNDS = 3;

/**
 * Generate a bot reply, optionally giving the model the live searchPrograms
 * tool (Faz 1). When the tool is disabled (admin toggle off / no active
 * knowledge_sources scope row) we simply never pass `tools`, so the model
 * falls back to the static knowledgeBase exactly like before this feature —
 * no behavior change for agencies that haven't turned it on.
 */
async function generateBotReply(input: BotReplyInput): Promise<string> {
  if (__botReplyOverride) return __botReplyOverride(input);
  const anthropic = await getAnthropicClient();
  const { enabled: toolsEnabled } = await isProgramSearchToolEnabled();

  type AnthropicMessage = { role: "user" | "assistant"; content: any };
  const conversation: AnthropicMessage[] = input.messages.map((m) => ({
    role: m.direction === "inbound" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const offerTools = toolsEnabled && round < MAX_TOOL_ROUNDS;
    const message = await anthropic.messages.create({
      model: input.model,
      max_tokens: 600,
      temperature: input.temperature,
      system: input.systemPrompt,
      messages: conversation,
      ...(offerTools ? { tools: [searchProgramsToolDefinition] } : {}),
    });

    if (message.stop_reason === "tool_use") {
      const toolUseBlocks = message.content.filter((b) => b.type === "tool_use");
      if (!toolUseBlocks.length) {
        // Unexpected shape — fall through and try to extract text below.
      } else {
        conversation.push({ role: "assistant", content: message.content });
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (block: any) => {
            let resultPayload: unknown;
            try {
              resultPayload =
                block.name === SEARCH_PROGRAMS_TOOL_NAME
                  ? await executeSearchProgramsTool(block.input || {})
                  : { error: `unknown_tool:${block.name}` };
            } catch (err) {
              console.error("[bot] tool execution failed:", block.name, err);
              resultPayload = { error: "tool_execution_failed" };
            }
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: JSON.stringify(resultPayload),
            };
          }),
        );
        conversation.push({ role: "user", content: toolResults });
        continue;
      }
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Bot AI returned no text content");
    }
    return textBlock.text.trim();
  }
  throw new Error("Bot AI tool-use loop did not terminate");
}

// ---------------------------------------------------------------------------
// Test console (FAZ 2) — run the bot brain against a sample message WITHOUT
// sending anything. Used by the admin-only POST /inbox/ai-agent/test endpoint.
// It deliberately reuses the same config + language + escalation + prompt path
// as the live engine, but it NEVER calls sendBotReply, so an admin can preview
// the would-be reply, the detected language, and the escalation decision with
// zero outbound side effects.
// ---------------------------------------------------------------------------

export interface BotTestInput {
  /** The sample inbound student message to run the brain against. */
  message: string;
  /** Optional language override; when omitted the language is auto-detected. */
  language?: BotLanguage;
  /** Optional prior turns for context (oldest → newest). */
  history?: Array<{ direction: string; content: string }>;
}

export interface BotTestResult {
  /** The would-be reply, or null when the message would escalate (no reply). */
  reply: string | null;
  /** The language the brain would reply in. */
  language: BotLanguage;
  /** Escalation decision: whether the message hits a hand-off topic. */
  escalation: { escalated: boolean; topic: EscalationTopic | null };
  /** The model the live config would use for the reply. */
  model: string;
}

/**
 * Run the intake brain against a supplied sample message and (optional) history
 * using the live ai_agent config, returning the would-be reply, detected
 * language, and escalation result — WITHOUT sending any message. When the
 * message matches an escalation topic the engine would defer to a human, so we
 * mirror that by returning `reply: null` and the matched topic.
 */
export async function runBotReplyTest(input: BotTestInput): Promise<BotTestResult> {
  const config = await getAiAgentConfig();
  const language = input.language ?? detectLanguage(input.message);
  const topic = detectEscalation(input.message, config.escalationKeywords);
  if (topic) {
    return {
      reply: null,
      language,
      escalation: { escalated: true, topic },
      model: config.model,
    };
  }
  const ragChunks = await retrieveKnowledgeChunks(input.message);
  const systemPrompt = buildBotSystemPrompt(language, config.knowledgeBase, ragChunks);
  const turns = [
    ...(input.history ?? []),
    { direction: "inbound", content: input.message },
  ].slice(-BOT_HISTORY_LIMIT);
  const reply = await generateBotReply({
    systemPrompt,
    language,
    model: config.model,
    temperature: config.temperature,
    messages: turns,
  });
  return {
    reply,
    language,
    escalation: { escalated: false, topic: null },
    model: config.model,
  };
}

// Channel-aware send. Only WhatsApp is wired today; a future channel can be
// slotted in here without touching the engine logic.
async function sendBotReply(input: BotSendInput): Promise<BotSendResult> {
  if (__botSendOverride) return __botSendOverride(input);
  // Zernio-hosted conversations: unified send path shared with manual replies.
  if (input.zernio) {
    const z = await sendViaZernio({
      externalThreadId: input.zernio.externalThreadId,
      externalAccountId: input.zernio.externalAccountId,
      text: input.text,
    });
    return { ok: z.ok, externalMessageId: z.externalMessageId, error: z.error };
  }
  if (input.channel === "whatsapp") {
    const cfg: WhatsAppConfig =
      (await resolveOutboundConfig<WhatsAppConfig>("whatsapp", input.channelAccountId)) || {};
    const result = await sendWhatsAppText({
      config: cfg,
      toPhoneE164: input.recipient,
      text: input.text,
    });
    return result;
  }
  if (input.channel === "messenger") {
    const cfg: MessengerConfig =
      (await resolveOutboundConfig<MessengerConfig>("messenger", input.channelAccountId)) || {};
    return sendMessengerText({ config: cfg, recipientId: input.recipient, text: input.text });
  }
  if (input.channel === "instagram") {
    const cfg: InstagramConfig =
      (await resolveOutboundConfig<InstagramConfig>("instagram", input.channelAccountId)) || {};
    return sendInstagramText({ config: cfg, recipientId: input.recipient, text: input.text });
  }
  return { ok: false, error: `unsupported_channel:${input.channel}` };
}

export interface BotTemplateSendInput {
  channel: string;
  toPhoneE164: string;
  templateName: string;
  language: string;
  parameters?: string[];
  channelAccountId?: number | null;
}
let __botTemplateSendOverride:
  | ((input: BotTemplateSendInput) => Promise<BotSendResult>)
  | null = null;
export function __setBotTemplateSendOverrideForTests(
  fn: ((input: BotTemplateSendInput) => Promise<BotSendResult>) | null,
): void {
  __botTemplateSendOverride = fn;
}

// Channel-aware approved-template send (used outside the 24h window).
async function sendBotTemplate(input: BotTemplateSendInput): Promise<BotSendResult> {
  if (__botTemplateSendOverride) return __botTemplateSendOverride(input);
  if (input.channel === "whatsapp") {
    const cfg: WhatsAppConfig =
      (await resolveOutboundConfig<WhatsAppConfig>("whatsapp", input.channelAccountId)) || {};
    return sendWhatsAppTemplate({
      config: cfg,
      toPhoneE164: input.toPhoneE164,
      templateName: input.templateName,
      language: input.language,
      parameters: input.parameters,
    });
  }
  return { ok: false, error: `unsupported_channel:${input.channel}` };
}

interface ReengagementTemplate {
  externalTemplateName: string;
  language: string;
  content: string;
}

/**
 * Resolve the approved WhatsApp re-engagement template to send outside the 24h
 * window. By convention this is the most recently updated active template with
 * category 'reengagement', a WhatsApp-capable channel, and a non-null
 * externalTemplateName (the name registered with the WhatsApp provider). We do
 * NOT manage templates here — that's Task #61's UI; we only consume its rows.
 * Returns null when none is configured (caller defers to staff).
 */
async function resolveReengagementTemplate(): Promise<ReengagementTemplate | null> {
  const [tpl] = await db
    .select()
    .from(messageTemplatesTable)
    .where(
      and(
        eq(messageTemplatesTable.isActive, true),
        eq(messageTemplatesTable.category, "reengagement"),
        sql`${messageTemplatesTable.externalTemplateName} IS NOT NULL`,
        sql`${messageTemplatesTable.channel} IN ('whatsapp', 'all')`,
      ),
    )
    .orderBy(sql`${messageTemplatesTable.updatedAt} DESC`)
    .limit(1);
  if (!tpl || !tpl.externalTemplateName) return null;
  return {
    externalTemplateName: tpl.externalTemplateName,
    language: tpl.language || "en",
    content: tpl.content || `[template] ${tpl.externalTemplateName}`,
  };
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
    | "template_sent"
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
    triggerStuckConversationAssignment(conversationId);
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

  // FAZ 3 — advance the funnel. On every handled inbound (while the bot is on)
  // we extract qualifying info, idempotently upsert the lead, and record any
  // attached document. Best-effort: a failure here must never block the reply.
  let captureLeadId: number | null = null;
  let captureStudentId: number | null = null;
  let captureLevel: string | null = null;
  try {
    const capture = await captureLeadFromConversation({ conversationId });
    captureLeadId = capture.leadId;
    captureStudentId = capture.studentId;
    captureLevel = capture.level;
    await recordInboundDocuments({
      metadata: msg.metadata,
      leadId: capture.leadId,
      studentId: capture.studentId,
    });
  } catch (err) {
    console.error("[bot] lead capture failed:", err);
  }

  // Resolve the outbound recipient. WhatsApp addresses by phone (E.164);
  // Messenger / Instagram address by the user's page-/IG-scoped id stored as
  // externalId. Needed by both the re-engagement and free-form reply paths.
  const [contact] = conv.externalContactId
    ? await db
        .select()
        .from(externalContactsTable)
        .where(eq(externalContactsTable.id, conv.externalContactId))
    : [null];
  const toPhone = contact?.phoneE164 || contact?.phone || null;
  const isMetaChannel = conv.channel === "messenger" || conv.channel === "instagram";
  const recipient = conv.channel === "whatsapp"
    ? toPhone
    : isMetaChannel
      ? contact?.externalId || conv.externalThreadId || null
      : toPhone;

  // Zernio-hosted conversation? Then ALL bot sends must go through the Zernio
  // API (same as manual staff replies) — the direct Meta senders reject these
  // accounts ("The account is not registered"). Zernio addresses by thread id,
  // so the phone / 24h-template gates below don't apply.
  const zernioAcct = await resolveZernioAccount(conv.channelAccountId);
  const zernioRoute =
    zernioAcct && conv.externalThreadId
      ? { externalAccountId: zernioAcct.externalAccountId, externalThreadId: conv.externalThreadId }
      : null;

  // 24h service window: free-form replies are only allowed within 24h of the
  // last inbound message (Meta policy). For WhatsApp, re-engage with an
  // approved template (Task #61 message_templates) if one is configured;
  // otherwise defer to staff. For Messenger / Instagram there is no template
  // path in scope, so simply defer to staff.
  if (conv.channel === "whatsapp" && !zernioRoute && !isWithin24hWindow(conv.lastInboundAt)) {
    if (!toPhone) return { acted: false, reason: "no_phone" };
    const template = await resolveReengagementTemplate();
    if (!template) return { acted: false, reason: "outside_window" };

    const [pendingTemplate] = await db
      .insert(messagesTable)
      .values({
        conversationId,
        senderId: null,
        content: template.content,
        channel: conv.channel,
        direction: "outbound",
        status: "pending",
        metadata: { botSent: true, botTemplate: true, templateName: template.externalTemplateName },
      })
      .returning();
    const templateResult = await sendBotTemplate({
      channel: conv.channel,
      toPhoneE164: toPhone,
      templateName: template.externalTemplateName,
      language: template.language,
      channelAccountId: conv.channelAccountId,
    });
    await db
      .update(messagesTable)
      .set({
        status: templateResult.ok ? "sent" : "failed",
        externalMessageId: templateResult.externalMessageId || null,
        failedReason: templateResult.ok ? null : templateResult.error || "send_failed",
        sentAt: templateResult.ok ? new Date() : null,
        metadata: {
          botSent: true,
          botTemplate: true,
          templateName: template.externalTemplateName,
          simulated: templateResult.simulated,
          ...(templateResult.ok ? {} : { error: templateResult.error }),
        },
      })
      .where(eq(messagesTable.id, pendingTemplate.id));
    if (templateResult.ok) {
      await db
        .update(conversationsTable)
        .set({ lastMessageAt: new Date(), lastMessagePreview: template.content.slice(0, 200) })
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
    return templateResult.ok
      ? { acted: true, reason: "template_sent" }
      : { acted: false, reason: "send_failed" };
  }

  if (conv.channel === "whatsapp" && !zernioRoute && !toPhone) {
    return { acted: false, reason: "no_phone" };
  }

  // Messenger / Instagram: no template re-engagement path in scope, so outside
  // the 24h window the bot stays silent and defers to staff.
  if (isMetaChannel && !zernioRoute && !isWithin24hWindow(conv.lastInboundAt)) {
    return { acted: false, reason: "outside_window" };
  }
  if (isMetaChannel && !zernioRoute && !recipient) {
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
        recipient: recipient || "",
        text: handoffText,
        channelAccountId: conv.channelAccountId,
        zernio: zernioRoute,
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
    triggerStuckConversationAssignment(conversationId);
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
  const ragChunks = await retrieveKnowledgeChunks(msg.content);
  let systemPrompt = buildBotSystemPrompt(language, config.knowledgeBase, ragChunks);

  // FAZ 3 — nudge the bot to collect any still-missing level-appropriate
  // documents for the captured lead/student.
  try {
    const missing = await computeMissingDocGroups({
      leadId: captureLeadId,
      studentId: captureStudentId,
      level: captureLevel,
    });
    const docInstruction = buildMissingDocsInstruction(missing);
    if (docInstruction) systemPrompt = `${systemPrompt}\n\n${docInstruction}`;
  } catch (err) {
    console.error("[bot] missing-doc computation failed:", err);
  }

  const rawReplyText = await generateBotReply({
    systemPrompt,
    language,
    model: config.model,
    temperature: config.temperature,
    messages: history.map((m) => ({ direction: m.direction, content: m.content })),
  });
  if (!rawReplyText) return { acted: false, reason: "send_failed" };
  // Strip any Markdown that WhatsApp renders as literal characters (**, ##, ---, etc.)
  const replyText = sanitizeWhatsAppText(rawReplyText);

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
    recipient: recipient || "",
    text: replyText,
    channelAccountId: conv.channelAccountId,
    zernio: zernioRoute,
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
