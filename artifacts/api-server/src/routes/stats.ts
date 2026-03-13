import { Router, type IRouter } from "express";
import { db, leadsTable, studentsTable, applicationsTable, agentsTable, documentsTable, invoicesTable, commissionsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";

const router: IRouter = Router();

router.get("/stats/overview", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const [[{ leads }], [{ students }], [{ applications }], [{ agents }]] = await Promise.all([
    db.select({ leads: sql<number>`count(*)` }).from(leadsTable),
    db.select({ students: sql<number>`count(*)` }).from(studentsTable),
    db.select({ applications: sql<number>`count(*)` }).from(applicationsTable),
    db.select({ agents: sql<number>`count(*)` }).from(agentsTable),
  ]);

  const [{ activeApps }] = await db
    .select({ activeApps: sql<number>`count(*)` })
    .from(applicationsTable)
    .where(sql`stage NOT IN ('enrolled','rejected')`);

  const [{ pendingDocs }] = await db
    .select({ pendingDocs: sql<number>`count(*)` })
    .from(documentsTable)
    .where(eq(documentsTable.status, "pending"));

  const [{ revenue }] = await db
    .select({ revenue: sql<number>`coalesce(sum(amount), 0)` })
    .from(invoicesTable)
    .where(eq(invoicesTable.status, "paid"));

  const [{ pending }] = await db
    .select({ pending: sql<number>`coalesce(sum(amount), 0)` })
    .from(commissionsTable)
    .where(eq(commissionsTable.status, "pending"));

  res.json({
    totalLeads: Number(leads),
    totalStudents: Number(students),
    totalApplications: Number(applications),
    totalAgents: Number(agents),
    activeApplications: Number(activeApps),
    pendingDocuments: Number(pendingDocs),
    totalRevenue: Number(revenue),
    pendingCommissions: Number(pending),
  });
});

export default router;
