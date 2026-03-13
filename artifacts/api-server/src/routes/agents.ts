import { Router, type IRouter } from "express";
import { db, agentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES, MANAGER_ROLES } from "../lib/roles";

const router: IRouter = Router();

const AGENT_PATCH_FIELDS = [
  "firstName", "lastName", "email", "phone",
  "status", "commissionRate", "notes", "agencyName", "country",
];

router.get("/agents/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.userId, userId));
  if (!agent) { res.status(404).json({ error: "Agent profile not found" }); return; }
  res.json(agent);
});

router.get("/agents", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const { search, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(agentsTable);

  const data = await db
    .select()
    .from(agentsTable)
    .limit(limitNum)
    .offset(offset)
    .orderBy(agentsTable.createdAt);

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

router.post("/agents", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { firstName, lastName, status = "active", email, phone, agencyName, country, commissionRate } = req.body;
  if (!firstName || !lastName) {
    res.status(400).json({ error: "firstName and lastName are required" });
    return;
  }
  const [agent] = await db.insert(agentsTable).values({
    firstName, lastName, status,
    email: email || null,
    phone: phone || null,
    agencyName: agencyName || null,
    country: country || null,
    commissionRate: commissionRate || null,
  }).returning();
  res.status(201).json(agent);
});

router.get("/agents/:id", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});

router.patch("/agents/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const updates: Record<string, unknown> = {};
  for (const key of AGENT_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [agent] = await db.update(agentsTable).set(updates).where(eq(agentsTable.id, id)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});

export default router;
