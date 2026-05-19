import { Router, type IRouter } from "express";
import { db, pipelineStagesTable, programDocumentRequirementsTable } from "@workspace/db";
import type { StageAction } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { STAFF_ROLES, AGENT_ROLES } from "../lib/roles";
import { clearStageFinanceCache } from "../lib/stageFinance";

const router: IRouter = Router();

// One-shot startup tasks: dedup + ensure unique index. The behavior-flag
// backfill (Task #134) is gated on a marker row in `pipeline_migrations`
// so it runs exactly once per database — admin-configured behavior is
// never overwritten on subsequent boots.
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
    // Task #167 — admin-defined per-stage action buttons. Idempotent.
    await db.execute(sql`
      ALTER TABLE pipeline_stages
      ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  } catch {}

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pipeline_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const claim = await db.execute<{ name: string }>(sql`
      INSERT INTO pipeline_migrations (name) VALUES ('task_134_backfill_v3')
      ON CONFLICT (name) DO NOTHING
      RETURNING name
    `);
    // node-postgres returns { rows: [...] }; some drivers return the array
    // directly. Handle both shapes without an `any` escape hatch.
    const claimed = Array.isArray(claim)
      ? claim.length > 0
      : (claim.rows?.length ?? 0) > 0;
    if (claimed) {
      await db.execute(sql`
        UPDATE pipeline_stages SET upload_permission_level = 'everyone'
        WHERE entity_type = 'application'
          AND upload_permission_level = 'none'
          AND key IN ('app_fee_paid','missing_docs','upload_payment','deposit_paid','visa_approved','student_card','visa_reject')
      `);
      // Offer stages were historically gated by ADMIN_ROLES only — preserve
      // that exact behavior using the dedicated 'admin_only' level.
      await db.execute(sql`
        UPDATE pipeline_stages SET upload_permission_level = 'admin_only', tracks_offer_expiry = true
        WHERE entity_type = 'application'
          AND key IN ('offer_received','acceptance_letter','final_acceptance')
      `);
      // Repair any rows that an earlier (v2) backfill broadened from
      // admin_only to staff_only on the legacy default offer keys.
      await db.execute(sql`
        UPDATE pipeline_stages SET upload_permission_level = 'admin_only'
        WHERE entity_type = 'application'
          AND upload_permission_level = 'staff_only'
          AND key IN ('offer_received','acceptance_letter','final_acceptance')
      `);
      await db.execute(sql`
        UPDATE pipeline_stages SET requires_valid_until = true
        WHERE entity_type = 'application' AND key = 'offer_received'
      `);
      await db.execute(sql`
        UPDATE pipeline_stages SET is_file_upload_mandatory = true, can_attach_file = true
        WHERE entity_type = 'application'
          AND key IN ('app_fee_paid','offer_received','acceptance_letter','final_acceptance','upload_payment','deposit_paid','visa_approved','student_card')
      `);
      await db.execute(sql`
        UPDATE pipeline_stages SET commission_finance_status = 'confirmed', service_fee_finance_status = 'confirmed', auto_cancel_siblings_on_won = true
        WHERE entity_type = 'application' AND key = 'enrolled'
      `);
      await db.execute(sql`
        UPDATE pipeline_stages SET commission_finance_status = 'excluded', service_fee_finance_status = 'confirmed'
        WHERE entity_type = 'application' AND key IN ('100scholar','visa_reject')
      `);
      await db.execute(sql`
        UPDATE pipeline_stages SET commission_finance_status = 'excluded', service_fee_finance_status = 'excluded'
        WHERE entity_type = 'application' AND key IN ('rejected','all_registered','cancelled','refound')
      `);
      // Catch-up: any custom application stage whose variant is 'won' should
      // also auto-cancel siblings by default (matches old hardcoded behavior
      // for any won-variant stage, not just the built-in 'enrolled' key).
      await db.execute(sql`
        UPDATE pipeline_stages SET auto_cancel_siblings_on_won = true
        WHERE entity_type = 'application'
          AND variant = 'won'
          AND auto_cancel_siblings_on_won = false
      `);
      clearStageFinanceCache();
      console.log("[PIPELINE] Task #134 backfill v3 applied (one-shot).");
    }
  } catch (err) {
    console.error("[PIPELINE] Backfill failed:", err);
  }
})();

const MANAGER_ROLES = ["super_admin", "admin", "manager"] as const;

const ENTITY_TYPES = ["lead", "application", "student"];

type DefaultStage = {
  key: string; label: string; sortOrder: number; variant?: string;
  uploadPermissionLevel?: string;
  tracksOfferExpiry?: boolean;
  requiresValidUntil?: boolean;
  isFileUploadMandatory?: boolean;
  canAttachFile?: boolean;
  commissionFinanceStatus?: string | null;
  serviceFeeFinanceStatus?: string | null;
  autoCancelSiblingsOnWon?: boolean;
};

const DEFAULT_STAGES: Record<string, DefaultStage[]> = {
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
    {
      key: "offer_received", label: "Offer", sortOrder: 3,
      uploadPermissionLevel: "admin_only", tracksOfferExpiry: true,
      requiresValidUntil: true, isFileUploadMandatory: true, canAttachFile: true,
    },
    { key: "visa_applied", label: "Visa Applied", sortOrder: 4 },
    {
      key: "visa_approved", label: "Visa OK", sortOrder: 5,
      uploadPermissionLevel: "everyone", isFileUploadMandatory: true, canAttachFile: true,
    },
    {
      key: "enrolled", label: "Enrolled", sortOrder: 6, variant: "won",
      commissionFinanceStatus: "confirmed", serviceFeeFinanceStatus: "confirmed",
      autoCancelSiblingsOnWon: true,
    },
    {
      key: "rejected", label: "Rejected", sortOrder: 7, variant: "lost",
      commissionFinanceStatus: "excluded", serviceFeeFinanceStatus: "excluded",
    },
  ],
  student: [
    { key: "active", label: "Active", sortOrder: 0 },
    { key: "inactive", label: "Inactive", sortOrder: 1 },
    { key: "graduated", label: "Graduated", sortOrder: 2, variant: "won" },
    { key: "suspended", label: "Suspended", sortOrder: 3, variant: "lost" },
  ],
};

const ALLOWED_PERMISSION_LEVELS = new Set(["none", "admin_only", "staff_only", "staff_and_agent", "everyone"]);
const ALLOWED_FINANCE_STATUS = new Set(["potential", "confirmed", "excluded"]);
const ALLOWED_ACTION_TYPES = new Set(["upload", "download", "missing_docs"]);

function normActions(v: unknown, validStageKeys: Set<string>, ownStageKey: string): StageAction[] {
  if (!Array.isArray(v)) return [];
  const out: StageAction[] = [];
  for (const raw of v) {
    if (out.length >= 2) break;
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const type = String(a.type || "");
    if (!ALLOWED_ACTION_TYPES.has(type)) continue;
    const targetStageKey = String(a.targetStageKey || "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!targetStageKey || !validStageKeys.has(targetStageKey)) continue;
    // Reject self-targeting (length-1 cycle) — moving to the same stage is a no-op.
    if (targetStageKey === ownStageKey) continue;
    const label = typeof a.label === "string" ? a.label.slice(0, 32) || null : null;
    const color = typeof a.color === "string" ? a.color.slice(0, 16) || null : null;
    const requiredDocTypes = Array.isArray(a.requiredDocTypes)
      ? (a.requiredDocTypes as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 20)
      : [];
    out.push({ type: type as StageAction["type"], label, color, targetStageKey, requiredDocTypes });
  }
  return out;
}

// Task #167 — surface the catalog of document types admins can pick from when
// configuring "Missing Documents" / "Upload" actions. Combines the built-in
// catalog (used in StudentDocChecklist) with any custom types referenced in
// program_document_requirements so the picker matches real-world data.
const BUILTIN_DOC_TYPES = [
  "high_school_diploma_translation","class_10th_ssc_marks_sheet","class_12th_hsc_certificate",
  "class_12th_hsc_marks_sheet","diploma_certificate","diploma_transcript",
  "bachelors_certificate","bachelors_transcript","bachelors_provisional_certificate",
  "bachelors_transcript_all_semesters","masters_certificate","masters_transcript",
  "masters_provisional_certificate","masters_transcript_all_semesters",
  "passport","cv","lor","sop","essay","experience_letters",
  "other_certificates_documents","ielts_pte_gre_gmat_toefl_duolingo","photo","diploma_recognition",
];

router.get("/document-types", requireAuth, requireRole(...STAFF_ROLES, ...AGENT_ROLES), async (_req, res): Promise<void> => {
  let extra: string[] = [];
  try {
    const rows = await db
      .selectDistinct({ documentType: programDocumentRequirementsTable.documentType })
      .from(programDocumentRequirementsTable);
    extra = rows.map(r => r.documentType).filter((s): s is string => !!s);
  } catch {}
  const set = new Set<string>([...BUILTIN_DOC_TYPES, ...extra]);
  res.json([...set].sort());
});

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

  function normPermission(v: any): string {
    const s = typeof v === "string" ? v : "none";
    return ALLOWED_PERMISSION_LEVELS.has(s) ? s : "none";
  }
  function normFinance(v: any): string | null {
    if (v === null || v === undefined || v === "" || v === "auto") return null;
    const s = String(v);
    return ALLOWED_FINANCE_STATUS.has(s) ? s : null;
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
          mappedStudentStageKey: entityType === "application" && s.mappedStudentStageKey ? String(s.mappedStudentStageKey) : null,
          uploadPermissionLevel: entityType === "application" ? normPermission(s.uploadPermissionLevel) : "none",
          tracksOfferExpiry: entityType === "application" && !!s.tracksOfferExpiry,
          requiresValidUntil: entityType === "application" && !!s.tracksOfferExpiry && !!s.requiresValidUntil,
          commissionFinanceStatus: entityType === "application" ? normFinance(s.commissionFinanceStatus) : null,
          serviceFeeFinanceStatus: entityType === "application" ? normFinance(s.serviceFeeFinanceStatus) : null,
          autoCancelSiblingsOnWon: entityType === "application" && !!s.autoCancelSiblingsOnWon,
          actions: entityType === "application"
            ? normActions(s.actions, new Set(normalizedKeys), String(s.key || "").toLowerCase().replace(/[^a-z0-9_]/g, "_"))
            : [],
        })))
        .returning();

      return rows;
    });

    clearStageFinanceCache();

    // Non-blocking warnings — surfaced to admin UI as toasts but do not
    // prevent the save (admins can intentionally run pipelines without
    // these features).
    const warnings: string[] = [];
    if (entityType === "application") {
      const hasOfferTracking = inserted.some(s => s.tracksOfferExpiry);
      if (!hasOfferTracking) {
        warnings.push("No stage tracks offer expiry. Offer-letter deadlines and expiry reminders will not run until at least one stage has 'Track offer expiry' enabled.");
      }
      const hasConfirmedCommission = inserted.some(s => s.commissionFinanceStatus === "confirmed" || (s.commissionFinanceStatus === null && s.variant === "won"));
      if (!hasConfirmedCommission) {
        warnings.push("No stage marks commission as confirmed. Commission finance entries will never move to confirmed without a stage configured for it.");
      }
    }

    res.json({
      stages: inserted.sort((a, b) => a.sortOrder - b.sortOrder),
      warnings,
    });
  } catch (err: any) {
    console.error("Failed to save pipeline stages:", err);
    res.status(500).json({ error: "Failed to save pipeline stages" });
  }
});

export default router;
