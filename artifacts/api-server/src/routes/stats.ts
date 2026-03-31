import { Router, type IRouter } from "express";
import { db, leadsTable, studentsTable, applicationsTable, agentsTable, documentsTable, commissionsTable, pipelineStagesTable } from "@workspace/db";
import { sql, eq, and, isNull, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";

const router: IRouter = Router();

router.get("/stats/overview", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
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

  const [[{ leads }], [{ students }], [{ applications }]] = await Promise.all([
    db.select({ leads: sql<number>`count(*)` }).from(leadsTable).where(isNull(leadsTable.deletedAt)),
    db.select({ students: sql<number>`count(*)` }).from(studentsTable).where(isNull(studentsTable.deletedAt)),
    db.select({ applications: sql<number>`count(*)` }).from(applicationsTable).where(isNull(applicationsTable.deletedAt)),
  ]);

  let activeApps = Number(applications);
  if (terminalKeys.length > 0) {
    const [{ active }] = await db
      .select({ active: sql<number>`count(*)` })
      .from(applicationsTable)
      .where(and(
        isNull(applicationsTable.deletedAt),
        sql`stage NOT IN (${sql.join(terminalKeys.map(k => sql`${k}`), sql`, `)})`
      ));
    activeApps = Number(active);
  }

  let enrolledStudents = 0;
  if (wonKeys.length > 0) {
    const [{ enrolled }] = await db
      .select({ enrolled: sql<number>`count(DISTINCT student_id)` })
      .from(applicationsTable)
      .where(and(
        isNull(applicationsTable.deletedAt),
        inArray(applicationsTable.stage, wonKeys)
      ));
    enrolledStudents = Number(enrolled);
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const [{ monthlyRevenue }] = await db
    .select({ monthlyRevenue: sql<number>`coalesce(sum(CAST(university_commission_amount AS numeric)), 0)` })
    .from(commissionsTable)
    .where(sql`status IN ('confirmed','collected_partial','collected_full','settled') AND confirmed_at >= ${monthStart} AND confirmed_at < ${monthEnd}`);

  res.json({
    totalLeads: Number(leads),
    totalStudents: Number(students),
    totalApplications: Number(applications),
    activeApplications: activeApps,
    enrolledStudents: enrolledStudents,
    monthlyRevenue: Number(monthlyRevenue),
  });
});

export default router;
