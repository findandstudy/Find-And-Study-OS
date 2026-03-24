import { Router, type IRouter } from "express";
import { db, quickLinksTable } from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";

const router: IRouter = Router();

router.get("/quick-links", requireAuth, async (req, res): Promise<void> => {
  const userRole = req.user!.role;
  let target: string;

  if (userRole === "agent") target = "agent";
  else if (userRole === "sub_agent") target = "sub_agent";
  else if (userRole === "student") target = "student";
  else target = "staff";

  const links = await db
    .select()
    .from(quickLinksTable)
    .where(and(
      sql`(${quickLinksTable.target} = ${target} OR ${quickLinksTable.target} LIKE '%' || ${target} || '%')`,
      eq(quickLinksTable.isActive, true),
    ))
    .orderBy(asc(quickLinksTable.sortOrder), asc(quickLinksTable.id));

  res.json({ data: links });
});

router.get("/quick-links/admin", requireAuth, requireRole(...MANAGER_ROLES), async (_req, res): Promise<void> => {
  const links = await db
    .select()
    .from(quickLinksTable)
    .orderBy(asc(quickLinksTable.target), asc(quickLinksTable.sortOrder), asc(quickLinksTable.id));

  res.json({ data: links });
});

router.post("/quick-links", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { title, url, icon, logoUrl, color, target, sortOrder } = req.body;
  if (!title || !url || !target) {
    res.status(400).json({ error: "title, url and target are required" });
    return;
  }
  const validTargets = ["agent", "sub_agent", "staff", "student"];
  const targets = String(target).split(",").map(t => t.trim()).filter(Boolean);
  if (targets.length === 0 || !targets.every(t => validTargets.includes(t))) {
    res.status(400).json({ error: "target must be one or more of: agent, sub_agent, staff, student" });
    return;
  }
  const normalizedTarget = targets.join(",");
  const [link] = await db.insert(quickLinksTable).values({
    title,
    url,
    icon: icon || null,
    logoUrl: logoUrl || null,
    color: color || null,
    target: normalizedTarget,
    sortOrder: sortOrder ?? 0,
  }).returning();
  res.status(201).json(link);
});

router.patch("/quick-links/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  for (const key of ["title", "url", "icon", "logoUrl", "color", "sortOrder", "isActive"]) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (req.body.target !== undefined) {
    const validTargets = ["agent", "sub_agent", "staff", "student"];
    const targets = String(req.body.target).split(",").map((t: string) => t.trim()).filter(Boolean);
    if (targets.length === 0 || !targets.every((t: string) => validTargets.includes(t))) {
      res.status(400).json({ error: "target must be one or more of: agent, sub_agent, staff, student" });
      return;
    }
    updates.target = targets.join(",");
  }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [updated] = await db.update(quickLinksTable).set(updates).where(eq(quickLinksTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Quick link not found" }); return; }
  res.json(updated);
});

router.delete("/quick-links/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [deleted] = await db.delete(quickLinksTable).where(eq(quickLinksTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Quick link not found" }); return; }
  res.json({ success: true });
});

export default router;
