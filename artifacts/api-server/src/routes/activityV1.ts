import { Router, type IRouter } from "express";
import { db, entityViewEventsTable, userSessionsTable, agentsTable, usersTable } from "@workspace/db";
import { eq, and, gte, isNull, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { validate, getValidated } from "../middlewares/validate";
import { requireAuth, requireRole, requireAgentStaffPermission } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES } from "../lib/roles";
import { getAgentVisibleIds } from "../lib/agentVisibility";
import { clampSessionMetrics } from "../lib/activityNormalize";

const router: IRouter = Router();

const ENTITY_TYPES = ["lead", "student", "application", "message_thread"] as const;

const viewBodySchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.number().int().positive(),
});

const summaryQuerySchema = z.object({
  range: z.enum(["daily", "weekly", "monthly", "yearly"]).default("daily"),
  staffId: z.coerce.number().int().positive().optional(),
});

function getRangeBounds(range: "daily" | "weekly" | "monthly" | "yearly"): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  let from: Date;
  switch (range) {
    case "daily":
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
      break;
    case "weekly":
      from = new Date(now);
      from.setDate(now.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      break;
    case "monthly":
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "yearly":
      from = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
  }
  return { from, to };
}

router.post(
  "/v1/activity/view",
  requireAuth,
  validate({ body: viewBodySchema }),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const { entityType, entityId } = getValidated<{ body: typeof viewBodySchema }>(req).body;

    const dedupCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const [existing] = await db
      .select({ id: entityViewEventsTable.id })
      .from(entityViewEventsTable)
      .where(
        and(
          eq(entityViewEventsTable.userId, user.id),
          eq(entityViewEventsTable.entityType, entityType),
          eq(entityViewEventsTable.entityId, entityId),
          isNull(entityViewEventsTable.deletedAt),
          gte(entityViewEventsTable.viewedAt, dedupCutoff),
        )
      )
      .limit(1);

    if (existing) {
      res.json({ ok: true, deduplicated: true });
      return;
    }

    let agentId: number | null = null;
    if (user.role === "agent" || user.role === "sub_agent" || user.role === "agent_staff") {
      const [agentRow] = await db
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(eq(agentsTable.userId, user.id))
        .limit(1);
      agentId = agentRow?.id ?? null;
    }

    await db.insert(entityViewEventsTable).values({
      userId: user.id,
      entityType,
      entityId,
      viewedAt: new Date(),
      agentId,
    });

    res.status(201).json({ ok: true, deduplicated: false });
  }
);

router.get(
  "/v1/activity/summary",
  requireAuth,
  requireRole(...STAFF_ROLES, "agent_staff"),
  requireAgentStaffPermission("leads"),
  validate({ query: summaryQuerySchema }),
  async (req, res): Promise<void> => {
    const user = req.user!;
    const { range, staffId: rawStaffId } = getValidated<{ query: typeof summaryQuerySchema }>(req).query;
    const { from, to } = getRangeBounds(range);
    const periodSeconds = Math.max(0, (to.getTime() - from.getTime()) / 1000);
    const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
    const isAgentStaff = user.role === "agent_staff";

    let targetUserIds: number[] | null = null;

    if (isAdmin) {
      targetUserIds = rawStaffId ? [rawStaffId] : null;
    } else if (isAgentStaff) {
      const agentIds = await getAgentVisibleIds(user.id, user.role);
      if (agentIds.length === 0) {
        res.json({
          range,
          leadsViewed: 0, studentsViewed: 0, applicationsViewed: 0, messagesViewed: 0,
          activeDurationSeconds: 0, idleDurationSeconds: 0, totalDurationSeconds: 0,
        });
        return;
      }
      const rows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.id, agentIds));
      targetUserIds = rows.map(r => r.id);
    } else {
      targetUserIds = [user.id];
    }

    const viewBaseConditions = [
      isNull(entityViewEventsTable.deletedAt),
      gte(entityViewEventsTable.viewedAt, from),
      sql`${entityViewEventsTable.viewedAt} <= ${to.toISOString()}`,
    ];
    if (targetUserIds !== null) {
      viewBaseConditions.push(inArray(entityViewEventsTable.userId, targetUserIds));
    }

    const viewCounts = await db
      .select({
        entityType: entityViewEventsTable.entityType,
        count: sql<number>`count(*)`,
      })
      .from(entityViewEventsTable)
      .where(and(...viewBaseConditions))
      .groupBy(entityViewEventsTable.entityType);

    const counts: Record<string, number> = {};
    for (const r of viewCounts) {
      counts[r.entityType as string] = Number(r.count);
    }

    const sessionBaseConditions = [
      gte(userSessionsTable.startedAt, from),
      sql`${userSessionsTable.startedAt} <= ${to.toISOString()}`,
    ];
    if (targetUserIds !== null) {
      sessionBaseConditions.push(inArray(userSessionsTable.userId, targetUserIds));
    }

    const [sessionAgg] = await db
      .select({
        activeDurationSeconds: sql<number>`coalesce(sum(active_duration_seconds), 0)`,
        idleDurationSeconds: sql<number>`coalesce(sum(idle_duration_seconds), 0)`,
        totalDurationSeconds: sql<number>`coalesce(sum(total_duration_seconds), 0)`,
      })
      .from(userSessionsTable)
      .where(and(...sessionBaseConditions));

    const clamped = clampSessionMetrics({
      activeDurationSeconds: Number(sessionAgg?.activeDurationSeconds) || 0,
      idleDurationSeconds: Number(sessionAgg?.idleDurationSeconds) || 0,
      totalDurationSeconds: Number(sessionAgg?.totalDurationSeconds) || 0,
    });

    // Clamp against period wall-clock: no metric can exceed elapsed time in range
    const totalSeconds = Math.min(clamped.totalDurationSeconds, periodSeconds);
    const activeSeconds = Math.min(clamped.activeDurationSeconds, totalSeconds);
    const idleSeconds = Math.min(clamped.idleDurationSeconds, totalSeconds - activeSeconds);

    res.json({
      range,
      leadsViewed: counts["lead"] ?? 0,
      studentsViewed: counts["student"] ?? 0,
      applicationsViewed: counts["application"] ?? 0,
      messagesViewed: counts["message_thread"] ?? 0,
      activeDurationSeconds: activeSeconds,
      idleDurationSeconds: idleSeconds,
      totalDurationSeconds: totalSeconds,
    });
  }
);

export default router;
