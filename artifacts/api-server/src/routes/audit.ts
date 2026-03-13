import { Router, type IRouter } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { sql, desc, ilike, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";

const router: IRouter = Router();

router.get("/audit", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { search, page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const where = search
    ? or(
        ilike(auditLogsTable.action, `%${search}%`),
        ilike(auditLogsTable.resource, `%${search}%`),
      )
    : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLogsTable)
    .where(where);

  const data = await db
    .select()
    .from(auditLogsTable)
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  res.json({
    data,
    meta: {
      total: Number(count),
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(Number(count) / limitNum),
    },
  });
});

export default router;
