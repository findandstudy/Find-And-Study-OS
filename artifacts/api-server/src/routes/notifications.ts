import { Router, type IRouter } from "express";
import {
  db,
  notificationsTable,
  notificationRulesTable,
} from "@workspace/db";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";
import {
  DEFAULT_NOTIFICATION_RULES,
  NOTIFICATION_EVENTS,
  NOTIFICATION_CHANNELS,
} from "@workspace/db";

const router: IRouter = Router();

async function seedNotificationRules() {
  const existing = await db.select().from(notificationRulesTable);
  const existingEvents = new Set(existing.map(r => r.event));

  let added = 0;
  for (const rule of DEFAULT_NOTIFICATION_RULES) {
    if (existingEvents.has(rule.event)) continue;
    await db.insert(notificationRulesTable).values({
      event: rule.event,
      name: rule.name,
      category: rule.category,
      channels: rule.channels,
      recipientType: rule.recipientType,
      recipientRoles: rule.recipientRoles,
      isActive: true,
    });
    added++;
  }
  if (added > 0) console.log(`[notifications] Seeded ${added} new notification rules`);
}

seedNotificationRules().catch((err) => console.error("[notifications] Seed error:", err));

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { limit = "20", unreadOnly } = req.query as Record<string, string>;

  const conditions = [eq(notificationsTable.userId, userId)];
  if (unreadOnly === "true") {
    conditions.push(eq(notificationsTable.isRead, false));
  }

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(and(...conditions))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(parseInt(limit, 10));

  res.json({ data: notifications });
});

router.get("/notifications/unread-count", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));

  res.json({ count: Number(count) });
});

router.get("/notifications/section-counts", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const rows = await db
    .select({
      type: notificationsTable.type,
      actionUrl: notificationsTable.actionUrl,
      data: notificationsTable.data,
    })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));

  const sections: Record<string, number> = { leads: 0, students: 0, applications: 0 };
  for (const row of rows) {
    const t = row.type || "";
    const url = row.actionUrl || "";
    const resourceType = (row.data as any)?.resourceType || "";

    if (t.startsWith("lead.") || resourceType === "lead" || url.includes("/leads/")) {
      sections.leads++;
    } else if (t.startsWith("student.") || t.startsWith("document.") || resourceType === "student" || url.includes("/students/")) {
      sections.students++;
    } else if (t.startsWith("application.") || resourceType === "application" || url.includes("/applications/")) {
      sections.applications++;
    }
  }
  res.json(sections);
});

router.patch("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const userId = req.user!.id;

  const [notification] = await db
    .update(notificationsTable)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)))
    .returning();

  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(notification);
});

router.post("/notifications/mark-all-read", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  await db
    .update(notificationsTable)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));

  res.json({ success: true });
});

router.get("/notification-rules", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  const rules = await db
    .select()
    .from(notificationRulesTable)
    .orderBy(notificationRulesTable.category, notificationRulesTable.event);

  res.json({ data: rules });
});

router.get("/notification-rules/schema", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  res.json({
    events: NOTIFICATION_EVENTS,
    channels: NOTIFICATION_CHANNELS,
  });
});

router.patch("/notification-rules/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const updates: Record<string, unknown> = {};

  if (req.body.channels !== undefined) updates.channels = req.body.channels;
  if (req.body.recipientType !== undefined) updates.recipientType = req.body.recipientType;
  if (req.body.recipientRoles !== undefined) updates.recipientRoles = req.body.recipientRoles;
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
  if (req.body.template !== undefined) updates.template = req.body.template;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [rule] = await db
    .update(notificationRulesTable)
    .set(updates)
    .where(eq(notificationRulesTable.id, id))
    .returning();

  if (!rule) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }

  await logAudit(req.user!.id, "update_notification_rule", "notification_rule", id, updates, req.ip);
  res.json(rule);
});

router.post("/notification-rules", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { event, name, category, channels, recipientType, recipientRoles, template } = req.body;

  if (!event || !name) {
    res.status(400).json({ error: "Event and name are required" });
    return;
  }

  const [rule] = await db
    .insert(notificationRulesTable)
    .values({
      event,
      name,
      category: category || "general",
      channels: channels || ["in_app"],
      recipientType: recipientType || "specific",
      recipientRoles: recipientRoles || [],
      isActive: true,
      template: template || {},
    })
    .returning();

  await logAudit(req.user!.id, "create_notification_rule", "notification_rule", rule.id, { event }, req.ip);
  res.status(201).json(rule);
});

export default router;
