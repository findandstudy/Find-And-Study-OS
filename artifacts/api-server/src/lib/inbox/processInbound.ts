import {
  db,
  conversationsTable,
  messagesTable,
  externalContactsTable,
  channelAccountsTable,
  agentsTable,
  leadsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { resolveIdentity } from "./identityResolver";
import { toE164 } from "./phone";
import { dispatchNotification } from "../notificationDispatcher";

export interface InboundContactInfo {
  externalId: string;
  displayName?: string | null;
  phone?: string | null;
  email?: string | null;
  metadata?: Record<string, unknown>;
}

export interface InboundMessageInfo {
  externalMessageId: string;
  text: string;
  externalThreadId?: string | null;
  receivedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface InboundResult {
  conversationId: number;
  messageId: number;
  externalContactId: number;
  duplicate: boolean;
  unmatched: boolean;
}

/**
 * Idempotent inbound message ingestion. Handles:
 *   - upsert external_contacts by (channel, externalId)
 *   - identity resolution (strong / ambiguous / none)
 *   - upsert conversation by (channelAccountId, externalThreadId)
 *   - dedupe message by (channel, externalMessageId)
 *   - notification dispatch on new inbound
 */
export async function processInboundMessage(opts: {
  channel: string;
  channelAccountId?: number | null;
  contact: InboundContactInfo;
  message: InboundMessageInfo;
}): Promise<InboundResult> {
  const { channel, channelAccountId = null, contact, message } = opts;
  const phoneE164 = toE164(contact.phone || null);

  const [existingContact] = await db
    .select()
    .from(externalContactsTable)
    .where(and(eq(externalContactsTable.channel, channel), eq(externalContactsTable.externalId, contact.externalId)));

  let externalContact = existingContact;
  if (!externalContact) {
    const [created] = await db
      .insert(externalContactsTable)
      .values({
        channel,
        externalId: contact.externalId,
        displayName: contact.displayName || null,
        phone: contact.phone || null,
        phoneE164,
        email: contact.email ? String(contact.email).toLowerCase() : null,
        metadata: contact.metadata || {},
      })
      .returning();
    externalContact = created;
  } else {
    await db
      .update(externalContactsTable)
      .set({
        lastSeenAt: new Date(),
        displayName: externalContact.displayName || contact.displayName || null,
        phone: externalContact.phone || contact.phone || null,
        phoneE164: externalContact.phoneE164 || phoneE164,
        email: externalContact.email || (contact.email ? String(contact.email).toLowerCase() : null),
      })
      .where(eq(externalContactsTable.id, externalContact.id));
  }

  if (!externalContact.leadId && !externalContact.studentId && !externalContact.agentId) {
    const resolution = await resolveIdentity({ phone: contact.phone, email: contact.email });
    if (resolution.outcome === "strong") {
      const c = resolution.candidates[0];
      const updates: any = { leadId: null, studentId: null, agentId: null };
      if (c.type === "lead") updates.leadId = c.id;
      if (c.type === "student") updates.studentId = c.id;
      if (c.type === "agent") updates.agentId = c.id;
      await db.update(externalContactsTable).set(updates).where(eq(externalContactsTable.id, externalContact.id));
      externalContact = { ...externalContact, ...updates };
    }
  }

  // agent_ref pipeline (web_form sub-agent referrals): if no identity match yet
  // and an agent_ref was provided, try to match it to an agent via agencyCode and
  // auto-create a lead with assignedAgentId set. Conversation ownership stays null.
  // Spec: lib/db/schema/leads.ts assignedAgentId path; conversation.assignedToId untouched.
  let subAgentMatch: { agentId: number; agencyCode: string | null; displayName: string } | null = null;
  const agentRefRaw = (contact.metadata && typeof contact.metadata === "object" ? (contact.metadata as any).agentRef : null)
    || (message.metadata && typeof message.metadata === "object" ? (message.metadata as any).agentRef : null);
  const agentRef = agentRefRaw ? String(agentRefRaw).trim() : "";
  if (agentRef && !externalContact.leadId && !externalContact.studentId && !externalContact.agentId) {
    try {
      const [matched] = await db
        .select({ id: agentsTable.id, code: agentsTable.agencyCode, name: agentsTable.companyName })
        .from(agentsTable)
        .where(sql`lower(${agentsTable.agencyCode}) = lower(${agentRef})`)
        .limit(1);
      if (matched) {
        // Split displayName into first/last; fall back to channel handle.
        const fullName = (contact.displayName || "").trim();
        const parts = fullName.split(/\s+/).filter(Boolean);
        const firstName = parts[0] || (contact.email?.split("@")[0]) || (contact.phone || "Web");
        const lastName = parts.slice(1).join(" ") || "Lead";
        const [createdLead] = await db
          .insert(leadsTable)
          .values({
            firstName,
            lastName,
            email: contact.email ? String(contact.email).toLowerCase() : null,
            phone: contact.phone || null,
            phoneE164,
            source: `web_form:${agentRef}`,
            status: "new",
            agentId: matched.id,
            originType: "agent",
            originEntityType: "agent",
            originEntityId: matched.id,
            originDisplayName: matched.name || matched.code || `Agent #${matched.id}`,
          })
          .returning({ id: leadsTable.id });
        if (createdLead) {
          await db
            .update(externalContactsTable)
            .set({ leadId: createdLead.id })
            .where(eq(externalContactsTable.id, externalContact.id));
          externalContact = { ...externalContact, leadId: createdLead.id };
          subAgentMatch = {
            agentId: matched.id,
            agencyCode: matched.code,
            displayName: matched.name || matched.code || `Agent #${matched.id}`,
          };
        }
      }
    } catch (err) {
      console.error("[INBOX] agent_ref pipeline failed:", err);
    }
  }

  const isLinked = Boolean(externalContact.leadId || externalContact.studentId || externalContact.agentId);

  const externalThreadId = message.externalThreadId || contact.externalId;

  let conversation = (
    await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.channel, channel),
          eq(conversationsTable.externalThreadId, externalThreadId),
        ),
      )
      .limit(1)
  )[0];

  if (!conversation) {
    const [created] = await db
      .insert(conversationsTable)
      .values({
        type: "external",
        title: contact.displayName || contact.phone || channel,
        channel,
        channelAccountId,
        externalContactId: externalContact.id,
        externalThreadId,
        unmatched: !isLinked,
        status: "open",
        lastMessageAt: message.receivedAt || new Date(),
        lastMessagePreview: message.text.slice(0, 200),
        lastInboundAt: message.receivedAt || new Date(),
        metadata: subAgentMatch
          ? { source: channel, subAgent: subAgentMatch }
          : { source: channel },
      })
      .returning();
    conversation = created;
  }

  const [existingMsg] = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(eq(messagesTable.channel, channel), eq(messagesTable.externalMessageId, message.externalMessageId)));

  if (existingMsg) {
    return {
      conversationId: conversation.id,
      messageId: existingMsg.id,
      externalContactId: externalContact.id,
      duplicate: true,
      unmatched: !isLinked,
    };
  }

  const [inserted] = await db
    .insert(messagesTable)
    .values({
      conversationId: conversation.id,
      content: message.text,
      channel,
      direction: "inbound",
      status: "received",
      externalMessageId: message.externalMessageId,
      sentAt: message.receivedAt || new Date(),
      metadata: message.metadata || {},
    })
    .returning();

  await db
    .update(conversationsTable)
    .set({
      lastMessageAt: message.receivedAt || new Date(),
      lastMessagePreview: message.text.slice(0, 200),
      lastInboundAt: message.receivedAt || new Date(),
      status: "open",
      unmatched: !isLinked,
    })
    .where(eq(conversationsTable.id, conversation.id));

  if (channelAccountId) {
    await db
      .update(channelAccountsTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(channelAccountsTable.id, channelAccountId));
  }

  try {
    // Targeting:
    //   - if conversation has an assignee, send only to that user (assigned semantics).
    //   - else fall through to role-based routing in dispatchNotification.
    const recipientUserIds = conversation.assignedToId ? [conversation.assignedToId] : undefined;
    await dispatchNotification({
      event: !isLinked ? "inbox.unmatched" : "inbox.new_message",
      title: !isLinked
        ? `New ${channel} message — needs matching`
        : `New ${channel} message from ${contact.displayName || contact.phone || "contact"}`,
      body: message.text.slice(0, 280),
      actionUrl: `/staff/messages?conversation=${conversation.id}`,
      icon: "message",
      recipientUserIds,
      data: {
        conversationId: conversation.id,
        channel,
        unmatched: !isLinked,
        assignedToId: conversation.assignedToId || null,
      },
    });
  } catch (err) {
    console.error("[INBOX] Notification dispatch failed:", err);
  }

  return {
    conversationId: conversation.id,
    messageId: inserted.id,
    externalContactId: externalContact.id,
    duplicate: false,
    unmatched: !isLinked,
  };
}
