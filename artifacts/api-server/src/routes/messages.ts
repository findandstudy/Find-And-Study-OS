import { Router, type IRouter } from "express";
import {
  db,
  conversationsTable,
  conversationParticipantsTable,
  messagesTable,
  broadcastsTable,
  usersTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray, ilike, or } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES } from "../lib/roles";

const router: IRouter = Router();

router.get("/conversations", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { search } = req.query as Record<string, string>;

  const myConvIds = db
    .select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userId));

  let query = db
    .select({
      id: conversationsTable.id,
      type: conversationsTable.type,
      title: conversationsTable.title,
      createdById: conversationsTable.createdById,
      isArchived: conversationsTable.isArchived,
      lastMessageAt: conversationsTable.lastMessageAt,
      lastMessagePreview: conversationsTable.lastMessagePreview,
      createdAt: conversationsTable.createdAt,
    })
    .from(conversationsTable)
    .where(
      and(
        inArray(conversationsTable.id, myConvIds),
        eq(conversationsTable.isArchived, false),
        search ? ilike(conversationsTable.title, `%${search}%`) : undefined
      )
    )
    .orderBy(desc(conversationsTable.lastMessageAt))
    .limit(50)
    .$dynamic();

  const conversations = await query;

  const convIds = conversations.map((c) => c.id);
  let participantsMap: Record<number, any[]> = {};
  if (convIds.length > 0) {
    const participants = await db
      .select({
        conversationId: conversationParticipantsTable.conversationId,
        userId: conversationParticipantsTable.userId,
        lastReadAt: conversationParticipantsTable.lastReadAt,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        avatarUrl: usersTable.avatarUrl,
        role: usersTable.role,
      })
      .from(conversationParticipantsTable)
      .innerJoin(usersTable, eq(conversationParticipantsTable.userId, usersTable.id))
      .where(inArray(conversationParticipantsTable.conversationId, convIds));

    for (const p of participants) {
      if (!participantsMap[p.conversationId]) participantsMap[p.conversationId] = [];
      participantsMap[p.conversationId].push(p);
    }
  }

  const unreadCounts = await db
    .select({
      conversationId: conversationParticipantsTable.conversationId,
      lastReadAt: conversationParticipantsTable.lastReadAt,
    })
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.userId, userId),
        inArray(conversationParticipantsTable.conversationId, convIds)
      )
    );

  const lastReadMap: Record<number, Date | null> = {};
  for (const u of unreadCounts) {
    lastReadMap[u.conversationId] = u.lastReadAt;
  }

  let unreadMap: Record<number, number> = {};
  if (convIds.length > 0) {
    for (const cid of convIds) {
      const lr = lastReadMap[cid];
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.conversationId, cid),
            lr ? sql`${messagesTable.createdAt} > ${lr}` : sql`1=1`
          )
        );
      unreadMap[cid] = Number(count);
    }
  }

  res.json({
    data: conversations.map((c) => ({
      ...c,
      participants: participantsMap[c.id] || [],
      unreadCount: unreadMap[c.id] || 0,
    })),
  });
});

router.post("/conversations", requireAuth, async (req, res): Promise<void> => {
  const { type = "direct", title, participantIds } = req.body;
  const userId = req.user!.id;

  if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
    res.status(400).json({ error: "At least one participant is required" });
    return;
  }

  if (type === "direct" && participantIds.length === 1) {
    const otherId = participantIds[0];
    const existing = await db
      .select({ conversationId: conversationParticipantsTable.conversationId })
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.userId, userId));

    for (const e of existing) {
      const conv = await db.select().from(conversationsTable).where(
        and(eq(conversationsTable.id, e.conversationId), eq(conversationsTable.type, "direct"))
      );
      if (conv.length > 0) {
        const otherP = await db.select().from(conversationParticipantsTable).where(
          and(
            eq(conversationParticipantsTable.conversationId, e.conversationId),
            eq(conversationParticipantsTable.userId, otherId)
          )
        );
        if (otherP.length > 0) {
          res.json(conv[0]);
          return;
        }
      }
    }
  }

  const [conv] = await db
    .insert(conversationsTable)
    .values({ type, title: title || null, createdById: userId })
    .returning();

  const allParticipants = [...new Set([userId, ...participantIds])];
  for (const pid of allParticipants) {
    await db.insert(conversationParticipantsTable).values({
      conversationId: conv.id,
      userId: pid,
    });
  }

  res.status(201).json(conv);
});

router.get("/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const conversationId = parseInt(req.params.id, 10);
  const userId = req.user!.id;
  const { limit = "50", before } = req.query as Record<string, string>;

  const participant = await db
    .select()
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, userId)
      )
    );

  if (participant.length === 0) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }

  const conditions = [eq(messagesTable.conversationId, conversationId)];
  if (before) {
    conditions.push(sql`${messagesTable.id} < ${parseInt(before, 10)}`);
  }

  const messages = await db
    .select({
      id: messagesTable.id,
      conversationId: messagesTable.conversationId,
      senderId: messagesTable.senderId,
      content: messagesTable.content,
      channel: messagesTable.channel,
      status: messagesTable.status,
      replyToId: messagesTable.replyToId,
      metadata: messagesTable.metadata,
      createdAt: messagesTable.createdAt,
      senderFirstName: usersTable.firstName,
      senderLastName: usersTable.lastName,
      senderAvatarUrl: usersTable.avatarUrl,
      senderRole: usersTable.role,
    })
    .from(messagesTable)
    .leftJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(messagesTable.id))
    .limit(parseInt(limit, 10));

  await db
    .update(conversationParticipantsTable)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, userId)
      )
    );

  res.json({ data: messages.reverse() });
});

router.post("/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const conversationId = parseInt(req.params.id, 10);
  const userId = req.user!.id;
  const { content, channel = "internal", replyToId, metadata } = req.body;

  if (!content || !content.trim()) {
    res.status(400).json({ error: "Message content is required" });
    return;
  }

  const participant = await db
    .select()
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, userId)
      )
    );

  if (participant.length === 0) {
    res.status(403).json({ error: "Not a participant" });
    return;
  }

  const [message] = await db
    .insert(messagesTable)
    .values({
      conversationId,
      senderId: userId,
      content: content.trim(),
      channel,
      status: "sent",
      replyToId: replyToId || null,
      metadata: metadata || {},
    })
    .returning();

  await db
    .update(conversationsTable)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: content.trim().substring(0, 100),
    })
    .where(eq(conversationsTable.id, conversationId));

  await db
    .update(conversationParticipantsTable)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, userId)
      )
    );

  res.status(201).json(message);
});

router.get("/conversations/:id/participants", requireAuth, async (req, res): Promise<void> => {
  const conversationId = parseInt(req.params.id, 10);
  const userId = req.user!.id;

  const [membership] = await db
    .select()
    .from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.userId, userId)
    ))
    .limit(1);

  if (!membership) {
    res.status(403).json({ error: "Not a participant of this conversation" });
    return;
  }

  const participants = await db
    .select({
      userId: conversationParticipantsTable.userId,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      avatarUrl: usersTable.avatarUrl,
      role: usersTable.role,
      email: usersTable.email,
      joinedAt: conversationParticipantsTable.joinedAt,
    })
    .from(conversationParticipantsTable)
    .innerJoin(usersTable, eq(conversationParticipantsTable.userId, usersTable.id))
    .where(eq(conversationParticipantsTable.conversationId, conversationId));

  res.json({ data: participants });
});

router.get("/users-search", requireAuth, async (req, res): Promise<void> => {
  const { search, limit = "20" } = req.query as Record<string, string>;
  const conditions = [eq(usersTable.isActive, true)];
  if (search) {
    conditions.push(
      or(
        ilike(usersTable.firstName, `%${search}%`),
        ilike(usersTable.lastName, `%${search}%`),
        ilike(usersTable.email, `%${search}%`)
      )!
    );
  }
  const users = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      role: usersTable.role,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .where(and(...conditions))
    .limit(parseInt(limit, 10))
    .orderBy(usersTable.firstName);

  res.json({ data: users });
});

router.post("/broadcasts", requireAuth, requireRole(...ADMIN_ROLES, ...STAFF_ROLES), async (req, res): Promise<void> => {
  const { title, content, channel = "internal", targetAudience = "all", targetRoles } = req.body;
  const userId = req.user!.id;

  if (!title || !content) {
    res.status(400).json({ error: "Title and content are required" });
    return;
  }

  let conditions: any[] = [eq(usersTable.isActive, true)];
  if (targetAudience === "role" && targetRoles?.length > 0) {
    conditions.push(inArray(usersTable.role, targetRoles));
  }

  const recipients = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(...conditions));

  const [broadcast] = await db
    .insert(broadcastsTable)
    .values({
      title,
      content,
      channel,
      targetAudience,
      targetRoles: targetRoles || [],
      status: "sent",
      sentAt: new Date(),
      sentById: userId,
      recipientCount: recipients.length,
    })
    .returning();

  for (const r of recipients) {
    await db.insert(notificationsTable).values({
      userId: r.id,
      type: "system.broadcast",
      title,
      body: content,
      icon: "megaphone",
      channel: "in_app",
      data: { broadcastId: broadcast.id, channel },
    });
  }

  await logAudit(userId, "send_broadcast", "broadcast", broadcast.id, { recipientCount: recipients.length, channel }, req.ip);
  res.status(201).json({ ...broadcast, recipientCount: recipients.length });
});

router.get("/broadcasts", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  const broadcasts = await db
    .select({
      id: broadcastsTable.id,
      title: broadcastsTable.title,
      content: broadcastsTable.content,
      channel: broadcastsTable.channel,
      targetAudience: broadcastsTable.targetAudience,
      targetRoles: broadcastsTable.targetRoles,
      status: broadcastsTable.status,
      sentAt: broadcastsTable.sentAt,
      recipientCount: broadcastsTable.recipientCount,
      senderFirstName: usersTable.firstName,
      senderLastName: usersTable.lastName,
      createdAt: broadcastsTable.createdAt,
    })
    .from(broadcastsTable)
    .leftJoin(usersTable, eq(broadcastsTable.sentById, usersTable.id))
    .orderBy(desc(broadcastsTable.createdAt))
    .limit(50);

  res.json({ data: broadcasts });
});

export default router;
