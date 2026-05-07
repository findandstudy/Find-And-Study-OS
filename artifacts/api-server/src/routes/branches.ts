import { Router, type IRouter } from "express";
import { db, branchesTable, agentBranchesTable, agentsTable } from "@workspace/db";
import { eq, isNull, isNotNull, and, sql, inArray, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES } from "../lib/roles";
import { getVisibleBranchIds } from "../lib/branchScope";

const router: IRouter = Router();

// List branches. Staff can read; super_admin sees all incl. archived (?archived=1).
router.get("/branches", requireAuth, requireRole(...STAFF_ROLES), async (req, res): Promise<void> => {
  const includeArchived = req.query.archived === "1" || req.query.archived === "true";
  const conditions = [];
  if (!includeArchived) conditions.push(isNull(branchesTable.archivedAt));

  // Non-super_admin staff only see their visible branches.
  const visible = await getVisibleBranchIds(req.user!.id, req.user!.role);
  if (visible !== null) {
    if (visible.length === 0) {
      res.json({ data: [] });
      return;
    }
    conditions.push(inArray(branchesTable.id, visible));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const data = await db.select().from(branchesTable).where(where).orderBy(branchesTable.name);
  res.json({ data });
});

router.post("/branches", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const { name, country, city, contactName, contactEmail, contactPhone, logoUrl, notes } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Şube adı zorunludur." });
    return;
  }
  try {
    const [branch] = await db.insert(branchesTable).values({
      name: name.trim(),
      country: country?.trim() || null,
      city: city?.trim() || null,
      contactName: contactName?.trim() || null,
      contactEmail: contactEmail?.trim() || null,
      contactPhone: contactPhone?.trim() || null,
      logoUrl: logoUrl || null,
      notes: notes?.trim() || null,
    }).returning();
    res.status(201).json(branch);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Bu isimde bir şube zaten var." });
      return;
    }
    res.status(500).json({ error: err?.message || "Failed to create branch" });
  }
});

router.patch("/branches/:id", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const allowed = ["name", "country", "city", "contactName", "contactEmail", "contactPhone", "logoUrl", "notes"];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      const v = req.body[k];
      updates[k] = (typeof v === "string" ? v.trim() : v) || null;
    }
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  if (typeof updates.name === "string" && !(updates.name as string).trim()) {
    res.status(400).json({ error: "Şube adı boş olamaz." });
    return;
  }
  try {
    const [branch] = await db.update(branchesTable).set(updates).where(eq(branchesTable.id, id)).returning();
    if (!branch) { res.status(404).json({ error: "Branch not found" }); return; }
    res.json(branch);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Bu isimde bir şube zaten var." });
      return;
    }
    res.status(500).json({ error: err?.message || "Failed" });
  }
});

router.post("/branches/:id/archive", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [branch] = await db.update(branchesTable).set({ archivedAt: new Date() }).where(eq(branchesTable.id, id)).returning();
  if (!branch) { res.status(404).json({ error: "Branch not found" }); return; }
  res.json(branch);
});

router.post("/branches/:id/unarchive", requireAuth, requireRole("super_admin"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [branch] = await db.update(branchesTable).set({ archivedAt: null }).where(eq(branchesTable.id, id)).returning();
  if (!branch) { res.status(404).json({ error: "Branch not found" }); return; }
  res.json(branch);
});

// Stats: how many agents/users are linked to each branch (super_admin only).
router.get("/branches/stats", requireAuth, requireRole("super_admin"), async (_req, res): Promise<void> => {
  const rows = await db.execute<{ branch_id: number; agents: string; }>(sql`
    SELECT b.id AS branch_id,
           (SELECT COUNT(*)::text FROM agent_branches ab WHERE ab.branch_id = b.id) AS agents
    FROM branches b
  `);
  const result: Record<number, { agents: number }> = {};
  for (const r of rows.rows as any[]) {
    result[Number(r.branch_id)] = { agents: parseInt(r.agents, 10) || 0 };
  }
  res.json(result);
});

export default router;
