import { Router, type IRouter } from "express";
import {
  db,
  pool,
  conversationsTable,
  conversationParticipantsTable,
  messagesTable,
  externalContactsTable,
  leadsTable,
  studentsTable,
  agentsTable,
  usersTable,
  messageTemplatesTable,
  integrationsTable,
  pipelineStagesTable,
  notesTable,
  followUpsTable,
} from "@workspace/db";
import type { ConversationAiSummary } from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { ExternalContact } from "@workspace/db";
import { z } from "zod";
import { RateLimiterPostgres } from "rate-limiter-flexible";
import { getAnthropicClient } from "@workspace/integrations-anthropic-ai";
import { validate, getValidated } from "../middlewares/validate";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { toLatinUpper, normalizePhoneField } from "../lib/textNormalize";
import { STAFF_ROLES, ADMIN_ROLES, isAgentRole } from "../lib/roles";
import { resolveIdentity } from "../lib/inbox/identityResolver";
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  isWithin24hWindow,
  type WhatsAppConfig,
} from "../lib/inbox/channels/whatsapp";
import { isLiveIntegrationsEnabled } from "../lib/inbox/liveMode";
import { directOrigin } from "../lib/originHelper";
import { applyLeadAssignmentRules } from "../lib/leadAssignment";
import { dispatchNotification } from "../lib/notificationDispatcher";
import { sendEmail } from "../lib/email";
import { decryptConfig } from "../lib/encryption";
import { inboxBus, type InboxBusEvent } from "../lib/inbox/eventBus";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Inbox AI / notes / tasks helpers (Phase 2)
// ---------------------------------------------------------------------------

// Per-user rate limit for the AI summarize endpoint. Anthropic calls cost
// money and are slow, so each staff/admin user gets 10 summarize requests
// per minute. Shares the same `rate_limits` table as auth.ts; isolated by
// `keyPrefix`.
const summarizeRateLimiter = new RateLimiterPostgres({
  storeClient: pool,
  storeType: "pool",
  tableName: "rate_limits",
  keyPrefix: "inbox-summarize",
  points: 10,
  duration: 60,
});

function isAiSummary(value: unknown): value is ConversationAiSummary {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.content === "string" &&
    typeof v.generatedAt === "string" &&
    typeof v.messageCount === "number" &&
    typeof v.model === "string" &&
    typeof v.generatedByUserId === "number"
  );
}

function readAiSummary(metadata: unknown): ConversationAiSummary | null {
  if (!metadata || typeof metadata !== "object") return null;
  const md = metadata as Record<string, unknown>;
  return isAiSummary(md.aiSummary) ? md.aiSummary : null;
}

// Injection seam: the AI summarize endpoint calls `generateConversationSummary`,
// which by default goes to Anthropic via `defaultGenerateSummary`. Tests can
// override `__aiSummaryOverride` to assert cache behavior without spending
// tokens or needing a live API key.
export interface SummarizeInput {
  messages: Array<{ direction: string; content: string; createdAt: Date | string | null }>;
}
let __aiSummaryOverride:
  | ((input: SummarizeInput) => Promise<{ content: string; model: string }>)
  | null = null;
export function __setAiSummaryOverrideForTests(
  fn: ((input: SummarizeInput) => Promise<{ content: string; model: string }>) | null,
): void {
  __aiSummaryOverride = fn;
}

const SUMMARIZE_MODEL = "claude-haiku-4-5-20251001";

async function defaultGenerateSummary(input: SummarizeInput): Promise<{ content: string; model: string }> {
  const anthropic = await getAnthropicClient();
  const transcript = input.messages
    .map((m) => {
      const who = m.direction === "inbound" ? "Customer" : m.direction === "outbound" ? "Agent" : "Internal";
      return `[${who}] ${m.content}`;
    })
    .join("\n");
  const systemPrompt =
    "You are a CRM assistant. Summarize the following customer conversation for staff " +
    "in 3-5 sentences. Cover: (1) the customer's core need, (2) progress so far, " +
    "(3) suggested next action. Respond in the same language the customer is using.";
  const message = await anthropic.messages.create({
    model: SUMMARIZE_MODEL,
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: "user", content: transcript }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI returned no text content");
  }
  return { content: textBlock.text.trim(), model: SUMMARIZE_MODEL };
}

async function generateConversationSummary(input: SummarizeInput): Promise<{ content: string; model: string }> {
  return __aiSummaryOverride ? __aiSummaryOverride(input) : defaultGenerateSummary(input);
}

// Injection seam: the lead-suggestion endpoint calls `extractLeadFromTranscript`,
// which by default goes to Anthropic. Tests can override this to assert field
// extraction + lowConfidence flag behavior without spending tokens or needing a key.
export interface LeadExtractionInput {
  transcript: string;
}
export interface LeadExtractionResult {
  fullName: string | null;
  email: string | null;
  fullNameConfidence: "high" | "low";
  emailConfidence: "high" | "low";
}
let __aiLeadSuggestionOverride:
  | ((input: LeadExtractionInput) => Promise<LeadExtractionResult>)
  | null = null;
export function __setAiLeadSuggestionOverrideForTests(
  fn: ((input: LeadExtractionInput) => Promise<LeadExtractionResult>) | null,
): void {
  __aiLeadSuggestionOverride = fn;
}

const LEAD_EXTRACTION_SYSTEM =
  "You are a CRM data extractor. Extract contact information from the conversation. " +
  "Return ONLY valid JSON with this exact shape — no markdown, no explanation:\n" +
  '{ "fullName": string|null, "email": string|null, "fullNameConfidence": "high"|"low", "emailConfidence": "high"|"low" }\n' +
  '"high" = information is explicitly and clearly stated in the conversation.\n' +
  '"low" = inferred, ambiguous, or uncertain.';

async function extractLeadFromTranscript(input: LeadExtractionInput): Promise<LeadExtractionResult> {
  if (__aiLeadSuggestionOverride) return __aiLeadSuggestionOverride(input);
  const anthropic = await getAnthropicClient();
  const aiResponse = await anthropic.messages.create({
    model: LEAD_EXTRACTION_MODEL,
    max_tokens: 200,
    system: LEAD_EXTRACTION_SYSTEM,
    messages: [{ role: "user", content: `Conversation:\n${input.transcript}` }],
  });
  const textBlock = aiResponse.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("AI returned no text");
  const aiResultSchema = z.object({
    fullName: z.string().nullable(),
    email: z.string().nullable(),
    fullNameConfidence: z.enum(["high", "low"]),
    emailConfidence: z.enum(["high", "low"]),
  });
  return aiResultSchema.parse(JSON.parse(textBlock.text.trim()));
}

interface ConversationLink {
  conversationId: number;
  leadId: number | null;
  studentId: number | null;
}

async function loadConversationLink(id: number): Promise<ConversationLink | null> {
  const [conv] = await db
    .select({ id: conversationsTable.id, externalContactId: conversationsTable.externalContactId })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, id));
  if (!conv) return null;
  if (!conv.externalContactId) {
    return { conversationId: id, leadId: null, studentId: null };
  }
  const [contact] = await db
    .select({ leadId: externalContactsTable.leadId, studentId: externalContactsTable.studentId })
    .from(externalContactsTable)
    .where(eq(externalContactsTable.id, conv.externalContactId));

  // Re-resolve the lead/student against their live (non-soft-deleted) state
  // so summarize/notes/tasks treat a soft-deleted entity as "no link" — same
  // 400 they already return for an unmatched conversation. This keeps deleted
  // personal data from being re-attached to new notes/tasks.
  let liveLeadId: number | null = null;
  if (contact?.leadId != null) {
    const [row] = await db
      .select({ id: leadsTable.id })
      .from(leadsTable)
      .where(and(eq(leadsTable.id, contact.leadId), isNull(leadsTable.deletedAt)));
    if (row) liveLeadId = row.id;
  }
  let liveStudentId: number | null = null;
  if (contact?.studentId != null) {
    const [row] = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(and(eq(studentsTable.id, contact.studentId), isNull(studentsTable.deletedAt)));
    if (row) liveStudentId = row.id;
  }
  return {
    conversationId: id,
    leadId: liveLeadId,
    studentId: liveStudentId,
  };
}

router.get("/inbox/live-mode", requireAuth, async (_req, res): Promise<void> => {
  res.json({ live: isLiveIntegrationsEnabled() });
});

/**
 * Live inbox stream (Server-Sent Events). Pushes `inbox_message` and
 * `inbox_assigned` frames to the client so the UI can refresh without
 * polling. Payloads carry just enough context for the client to decide
 * what to refetch (the conversation list and, if open, the conversation
 * detail). The connection emits a named `heartbeat` event every 25s so the
 * client can both defeat idle proxies AND surface a "last update" timestamp
 * — staff see the indicator turn amber if no heartbeat arrives for > 60s,
 * catching "looks live but isn't" failures where the socket stays open but
 * the push pipeline silently stops emitting.
 */
router.get(
  "/inbox/events",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  (req, res): void => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
      (res as { flushHeaders: () => void }).flushHeaders();
    }

    res.write(`retry: 5000\n\n`);

    const writeHeartbeat = () => {
      try {
        res.write(`event: heartbeat\n`);
        res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
      } catch {
        // ignored — close handler will tear down.
      }
    };

    // Send an initial heartbeat immediately so the client's "last update"
    // timestamp is populated before the first real event arrives.
    writeHeartbeat();

    const handler = (event: InboxBusEvent) => {
      const eventName = event.type === "message" ? "inbox_message" : "inbox_assigned";
      try {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // socket may have closed mid-write; cleanup happens via 'close'.
      }
    };

    const unsubscribe = inboxBus.subscribe(handler);

    const ping = setInterval(writeHeartbeat, 25000);

    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
      try { res.end(); } catch {}
    };

    req.on("close", cleanup);
    req.on("error", cleanup);
  },
);

router.get(
  "/inbox/conversations",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const userId = req.user!.id;
    const tab = String(req.query.tab || "mine"); // mine | unassigned | unmatched | all
    const channel = req.query.channel ? String(req.query.channel) : null;

    const where: SQL[] = [eq(conversationsTable.isArchived, false)];

    // Channel filter has full parity, including the value 'internal'. When NO
    // channel is requested, default the inbox scope to external channels only
    // so user-DMs (internal conversations) don't pollute the staff inbox feed
    // — internal conversations remain reachable by passing channel=internal.
    if (channel) {
      where.push(eq(conversationsTable.channel, channel));
    } else {
      where.push(sql`${conversationsTable.channel} != 'internal'`);
    }

    if (tab === "mine") where.push(eq(conversationsTable.assignedToId, userId));
    else if (tab === "unassigned") where.push(isNull(conversationsTable.assignedToId));
    else if (tab === "unmatched") where.push(eq(conversationsTable.unmatched, true));

    const rows = await db
      .select({
        id: conversationsTable.id,
        type: conversationsTable.type,
        title: conversationsTable.title,
        channel: conversationsTable.channel,
        externalContactId: conversationsTable.externalContactId,
        externalThreadId: conversationsTable.externalThreadId,
        unmatched: conversationsTable.unmatched,
        status: conversationsTable.status,
        assignedToId: conversationsTable.assignedToId,
        lastMessageAt: conversationsTable.lastMessageAt,
        lastMessagePreview: conversationsTable.lastMessagePreview,
        lastInboundAt: conversationsTable.lastInboundAt,
        createdAt: conversationsTable.createdAt,
      })
      .from(conversationsTable)
      .where(and(...where))
      .orderBy(desc(conversationsTable.lastMessageAt))
      .limit(200);

    const externalIds = rows.map((r) => r.externalContactId).filter((x): x is number => !!x);
    const assignedIds = rows.map((r) => r.assignedToId).filter((x): x is number => !!x);

    type AssignedUserSummary = {
      id: number;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
    };

    const contactsMap = new Map<number, ExternalContact>();
    if (externalIds.length > 0) {
      const contacts = await db
        .select()
        .from(externalContactsTable)
        .where(inArray(externalContactsTable.id, externalIds));
      for (const c of contacts) contactsMap.set(c.id, c);
    }
    const usersMap = new Map<number, AssignedUserSummary>();
    if (assignedIds.length > 0) {
      const users = await db
        .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, email: usersTable.email })
        .from(usersTable)
        .where(inArray(usersTable.id, assignedIds));
      for (const u of users) usersMap.set(u.id, u);
    }

    const data = rows.map((r) => ({
      ...r,
      externalContact: r.externalContactId ? contactsMap.get(r.externalContactId) : null,
      assignedTo: r.assignedToId ? usersMap.get(r.assignedToId) : null,
    }));

    res.json({ data });
  },
);

router.get(
  "/inbox/conversations/:id",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [externalContact] = conv.externalContactId
      ? await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId))
      : [null];
    const [assignedTo] = conv.assignedToId
      ? await db
          .select({
            id: usersTable.id,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            avatarUrl: usersTable.avatarUrl,
          })
          .from(usersTable)
          .where(eq(usersTable.id, conv.assignedToId))
      : [null];
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(messagesTable.createdAt);

    const leadId = externalContact?.leadId ?? null;
    const studentId = externalContact?.studentId ?? null;
    const agentId = externalContact?.agentId ?? null;

    const [lead] = leadId
      ? await db
          .select({
            id: leadsTable.id,
            firstName: leadsTable.firstName,
            lastName: leadsTable.lastName,
            email: leadsTable.email,
            phone: leadsTable.phone,
            status: leadsTable.status,
            interestedProgram: leadsTable.interestedProgram,
            interestedUniversity: leadsTable.interestedUniversity,
            interestedCountry: leadsTable.interestedCountry,
            estimatedValue: leadsTable.estimatedValue,
            source: leadsTable.source,
            originType: leadsTable.originType,
            originDisplayName: leadsTable.originDisplayName,
            agentId: leadsTable.agentId,
            assignedToId: leadsTable.assignedToId,
            createdAt: leadsTable.createdAt,
            convertedStudentId: leadsTable.convertedStudentId,
          })
          .from(leadsTable)
          .where(and(eq(leadsTable.id, leadId), isNull(leadsTable.deletedAt)))
      : [null];

    const [student] = studentId
      ? await db
          .select({
            id: studentsTable.id,
            firstName: studentsTable.firstName,
            lastName: studentsTable.lastName,
            email: studentsTable.email,
            phone: studentsTable.phone,
            status: studentsTable.status,
            agentId: studentsTable.agentId,
            assignedToId: studentsTable.assignedToId,
            interestedLevel: studentsTable.interestedLevel,
            originType: studentsTable.originType,
            originDisplayName: studentsTable.originDisplayName,
            createdAt: studentsTable.createdAt,
          })
          .from(studentsTable)
          .where(and(eq(studentsTable.id, studentId!), isNull(studentsTable.deletedAt)))
      : [null];

    const [agent] = agentId
      ? await db
          .select({
            id: agentsTable.id,
            firstName: agentsTable.firstName,
            lastName: agentsTable.lastName,
            companyName: agentsTable.companyName,
            email: agentsTable.email,
            phone: agentsTable.phone,
            status: agentsTable.status,
            entityType: agentsTable.entityType,
          })
          .from(agentsTable)
          .where(and(eq(agentsTable.id, agentId), isNull(agentsTable.deletedAt)))
      : [null];

    let stage: {
      key: string;
      label: string;
      color: string | null;
      variant: string | null;
      icon: string | null;
    } | null = null;
    const stageEntity: "lead" | "student" | null = lead ? "lead" : student ? "student" : null;
    const stageKey = lead?.status ?? student?.status ?? null;
    if (stageEntity && stageKey) {
      const [row] = await db
        .select({
          key: pipelineStagesTable.key,
          label: pipelineStagesTable.label,
          color: pipelineStagesTable.color,
          variant: pipelineStagesTable.variant,
          icon: pipelineStagesTable.icon,
        })
        .from(pipelineStagesTable)
        .where(and(
          eq(pipelineStagesTable.entityType, stageEntity),
          eq(pipelineStagesTable.key, stageKey),
        ));
      stage = row ?? null;
    }

    const aiSummary = readAiSummary(conv.metadata);

    res.json({
      conversation: { ...conv, assignedTo: assignedTo ?? null },
      externalContact,
      messages,
      withinWindow: conv.channel === "whatsapp" ? isWithin24hWindow(conv.lastInboundAt) : true,
      lead: lead ?? null,
      student: student ?? null,
      agent: agent ?? null,
      stage,
      aiSummary,
    });
  },
);

router.patch(
  "/inbox/conversations/:id/assign",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { userId } = req.body as { userId: number | null };
    if (!id) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const assignedToId = userId === null ? null : (typeof userId === "number" ? userId : req.user!.id);
    const [previous] = await db
      .select({ assignedToId: conversationsTable.assignedToId })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id));
    const [updated] = await db
      .update(conversationsTable)
      .set({ assignedToId, status: assignedToId ? "open" : "open" })
      .where(eq(conversationsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await logAudit(req.user!.id, "assign_conversation", "conversation", id, { assignedToId }, req.ip);
    inboxBus.publish({
      type: "assigned",
      conversationId: id,
      assignedToId: updated.assignedToId ?? null,
      previousAssignedToId: previous?.assignedToId ?? null,
      actorUserId: req.user!.id,
    });
    if (assignedToId && assignedToId !== req.user!.id) {
      try {
        await dispatchNotification({
          event: "inbox.assigned",
          title: "Conversation assigned to you",
          body: updated.title || `${updated.channel} conversation`,
          actionUrl: `/staff/messages?conversation=${id}`,
          icon: "user",
          recipientUserIds: [assignedToId],
          actorUserId: req.user!.id,
          data: { conversationId: id },
        });
      } catch {}
    }
    res.json({ data: updated });
  },
);

router.patch(
  "/inbox/conversations/:id/bot",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { enabled } = req.body as { enabled: boolean };
    if (!id || typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) is required" });
      return;
    }
    // Re-enabling the bot clears the needs-human flag: staff have acknowledged
    // any escalation and are handing the conversation back to the assistant.
    // Re-enabling resets the consecutive-reply counter so the handoff threshold
    // starts fresh for the next bot-led stretch.
    const [updated] = await db
      .update(conversationsTable)
      .set(enabled ? { botEnabled: true, needsHuman: false, botReplyCount: 0 } : { botEnabled: false })
      .where(eq(conversationsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await logAudit(req.user!.id, "toggle_conversation_bot", "conversation", id, { enabled }, req.ip);
    res.json({ data: { id: updated.id, botEnabled: updated.botEnabled, needsHuman: updated.needsHuman } });
  },
);

router.post(
  "/inbox/conversations/:id/match",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { type, entityId } = req.body as { type: "lead" | "student" | "agent"; entityId: number };
    if (!id || !type || !entityId) {
      res.status(400).json({ error: "type and entityId are required" });
      return;
    }
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv || !conv.externalContactId) {
      res.status(404).json({ error: "Conversation has no external contact" });
      return;
    }
    const updates: { leadId: number | null; studentId: number | null; agentId: number | null } = {
      leadId: null,
      studentId: null,
      agentId: null,
    };
    if (type === "lead") updates.leadId = entityId;
    if (type === "student") updates.studentId = entityId;
    if (type === "agent") updates.agentId = entityId;
    await db.update(externalContactsTable).set(updates).where(eq(externalContactsTable.id, conv.externalContactId));
    await db.update(conversationsTable).set({ unmatched: false }).where(eq(conversationsTable.id, id));
    await logAudit(req.user!.id, "match_conversation", "conversation", id, { type, entityId }, req.ip);
    res.json({ ok: true });
  },
);

router.get(
  "/inbox/conversations/:id/match-suggestions",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv || !conv.externalContactId) {
      res.json({ outcome: "none", candidates: [] });
      return;
    }
    const [contact] = await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId));
    if (!contact) {
      res.json({ outcome: "none", candidates: [] });
      return;
    }
    const result = await resolveIdentity({ phone: contact.phone, email: contact.email });
    res.json(result);
  },
);

// ---------------------------------------------------------------------------
// Shared param schema (used by Faz 1 routes below and Phase 2 routes further below)
// ---------------------------------------------------------------------------

const conversationIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Faz 1 — Smart lead creation from conversation (AI pre-fill + duplicate guard)
// ---------------------------------------------------------------------------

const LEAD_EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

router.get(
  "/inbox/conversations/:id/lead-suggestion",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  requireAgentStaffPermission("leads"),
  validate({ params: conversationIdParamSchema }),
  async (req, res): Promise<void> => {
    const { params } = getValidated<{ params: typeof conversationIdParamSchema }>(req);
    const id = params.id;

    const [conv] = await db
      .select({ id: conversationsTable.id, externalContactId: conversationsTable.externalContactId })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, id));
    if (!conv) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const suggestion: Record<string, unknown> = {};

    if (conv.externalContactId) {
      const [contact] = await db
        .select()
        .from(externalContactsTable)
        .where(eq(externalContactsTable.id, conv.externalContactId));
      if (contact) {
        if (contact.phoneE164 || contact.phone) {
          suggestion.phone = contact.phoneE164 || contact.phone;
        }
        if (contact.displayName) {
          suggestion.displayName = contact.displayName;
        }
      }
    }

    // AI extraction from transcript — never throws (errors silently fold to empty suggestion)
    try {
      const transcript = await db
        .select({ direction: messagesTable.direction, content: messagesTable.content })
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, id))
        .orderBy(asc(messagesTable.createdAt))
        .limit(30);

      if (transcript.length > 0) {
        const text = transcript
          .map((m) => `[${m.direction === "inbound" ? "Customer" : "Agent"}] ${m.content}`)
          .join("\n");

        const extracted = await extractLeadFromTranscript({ transcript: text });
        if (extracted.fullName) {
          suggestion.fullName = extracted.fullName;
          if (extracted.fullNameConfidence === "low") suggestion.fullNameLowConfidence = true;
        }
        if (extracted.email) {
          suggestion.email = extracted.email;
          if (extracted.emailConfidence === "low") suggestion.emailLowConfidence = true;
        }
      }
    } catch {
      // Swallow all AI / parse errors — return partial suggestion
    }

    res.json({ suggestion });
  },
);

const createLeadFromConversationBodySchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
});

router.post(
  "/inbox/conversations/:id/create-lead",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  requireAgentStaffPermission("leads"),
  validate({ params: conversationIdParamSchema, body: createLeadFromConversationBodySchema }),
  async (req, res): Promise<void> => {
    const { params, body } = getValidated<{
      params: typeof conversationIdParamSchema;
      body: typeof createLeadFromConversationBodySchema;
    }>(req);
    const id = params.id;

    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv || !conv.externalContactId) {
      res.status(404).json({ error: "Conversation not found or has no external contact" });
      return;
    }
    const [contact] = await db
      .select()
      .from(externalContactsTable)
      .where(eq(externalContactsTable.id, conv.externalContactId));
    if (!contact) {
      res.status(404).json({ error: "External contact not found" });
      return;
    }

    // Parse fullName into first/last
    const trimmedName = body.fullName.trim();
    const parts = trimmedName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || trimmedName;
    const lastName = parts.slice(1).join(" ") || "Contact";

    const email = body.email?.trim().toLowerCase() || contact.email || null;
    const phoneForCheck = body.phone?.trim() || contact.phone || null;

    // Duplicate lead guard — uses resolveIdentity to avoid re-implementing phone/email normalisation
    const resolution = await resolveIdentity({ phone: phoneForCheck, email });
    const existingLead = resolution.candidates.find((c) => c.type === "lead");
    if (existingLead) {
      const [candidate] = await db
        .select({
          id: leadsTable.id,
          firstName: leadsTable.firstName,
          lastName: leadsTable.lastName,
          email: leadsTable.email,
          phone: leadsTable.phone,
          status: leadsTable.status,
        })
        .from(leadsTable)
        .where(and(eq(leadsTable.id, existingLead.id), isNull(leadsTable.deletedAt)));
      if (candidate) {
        res.status(409).json({ error: "LEAD_EXISTS", candidate });
        return;
      }
    }

    // Single TX: insert lead + link external_contact + mark conversation matched
    const lead = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(leadsTable)
        .values({
          firstName: toLatinUpper(firstName).slice(0, 100),
          lastName: toLatinUpper(lastName).slice(0, 100),
          email: email || null,
          phone: phoneForCheck ? normalizePhoneField(phoneForCheck) : null,
          phoneE164: contact.phoneE164 || null,
          source: conv.channel,
          status: "new",
          ...directOrigin(),
        })
        .returning();

      await tx
        .update(externalContactsTable)
        .set({ leadId: inserted.id })
        .where(eq(externalContactsTable.id, contact.id));

      await tx
        .update(conversationsTable)
        .set({ unmatched: false })
        .where(eq(conversationsTable.id, id));

      return inserted;
    });

    await applyLeadAssignmentRules(lead, req.ip);
    logAudit(
      req.user!.id,
      "create_lead_from_inbox_smart",
      "lead",
      lead.id,
      { conversationId: id, method: "ai_prefill" },
      req.ip,
    );

    res.status(201).json({ ok: true, leadId: lead.id });
  },
);

router.post(
  "/inbox/conversations/:id/match/new-lead",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv || !conv.externalContactId) {
      res.status(404).json({ error: "Conversation has no external contact" });
      return;
    }
    const [contact] = await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId));
    if (!contact) {
      res.status(404).json({ error: "External contact not found" });
      return;
    }
    const displayName = contact.displayName || "Unknown";
    const [firstName, ...rest] = displayName.split(/\s+/);
    const lastName = rest.join(" ") || "Contact";
    const [lead] = await db
      .insert(leadsTable)
      .values({
        firstName: toLatinUpper(firstName).slice(0, 100),
        lastName: toLatinUpper(lastName).slice(0, 100),
        email: contact.email || null,
        phone: contact.phone ? normalizePhoneField(contact.phone) : null,
        phoneE164: contact.phoneE164 || null,
        source: conv.channel,
        status: "new",
        ...directOrigin(),
      })
      .returning();
    await db.update(externalContactsTable).set({ leadId: lead.id }).where(eq(externalContactsTable.id, contact.id));
    await db.update(conversationsTable).set({ unmatched: false }).where(eq(conversationsTable.id, id));
    await applyLeadAssignmentRules(lead, req.ip);
    await logAudit(req.user!.id, "create_lead_from_inbox", "lead", lead.id, { conversationId: id }, req.ip);
    res.status(201).json({ ok: true, leadId: lead.id });
  },
);

/**
 * Send an outbound message on a non-internal channel conversation.
 * Body: { content: string }
 */
router.post(
  "/inbox/conversations/:id/messages",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { content } = req.body as { content: string };
    if (!id || !content || !content.trim()) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Human takeover: a staff member manually replying disables the intake bot
    // for this conversation so the human and the bot never talk over each other.
    if (conv.botEnabled) {
      await db
        .update(conversationsTable)
        .set({ botEnabled: false, botReplyCount: 0 })
        .where(eq(conversationsTable.id, id));
    }

    if (conv.channel === "whatsapp") {
      if (!isWithin24hWindow(conv.lastInboundAt)) {
        res.status(409).json({
          error: "outside_24h_window",
          message: "Free-form replies are only allowed within 24h of the last inbound message. Use a template.",
        });
        return;
      }
      if (!conv.externalContactId) {
        res.status(400).json({ error: "Conversation has no external contact" });
        return;
      }
      const [contact] = await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId));
      if (!contact?.phoneE164) {
        res.status(400).json({ error: "Contact has no E.164 phone" });
        return;
      }
      const [integ] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, "whatsapp"));
      const cfg: WhatsAppConfig = (decryptConfig(integ?.config as Record<string, any>) as WhatsAppConfig) || {};

      // Persist a 'pending' row first so the client can observe lifecycle.
      const [pending] = await db
        .insert(messagesTable)
        .values({
          conversationId: id,
          senderId: req.user!.id,
          content,
          channel: "whatsapp",
          direction: "outbound",
          status: "pending",
          metadata: {},
        })
        .returning();

      const result = await sendWhatsAppText({ config: cfg, toPhoneE164: contact.phoneE164, text: content });

      const [msg] = await db
        .update(messagesTable)
        .set({
          status: result.ok ? "sent" : "failed",
          externalMessageId: result.externalMessageId || null,
          failedReason: result.ok ? null : result.error || "send_failed",
          sentAt: result.ok ? new Date() : null,
          metadata: { simulated: result.simulated, ...(result.ok ? {} : { error: result.error }) },
        })
        .where(eq(messagesTable.id, pending.id))
        .returning();

      if (result.ok) {
        await db
          .update(conversationsTable)
          .set({ lastMessageAt: new Date(), lastMessagePreview: content.slice(0, 200) })
          .where(eq(conversationsTable.id, id));
        inboxBus.publish({
          type: "message",
          conversationId: id,
          channel: "whatsapp",
          assignedToId: conv.assignedToId ?? null,
          unmatched: conv.unmatched,
          direction: "outbound",
        });
      } else {
        // Notify staff of send failure (in_app + email per default rule).
        try {
          await dispatchNotification({
            event: "inbox.send_failed",
            title: `WhatsApp send failed for conversation #${id}`,
            body: result.error || "Send failed",
            actionUrl: `/staff/messages?conversation=${id}`,
            icon: "alert",
            data: { conversationId: id, channel: "whatsapp", error: result.error },
          });
        } catch (err) {
          console.error("[INBOX] send_failed dispatch error:", err);
        }
      }
      res.status(result.ok ? 201 : 502).json({ message: msg, simulated: result.simulated, error: result.error });
      return;
    }

    if (conv.channel === "web_form") {
      const [msg] = await db
        .insert(messagesTable)
        .values({
          conversationId: id,
          senderId: req.user!.id,
          content,
          channel: "web_form",
          direction: "outbound",
          status: "sent",
          sentAt: new Date(),
        })
        .returning();
      await db
        .update(conversationsTable)
        .set({ lastMessageAt: new Date(), lastMessagePreview: content.slice(0, 200) })
        .where(eq(conversationsTable.id, id));
      inboxBus.publish({
        type: "message",
        conversationId: id,
        channel: "web_form",
        assignedToId: conv.assignedToId ?? null,
        unmatched: conv.unmatched,
        direction: "outbound",
      });

      // Auto-email the original submitter when an email is on file.
      let emailSent = false;
      let emailError: string | undefined;
      try {
        const [contact] = conv.externalContactId
          ? await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId))
          : [null];
        if (contact?.email) {
          const subject = "Reply from our team";
          const text = content;
          const html = `<p>${content.replace(/\n/g, "<br/>")}</p>`;
          await sendEmail(contact.email, { subject, html, text });
          emailSent = true;
          await db
            .update(messagesTable)
            .set({ metadata: { emailedTo: contact.email } })
            .where(eq(messagesTable.id, msg.id));
        }
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
        console.error("[INBOX] web_form email auto-reply failed:", err);
        try {
          await dispatchNotification({
            event: "inbox.send_failed",
            title: `Web form reply email failed for conversation #${id}`,
            body: emailError,
            actionUrl: `/staff/messages?conversation=${id}`,
            icon: "alert",
            data: { conversationId: id, channel: "web_form", error: emailError },
          });
        } catch {}
      }
      res.status(201).json({
        message: msg,
        emailSent,
        ...(emailError ? { emailError } : {}),
        note: emailSent
          ? "Reply emailed to submitter."
          : "Recorded; submitter has no email on file.",
      });
      return;
    }

    res.status(400).json({ error: `Channel '${conv.channel}' is not supported by this endpoint` });
  },
);

router.post(
  "/inbox/conversations/:id/templates",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { templateId, parameters } = req.body as { templateId: number; parameters?: string[] };
    if (!id || !templateId) {
      res.status(400).json({ error: "templateId is required" });
      return;
    }
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
    if (!conv || conv.channel !== "whatsapp") {
      res.status(400).json({ error: "Templates are only supported on WhatsApp conversations" });
      return;
    }
    if (!conv.externalContactId) {
      res.status(400).json({ error: "Conversation has no external contact" });
      return;
    }
    const [contact] = await db.select().from(externalContactsTable).where(eq(externalContactsTable.id, conv.externalContactId));
    if (!contact?.phoneE164) {
      res.status(400).json({ error: "Contact has no E.164 phone" });
      return;
    }
    const [tpl] = await db.select().from(messageTemplatesTable).where(eq(messageTemplatesTable.id, templateId));
    if (!tpl || !tpl.externalTemplateName) {
      res.status(400).json({ error: "Template missing externalTemplateName" });
      return;
    }
    const [integ] = await db.select().from(integrationsTable).where(eq(integrationsTable.key, "whatsapp"));
    const cfg: WhatsAppConfig = (decryptConfig(integ?.config as Record<string, any>) as WhatsAppConfig) || {};
    const result = await sendWhatsAppTemplate({
      config: cfg,
      toPhoneE164: contact.phoneE164,
      templateName: tpl.externalTemplateName,
      language: tpl.language || "en",
      parameters: parameters || [],
    });

    const renderedContent = (parameters || []).reduce<string>(
      (acc, val, idx) => acc.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, "g"), val),
      tpl.content,
    );

    const [msg] = await db
      .insert(messagesTable)
      .values({
        conversationId: id,
        senderId: req.user!.id,
        content: renderedContent,
        channel: "whatsapp",
        direction: "outbound",
        status: result.ok ? "sent" : "failed",
        externalMessageId: result.externalMessageId || null,
        failedReason: result.ok ? null : result.error || "send_failed",
        sentAt: result.ok ? new Date() : null,
        metadata: { simulated: result.simulated, template: tpl.externalTemplateName },
      })
      .returning();
    if (result.ok) {
      await db
        .update(conversationsTable)
        .set({ lastMessageAt: new Date(), lastMessagePreview: renderedContent.slice(0, 200) })
        .where(eq(conversationsTable.id, id));
      inboxBus.publish({
        type: "message",
        conversationId: id,
        channel: "whatsapp",
        assignedToId: conv.assignedToId ?? null,
        unmatched: conv.unmatched,
        direction: "outbound",
      });
    }
    res.status(result.ok ? 201 : 502).json({ message: msg, simulated: result.simulated, error: result.error });
  },
);

router.get(
  "/inbox/external-history",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const type = String(req.query.type || ""); // lead | student | agent
    const id = parseInt(String(req.query.id || ""), 10);
    if (!type || !id) {
      res.status(400).json({ error: "type and id required" });
      return;
    }
    if (type !== "lead" && type !== "student" && type !== "agent") {
      res.status(400).json({ error: "Invalid type" });
      return;
    }

    // 1) External conversations linked via external_contacts (WA + web_form).
    const extWhere =
      type === "lead"
        ? eq(externalContactsTable.leadId, id)
        : type === "student"
        ? eq(externalContactsTable.studentId, id)
        : eq(externalContactsTable.agentId, id);
    const contacts = await db.select().from(externalContactsTable).where(extWhere);
    const contactIds = contacts.map((c) => c.id);

    // 2) Internal conversations linked to the entity's user account, if any.
    //    Students and agents have a userId on their row; leads do not (they are
    //    pre-account prospects), so the internal union is a no-op for leads.
    let entityUserId: number | null = null;
    if (type === "student") {
      const [s] = await db
        .select({ userId: studentsTable.userId })
        .from(studentsTable)
        .where(eq(studentsTable.id, id))
        .limit(1);
      entityUserId = s?.userId ?? null;
    } else if (type === "agent") {
      const [a] = await db
        .select({ userId: agentsTable.userId })
        .from(agentsTable)
        .where(eq(agentsTable.id, id))
        .limit(1);
      entityUserId = a?.userId ?? null;
    }

    let internalConvIds: number[] = [];
    if (entityUserId) {
      const parts = await db
        .select({ conversationId: conversationParticipantsTable.conversationId })
        .from(conversationParticipantsTable)
        .where(eq(conversationParticipantsTable.userId, entityUserId));
      internalConvIds = parts.map((p) => p.conversationId);
    }

    if (contactIds.length === 0 && internalConvIds.length === 0) {
      res.json({ conversations: [], messages: [], externalContacts: contacts });
      return;
    }

    // Union: external_contact-linked OR internal-participant-linked.
    const whereClauses = [];
    if (contactIds.length > 0) whereClauses.push(inArray(conversationsTable.externalContactId, contactIds));
    if (internalConvIds.length > 0) whereClauses.push(inArray(conversationsTable.id, internalConvIds));
    const conversations = await db
      .select()
      .from(conversationsTable)
      .where(whereClauses.length === 1 ? whereClauses[0] : or(...whereClauses))
      .orderBy(desc(conversationsTable.lastMessageAt));
    const convIds = conversations.map((c) => c.id);
    const messages = convIds.length
      ? await db
          .select()
          .from(messagesTable)
          .where(inArray(messagesTable.conversationId, convIds))
          .orderBy(desc(messagesTable.createdAt))
          .limit(500)
      : [];
    res.json({ conversations, messages, externalContacts: contacts });
  },
);

// ---------------------------------------------------------------------------
// Phase 2 — AI summarize + inline notes + inline follow-up tasks
// ---------------------------------------------------------------------------

router.post(
  "/inbox/conversations/:id/summarize",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: conversationIdParamSchema }),
  async (req, res): Promise<void> => {
    const { params } = getValidated<{ params: typeof conversationIdParamSchema }>(req);
    const conversationId = params.id;
    const userId = req.user!.id;

    // First, count messages — needed both to short-circuit empty conversations
    // and to key the cache. Then probe the cache *before* consuming any rate-
    // limit quota or acquiring a lock so repeated reads of a stable summary
    // stay cheap.
    const [conv] = await db
      .select({ id: conversationsTable.id, metadata: conversationsTable.metadata })
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));
    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const [{ count: rawCount } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId));
    const messageCount = Number(rawCount) || 0;
    if (messageCount === 0) {
      res.status(400).json({ error: "No messages to summarize" });
      return;
    }

    const cached = readAiSummary(conv.metadata);
    if (cached && cached.messageCount === messageCount) {
      logAudit(userId, "conversation_summarize", "conversation", conversationId, {
        messageCount,
        fromCache: true,
      }, req.ip);
      res.json({ data: cached, fromCache: true });
      return;
    }

    // Cache miss — now charge a token against the per-user rate limit so the
    // expensive path is the only one that costs quota.
    try {
      await summarizeRateLimiter.consume(String(userId));
    } catch (rlErr) {
      const ms = (rlErr as { msBeforeNext?: number })?.msBeforeNext ?? 60000;
      res.setHeader("Retry-After", String(Math.ceil(ms / 1000)));
      res.status(429).json({ error: "Too many summarize requests. Please wait a moment." });
      return;
    }

    // Per-conversation advisory lock so two concurrent summarize requests for
    // the same conversation don't both call Anthropic. We use the
    // `pg_advisory_xact_lock` variant inside a transaction — it's released
    // automatically on COMMIT/ROLLBACK and survives if the request errors
    // out. After acquiring the lock we re-read metadata and re-check the
    // cache; the second caller will then hit the freshly-written summary.
    let summary: ConversationAiSummary;
    let fromCache = false;
    try {
      summary = await db.transaction(async (tx) => {
        // First key is a fixed namespace constant for "inbox.summarize"
        // (chosen arbitrarily — picked from task #216) so this lock cannot
        // collide with other advisory locks the app might add later.
        await tx.execute(sql`select pg_advisory_xact_lock(7216, ${conversationId})`);

        const [fresh] = await tx
          .select({ metadata: conversationsTable.metadata })
          .from(conversationsTable)
          .where(eq(conversationsTable.id, conversationId));
        const reCached = readAiSummary(fresh?.metadata);
        if (reCached && reCached.messageCount === messageCount) {
          fromCache = true;
          return reCached;
        }

        const transcript = await tx
          .select({
            direction: messagesTable.direction,
            content: messagesTable.content,
            createdAt: messagesTable.createdAt,
          })
          .from(messagesTable)
          .where(eq(messagesTable.conversationId, conversationId))
          .orderBy(asc(messagesTable.createdAt))
          .limit(50);

        const { content, model } = await generateConversationSummary({ messages: transcript });
        const next: ConversationAiSummary = {
          content,
          generatedAt: new Date().toISOString(),
          messageCount,
          model,
          generatedByUserId: userId,
        };

        // Atomic JSONB merge done in-database so a parallel writer that
        // updates a different metadata key (e.g. channel state) is preserved
        // instead of being clobbered by a stale read-modify-write.
        await tx
          .update(conversationsTable)
          .set({
            metadata: sql`coalesce(${conversationsTable.metadata}, '{}'::jsonb) || jsonb_build_object('aiSummary', ${JSON.stringify(next)}::jsonb)`,
          })
          .where(eq(conversationsTable.id, conversationId));

        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI service not configured";
      const isConfigError = /not configured|API key/i.test(message);
      res
        .status(502)
        .json({ error: isConfigError ? "AI service not configured" : `AI request failed: ${message}` });
      return;
    }

    logAudit(userId, "conversation_summarize", "conversation", conversationId, {
      messageCount,
      fromCache,
      model: summary.model,
    }, req.ip);

    res.json({ data: summary, fromCache });
  },
);

const conversationNoteBodySchema = z.object({
  content: z.string().min(1).max(2000),
});

router.post(
  "/inbox/conversations/:id/notes",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: conversationIdParamSchema, body: conversationNoteBodySchema }),
  async (req, res): Promise<void> => {
    const { params, body } = getValidated<{
      params: typeof conversationIdParamSchema;
      body: typeof conversationNoteBodySchema;
    }>(req);
    const conversationId = params.id;
    const userId = req.user!.id;

    const link = await loadConversationLink(conversationId);
    if (!link) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (!link.leadId && !link.studentId) {
      res.status(400).json({ error: "This conversation is not linked to a lead or student" });
      return;
    }

    // Student takes priority: a converted lead has both leadId and studentId set;
    // notes should attach to the student (canonical post-conversion anchor).
    const primaryResourceType: "lead" | "student" = link.studentId ? "student" : "lead";
    const primaryResourceId = (link.studentId ?? link.leadId) as number;

    // Both inserts share a transaction so a failed cross-link does not leave
    // the primary note orphaned (or vice versa).
    const primaryNote = await db.transaction(async (tx) => {
      const [primary] = await tx
        .insert(notesTable)
        .values({
          content: body.content,
          authorId: userId,
          resourceType: primaryResourceType,
          resourceId: primaryResourceId,
          isInternal: true,
        })
        .returning();

      // Cross-link copy so a future inbox-side notes view can list notes by
      // conversation id without joining through external_contacts.
      await tx.insert(notesTable).values({
        content: body.content,
        authorId: userId,
        resourceType: "conversation",
        resourceId: conversationId,
        isInternal: true,
      });

      return primary;
    });

    logAudit(userId, "conversation_note_create", "conversation", conversationId, {
      noteId: primaryNote.id,
      resourceType: primaryResourceType,
      resourceId: primaryResourceId,
    }, req.ip);

    res.status(201).json({
      data: {
        id: primaryNote.id,
        content: primaryNote.content,
        createdAt: primaryNote.createdAt,
        resourceType: primaryResourceType,
        resourceId: primaryResourceId,
      },
    });
  },
);

const conversationTaskBodySchema = z.object({
  title: z.string().min(1).max(500),
  scheduledAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "scheduledAt must be a valid ISO datetime",
  }),
  assignedToId: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

router.post(
  "/inbox/conversations/:id/tasks",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  validate({ params: conversationIdParamSchema, body: conversationTaskBodySchema }),
  async (req, res): Promise<void> => {
    const { params, body } = getValidated<{
      params: typeof conversationIdParamSchema;
      body: typeof conversationTaskBodySchema;
    }>(req);
    const conversationId = params.id;
    const userId = req.user!.id;

    const link = await loadConversationLink(conversationId);
    if (!link) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (!link.leadId && !link.studentId) {
      res.status(400).json({ error: "This conversation is not linked to a lead or student" });
      return;
    }

    // Student takes priority: a converted lead has both leadId and studentId set;
    // follow-ups should attach to the student (canonical post-conversion anchor).
    const resourceType: "lead" | "student" = link.studentId ? "student" : "lead";
    const [task] = await db
      .insert(followUpsTable)
      .values({
        leadId: link.leadId,
        studentId: link.studentId,
        resourceType,
        title: body.title,
        scheduledAt: new Date(body.scheduledAt),
        assignedToId: body.assignedToId ?? userId,
        notes: body.notes ?? null,
        createdById: userId,
      })
      .returning();

    logAudit(userId, "conversation_task_create", "conversation", conversationId, {
      taskId: task.id,
      resourceType,
      leadId: link.leadId,
      studentId: link.studentId,
    }, req.ip);

    res.status(201).json({ data: task });
  },
);

export default router;
