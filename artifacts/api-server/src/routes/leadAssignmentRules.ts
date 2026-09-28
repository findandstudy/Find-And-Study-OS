import { Router, type IRouter, type Request } from "express";
import { db, leadAssignmentRulesTable, auditLogsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";

const router: IRouter = Router();

const VALID_STRATEGIES = ["first", "round_robin"] as const;

function sanitizeStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x).trim()).filter(Boolean).slice(0, 200);
}
function sanitizeIntArray(v: any): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(Number).filter(n => Number.isSafeInteger(n) && n > 0))].slice(0, 200);
}

async function writeRuleAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  req: Request,
  action: string,
  resourceId: number,
  changes: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLogsTable).values({
    userId: req.user!.id,
    action,
    resource: "lead_assignment_rule",
    resourceId,
    changes: JSON.stringify(changes),
    ipAddress: req.ip || null,
  });
}

router.get("/settings/lead-assignment-rules", requireAuth, requireRole(...MANAGER_ROLES), async (_req, res): Promise<void> => {
  const rows = await db.select().from(leadAssignmentRulesTable)
    .orderBy(asc(leadAssignmentRulesTable.priority), asc(leadAssignmentRulesTable.id));
  res.json({ data: rows });
});

router.post("/settings/lead-assignment-rules", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { name, priority, isActive, countries, universityIds, cities, phoneCodes, sources, staffUserIds, strategy } = req.body;
  if (!name || !String(name).trim()) { res.status(400).json({ error: "name is required" }); return; }
  const staff = sanitizeIntArray(staffUserIds);
  if (staff.length === 0) { res.status(400).json({ error: "At least one staff member is required" }); return; }
  const strat: "first" | "round_robin" = VALID_STRATEGIES.includes(strategy as any) ? strategy : "first";

  const rule = await db.transaction(async tx => {
    const [created] = await tx.insert(leadAssignmentRulesTable).values({
      name: String(name).trim().slice(0, 200),
      priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
      isActive: isActive !== false,
      countries: sanitizeStringArray(countries),
      universityIds: sanitizeIntArray(universityIds),
      cities: sanitizeStringArray(cities),
      phoneCodes: sanitizeStringArray(phoneCodes),
      sources: sanitizeStringArray(sources),
      staffUserIds: staff,
      strategy: strat,
      lastAssignedIndex: 0,
    }).returning();
    await writeRuleAudit(tx, req, "create_lead_assignment_rule", created.id, { name: created.name });
    return created;
  });
  res.status(201).json(rule);
});

router.patch("/settings/lead-assignment-rules/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  const b = req.body;
  if (b.name !== undefined) {
    const nextName = String(b.name).trim().slice(0, 200);
    if (!nextName) { res.status(400).json({ error: "name is required" }); return; }
    updates.name = nextName;
  }
  if (b.priority !== undefined && Number.isFinite(Number(b.priority))) updates.priority = Number(b.priority);
  if (b.isActive !== undefined) updates.isActive = !!b.isActive;
  if (b.countries !== undefined) updates.countries = sanitizeStringArray(b.countries);
  if (b.universityIds !== undefined) updates.universityIds = sanitizeIntArray(b.universityIds);
  if (b.cities !== undefined) updates.cities = sanitizeStringArray(b.cities);
  if (b.phoneCodes !== undefined) updates.phoneCodes = sanitizeStringArray(b.phoneCodes);
  if (b.sources !== undefined) updates.sources = sanitizeStringArray(b.sources);
  if (b.staffUserIds !== undefined) {
    const staff = sanitizeIntArray(b.staffUserIds);
    if (staff.length === 0) { res.status(400).json({ error: "At least one staff member is required" }); return; }
    updates.staffUserIds = staff;
    updates.lastAssignedIndex = 0;
  }
  if (b.strategy !== undefined) {
    updates.strategy = VALID_STRATEGIES.includes(b.strategy as any) ? b.strategy : "first";
  }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const updated = await db.transaction(async tx => {
    const [saved] = await tx.update(leadAssignmentRulesTable).set(updates).where(eq(leadAssignmentRulesTable.id, id)).returning();
    if (!saved) return null;
    await writeRuleAudit(tx, req, "update_lead_assignment_rule", id, { changedFields: Object.keys(updates).sort() });
    return saved;
  });
  if (!updated) { res.status(404).json({ error: "Rule not found" }); return; }
  res.json(updated);
});

router.delete("/settings/lead-assignment-rules/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const deleted = await db.transaction(async tx => {
    const [removed] = await tx.delete(leadAssignmentRulesTable).where(eq(leadAssignmentRulesTable.id, id)).returning();
    if (!removed) return null;
    await writeRuleAudit(tx, req, "delete_lead_assignment_rule", id, { name: removed.name });
    return removed;
  });
  if (!deleted) { res.status(404).json({ error: "Rule not found" }); return; }
  res.json({ success: true });
});

export default router;
