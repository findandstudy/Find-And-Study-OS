import { Router, type IRouter, type Request } from "express";
import {
  db,
  followUpsTable,
  leadsTable,
  studentsTable,
  usersTable,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { requireAgentStaffPermission, requireAuth, requireRole, logAudit } from "../lib/auth";
import { ADMIN_ROLES, STAFF_ROLES, isAgentRole } from "../lib/roles";
import { getAgentVisibleIds } from "../lib/agentVisibility";
import { getAgencyMemberAgentIds } from "../lib/agencyStaff";
import { getVisibleBranchIds } from "../lib/branchScope";
import { getAssignmentVisibility, getEffectivePermissionSet, type AssignmentVisibility } from "../lib/permissions";
import { parseClientCalendarDate, parseClientDayBounds } from "../lib/followUpDateFilters";

const router: IRouter = Router();

type FollowUpScope = {
  userId: number;
  isAdmin: boolean;
  isAgent: boolean;
  permissions: Set<string> | null;
  assignmentVisibility: AssignmentVisibility | null;
  visibleBranchIds: number[] | null;
  visibleAgentIds: number[];
  agencyAgentIds: number[];
};

function parsePositiveInt(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function resolveScope(req: Request): Promise<FollowUpScope> {
  const user = req.user!;
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const isAgent = isAgentRole(user.role);
  const permissions = !isAdmin && !isAgent
    ? await getEffectivePermissionSet(user)
    : null;
  const [visibleBranchIds, visibleAgentIds, agencyAgentIds] = await Promise.all([
    getVisibleBranchIds(user.id, user.role, user),
    isAgent ? getAgentVisibleIds(user.id, user.role) : Promise.resolve([]),
    !isAdmin && !isAgent ? getAgencyMemberAgentIds(user.id) : Promise.resolve([]),
  ]);
  return {
    userId: user.id,
    isAdmin,
    isAgent,
    permissions,
    assignmentVisibility: permissions ? getAssignmentVisibility(permissions) : null,
    visibleBranchIds,
    visibleAgentIds,
    agencyAgentIds,
  };
}

function branchCondition(column: any, scope: FollowUpScope) {
  if (scope.visibleBranchIds === null) return null;
  if (scope.visibleBranchIds.length === 0) return isNull(column);
  return or(inArray(column, scope.visibleBranchIds), isNull(column))!;
}

function assignmentCondition(
  column: any,
  visibility: AssignmentVisibility | null,
  userId: number,
) {
  if (!visibility || visibility === "all") return null;
  if (visibility === "assigned") return isNotNull(column);
  if (visibility === "own_or_unassigned") return or(eq(column, userId), isNull(column))!;
  return eq(column, userId);
}

function leadScopeCondition(scope: FollowUpScope) {
  const conditions: any[] = [isNull(leadsTable.deletedAt)];
  const branch = branchCondition(leadsTable.branchId, scope);
  if (branch) conditions.push(branch);
  if (scope.isAgent) {
    conditions.push(scope.visibleAgentIds.length > 0
      ? inArray(leadsTable.agentId, scope.visibleAgentIds)
      : sql`false`);
  } else if (!scope.isAdmin) {
    if (!scope.permissions?.has("records.view_others")) conditions.push(isNull(leadsTable.agentId));
    const assignment = assignmentCondition(leadsTable.assignedToId, scope.assignmentVisibility, scope.userId);
    if (assignment) conditions.push(assignment);
  }
  return and(...conditions)!;
}

function studentScopeCondition(scope: FollowUpScope) {
  const conditions: any[] = [isNull(studentsTable.deletedAt)];
  const branch = branchCondition(studentsTable.branchId, scope);
  if (branch) conditions.push(branch);
  if (scope.isAgent) {
    conditions.push(scope.visibleAgentIds.length > 0
      ? inArray(studentsTable.agentId, scope.visibleAgentIds)
      : sql`false`);
  } else if (!scope.isAdmin) {
    const assignment = assignmentCondition(studentsTable.assignedToId, scope.assignmentVisibility, scope.userId);
    if (assignment) {
      conditions.push(scope.agencyAgentIds.length > 0
        ? or(assignment, inArray(studentsTable.agentId, scope.agencyAgentIds))!
        : assignment);
    }
  }
  return and(...conditions)!;
}

function followUpVisibilityCondition(scope: FollowUpScope) {
  const leadScope = leadScopeCondition(scope);
  const studentScope = studentScopeCondition(scope);
  const standaloneScope = scope.isAdmin
    ? and(isNull(followUpsTable.leadId), isNull(followUpsTable.studentId))
    : and(
        isNull(followUpsTable.leadId),
        isNull(followUpsTable.studentId),
        or(eq(followUpsTable.assignedToId, scope.userId), eq(followUpsTable.createdById, scope.userId)),
      );
  return or(
    and(
      isNotNull(followUpsTable.leadId),
      sql`EXISTS (
        SELECT 1 FROM ${leadsTable}
        WHERE ${leadsTable.id} = ${followUpsTable.leadId}
          AND ${leadScope}
      )`,
    ),
    and(
      isNotNull(followUpsTable.studentId),
      sql`EXISTS (
        SELECT 1 FROM ${studentsTable}
        WHERE ${studentsTable.id} = ${followUpsTable.studentId}
          AND ${studentScope}
      )`,
    ),
    standaloneScope,
  )!;
}

async function canAccessResource(scope: FollowUpScope, resourceType: "lead" | "student", resourceId: number): Promise<boolean> {
  if (resourceType === "lead") {
    const [row] = await db.select({ id: leadsTable.id })
      .from(leadsTable)
      .where(and(eq(leadsTable.id, resourceId), leadScopeCondition(scope)))
      .limit(1);
    return Boolean(row);
  }
  const [row] = await db.select({ id: studentsTable.id })
    .from(studentsTable)
    .where(and(eq(studentsTable.id, resourceId), studentScopeCondition(scope)))
    .limit(1);
  return Boolean(row);
}

async function validateAssignee(value: unknown): Promise<number | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "unassigned") return null;
  const id = parsePositiveInt(value);
  if (!id) return undefined;
  const [user] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.id, id),
      eq(usersTable.isActive, true),
      isNull(usersTable.deletedAt),
      inArray(usersTable.role, [...STAFF_ROLES]),
    ))
    .limit(1);
  return user?.id;
}

const followUpSelection = {
  id: followUpsTable.id,
  leadId: followUpsTable.leadId,
  studentId: followUpsTable.studentId,
  resourceType: sql<"lead" | "student" | "standalone">`CASE
    WHEN ${followUpsTable.studentId} IS NOT NULL THEN 'student'
    WHEN ${followUpsTable.leadId} IS NOT NULL THEN 'lead'
    ELSE 'standalone'
  END`,
  resourceId: sql<number | null>`COALESCE(${followUpsTable.studentId}, ${followUpsTable.leadId})`,
  title: followUpsTable.title,
  scheduledAt: followUpsTable.scheduledAt,
  completed: followUpsTable.completed,
  completedAt: followUpsTable.completedAt,
  assignedToId: followUpsTable.assignedToId,
  assignedToName: sql<string | null>`(
    SELECT NULLIF(CONCAT_WS(' ', au.first_name, au.last_name), '')
    FROM users au WHERE au.id = ${followUpsTable.assignedToId}
  )`,
  notes: followUpsTable.notes,
  relatedName: sql<string | null>`COALESCE(
    (SELECT NULLIF(CONCAT_WS(' ', fl.first_name, fl.last_name), '') FROM leads fl WHERE fl.id = ${followUpsTable.leadId}),
    (SELECT NULLIF(CONCAT_WS(' ', fs.first_name, fs.last_name), '') FROM students fs WHERE fs.id = ${followUpsTable.studentId})
  )`,
  relatedEmail: sql<string | null>`COALESCE(
    (SELECT fl.email FROM leads fl WHERE fl.id = ${followUpsTable.leadId}),
    (SELECT fs.email FROM students fs WHERE fs.id = ${followUpsTable.studentId})
  )`,
  createdById: followUpsTable.createdById,
  createdByName: sql<string | null>`(
    SELECT NULLIF(CONCAT_WS(' ', cu.first_name, cu.last_name), '')
    FROM users cu WHERE cu.id = ${followUpsTable.createdById}
  )`,
  updatedById: followUpsTable.updatedById,
  updatedByName: sql<string | null>`(
    SELECT NULLIF(CONCAT_WS(' ', uu.first_name, uu.last_name), '')
    FROM users uu WHERE uu.id = ${followUpsTable.updatedById}
  )`,
  createdAt: followUpsTable.createdAt,
  updatedAt: followUpsTable.updatedAt,
};

async function loadEnrichedFollowUp(id: number) {
  const [row] = await db.select(followUpSelection)
    .from(followUpsTable)
    .where(eq(followUpsTable.id, id))
    .limit(1);
  return row ?? null;
}

router.get(
  "/follow-ups",
  requireAuth,
  requireRole(...STAFF_ROLES, "agent_staff"),
  requireAgentStaffPermission("tasks"),
  async (req, res): Promise<void> => {
    const scope = await resolveScope(req);
    const query = req.query as Record<string, string>;
    const page = Math.max(1, Number.parseInt(query.page || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || "25", 10) || 25));
    const offset = (page - 1) * limit;
    const { now, today, tomorrow, nextSevenDays, offsetMinutes } = parseClientDayBounds(query.tzOffsetMinutes);

    const structuralConditions: any[] = [followUpVisibilityCondition(scope)];
    const resourceType = query.resourceType;
    if (resourceType === "lead") structuralConditions.push(isNotNull(followUpsTable.leadId));
    else if (resourceType === "student") structuralConditions.push(isNotNull(followUpsTable.studentId));
    if (query.assignedTo === "me") structuralConditions.push(eq(followUpsTable.assignedToId, scope.userId));
    else if (query.assignedTo === "unassigned") structuralConditions.push(isNull(followUpsTable.assignedToId));
    else if (query.assignedTo && query.assignedTo !== "all") {
      const assignedToId = parsePositiveInt(query.assignedTo);
      if (assignedToId) structuralConditions.push(eq(followUpsTable.assignedToId, assignedToId));
    }
    if (query.createdBy && query.createdBy !== "all") {
      const createdById = parsePositiveInt(query.createdBy);
      if (createdById && scope.isAdmin) structuralConditions.push(eq(followUpsTable.createdById, createdById));
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      structuralConditions.push(or(
        ilike(followUpsTable.title, term),
        ilike(followUpsTable.notes, term),
        sql`EXISTS (
          SELECT 1 FROM leads sl WHERE sl.id = ${followUpsTable.leadId}
            AND (CONCAT_WS(' ', sl.first_name, sl.last_name) ILIKE ${term} OR sl.email ILIKE ${term})
        )`,
        sql`EXISTS (
          SELECT 1 FROM students ss WHERE ss.id = ${followUpsTable.studentId}
            AND (CONCAT_WS(' ', ss.first_name, ss.last_name) ILIKE ${term} OR ss.email ILIKE ${term})
        )`,
      )!);
    }
    const from = parseClientCalendarDate(query.from, offsetMinutes);
    const to = parseClientCalendarDate(query.to, offsetMinutes, true);
    if (from) structuralConditions.push(gte(followUpsTable.scheduledAt, from));
    if (to) structuralConditions.push(lte(followUpsTable.scheduledAt, to));

    const listConditions = [...structuralConditions];
    if (query.status === "pending") listConditions.push(eq(followUpsTable.completed, false));
    else if (query.status === "completed") listConditions.push(eq(followUpsTable.completed, true));
    if (query.range === "today") {
      listConditions.push(eq(followUpsTable.completed, false));
      listConditions.push(gte(followUpsTable.scheduledAt, today));
      listConditions.push(lt(followUpsTable.scheduledAt, tomorrow));
    } else if (query.range === "next7") {
      listConditions.push(eq(followUpsTable.completed, false));
      listConditions.push(gte(followUpsTable.scheduledAt, now));
      listConditions.push(lt(followUpsTable.scheduledAt, nextSevenDays));
    } else if (query.range === "overdue") {
      listConditions.push(eq(followUpsTable.completed, false));
      listConditions.push(lt(followUpsTable.scheduledAt, now));
    } else if (query.range === "completed") {
      listConditions.push(eq(followUpsTable.completed, true));
    }

    const sortColumns: Record<string, any> = {
      title: followUpsTable.title,
      scheduledAt: followUpsTable.scheduledAt,
      status: followUpsTable.completed,
      assignee: sql`(
        SELECT lower(CONCAT_WS(' ', su.first_name, su.last_name))
        FROM users su WHERE su.id = ${followUpsTable.assignedToId}
      )`,
      related: sql`COALESCE(
        (SELECT lower(CONCAT_WS(' ', rl.first_name, rl.last_name)) FROM leads rl WHERE rl.id = ${followUpsTable.leadId}),
        (SELECT lower(CONCAT_WS(' ', rs.first_name, rs.last_name)) FROM students rs WHERE rs.id = ${followUpsTable.studentId})
      )`,
    };
    const sortColumn = sortColumns[query.sortKey] || followUpsTable.scheduledAt;
    const order = query.sortDir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const structuralWhere = and(...structuralConditions)!;
    const listWhere = and(...listConditions)!;

    const [rows, countRows, countSummary] = await Promise.all([
      db.select(followUpSelection)
        .from(followUpsTable)
        .where(listWhere)
        .orderBy(order, asc(followUpsTable.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` })
        .from(followUpsTable)
        .where(listWhere),
      db.select({
        all: sql<number>`count(*)`,
        today: sql<number>`count(*) FILTER (
          WHERE ${followUpsTable.completed} = false
            AND ${followUpsTable.scheduledAt} >= ${today}
            AND ${followUpsTable.scheduledAt} < ${tomorrow}
        )`,
        next7: sql<number>`count(*) FILTER (
          WHERE ${followUpsTable.completed} = false
            AND ${followUpsTable.scheduledAt} >= ${now}
            AND ${followUpsTable.scheduledAt} < ${nextSevenDays}
        )`,
        overdue: sql<number>`count(*) FILTER (
          WHERE ${followUpsTable.completed} = false
            AND ${followUpsTable.scheduledAt} < ${now}
        )`,
        completed: sql<number>`count(*) FILTER (WHERE ${followUpsTable.completed} = true)`,
      }).from(followUpsTable).where(structuralWhere),
    ]);
    const total = Number(countRows[0]?.count || 0);
    const summary = countSummary[0] || { all: 0, today: 0, next7: 0, overdue: 0, completed: 0 };
    res.json({
      data: rows,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        counts: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Number(value || 0)])),
      },
    });
  },
);

router.post(
  "/follow-ups",
  requireAuth,
  requireRole(...STAFF_ROLES, "agent_staff"),
  requireAgentStaffPermission("tasks"),
  async (req, res): Promise<void> => {
    const scope = await resolveScope(req);
    const resourceType = req.body?.resourceType === "student" ? "student" : req.body?.resourceType === "lead" ? "lead" : null;
    const resourceId = parsePositiveInt(req.body?.resourceId);
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const scheduledAt = new Date(req.body?.scheduledAt);
    if (!resourceType || !resourceId) {
      res.status(400).json({ error: "A lead or student is required" });
      return;
    }
    if (!title) {
      res.status(400).json({ error: "Title is required" });
      return;
    }
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt < new Date()) {
      res.status(400).json({ error: "A valid future date is required" });
      return;
    }
    if (!(await canAccessResource(scope, resourceType, resourceId))) {
      res.status(404).json({ error: `${resourceType === "lead" ? "Lead" : "Student"} not found` });
      return;
    }
    let assignedToId: number | null = scope.userId;
    if (scope.isAdmin && Object.prototype.hasOwnProperty.call(req.body ?? {}, "assignedToId")) {
      const validated = await validateAssignee(req.body.assignedToId);
      if (validated === undefined) {
        res.status(400).json({ error: "Assigned user not found or inactive" });
        return;
      }
      assignedToId = validated;
    }
    const [created] = await db.insert(followUpsTable).values({
      leadId: resourceType === "lead" ? resourceId : null,
      studentId: resourceType === "student" ? resourceId : null,
      resourceType,
      title: title.slice(0, 500),
      scheduledAt,
      assignedToId,
      notes: req.body?.notes ? String(req.body.notes).slice(0, 2000) : null,
      createdById: scope.userId,
    }).returning();
    await logAudit(scope.userId, "create_follow_up", resourceType, resourceId, {
      followUpId: created.id,
      title: created.title,
      scheduledAt: created.scheduledAt,
      assignedToId,
    }, req.ip);
    res.status(201).json(await loadEnrichedFollowUp(created.id));
  },
);

router.put(
  "/follow-ups/bulk",
  requireAuth,
  requireRole(...STAFF_ROLES, "agent_staff"),
  requireAgentStaffPermission("tasks"),
  async (req, res): Promise<void> => {
    const scope = await resolveScope(req);
    const parsedIds: number[] = (Array.isArray(req.body?.ids) ? req.body.ids : [])
      .map(parsePositiveInt)
      .filter((id: number | null): id is number => id !== null);
    const ids = Array.from(new Set<number>(parsedIds)).slice(0, 100);
    if (ids.length === 0) {
      res.status(400).json({ error: "At least one follow-up is required" });
      return;
    }
    const updates: Record<string, unknown> = { updatedAt: new Date(), updatedById: scope.userId };
    if (typeof req.body?.completed === "boolean") {
      updates.completed = req.body.completed;
      updates.completedAt = req.body.completed ? new Date() : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "assignedToId")) {
      if (!scope.isAdmin) {
        res.status(403).json({ error: "Only admins can reassign follow-ups" });
        return;
      }
      const assignedToId = await validateAssignee(req.body.assignedToId);
      if (assignedToId === undefined) {
        res.status(400).json({ error: "Assigned user not found or inactive" });
        return;
      }
      updates.assignedToId = assignedToId;
    }
    if (!("completed" in updates) && !("assignedToId" in updates)) {
      res.status(400).json({ error: "No valid fields" });
      return;
    }
    const accessibleRows = await db.select({ id: followUpsTable.id })
      .from(followUpsTable)
      .where(and(inArray(followUpsTable.id, ids), followUpVisibilityCondition(scope)));
    const accessibleIds = accessibleRows.map(row => row.id);
    if (accessibleIds.length === 0) {
      res.status(404).json({ error: "No accessible follow-ups found" });
      return;
    }
    const updated = await db.update(followUpsTable)
      .set(updates)
      .where(inArray(followUpsTable.id, accessibleIds))
      .returning({ id: followUpsTable.id });
    for (const row of updated) {
      await logAudit(scope.userId, "bulk_update_follow_up", "follow_up", row.id, updates, req.ip);
    }
    res.json({ updated: updated.length, skipped: ids.length - updated.length });
  },
);

export default router;
