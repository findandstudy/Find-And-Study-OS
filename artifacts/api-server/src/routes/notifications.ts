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
import { notificationBus, type NotificationBusEvent } from "../lib/notificationBus";

const router: IRouter = Router();

/**
 * SQL fragment that excludes notifications whose target resource has been
 * deleted (or, for soft-deletable tables, soft-deleted). The bell badge,
 * the per-section nav badges, and the notification panel listing all share
 * this filter so they stay in sync — a notification pointing at a vanished
 * lead/student/application/conversation never contributes to a count or
 * shows up in the panel.
 *
 * Notifications without a recognised resource reference (system messages,
 * etc.) are kept by default — only known patterns are checked.
 */
const liveResourceFilter = sql`(
  CASE
    WHEN ${notificationsTable.actionUrl} ~ '/applications/([0-9]+)' THEN
      EXISTS (
        SELECT 1 FROM applications a
        WHERE a.id = (regexp_match(${notificationsTable.actionUrl}, '/applications/([0-9]+)'))[1]::int
          AND a.deleted_at IS NULL
      )
    WHEN ${notificationsTable.actionUrl} ~ '/leads/([0-9]+)' THEN
      EXISTS (
        SELECT 1 FROM leads l
        WHERE l.id = (regexp_match(${notificationsTable.actionUrl}, '/leads/([0-9]+)'))[1]::int
          AND l.deleted_at IS NULL
      )
    WHEN ${notificationsTable.actionUrl} ~ '/students/([0-9]+)' THEN
      EXISTS (
        SELECT 1 FROM students s
        WHERE s.id = (regexp_match(${notificationsTable.actionUrl}, '/students/([0-9]+)'))[1]::int
          AND s.deleted_at IS NULL
      )
    WHEN ${notificationsTable.actionUrl} ~ 'conversation=([0-9]+)' THEN
      EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = (regexp_match(${notificationsTable.actionUrl}, 'conversation=([0-9]+)'))[1]::int
      )
    ELSE TRUE
  END
)`;

/**
 * Live notification stream (SSE). Replaces the previous 15 s polling loop in
 * the browser NotificationCenter — events are pushed immediately when
 * dispatchNotification() inserts a row. Heartbeat every 25 s keeps idle
 * proxies from closing the connection.
 */
router.get("/notifications/events", requireAuth, (req, res): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
    (res as { flushHeaders: () => void }).flushHeaders();
  }
  res.write(`retry: 5000\n\n`);

  const userId = req.user!.id;

  const ping = setInterval(() => {
    try { res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`); } catch { /* ignore */ }
  }, 25000);

  const handler = (event: NotificationBusEvent) => {
    if (event.userId !== userId) return;
    try {
      res.write(`event: notification\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch { /* socket may be closed */ }
  };
  const unsubscribe = notificationBus.subscribe(handler);

  const cleanup = () => {
    clearInterval(ping);
    unsubscribe();
    try { res.end(); } catch { /* ignore */ }
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
});

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

  const conditions = [eq(notificationsTable.userId, userId), liveResourceFilter];
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
    .where(and(
      eq(notificationsTable.userId, userId),
      eq(notificationsTable.isRead, false),
      liveResourceFilter,
    ));

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
    .where(and(
      eq(notificationsTable.userId, userId),
      eq(notificationsTable.isRead, false),
      liveResourceFilter,
    ));

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
