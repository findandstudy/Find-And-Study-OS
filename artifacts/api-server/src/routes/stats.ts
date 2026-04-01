import { Router, type IRouter } from "express";
import { db, leadsTable, studentsTable, applicationsTable, agentsTable, documentsTable, commissionsTable, pipelineStagesTable } from "@workspace/db";
import { sql, eq, and, isNull, inArray, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES, ADMIN_ROLES, AGENT_ROLES } from "../lib/roles";
import { isAgentRole } from "../lib/roles";
import { getAgentVisibleIds } from "../lib/agentVisibility";

const router: IRouter = Router();

router.get("/stats/overview", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const user = req.user!;
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const isAgent = isAgentRole(user.role);

  const wonStages = await db
    .select({ key: pipelineStagesTable.key })
    .from(pipelineStagesTable)
    .where(and(eq(pipelineStagesTable.entityType, "application"), eq(pipelineStagesTable.variant, "won")));
  const wonKeys = wonStages.map(s => s.key);

  const lostStages = await db
    .select({ key: pipelineStagesTable.key })
    .from(pipelineStagesTable)
    .where(and(eq(pipelineStagesTable.entityType, "application"), eq(pipelineStagesTable.variant, "lost")));
  const lostKeys = lostStages.map(s => s.key);
  const terminalKeys = [...wonKeys, ...lostKeys];

  let leadFilter = isNull(leadsTable.deletedAt);
  let studentFilter = isNull(studentsTable.deletedAt);
  let appFilter = isNull(applicationsTable.deletedAt);

  if (isAgent) {
    const agentIds = await getAgentVisibleIds(user.id, user.role);
    if (agentIds.length === 0) {
      res.json({ totalLeads: 0, totalStudents: 0, totalApplications: 0, activeApplications: 0, enrolledStudents: 0, monthlyRevenue: 0 });
      return;
    }
    leadFilter = and(isNull(leadsTable.deletedAt), inArray(leadsTable.agentId, agentIds))!;
    studentFilter = and(isNull(studentsTable.deletedAt), inArray(studentsTable.agentId, agentIds))!;
    appFilter = and(isNull(applicationsTable.deletedAt), inArray(applicationsTable.agentId, agentIds))!;
  } else if (!isAdmin) {
    leadFilter = and(isNull(leadsTable.deletedAt), or(eq(leadsTable.assignedToId, user.id), isNull(leadsTable.assignedToId)))!;
    studentFilter = and(isNull(studentsTable.deletedAt), or(eq(studentsTable.assignedToId, user.id), isNull(studentsTable.assignedToId)))!;
    appFilter = and(isNull(applicationsTable.deletedAt), or(eq(applicationsTable.assignedToId, user.id), isNull(applicationsTable.assignedToId)))!;
  }

  const [[{ leads }], [{ students }], [{ applications }]] = await Promise.all([
    db.select({ leads: sql<number>`count(*)` }).from(leadsTable).where(leadFilter),
    db.select({ students: sql<number>`count(*)` }).from(studentsTable).where(studentFilter),
    db.select({ applications: sql<number>`count(*)` }).from(applicationsTable).where(appFilter),
  ]);

  let activeApps = Number(applications);
  if (terminalKeys.length > 0) {
    const terminalSql = sql`stage NOT IN (${sql.join(terminalKeys.map(k => sql`${k}`), sql`, `)})`;
    if (isAgent) {
      const agentIds = await getAgentVisibleIds(user.id, user.role);
      const [{ active }] = await db
        .select({ active: sql<number>`count(*)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), inArray(applicationsTable.agentId, agentIds), terminalSql));
      activeApps = Number(active);
    } else if (!isAdmin) {
      const [{ active }] = await db
        .select({ active: sql<number>`count(*)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), or(eq(applicationsTable.assignedToId, user.id), isNull(applicationsTable.assignedToId)), terminalSql));
      activeApps = Number(active);
    } else {
      const [{ active }] = await db
        .select({ active: sql<number>`count(*)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), terminalSql));
      activeApps = Number(active);
    }
  }

  let enrolledStudents = 0;
  if (wonKeys.length > 0) {
    if (isAgent) {
      const agentIds = await getAgentVisibleIds(user.id, user.role);
      const [{ enrolled }] = await db
        .select({ enrolled: sql<number>`count(DISTINCT student_id)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), inArray(applicationsTable.stage, wonKeys), inArray(applicationsTable.agentId, agentIds)));
      enrolledStudents = Number(enrolled);
    } else if (!isAdmin) {
      const [{ enrolled }] = await db
        .select({ enrolled: sql<number>`count(DISTINCT student_id)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), inArray(applicationsTable.stage, wonKeys), or(eq(applicationsTable.assignedToId, user.id), isNull(applicationsTable.assignedToId))));
      enrolledStudents = Number(enrolled);
    } else {
      const [{ enrolled }] = await db
        .select({ enrolled: sql<number>`count(DISTINCT student_id)` })
        .from(applicationsTable)
        .where(and(isNull(applicationsTable.deletedAt), inArray(applicationsTable.stage, wonKeys)));
      enrolledStudents = Number(enrolled);
    }
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  let revenueFilter = sql`status IN ('confirmed','collected_partial','collected_full','settled') AND confirmed_at >= ${monthStart} AND confirmed_at < ${monthEnd}`;
  if (isAgent) {
    const agentIds = await getAgentVisibleIds(user.id, user.role);
    revenueFilter = sql`status IN ('confirmed','collected_partial','collected_full','settled') AND confirmed_at >= ${monthStart} AND confirmed_at < ${monthEnd} AND agent_id IN (${sql.join(agentIds.map(id => sql`${id}`), sql`, `)})`;
  }

  const [{ monthlyRevenue }] = await db
    .select({ monthlyRevenue: sql<number>`coalesce(sum(CAST(university_commission_amount AS numeric)), 0)` })
    .from(commissionsTable)
    .where(revenueFilter);

  res.json({
    totalLeads: Number(leads),
    totalStudents: Number(students),
    totalApplications: Number(applications),
    activeApplications: activeApps,
    enrolledStudents: enrolledStudents,
    monthlyRevenue: Number(monthlyRevenue),
  });
});

router.get("/stats/growth", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const user = req.user!;
  const isAdmin = (ADMIN_ROLES as readonly string[]).includes(user.role);
  const isAgent = isAgentRole(user.role);

  const now = new Date();
  const months: { name: string; start: string; end: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = d.toISOString();
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
    const name = d.toLocaleString("en-US", { month: "short" });
    months.push({ name, start, end });
  }

  let agentIds: number[] = [];
  if (isAgent) {
    agentIds = await getAgentVisibleIds(user.id, user.role);
    if (agentIds.length === 0) {
      res.json(months.map(m => ({ name: m.name, leads: 0, students: 0, applications: 0 })));
      return;
    }
  }

  const result = await Promise.all(months.map(async (m) => {
    const dateFilter = sql`created_at >= ${m.start} AND created_at < ${m.end}`;

    let leadQ, studentQ, appQ;

    if (isAgent) {
      const agentFilter = sql`agent_id IN (${sql.join(agentIds.map(id => sql`${id}`), sql`, `)})`;
      leadQ = db.select({ c: sql<number>`count(*)` }).from(leadsTable).where(and(isNull(leadsTable.deletedAt), sql`${dateFilter} AND ${agentFilter}`));
      studentQ = db.select({ c: sql<number>`count(*)` }).from(studentsTable).where(and(isNull(studentsTable.deletedAt), sql`${dateFilter} AND ${agentFilter}`));
      appQ = db.select({ c: sql<number>`count(*)` }).from(applicationsTable).where(and(isNull(applicationsTable.deletedAt), sql`${dateFilter} AND ${agentFilter}`));
    } else if (!isAdmin) {
      const staffFilter = or(eq(leadsTable.assignedToId, user.id), isNull(leadsTable.assignedToId));
      const studentStaffFilter = or(eq(studentsTable.assignedToId, user.id), isNull(studentsTable.assignedToId));
      const appStaffFilter = or(eq(applicationsTable.assignedToId, user.id), isNull(applicationsTable.assignedToId));
      leadQ = db.select({ c: sql<number>`count(*)` }).from(leadsTable).where(and(isNull(leadsTable.deletedAt), sql`${dateFilter}`, staffFilter));
      studentQ = db.select({ c: sql<number>`count(*)` }).from(studentsTable).where(and(isNull(studentsTable.deletedAt), sql`${dateFilter}`, studentStaffFilter));
      appQ = db.select({ c: sql<number>`count(*)` }).from(applicationsTable).where(and(isNull(applicationsTable.deletedAt), sql`${dateFilter}`, appStaffFilter));
    } else {
      leadQ = db.select({ c: sql<number>`count(*)` }).from(leadsTable).where(and(isNull(leadsTable.deletedAt), sql`${dateFilter}`));
      studentQ = db.select({ c: sql<number>`count(*)` }).from(studentsTable).where(and(isNull(studentsTable.deletedAt), sql`${dateFilter}`));
      appQ = db.select({ c: sql<number>`count(*)` }).from(applicationsTable).where(and(isNull(applicationsTable.deletedAt), sql`${dateFilter}`));
    }

    const [[{ c: leadCount }], [{ c: studentCount }], [{ c: appCount }]] = await Promise.all([leadQ, studentQ, appQ]);
    return { name: m.name, leads: Number(leadCount), students: Number(studentCount), applications: Number(appCount) };
  }));

  res.json(result);
});

export default router;
