import {
  db,
  conversationsTable,
  messagesTable,
  externalContactsTable,
  channelAccountsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
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
        metadata: { source: channel },
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
    await dispatchNotification({
      event: !isLinked ? "inbox.unmatched_inbound" : "inbox.inbound_message",
      title: !isLinked
        ? `New ${channel} message — needs matching`
        : `New ${channel} message from ${contact.displayName || contact.phone || "contact"}`,
      body: message.text.slice(0, 280),
      actionUrl: `/staff/messages?conversation=${conversation.id}`,
      icon: "message",
      data: {
        conversationId: conversation.id,
        channel,
        unmatched: !isLinked,
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
