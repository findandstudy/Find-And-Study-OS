import { Router, type IRouter } from "express";
import { db, documentRequirementsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { ADMIN_ROLES } from "../lib/roles";

const router: IRouter = Router();

const LEVELS = ["pre_bachelors", "bachelors", "pre_masters", "masters", "phd", "others"];

const DEFAULT_DOCUMENT_TYPES = [
  "high_school_diploma_translation",
  "class_10th_ssc_marks_sheet",
  "class_12th_hsc_certificate",
  "class_12th_hsc_marks_sheet",
  "diploma_certificate",
  "diploma_transcript",
  "bachelors_certificate",
  "bachelors_transcript",
  "bachelors_provisional_certificate",
  "bachelors_transcript_all_semesters",
  "masters_certificate",
  "masters_transcript",
  "masters_provisional_certificate",
  "masters_transcript_all_semesters",
  "passport",
  "cv",
  "lor",
  "sop",
  "essay",
  "experience_letters",
  "other_certificates_documents",
  "ielts_pte_gre_gmat_toefl_duolingo",
];

router.get("/document-requirements", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db.select().from(documentRequirementsTable).orderBy(documentRequirementsTable.sortOrder);
  res.json(rows);
});

router.put("/document-requirements", requireAuth, requireRole(...ADMIN_ROLES), async (req, res): Promise<void> => {
  const { requirements } = req.body;
  if (!Array.isArray(requirements)) {
    res.status(400).json({ error: "requirements array is required" });
    return;
  }

  for (const r of requirements) {
    if (!r.documentType || !r.level) continue;
    const [existing] = await db.select().from(documentRequirementsTable)
      .where(and(eq(documentRequirementsTable.documentType, r.documentType), eq(documentRequirementsTable.level, r.level)));

    if (existing) {
      await db.update(documentRequirementsTable)
        .set({
          enabled: !!r.enabled,
          mandatory: !!r.mandatory,
          sortOrder: r.sortOrder ?? existing.sortOrder,
        })
        .where(eq(documentRequirementsTable.id, existing.id));
    } else {
      await db.insert(documentRequirementsTable).values({
        documentType: r.documentType,
        level: r.level,
        enabled: !!r.enabled,
        mandatory: !!r.mandatory,
        sortOrder: r.sortOrder ?? 0,
      });
    }
  }

  const rows = await db.select().from(documentRequirementsTable).orderBy(documentRequirementsTable.sortOrder);
  res.json(rows);
});

router.post("/document-requirements/seed-defaults", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res): Promise<void> => {
  const existing = await db.select().from(documentRequirementsTable);
  if (existing.length > 0) {
    res.json({ message: "Defaults already seeded", count: existing.length });
    return;
  }

  const defaults: { documentType: string; level: string; enabled: boolean; mandatory: boolean }[] = [];

  for (let i = 0; i < DEFAULT_DOCUMENT_TYPES.length; i++) {
    const dt = DEFAULT_DOCUMENT_TYPES[i];
    for (const level of LEVELS) {
      let enabled = false;
      let mandatory = false;

      if (dt === "passport") {
        enabled = true;
        mandatory = true;
      } else if (dt === "diploma_certificate" || dt === "diploma_transcript") {
        if (level === "pre_bachelors" || level === "others") { enabled = true; mandatory = true; }
      } else if (dt === "bachelors_certificate" || dt === "bachelors_transcript") {
        if (level === "pre_masters" || level === "masters") { enabled = true; mandatory = true; }
      } else if (dt === "bachelors_transcript_all_semesters") {
        if (level === "masters") { enabled = true; }
      } else if (dt === "masters_certificate" || dt === "masters_transcript") {
        if (level === "phd") { enabled = true; mandatory = true; }
      } else if (dt === "other_certificates_documents" || dt === "ielts_pte_gre_gmat_toefl_duolingo") {
        enabled = true;
      } else if (dt === "sop") {
        enabled = true;
      }

      defaults.push({ documentType: dt, level, enabled, mandatory });
    }
  }

  await db.insert(documentRequirementsTable).values(
    defaults.map((d, idx) => ({ ...d, sortOrder: Math.floor(idx / LEVELS.length) }))
  );

  res.json({ message: "Defaults seeded", count: defaults.length });
});

export default router;
