import { Router, type IRouter } from "express";
import {
  db,
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
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { ExternalContact } from "@workspace/db";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
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
      email: string;
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
    const id = parseInt(req.params.id, 10);
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

    res.json({
      conversation: { ...conv, assignedTo: assignedTo ?? null },
      externalContact,
      messages,
      withinWindow: conv.channel === "whatsapp" ? isWithin24hWindow(conv.lastInboundAt) : true,
    });
  },
);

router.patch(
  "/inbox/conversations/:id/assign",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(req.params.id, 10);
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

router.post(
  "/inbox/conversations/:id/match",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(req.params.id, 10);
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
    const id = parseInt(req.params.id, 10);
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

router.post(
  "/inbox/conversations/:id/match/new-lead",
  requireAuth,
  requireRole(...STAFF_ROLES, ...ADMIN_ROLES),
  async (req, res): Promise<void> => {
    const id = parseInt(req.params.id, 10);
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
        firstName: firstName.toUpperCase().slice(0, 100),
        lastName: lastName.toUpperCase().slice(0, 100),
        email: contact.email || null,
        phone: contact.phone || null,
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
    const id = parseInt(req.params.id, 10);
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
    const id = parseInt(req.params.id, 10);
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

export default router;
