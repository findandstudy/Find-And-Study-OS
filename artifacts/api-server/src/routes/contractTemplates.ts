import { Router, type IRouter } from "express";
import { db, contractTemplatesTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";
import { writeAudit } from "../lib/auditLog";

const router: IRouter = Router();

router.get("/contract-templates", requireAuth, requirePermission("contract_templates.view"), async (req, res): Promise<void> => {
  try {
    const filters: any[] = [isNull(contractTemplatesTable.deletedAt)];
    const language = (req.query.language as string) || null;
    const entityType = (req.query.entityType as string) || null;
    const isActiveQ = req.query.isActive;
    if (language) filters.push(eq(contractTemplatesTable.language, language));
    if (entityType === "company" || entityType === "individual") filters.push(eq(contractTemplatesTable.entityType, entityType));
    if (isActiveQ === "true") filters.push(eq(contractTemplatesTable.isActive, true));
    if (isActiveQ === "false") filters.push(eq(contractTemplatesTable.isActive, false));
    const rows = await db.select().from(contractTemplatesTable)
      .where(and(...filters))
      .orderBy(desc(contractTemplatesTable.updatedAt));
    res.json({ data: rows });
  } catch (err) {
    console.error("[contract-templates] list:", err);
    res.status(500).json({ error: "Failed to list contract templates" });
  }
});

// Render a template against an arbitrary intake payload — used by admins to
// preview the final HTML before sending or saving template edits.
router.post("/contract-templates/:id/preview", requireAuth, requirePermission("contract_templates.view"), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(contractTemplatesTable)
      .where(and(eq(contractTemplatesTable.id, id), isNull(contractTemplatesTable.deletedAt)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const { renderTemplate } = await import("../lib/contractRenderer");
    const html = renderTemplate(row.bodyHtml, req.body?.intakeData || {});
    res.json({ data: { html, templateName: row.name, language: row.language, entityType: row.entityType, version: row.version } });
  } catch (err) {
    console.error("[contract-templates] preview:", err);
    res.status(500).json({ error: "Failed to render preview" });
  }
});

router.get("/contract-templates/:id", requireAuth, requirePermission("contract_templates.view"), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const [row] = await db.select().from(contractTemplatesTable)
      .where(and(eq(contractTemplatesTable.id, id), isNull(contractTemplatesTable.deletedAt)));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ data: row });
  } catch (err) {
    console.error("[contract-templates] get:", err);
    res.status(500).json({ error: "Failed to fetch contract template" });
  }
});

router.post("/contract-templates", requireAuth, requirePermission("contract_templates.manage"), async (req, res): Promise<void> => {
  try {
    const { name, language, entityType, version, bodyHtml, intakeSchema, isActive } = req.body || {};
    if (!name || typeof name !== "string") { res.status(400).json({ error: "name is required" }); return; }
    if (!bodyHtml || typeof bodyHtml !== "string") { res.status(400).json({ error: "bodyHtml is required" }); return; }
    const norm = {
      name: String(name).slice(0, 200),
      language: language && typeof language === "string" ? language.slice(0, 8) : "en",
      entityType: entityType === "individual" ? "individual" : "company",
      version: Number.isInteger(version) && version > 0 ? version : 1,
      bodyHtml: String(bodyHtml),
      intakeSchema: Array.isArray(intakeSchema) ? intakeSchema : null,
      isActive: isActive !== false,
    };
    const [row] = await db.insert(contractTemplatesTable).values(norm).returning();
    await writeAudit({
      userId: (req as any).user?.id ?? null,
      action: "contract_template.create",
      resource: "contract_template",
      resourceId: row.id,
      changes: { name: row.name, language: row.language, entityType: row.entityType, version: row.version },
      ipAddress: req.ip,
    });
    res.status(201).json({ data: row });
  } catch (err) {
    console.error("[contract-templates] create:", err);
    res.status(500).json({ error: "Failed to create contract template" });
  }
});

router.patch("/contract-templates/:id", requireAuth, requirePermission("contract_templates.manage"), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    const updates: any = {};
    const allowed = ["name", "language", "entityType", "version", "bodyHtml", "intakeSchema", "isActive"];
    for (const k of allowed) {
      if (k in (req.body || {})) updates[k] = req.body[k];
    }
    if (updates.entityType && updates.entityType !== "individual") updates.entityType = "company";
    if (updates.intakeSchema != null && !Array.isArray(updates.intakeSchema)) updates.intakeSchema = null;
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
    // Auto-bump version when contract body content changes — preserves an
    // immutable history of what was actually signed at the time of signing.
    const [existing] = await db.select().from(contractTemplatesTable)
      .where(and(eq(contractTemplatesTable.id, id), isNull(contractTemplatesTable.deletedAt)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if ("bodyHtml" in updates && typeof updates.bodyHtml === "string" && updates.bodyHtml !== existing.bodyHtml && !("version" in (req.body || {}))) {
      updates.version = (existing.version || 1) + 1;
    }
    const [row] = await db.update(contractTemplatesTable).set(updates)
      .where(and(eq(contractTemplatesTable.id, id), isNull(contractTemplatesTable.deletedAt)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await writeAudit({
      userId: (req as any).user?.id ?? null,
      action: "contract_template.update",
      resource: "contract_template",
      resourceId: row.id,
      changes: updates,
      ipAddress: req.ip,
    });
    res.json({ data: row });
  } catch (err) {
    console.error("[contract-templates] update:", err);
    res.status(500).json({ error: "Failed to update contract template" });
  }
});

router.delete("/contract-templates/:id", requireAuth, requirePermission("contract_templates.manage"), async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.update(contractTemplatesTable)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(contractTemplatesTable.id, id));
    await writeAudit({
      userId: (req as any).user?.id ?? null,
      action: "contract_template.delete",
      resource: "contract_template",
      resourceId: id,
      ipAddress: req.ip,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[contract-templates] delete:", err);
    res.status(500).json({ error: "Failed to delete contract template" });
  }
});

export default router;
