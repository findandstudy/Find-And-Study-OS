import { Router, type IRouter } from "express";
import { db, programDocumentRequirementsTable, programsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";

const router: IRouter = Router();

router.get("/programs/:id/document-requirements", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(programDocumentRequirementsTable)
    .where(eq(programDocumentRequirementsTable.programId, id))
    .orderBy(programDocumentRequirementsTable.sortOrder);
  res.json(rows);
});

router.put("/programs/:id/document-requirements", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [prog] = await db.select({ id: programsTable.id }).from(programsTable).where(eq(programsTable.id, id));
  if (!prog) { res.status(404).json({ error: "Program not found" }); return; }

  const { requirements } = req.body as { requirements?: { documentType: string; mandatory?: boolean; sortOrder?: number }[] };
  if (!Array.isArray(requirements)) { res.status(400).json({ error: "requirements array is required" }); return; }

  const cleaned: { documentType: string; mandatory: boolean; sortOrder: number }[] = [];
  const seen = new Set<string>();
  requirements.forEach((r, idx) => {
    if (!r || typeof r.documentType !== "string") return;
    const dt = r.documentType.trim();
    if (!dt || seen.has(dt)) return;
    seen.add(dt);
    cleaned.push({
      documentType: dt,
      mandatory: !!r.mandatory,
      sortOrder: typeof r.sortOrder === "number" ? r.sortOrder : idx,
    });
  });

  await db.transaction(async (tx) => {
    await tx.delete(programDocumentRequirementsTable).where(eq(programDocumentRequirementsTable.programId, id));
    if (cleaned.length > 0) {
      await tx.insert(programDocumentRequirementsTable).values(cleaned.map(c => ({ ...c, programId: id })));
    }
  });

  await logAudit(req.user!.id, "update_program_document_requirements", "program", id, { count: cleaned.length }, req.ip);

  const rows = await db.select().from(programDocumentRequirementsTable)
    .where(eq(programDocumentRequirementsTable.programId, id))
    .orderBy(programDocumentRequirementsTable.sortOrder);
  res.json(rows);
});

export default router;
