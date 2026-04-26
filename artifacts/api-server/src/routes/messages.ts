import { Router, type IRouter } from "express";
import {
  db,
  conversationsTable,
  conversationParticipantsTable,
  messagesTable,
  broadcastsTable,
  usersTable,
  notificationsTable,
  messageTemplatesTable,
  studentsTable,
  leadsTable,
  agentsTable,
  documentsTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray, ilike, or, isNull, ne } from "drizzle-orm";
import { requireAuth, requireRole, requireAgentStaffPermission, logAudit } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES } from "../lib/roles";

const router: IRouter = Router();

const STAFF_ROLE_LIST = ["super_admin", "admin", "manager", "staff", "consultant", "accountant", "editor"];

async function getVisibleUserIdsForStaff(staffUserId: number): Promise<number[]> {
  const visibleStudents = await db
    .select({ userId: studentsTable.userId, agentId: studentsTable.agentId })
    .from(studentsTable)
    .where(and(
      or(eq(studentsTable.assignedToId, staffUserId), isNull(studentsTable.assignedToId)),
      isNull(studentsTable.deletedAt)
    ));

  const visibleLeads = await db
    .select({ agentId: leadsTable.agentId })
    .from(leadsTable)
    .where(or(eq(leadsTable.assignedToId, staffUserId), isNull(leadsTable.assignedToId)));

  const studentUserIds = visibleStudents.map(s => s.userId).filter(Boolean) as number[];
  const agentIds = new Set<number>();
  for (const s of visibleStudents) { if (s.agentId) agentIds.add(s.agentId); }
  for (const l of visibleLeads) { if (l.agentId) agentIds.add(l.agentId); }

  const assignedAgents = await db
    .select({ id: agentsTable.id, userId: agentsTable.userId })
    .from(agentsTable)
    .where(eq(agentsTable.assignedStaffId, staffUserId));
  for (const a of assignedAgents) { agentIds.add(a.id); }

  let agentUserIds: number[] = [];
  if (agentIds.size > 0) {
    const agents = await db
      .select({ userId: agentsTable.userId })
      .from(agentsTable)
      .where(inArray(agentsTable.id, Array.from(agentIds)));
    agentUserIds = agents.map(a => a.userId).filter(Boolean) as number[];
  }

  const staffUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.isActive, true), inArray(usersTable.role, STAFF_ROLE_LIST)));
  const staffUserIds = staffUsers.map(u => u.id);

  return [...new Set([...staffUserIds, ...studentUserIds, ...agentUserIds, staffUserId])];
}

router.get("/conversations", requireAuth, requireRole(...STAFF_ROLES, ...ADMIN_ROLES), async (req, res): Promise<void> => {
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
      assignedToId: conversationsTable.assignedToId,
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

    const studentUserIds = participants.filter(p => p.role === "student" && !p.avatarUrl).map(p => p.userId);
    let photoMap: Record<number, string> = {};
    if (studentUserIds.length > 0) {
      const studentRows = await db
        .select({ userId: studentsTable.userId, studentId: studentsTable.id })
        .from(studentsTable)
        .where(and(inArray(studentsTable.userId, studentUserIds), isNull(studentsTable.deletedAt)));
      const studentIdMap: Record<number, number> = {};
      for (const s of studentRows) if (s.userId) studentIdMap[s.userId] = s.id;
      const sIds = studentRows.map(s => s.id);
      if (sIds.length > 0) {
        const photoDocs = await db
          .select({ studentId: documentsTable.studentId, fileData: documentsTable.fileData, mimeType: documentsTable.mimeType })
          .from(documentsTable)
          .where(and(
            inArray(documentsTable.studentId, sIds),
            or(eq(documentsTable.type, "photo"), eq(documentsTable.type, "photograph")),
            isNull(documentsTable.deletedAt)
          ))
          .orderBy(desc(documentsTable.createdAt));
        const seen = new Set<number>();
        for (const pd of photoDocs) {
          if (pd.studentId && !seen.has(pd.studentId) && pd.fileData) {
            seen.add(pd.studentId);
            const mime = pd.mimeType || "image/jpeg";
            photoMap[pd.studentId] = `data:${mime};base64,${pd.fileData}`;
          }
        }
      }
      for (const p of participants) {
        if (p.role === "student" && !p.avatarUrl && studentIdMap[p.userId]) {
          const url = photoMap[studentIdMap[p.userId]];
          if (url) (p as any).avatarUrl = url;
        }
      }
    }

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
            sql`${messagesTable.senderId} != ${userId}`,
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

router.post("/conversations", requireAuth, requireRole(...STAFF_ROLES, ...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { type = "direct", title, participantIds } = req.body;
  const userId = req.user!.id;

  if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
    res.status(400).json({ error: "At least one participant is required" });
    return;
  }

  const isAdminUser = (ADMIN_ROLES as readonly string[]).includes(req.user!.role);
  if (!isAdminUser) {
    const visibleIds = await getVisibleUserIdsForStaff(userId);
    const unauthorized = participantIds.filter((pid: number) => !visibleIds.includes(pid));
    if (unauthorized.length > 0) {
      res.status(403).json({ error: "You cannot start a conversation with one or more of these users" });
      return;
    }
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

router.get("/conversations/:id/messages", requireAuth, requireRole(...STAFF_ROLES, ...ADMIN_ROLES), async (req, res): Promise<void> => {
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

  const reversed = messages.reverse();
  const studentSenders = reversed.filter(m => m.senderRole === "student" && !m.senderAvatarUrl && m.senderId);
  if (studentSenders.length > 0) {
    const senderIds = [...new Set(studentSenders.map(m => m.senderId!))];
    const studentRows = await db
      .select({ userId: studentsTable.userId, studentId: studentsTable.id })
      .from(studentsTable)
      .where(and(inArray(studentsTable.userId, senderIds), isNull(studentsTable.deletedAt)));
    const sidMap: Record<number, number> = {};
    for (const s of studentRows) if (s.userId) sidMap[s.userId] = s.id;
    const sIds = Object.values(sidMap);
    if (sIds.length > 0) {
      const photoDocs = await db
        .select({ studentId: documentsTable.studentId, fileData: documentsTable.fileData, mimeType: documentsTable.mimeType })
        .from(documentsTable)
        .where(and(
          inArray(documentsTable.studentId, sIds),
          or(eq(documentsTable.type, "photo"), eq(documentsTable.type, "photograph")),
          isNull(documentsTable.deletedAt)
        ))
        .orderBy(desc(documentsTable.createdAt));
      const pMap: Record<number, string> = {};
      const seen = new Set<number>();
      for (const pd of photoDocs) {
        if (pd.studentId && !seen.has(pd.studentId) && pd.fileData) {
          seen.add(pd.studentId);
          pMap[pd.studentId] = `data:${pd.mimeType || "image/jpeg"};base64,${pd.fileData}`;
        }
      }
      for (const m of reversed) {
        if (m.senderRole === "student" && !m.senderAvatarUrl && m.senderId && sidMap[m.senderId]) {
          (m as any).senderAvatarUrl = pMap[sidMap[m.senderId]] || null;
        }
      }
    }
  }

  res.json({ data: reversed });
});

router.post("/conversations/:id/messages", requireAuth, requireRole(...STAFF_ROLES, ...ADMIN_ROLES), async (req, res): Promise<void> => {
  const conversationId = parseInt(req.params.id, 10);
  const userId = req.user!.id;
  const { content, channel = "internal", replyToId, metadata } = req.body;

  const hasAttachment = metadata?.attachment?.fileName;
  if ((!content || !content.trim()) && !hasAttachment) {
    res.status(400).json({ error: "Message content or attachment is required" });
    return;
  }

  if (hasAttachment) {
    const att = metadata.attachment;
    if (!att.fileUrl || typeof att.fileUrl !== "string" || !att.fileUrl.startsWith("/api/storage/objects/")) {
      res.status(400).json({ error: "Invalid attachment URL" });
      return;
    }
    if (typeof att.fileSize !== "number" || att.fileSize <= 0 || att.fileSize > 25 * 1024 * 1024) {
      res.status(400).json({ error: "Invalid attachment size" });
      return;
    }
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

  const messageContent = content?.trim() || (hasAttachment ? `📎 ${metadata.attachment.fileName}` : "");

  const [message] = await db
    .insert(messagesTable)
    .values({
      conversationId,
      senderId: userId,
      content: messageContent,
      channel,
      status: "sent",
      replyToId: replyToId || null,
      metadata: metadata || {},
    })
    .returning();

  const preview = hasAttachment ? `📎 ${metadata.attachment.fileName}` : messageContent.substring(0, 100);
  await db
    .update(conversationsTable)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: preview,
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

  const otherParticipants = await db
    .select({ userId: conversationParticipantsTable.userId })
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        sql`${conversationParticipantsTable.userId} != ${userId}`
      )
    );

  const senderName = req.user!.firstName + " " + req.user!.lastName;
  const recipientUsers = otherParticipants.length > 0
    ? await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(inArray(usersTable.id, otherParticipants.map(p => p.userId)))
    : [];
  const recipientRoleMap = new Map(recipientUsers.map(u => [u.id, u.role]));
  for (const p of otherParticipants) {
    const role = recipientRoleMap.get(p.userId);
    const actionUrl = role === "student" ? `/student/messages` : `/staff/messages`;
    await db.insert(notificationsTable).values({
      userId: p.userId,
      type: "message.new",
      title: `New message from ${senderName}`,
      body: messageContent.substring(0, 150),
      icon: "message-circle",
      actionUrl,
      channel: "in_app",
      data: { conversationId, messageId: message.id },
    });
  }

  res.status(201).json(message);
});

router.get("/conversations/:id/participants", requireAuth, requireRole(...STAFF_ROLES, ...ADMIN_ROLES), async (req, res): Promise<void> => {
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

router.get("/users-search", requireAuth, requireRole(...STAFF_ROLES, ...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { search, limit = "20" } = req.query as Record<string, string>;
  const user = req.user!;
  const isAdminUser = (ADMIN_ROLES as readonly string[]).includes(user.role);

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

  if (!isAdminUser) {
    const visibleIds = await getVisibleUserIdsForStaff(user.id);
    if (visibleIds.length > 0) {
      conditions.push(inArray(usersTable.id, visibleIds));
    } else {
      conditions.push(eq(usersTable.id, user.id));
    }
  }

  conditions.push(ne(usersTable.id, user.id));

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

/* ─── QUICK CONTACT ────────────────────────────────────────── */

async function createQuickContactConversation(
  userId: number, title: string, channel: string, status: string,
  content: string, metadata: Record<string, any>, recipientUserId?: number | null
) {
  if (recipientUserId && channel === "internal") {
    const existingParticipations = await db
      .select({ conversationId: conversationParticipantsTable.conversationId })
      .from(conversationParticipantsTable)
      .where(eq(conversationParticipantsTable.userId, userId));
    for (const e of existingParticipations) {
      const conv = await db.select().from(conversationsTable).where(
        and(eq(conversationsTable.id, e.conversationId), eq(conversationsTable.type, "direct"))
      );
      if (conv.length > 0) {
        const otherP = await db.select().from(conversationParticipantsTable).where(
          and(eq(conversationParticipantsTable.conversationId, e.conversationId), eq(conversationParticipantsTable.userId, recipientUserId))
        );
        if (otherP.length > 0) {
          await db.insert(messagesTable).values({ conversationId: conv[0].id, senderId: userId, content, channel, status, metadata });
          await db.update(conversationsTable)
            .set({ lastMessageAt: new Date(), lastMessagePreview: content.substring(0, 200) })
            .where(eq(conversationsTable.id, conv[0].id));
          return conv[0];
        }
      }
    }
  }

  const [conv] = await db
    .insert(conversationsTable)
    .values({ type: "direct", title, createdById: userId })
    .returning();
  await db.insert(conversationParticipantsTable).values({ conversationId: conv.id, userId });
  if (recipientUserId && recipientUserId !== userId) {
    await db.insert(conversationParticipantsTable).values({ conversationId: conv.id, userId: recipientUserId });
  }
  await db.insert(messagesTable).values({
    conversationId: conv.id, senderId: userId, content,
    channel, status, metadata,
  });
  await db.update(conversationsTable)
    .set({ lastMessageAt: new Date(), lastMessagePreview: content.substring(0, 200) })
    .where(eq(conversationsTable.id, conv.id));
  return conv;
}

router.post("/quick-contact", requireAuth, requireRole(...STAFF_ROLES, ...ADMIN_ROLES), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { channel, recipientName, recipientEmail, recipientPhone, subject, message, entityType, entityId } = req.body;

  if (!channel || !message) {
    res.status(400).json({ error: "channel and message are required" });
    return;
  }
  if (channel === "email" && !recipientEmail) {
    res.status(400).json({ error: "recipientEmail is required for email channel" });
    return;
  }
  if (channel === "whatsapp" && !recipientPhone) {
    res.status(400).json({ error: "recipientPhone is required for WhatsApp channel" });
    return;
  }

  try {
    const entityLabel = entityType ? entityType.charAt(0).toUpperCase() + entityType.slice(1) : "Contact";
    let conv;
    let note: string | undefined;

    let recipientUserId: number | null = null;
    if (entityType === "student" && entityId) {
      const [s] = await db.select({ userId: studentsTable.userId }).from(studentsTable).where(eq(studentsTable.id, parseInt(String(entityId), 10)));
      if (s?.userId) recipientUserId = s.userId;
    } else if (entityType === "lead" && entityId && recipientEmail) {
      const [u] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, recipientEmail));
      if (u) recipientUserId = u.id;
    }

    if (channel === "internal") {
      const title = `${entityLabel}: ${recipientName}`;
      conv = await createQuickContactConversation(
        userId, title, "internal", "sent", message,
        { entityType, entityId, recipientName, recipientEmail, recipientPhone },
        recipientUserId
      );
    } else if (channel === "email") {
      const title = `Email to ${recipientName}: ${subject || "(no subject)"}`;
      conv = await createQuickContactConversation(
        userId, title, "email", "queued", message,
        { entityType, entityId, recipientName, recipientEmail, subject },
        recipientUserId
      );
      note = "Email queued for delivery";
    } else if (channel === "whatsapp") {
      const title = `WhatsApp to ${recipientName}`;
      conv = await createQuickContactConversation(
        userId, title, "whatsapp", "queued", message,
        { entityType, entityId, recipientName, recipientPhone },
        recipientUserId
      );
      note = "WhatsApp message queued";
    } else {
      res.status(400).json({ error: "Unsupported channel" });
      return;
    }

    await logAudit(userId, "quick_contact", entityType, entityId, { channel, recipientName }, req.ip);
    res.json({ success: true, conversationId: conv.id, ...(note ? { note } : {}) });
  } catch (err: any) {
    console.error("Quick contact error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

/* ─── MESSAGE TEMPLATES ─────────────────────────────────────── */

router.get("/message-templates", requireAuth, requireRole(...ADMIN_ROLES, ...STAFF_ROLES), async (req, res): Promise<void> => {
  const { category, channel, language, activeOnly } = req.query as Record<string, string>;
  const conditions: any[] = [];
  if (category) conditions.push(eq(messageTemplatesTable.category, category));
  if (channel && channel !== "all") conditions.push(
    or(eq(messageTemplatesTable.channel, channel), eq(messageTemplatesTable.channel, "all"))
  );
  if (language) conditions.push(eq(messageTemplatesTable.language, language));
  if (activeOnly === "true") conditions.push(eq(messageTemplatesTable.isActive, true));

  const templates = await db
    .select({
      id: messageTemplatesTable.id,
      name: messageTemplatesTable.name,
      category: messageTemplatesTable.category,
      subject: messageTemplatesTable.subject,
      content: messageTemplatesTable.content,
      channel: messageTemplatesTable.channel,
      language: messageTemplatesTable.language,
      variables: messageTemplatesTable.variables,
      isActive: messageTemplatesTable.isActive,
      createdById: messageTemplatesTable.createdById,
      createdAt: messageTemplatesTable.createdAt,
      updatedAt: messageTemplatesTable.updatedAt,
      creatorFirstName: usersTable.firstName,
      creatorLastName: usersTable.lastName,
    })
    .from(messageTemplatesTable)
    .leftJoin(usersTable, eq(messageTemplatesTable.createdById, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(messageTemplatesTable.category, messageTemplatesTable.name);

  res.json({ data: templates });
});

router.post("/message-templates", requireAuth, requireRole(...ADMIN_ROLES, ...STAFF_ROLES), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { name, category, subject, content, channel, language, variables } = req.body;

  if (!name || !content) {
    res.status(400).json({ error: "Name and content are required" });
    return;
  }

  const [template] = await db
    .insert(messageTemplatesTable)
    .values({
      name, content,
      category: category || "general",
      subject: subject || null,
      channel: channel || "all",
      language: language || "en",
      variables: variables || [],
      createdById: userId,
    })
    .returning();

  await logAudit(userId, "create_message_template", "message_template", template.id, { name, category }, req.ip);
  res.status(201).json(template);
});

router.patch("/message-templates/:id", requireAuth, requireRole(...ADMIN_ROLES, ...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const updates: Record<string, unknown> = {};

  const allowed = ["name", "category", "subject", "content", "channel", "language", "variables", "isActive"];
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [template] = await db
    .update(messageTemplatesTable)
    .set(updates)
    .where(eq(messageTemplatesTable.id, id))
    .returning();

  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  await logAudit(req.user!.id, "update_message_template", "message_template", id, updates, req.ip);
  res.json(template);
});

router.delete("/message-templates/:id", requireAuth, requireRole(...ADMIN_ROLES, ...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [deleted] = await db
    .delete(messageTemplatesTable)
    .where(eq(messageTemplatesTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  await logAudit(req.user!.id, "delete_message_template", "message_template", id, { name: deleted.name }, req.ip);
  res.json({ success: true });
});

router.get("/student/conversations", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  if (req.user!.role !== "student") { res.status(403).json({ error: "Students only" }); return; }

  const myParticipations = await db
    .select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userId));

  if (myParticipations.length === 0) { res.json({ data: [] }); return; }

  const convIds = myParticipations.map(p => p.conversationId);
  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(inArray(conversationsTable.id, convIds))
    .orderBy(desc(conversationsTable.lastMessageAt));

  const result = [];
  for (const conv of conversations) {
    const participants = await db
      .select({ userId: conversationParticipantsTable.userId, firstName: usersTable.firstName, lastName: usersTable.lastName, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
      .from(conversationParticipantsTable)
      .innerJoin(usersTable, eq(conversationParticipantsTable.userId, usersTable.id))
      .where(eq(conversationParticipantsTable.conversationId, conv.id));

    const lastMsg = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(desc(messagesTable.createdAt)).limit(1);

    const unread = await db.select({ count: sql<number>`count(*)::int` }).from(messagesTable)
      .where(and(eq(messagesTable.conversationId, conv.id), ne(messagesTable.senderId, userId), eq(messagesTable.status, "sent")));

    result.push({ ...conv, participants, lastMessage: lastMsg[0] || null, unreadCount: unread[0]?.count || 0 });
  }
  res.json({ data: result });
});

router.get("/student/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "student") { res.status(403).json({ error: "Students only" }); return; }
  const userId = req.user!.id;
  const conversationId = parseInt(req.params.id, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversation id" }); return; }

  const participation = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, userId)));
  if (participation.length === 0) { res.status(403).json({ error: "Not a participant" }); return; }

  const messages = await db.select({
    id: messagesTable.id, conversationId: messagesTable.conversationId, content: messagesTable.content,
    channel: messagesTable.channel, status: messagesTable.status, createdAt: messagesTable.createdAt,
    metadata: messagesTable.metadata,
    senderId: messagesTable.senderId, senderFirstName: usersTable.firstName, senderLastName: usersTable.lastName,
    senderRole: usersTable.role, senderAvatarUrl: usersTable.avatarUrl,
  })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(desc(messagesTable.createdAt));

  await db.update(messagesTable)
    .set({ status: "read" })
    .where(and(eq(messagesTable.conversationId, conversationId), ne(messagesTable.senderId, userId), eq(messagesTable.status, "sent")));

  res.json({ data: messages });
});

router.post("/student/conversations", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "student") { res.status(403).json({ error: "Students only" }); return; }
  const userId = req.user!.id;

  const [student] = await db.select().from(studentsTable).where(eq(studentsTable.userId, userId));
  if (!student || !student.assignedToId) { res.status(400).json({ error: "No advisor assigned" }); return; }

  const advisorId = student.assignedToId;
  const myConvs = await db.select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable).where(eq(conversationParticipantsTable.userId, userId));

  for (const mc of myConvs) {
    const [conv] = await db.select().from(conversationsTable)
      .where(and(eq(conversationsTable.id, mc.conversationId), eq(conversationsTable.type, "direct")));
    if (conv) {
      const advisorP = await db.select().from(conversationParticipantsTable)
        .where(and(eq(conversationParticipantsTable.conversationId, conv.id), eq(conversationParticipantsTable.userId, advisorId)));
      if (advisorP.length > 0) {
        res.json(conv);
        return;
      }
    }
  }

  const [conv] = await db.insert(conversationsTable).values({ type: "direct", createdById: userId }).returning();
  await db.insert(conversationParticipantsTable).values({ conversationId: conv.id, userId });
  await db.insert(conversationParticipantsTable).values({ conversationId: conv.id, userId: advisorId });
  res.status(201).json(conv);
});

router.post("/student/conversations/:id/messages", requireAuth, async (req, res): Promise<void> => {
  if (req.user!.role !== "student") { res.status(403).json({ error: "Students only" }); return; }
  const userId = req.user!.id;
  const conversationId = parseInt(req.params.id, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversation id" }); return; }
  const { content, metadata } = req.body;

  const hasAttachment = metadata?.attachment?.fileName;
  if ((!content || !content.trim()) && !hasAttachment) { res.status(400).json({ error: "Message content or attachment is required" }); return; }

  if (hasAttachment) {
    const att = metadata.attachment;
    if (!att.fileUrl || typeof att.fileUrl !== "string" || !att.fileUrl.startsWith("/api/storage/objects/")) {
      res.status(400).json({ error: "Invalid attachment URL" }); return;
    }
    if (typeof att.fileSize !== "number" || att.fileSize <= 0 || att.fileSize > 25 * 1024 * 1024) {
      res.status(400).json({ error: "Invalid attachment size" }); return;
    }
  }

  const participation = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, userId)));
  if (participation.length === 0) { res.status(403).json({ error: "Not a participant" }); return; }

  const messageContent = content?.trim() || (hasAttachment ? `📎 ${metadata.attachment.fileName}` : "");

  const [message] = await db.insert(messagesTable).values({
    conversationId, senderId: userId, content: messageContent, channel: "internal", status: "sent", metadata: metadata || {},
  }).returning();

  const preview = hasAttachment ? `📎 ${metadata.attachment.fileName}` : messageContent.substring(0, 100);
  await db.update(conversationsTable).set({ lastMessageAt: new Date(), lastMessagePreview: preview }).where(eq(conversationsTable.id, conversationId));

  const otherParticipants = await db
    .select({ odUserId: conversationParticipantsTable.userId })
    .from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), sql`${conversationParticipantsTable.userId} != ${userId}`));

  const senderUser = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(eq(usersTable.id, userId));
  const senderName = senderUser[0] ? `${senderUser[0].firstName} ${senderUser[0].lastName}` : "Student";
  for (const p of otherParticipants) {
    await db.insert(notificationsTable).values({
      userId: p.odUserId,
      type: "message.new",
      title: `New message from ${senderName}`,
      body: messageContent.substring(0, 150),
      icon: "message-circle",
      actionUrl: `/staff/messages`,
      channel: "in_app",
      data: { conversationId, messageId: message.id },
    });
  }

  res.status(201).json(message);
});

const AGENT_ROLE_LIST = ["agent", "sub_agent", "agent_staff"];

async function getAgentContactUserIds(userId: number, userRole: string): Promise<Set<number>> {
  let agentRec;
  if (userRole === "agent_staff") {
    const [staffUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!staffUser?.managingAgentId) return new Set();
    [agentRec] = await db.select().from(agentsTable).where(eq(agentsTable.id, staffUser.managingAgentId));
  } else {
    [agentRec] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  }
  if (!agentRec) return new Set();

  const contactUserIds = new Set<number>();

  if (userRole === "sub_agent") {
    if (agentRec.parentAgentId) {
      const [parentAgent] = await db.select({ userId: agentsTable.userId }).from(agentsTable).where(eq(agentsTable.id, agentRec.parentAgentId));
      if (parentAgent?.userId) contactUserIds.add(parentAgent.userId);
    }
    const myStudents = await db
      .select({ userId: studentsTable.userId })
      .from(studentsTable)
      .where(and(eq(studentsTable.agentId, agentRec.id), isNull(studentsTable.deletedAt)));
    for (const s of myStudents) { if (s.userId) contactUserIds.add(s.userId); }
  } else {
    if (agentRec.assignedStaffId) {
      contactUserIds.add(agentRec.assignedStaffId);
    }
    const agentIds = [agentRec.id];
    const subAgents = await db.select({ id: agentsTable.id }).from(agentsTable).where(eq(agentsTable.parentAgentId, agentRec.id));
    for (const sa of subAgents) agentIds.push(sa.id);

    const myStudents = await db
      .select({ userId: studentsTable.userId })
      .from(studentsTable)
      .where(and(inArray(studentsTable.agentId, agentIds), isNull(studentsTable.deletedAt)));
    for (const s of myStudents) { if (s.userId) contactUserIds.add(s.userId); }
  }

  contactUserIds.delete(userId);
  return contactUserIds;
}

router.get("/agent/conversations", requireAuth, requireAgentStaffPermission("messages"), async (req, res): Promise<void> => {
  const userId = req.user!.id;
  if (!AGENT_ROLE_LIST.includes(req.user!.role)) { res.status(403).json({ error: "Agents only" }); return; }

  const myParticipations = await db
    .select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userId));

  if (myParticipations.length === 0) { res.json({ data: [] }); return; }

  const convIds = myParticipations.map(p => p.conversationId);
  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(inArray(conversationsTable.id, convIds))
    .orderBy(desc(conversationsTable.lastMessageAt));

  const result = [];
  for (const conv of conversations) {
    const participants = await db
      .select({ userId: conversationParticipantsTable.userId, firstName: usersTable.firstName, lastName: usersTable.lastName, role: usersTable.role, avatarUrl: usersTable.avatarUrl })
      .from(conversationParticipantsTable)
      .innerJoin(usersTable, eq(conversationParticipantsTable.userId, usersTable.id))
      .where(eq(conversationParticipantsTable.conversationId, conv.id));

    const lastMsg = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(desc(messagesTable.createdAt)).limit(1);

    const unread = await db.select({ count: sql<number>`count(*)::int` }).from(messagesTable)
      .where(and(eq(messagesTable.conversationId, conv.id), ne(messagesTable.senderId, userId), eq(messagesTable.status, "sent")));

    result.push({ ...conv, participants, lastMessage: lastMsg[0] || null, unreadCount: unread[0]?.count || 0 });
  }
  res.json({ data: result });
});

router.get("/agent/conversations/:id/messages", requireAuth, requireAgentStaffPermission("messages"), async (req, res): Promise<void> => {
  if (!AGENT_ROLE_LIST.includes(req.user!.role)) { res.status(403).json({ error: "Agents only" }); return; }
  const userId = req.user!.id;
  const conversationId = parseInt(req.params.id, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversation id" }); return; }

  const participation = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, userId)));
  if (participation.length === 0) { res.status(403).json({ error: "Not a participant" }); return; }

  const messages = await db.select({
    id: messagesTable.id, conversationId: messagesTable.conversationId, content: messagesTable.content,
    channel: messagesTable.channel, status: messagesTable.status, createdAt: messagesTable.createdAt,
    metadata: messagesTable.metadata,
    senderId: messagesTable.senderId, senderFirstName: usersTable.firstName, senderLastName: usersTable.lastName,
    senderRole: usersTable.role, senderAvatarUrl: usersTable.avatarUrl,
  })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(desc(messagesTable.createdAt));

  await db.update(messagesTable)
    .set({ status: "read" })
    .where(and(eq(messagesTable.conversationId, conversationId), ne(messagesTable.senderId, userId), eq(messagesTable.status, "sent")));

  res.json({ data: messages });
});

router.get("/agent/staff-contacts", requireAuth, requireAgentStaffPermission("messages"), async (req, res): Promise<void> => {
  if (!AGENT_ROLE_LIST.includes(req.user!.role)) { res.status(403).json({ error: "Agents only" }); return; }
  const userId = req.user!.id;
  const userRole = req.user!.role;

  const contactUserIds = await getAgentContactUserIds(userId, userRole);

  if (contactUserIds.size === 0) { res.json({ data: [] }); return; }

  const contacts = await db
    .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, role: usersTable.role, avatarUrl: usersTable.avatarUrl, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.isActive, true), inArray(usersTable.id, Array.from(contactUserIds))))
    .orderBy(usersTable.firstName);

  res.json({ data: contacts });
});

router.post("/agent/conversations", requireAuth, requireAgentStaffPermission("messages"), async (req, res): Promise<void> => {
  if (!AGENT_ROLE_LIST.includes(req.user!.role)) { res.status(403).json({ error: "Agents only" }); return; }
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const targetUserId = req.body.staffUserId || req.body.targetUserId;
  if (!targetUserId || typeof targetUserId !== "number") { res.status(400).json({ error: "targetUserId is required" }); return; }

  const [targetUser] = await db.select().from(usersTable).where(and(eq(usersTable.id, targetUserId), eq(usersTable.isActive, true)));
  if (!targetUser) { res.status(400).json({ error: "Invalid user" }); return; }

  const allowedContacts = await getAgentContactUserIds(userId, userRole);
  if (!allowedContacts.has(targetUserId)) { res.status(403).json({ error: "You cannot start a conversation with this user" }); return; }

  const myConvs = await db.select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable).where(eq(conversationParticipantsTable.userId, userId));

  for (const mc of myConvs) {
    const [conv] = await db.select().from(conversationsTable)
      .where(and(eq(conversationsTable.id, mc.conversationId), eq(conversationsTable.type, "direct")));
    if (conv) {
      const targetP = await db.select().from(conversationParticipantsTable)
        .where(and(eq(conversationParticipantsTable.conversationId, conv.id), eq(conversationParticipantsTable.userId, targetUserId)));
      if (targetP.length > 0) {
        res.json(conv);
        return;
      }
    }
  }

  const [conv] = await db.insert(conversationsTable).values({ type: "direct", createdById: userId }).returning();
  await db.insert(conversationParticipantsTable).values({ conversationId: conv.id, userId });
  await db.insert(conversationParticipantsTable).values({ conversationId: conv.id, userId: targetUserId });
  res.status(201).json(conv);
});

router.post("/agent/conversations/:id/messages", requireAuth, requireAgentStaffPermission("messages"), async (req, res): Promise<void> => {
  if (!AGENT_ROLE_LIST.includes(req.user!.role)) { res.status(403).json({ error: "Agents only" }); return; }
  const userId = req.user!.id;
  const conversationId = parseInt(req.params.id, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversation id" }); return; }
  const { content, metadata } = req.body;

  const hasAttachment = metadata?.attachment?.fileName;
  if ((!content || !content.trim()) && !hasAttachment) { res.status(400).json({ error: "Message content or attachment is required" }); return; }

  if (hasAttachment) {
    const att = metadata.attachment;
    if (!att.fileUrl || typeof att.fileUrl !== "string" || !att.fileUrl.startsWith("/api/storage/objects/")) {
      res.status(400).json({ error: "Invalid attachment URL" }); return;
    }
    if (typeof att.fileSize !== "number" || att.fileSize <= 0 || att.fileSize > 25 * 1024 * 1024) {
      res.status(400).json({ error: "Invalid attachment size" }); return;
    }
  }

  const participation = await db.select().from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.userId, userId)));
  if (participation.length === 0) { res.status(403).json({ error: "Not a participant" }); return; }

  const messageContent = content?.trim() || (hasAttachment ? `📎 ${metadata.attachment.fileName}` : "");

  const [message] = await db.insert(messagesTable).values({
    conversationId, senderId: userId, content: messageContent, channel: "internal", status: "sent", metadata: metadata || {},
  }).returning();

  const preview = hasAttachment ? `📎 ${metadata.attachment.fileName}` : messageContent.substring(0, 100);
  await db.update(conversationsTable).set({ lastMessageAt: new Date(), lastMessagePreview: preview }).where(eq(conversationsTable.id, conversationId));

  const otherParticipants = await db
    .select({ odUserId: conversationParticipantsTable.userId })
    .from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), sql`${conversationParticipantsTable.userId} != ${userId}`));

  const senderUser = await db.select({ firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(eq(usersTable.id, userId));
  const senderName = senderUser[0] ? `${senderUser[0].firstName} ${senderUser[0].lastName}` : "Agent";
  for (const p of otherParticipants) {
    await db.insert(notificationsTable).values({
      userId: p.odUserId,
      type: "message.new",
      title: `New message from ${senderName}`,
      body: messageContent.substring(0, 150),
      icon: "message-circle",
      actionUrl: `/staff/messages`,
      channel: "in_app",
      data: { conversationId, messageId: message.id },
    });
  }

  res.status(201).json(message);
});

export default router;
