import { Router, type IRouter } from "express";
import { db, pipelineStagesTable } from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES, AGENT_ROLES } from "../lib/roles";

const router: IRouter = Router();

(async () => {
  try {
    await db.execute(sql`
      DELETE FROM pipeline_stages
      WHERE id NOT IN (
        SELECT MIN(id) FROM pipeline_stages GROUP BY entity_type, key
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_entity_key_uniq
      ON pipeline_stages(entity_type, key)
    `);
  } catch {}
})();

const MANAGER_ROLES = ["super_admin", "admin", "manager"] as const;

const ENTITY_TYPES = ["lead", "application", "student"];

const DEFAULT_STAGES: Record<string, Array<{ key: string; label: string; sortOrder: number; variant?: string }>> = {
  lead: [
    { key: "new", label: "New", sortOrder: 0 },
    { key: "contacted", label: "Contacted", sortOrder: 1 },
    { key: "interested", label: "Interested", sortOrder: 2 },
    { key: "qualified", label: "Qualified", sortOrder: 3 },
    { key: "converted", label: "Converted", sortOrder: 4, variant: "won" },
    { key: "lost", label: "LOST", sortOrder: 5, variant: "lost" },
  ],
  application: [
    { key: "inquiry", label: "Inquiry", sortOrder: 0 },
    { key: "documents_collected", label: "Documents", sortOrder: 1 },
    { key: "submitted", label: "Submitted", sortOrder: 2 },
    { key: "offer_received", label: "Offer", sortOrder: 3 },
    { key: "visa_applied", label: "Visa Applied", sortOrder: 4 },
    { key: "visa_approved", label: "Visa OK", sortOrder: 5 },
    { key: "enrolled", label: "Enrolled", sortOrder: 6, variant: "won" },
    { key: "rejected", label: "Rejected", sortOrder: 7, variant: "lost" },
  ],
  student: [
    { key: "active", label: "Active", sortOrder: 0 },
    { key: "inactive", label: "Inactive", sortOrder: 1 },
    { key: "graduated", label: "Graduated", sortOrder: 2, variant: "won" },
    { key: "suspended", label: "Suspended", sortOrder: 3, variant: "lost" },
  ],
};

router.get("/pipeline-stages/:entityType", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (req, res): Promise<void> => {
  const { entityType } = req.params;
  if (!ENTITY_TYPES.includes(entityType)) {
    res.status(400).json({ error: "Invalid entity type" });
    return;
  }

  let stages = await db
    .select()
    .from(pipelineStagesTable)
    .where(eq(pipelineStagesTable.entityType, entityType))
    .orderBy(asc(pipelineStagesTable.sortOrder));

  if (stages.length === 0) {
    const defaults = DEFAULT_STAGES[entityType];
    if (defaults) {
      await db.insert(pipelineStagesTable)
        .values(defaults.map(d => ({ ...d, entityType })))
        .onConflictDoNothing();
      stages = await db
        .select()
        .from(pipelineStagesTable)
        .where(eq(pipelineStagesTable.entityType, entityType))
        .orderBy(asc(pipelineStagesTable.sortOrder));
    }
  }

  res.json(stages);
});

router.put("/pipeline-stages/:entityType", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { entityType } = req.params;
  if (!ENTITY_TYPES.includes(entityType)) {
    res.status(400).json({ error: "Invalid entity type" });
    return;
  }

  const { stages } = req.body;
  if (!Array.isArray(stages) || stages.length === 0) {
    res.status(400).json({ error: "stages array is required" });
    return;
  }

  for (const s of stages) {
    if (!s.key || !s.label) {
      res.status(400).json({ error: "Each stage needs key and label" });
      return;
    }
  }

  const normalizedKeys = stages.map((s: any) => String(s.key).toLowerCase().replace(/[^a-z0-9_]/g, "_"));
  const uniqueKeys = new Set(normalizedKeys);
  if (uniqueKeys.size !== normalizedKeys.length) {
    res.status(400).json({ error: "Duplicate keys not allowed" });
    return;
  }

  try {
    const inserted = await db.transaction(async (tx) => {
      await tx.delete(pipelineStagesTable).where(eq(pipelineStagesTable.entityType, entityType));

      const rows = await tx.insert(pipelineStagesTable)
        .values(stages.map((s: any, i: number) => ({
          entityType,
          key: normalizedKeys[i],
          label: String(s.label).slice(0, 50),
          sortOrder: i,
          variant: s.variant || null,
          icon: s.icon || null,
          color: s.color || null,
          isNotesMandatory: !!s.isNotesMandatory,
          canAttachFile: !!s.canAttachFile,
          maxFiles: s.canAttachFile ? Math.max(1, parseInt(s.maxFiles) || 1) : 1,
          isFileUploadMandatory: s.canAttachFile ? !!s.isFileUploadMandatory : false,
          canGoBack: s.canGoBack !== false,
          isCaseClose: !!s.isCaseClose,
          countries: s.countries || null,
        })))
        .returning();

      return rows;
    });

    res.json(inserted.sort((a, b) => a.sortOrder - b.sortOrder));
  } catch (err: any) {
    console.error("Failed to save pipeline stages:", err);
    res.status(500).json({ error: "Failed to save pipeline stages" });
  }
});

export default router;
