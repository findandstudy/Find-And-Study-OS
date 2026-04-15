import { Router, type IRouter } from "express";
import { db, universitiesTable, programsTable } from "@workspace/db";
import { eq, ilike, sql, and } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { MANAGER_ROLES, STAFF_ROLES } from "../lib/roles";

const router: IRouter = Router();

const UNI_PATCH_FIELDS = [
  "name", "country", "city", "website", "logoUrl", "description", "ranking", "isActive",
  "universityType", "taxType", "taxPercent", "qsRanking", "timesRanking", "shanghaiRanking",
  "cwtsLeidenRanking", "address", "onlinePaymentUrl", "cricosLink", "documentsLink",
  "currentFeeListLink", "initialDepositOptions", "admissionProcess",
  "contactPersonName", "contactPersonPhone", "contactPersonEmail", "status",
];

const CONTACT_FIELDS = ["contactPersonName", "contactPersonPhone", "contactPersonEmail"];
const PROG_PATCH_FIELDS = [
  "universityId", "name", "degree", "field", "language", "duration",
  "tuitionFee", "currency", "scholarship", "intakes", "requirements",
  "commissionRate", "applicationFee", "advancedFee", "depositFee",
  "serviceFeeAmount", "discountedFee", "languageFee", "feeType",
  "minGpa", "minLanguageScore", "quota", "isActive",
];

/* ─── UNIVERSITIES ───────────────────────────────────────────── */

function maskContacts(uni: Record<string, any>, userRole?: string): Record<string, any> {
  if (userRole === "super_admin") return uni;
  const masked = { ...uni };
  for (const f of CONTACT_FIELDS) {
    delete masked[f];
  }
  return masked;
}

router.get("/universities/countries", async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ country: universitiesTable.country })
    .from(universitiesTable)
    .orderBy(universitiesTable.country);
  res.json(rows.map(r => r.country).filter(Boolean));
});

router.get("/universities", async (req, res): Promise<void> => {
  const { country, search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (country) conditions.push(ilike(universitiesTable.country, `%${country}%`));
  if (search) conditions.push(ilike(universitiesTable.name, `%${search}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(universitiesTable).where(where);
  const rows = await db.select().from(universitiesTable).where(where).limit(limitNum).offset(offset).orderBy(universitiesTable.name);
  const userRole = (req as any).user?.role;
  const data = rows.map(u => maskContacts(u as any, userRole));

  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.post("/universities", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const {
    name, country, city, website, logoUrl, description, ranking, isActive = true,
    universityType, taxType, taxPercent, qsRanking, timesRanking, shanghaiRanking,
    cwtsLeidenRanking, address, onlinePaymentUrl, cricosLink, documentsLink,
    currentFeeListLink, initialDepositOptions, admissionProcess,
    contactPersonName, contactPersonPhone, contactPersonEmail, status = "open",
  } = req.body;
  if (!name || !country) { res.status(400).json({ error: "name and country are required" }); return; }
  const [uni] = await db.insert(universitiesTable).values({
    name, country, city: city || null, website: website || null, logoUrl: logoUrl || null,
    description: description || null, ranking: ranking ? Number(ranking) : null, isActive,
    universityType: universityType || null, taxType: taxType || null,
    taxPercent: taxPercent ? Number(taxPercent) : null,
    qsRanking: qsRanking ? Number(qsRanking) : null,
    timesRanking: timesRanking ? Number(timesRanking) : null,
    shanghaiRanking: shanghaiRanking ? Number(shanghaiRanking) : null,
    cwtsLeidenRanking: cwtsLeidenRanking ? Number(cwtsLeidenRanking) : null,
    address: address || null, onlinePaymentUrl: onlinePaymentUrl || null,
    cricosLink: cricosLink || null, documentsLink: documentsLink || null,
    currentFeeListLink: currentFeeListLink || null,
    initialDepositOptions: initialDepositOptions || null,
    admissionProcess: admissionProcess || null,
    contactPersonName: contactPersonName || null,
    contactPersonPhone: contactPersonPhone || null,
    contactPersonEmail: contactPersonEmail || null,
    status,
  }).returning();
  await logAudit(req.user!.id, "create_university", "university", uni.id, { name, country }, req.ip);
  res.status(201).json(uni);
});

router.get("/universities/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [uni] = await db.select().from(universitiesTable).where(eq(universitiesTable.id, id));
  if (!uni) { res.status(404).json({ error: "University not found" }); return; }
  const userRole = (req as any).user?.role;
  res.json(maskContacts(uni as any, userRole));
});

router.patch("/universities/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  for (const key of UNI_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields" }); return; }
  const [uni] = await db.update(universitiesTable).set(updates).where(eq(universitiesTable.id, id)).returning();
  if (!uni) { res.status(404).json({ error: "University not found" }); return; }
  await logAudit(req.user!.id, "update_university", "university", id, updates, req.ip);
  res.json(uni);
});

router.delete("/universities/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(universitiesTable).where(eq(universitiesTable.id, id));
  await logAudit(req.user!.id, "delete_university", "university", id, {}, req.ip);
  res.sendStatus(204);
});

/* ─── PROGRAMS ───────────────────────────────────────────────── */

router.get("/programs", async (req, res): Promise<void> => {
  const { universityId, language, search, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (universityId) conditions.push(eq(programsTable.universityId, parseInt(universityId, 10)));
  if (language) conditions.push(ilike(programsTable.language, language));
  if (search) conditions.push(ilike(programsTable.name, `%${search}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(programsTable).where(where);
  const data = await db.select().from(programsTable).where(where).limit(limitNum).offset(offset).orderBy(programsTable.name);

  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum, totalPages: Math.ceil(Number(count) / limitNum) } });
});

router.post("/programs", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const {
    universityId, name, degree, field, language, duration,
    tuitionFee, currency = "USD", scholarship, intakes, requirements, commissionRate,
    applicationFee, advancedFee, depositFee, serviceFeeAmount, discountedFee, languageFee,
    feeType, minGpa, minLanguageScore, quota, isActive = true,
  } = req.body;
  if (!universityId || !name) { res.status(400).json({ error: "universityId and name are required" }); return; }
  const n = (v: any) => (v !== undefined && v !== "" && v !== null ? Number(v) : null);
  let quotaVal: number | null = null;
  if (quota !== undefined && quota !== "" && quota !== null) {
    const qv = Math.round(Number(quota));
    if (isNaN(qv) || qv < 1) { res.status(400).json({ error: "quota must be a positive integer (>= 1) or empty" }); return; }
    quotaVal = qv;
  }
  const [prog] = await db.insert(programsTable).values({
    universityId: Number(universityId), name, degree: degree || null, field: field || null,
    language: language || null, duration: duration || null,
    tuitionFee: n(tuitionFee), currency,
    scholarship: n(scholarship),
    intakes: intakes || null, requirements: requirements || null,
    commissionRate: n(commissionRate),
    applicationFee: n(applicationFee),
    advancedFee: n(advancedFee),
    depositFee: n(depositFee),
    serviceFeeAmount: n(serviceFeeAmount),
    discountedFee: n(discountedFee),
    languageFee: n(languageFee),
    feeType: feeType || null,
    minGpa: n(minGpa),
    minLanguageScore: n(minLanguageScore),
    quota: quotaVal,
    isActive,
  }).returning();
  await logAudit(req.user!.id, "create_program", "program", prog.id, { universityId, name }, req.ip);
  res.status(201).json(prog);
});

router.get("/programs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [prog] = await db.select().from(programsTable).where(eq(programsTable.id, id));
  if (!prog) { res.status(404).json({ error: "Program not found" }); return; }
  res.json(prog);
});

router.patch("/programs/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  for (const key of PROG_PATCH_FIELDS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.quota !== undefined) {
    if (updates.quota === null || updates.quota === "") {
      updates.quota = null;
    } else {
      const qv = Math.round(Number(updates.quota));
      if (isNaN(qv) || qv < 1) { res.status(400).json({ error: "quota must be a positive integer (>= 1) or null" }); return; }
      updates.quota = qv;
    }
  }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields" }); return; }
  const [prog] = await db.update(programsTable).set(updates).where(eq(programsTable.id, id)).returning();
  if (!prog) { res.status(404).json({ error: "Program not found" }); return; }
  await logAudit(req.user!.id, "update_program", "program", id, updates, req.ip);
  res.json(prog);
});

router.delete("/programs/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(programsTable).where(eq(programsTable.id, id));
  await logAudit(req.user!.id, "delete_program", "program", id, {}, req.ip);
  res.sendStatus(204);
});

router.delete("/programs", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const result = await db.delete(programsTable).returning({ id: programsTable.id });
  await logAudit(req.user!.id, "delete_all_programs", "program", undefined, { count: result.length }, req.ip);
  res.json({ deleted: result.length });
});

export default router;
