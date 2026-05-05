import { Router, type IRouter } from "express";
import { db, countriesTable, citiesTable, universitiesTable, programsTable, catalogOptionsTable, programDocumentRequirementsTable } from "@workspace/db";
import { eq, ilike, sql, and, asc, inArray } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";

const PROGRAM_DOC_TYPES = [
  "high_school_diploma_translation", "class_10th_ssc_marks_sheet",
  "class_12th_hsc_certificate", "class_12th_hsc_marks_sheet",
  "diploma_certificate", "diploma_transcript",
  "bachelors_certificate", "bachelors_transcript",
  "bachelors_provisional_certificate", "bachelors_transcript_all_semesters",
  "masters_certificate", "masters_transcript",
  "masters_provisional_certificate", "masters_transcript_all_semesters",
  "passport", "cv", "lor", "sop", "essay", "experience_letters",
  "other_certificates_documents", "ielts_pte_gre_gmat_toefl_duolingo",
  "photo", "diploma_recognition",
];

function parseDocCellValue(v: any): { value: "mandatory" | "optional" | null; invalid: boolean } {
  if (v === undefined || v === null) return { value: null, invalid: false };
  const s = String(v).trim().toLowerCase();
  if (!s) return { value: null, invalid: false };
  if (s === "mandatory") return { value: "mandatory", invalid: false };
  if (s === "optional") return { value: "optional", invalid: false };
  return { value: null, invalid: true };
}

const router: IRouter = Router();

/* ─── COUNTRIES ─────────────────────────────────────────────── */

router.get("/countries", async (req, res): Promise<void> => {
  const { search, page = "1", limit = "200" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const where = search ? ilike(countriesTable.name, `%${search}%`) : undefined;
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(countriesTable).where(where);
  const data = await db.select().from(countriesTable).where(where)
    .orderBy(countriesTable.name).limit(limitNum).offset(offset);

  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum } });
});

router.post("/countries", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { name, code, flagEmoji, isActive = true } = req.body;
  if (!name || !code) { res.status(400).json({ error: "name and code are required" }); return; }
  try {
    const [country] = await db.insert(countriesTable).values({ name, code: code.toUpperCase(), flagEmoji, isActive }).returning();
    await logAudit(req.user!.id, "create_country", "country", country.id, { name, code }, req.ip);
    res.status(201).json(country);
  } catch { res.status(409).json({ error: "Country code or name already exists" }); }
});

router.post("/countries/bulk", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const rows: { name: string; code: string; flagEmoji?: string }[] = req.body;
  if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: "Expected non-empty array" }); return; }
  const values = rows.map(r => ({ name: r.name, code: r.code.toUpperCase(), flagEmoji: r.flagEmoji ?? null, isActive: true }));
  const inserted = await db.insert(countriesTable).values(values).onConflictDoNothing().returning();
  await logAudit(req.user!.id, "bulk_import_countries", "country", undefined, { count: inserted.length }, req.ip);
  res.json({ inserted: inserted.length, skipped: rows.length - inserted.length });
});

router.patch("/countries/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { name, code, flagEmoji, isActive } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (code !== undefined) updates.code = code.toUpperCase();
  if (flagEmoji !== undefined) updates.flagEmoji = flagEmoji;
  if (isActive !== undefined) updates.isActive = isActive;
  const [country] = await db.update(countriesTable).set(updates).where(eq(countriesTable.id, id)).returning();
  if (!country) { res.status(404).json({ error: "Not found" }); return; }
  res.json(country);
});

router.delete("/countries/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(countriesTable).where(eq(countriesTable.id, id));
  res.sendStatus(204);
});

/* ─── CITIES ─────────────────────────────────────────────────── */

router.get("/cities", async (req, res): Promise<void> => {
  const { countryId, search, page = "1", limit = "500" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (countryId) conditions.push(eq(citiesTable.countryId, parseInt(countryId, 10)));
  if (search) conditions.push(ilike(citiesTable.name, `%${search}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(citiesTable).where(where);
  const data = await db.select().from(citiesTable).where(where)
    .orderBy(citiesTable.name).limit(limitNum).offset(offset);

  res.json({ data, meta: { total: Number(count), page: pageNum, limit: limitNum } });
});

router.post("/cities", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { name, countryId, isActive = true } = req.body;
  if (!name || !countryId) { res.status(400).json({ error: "name and countryId are required" }); return; }
  const [city] = await db.insert(citiesTable).values({ name, countryId, isActive }).returning();
  await logAudit(req.user!.id, "create_city", "city", city.id, { name, countryId }, req.ip);
  res.status(201).json(city);
});

router.post("/cities/bulk", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const rows: { name: string; countryId?: number; countryCode?: string }[] = req.body;
  if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: "Expected non-empty array" }); return; }

  const allCountries = await db.select().from(countriesTable);
  const codeMap = Object.fromEntries(allCountries.map(c => [c.code.toUpperCase(), c.id]));

  const values = rows.map(r => {
    const cid = r.countryId ?? (r.countryCode ? codeMap[r.countryCode.toUpperCase()] : undefined);
    if (!cid) return null;
    return { name: r.name, countryId: cid, isActive: true };
  }).filter(Boolean) as { name: string; countryId: number; isActive: boolean }[];

  if (values.length === 0) { res.status(400).json({ error: "No valid rows (countryId or countryCode required)" }); return; }
  const inserted = await db.insert(citiesTable).values(values).returning();
  await logAudit(req.user!.id, "bulk_import_cities", "city", undefined, { count: inserted.length }, req.ip);
  res.json({ inserted: inserted.length, skipped: rows.length - inserted.length });
});

router.patch("/cities/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { name, countryId, isActive } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (countryId !== undefined) updates.countryId = countryId;
  if (isActive !== undefined) updates.isActive = isActive;
  const [city] = await db.update(citiesTable).set(updates).where(eq(citiesTable.id, id)).returning();
  if (!city) { res.status(404).json({ error: "Not found" }); return; }
  res.json(city);
});

router.delete("/cities/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(citiesTable).where(eq(citiesTable.id, id));
  res.sendStatus(204);
});

/* ─── UNIVERSITIES BULK ──────────────────────────────────────── */

router.post("/universities/bulk", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const rows: {
    name: string; country: string; city?: string; website?: string;
    description?: string; ranking?: number; logoUrl?: string;
    universityType?: string; taxType?: string; taxPercent?: number;
    qsRanking?: number; timesRanking?: number; shanghaiRanking?: number;
    cwtsLeidenRanking?: number; address?: string; onlinePaymentUrl?: string;
    cricosLink?: string; documentsLink?: string; currentFeeListLink?: string;
    initialDepositOptions?: string; admissionProcess?: string;
    contactPersonName?: string; contactPersonPhone?: string; contactPersonEmail?: string;
    status?: string; isActive?: string | boolean;
  }[] = req.body;
  if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: "Expected non-empty array" }); return; }

  const values = rows.filter(r => r.name && r.country).map(r => ({
    name: r.name, country: r.country, city: r.city ?? null,
    website: r.website ?? null, description: r.description ?? null,
    ranking: r.ranking ? Number(r.ranking) : null, logoUrl: r.logoUrl ?? null,
    universityType: r.universityType ?? null,
    taxType: r.taxType ?? null,
    taxPercent: r.taxPercent ? Number(r.taxPercent) : null,
    qsRanking: r.qsRanking ? Number(r.qsRanking) : null,
    timesRanking: r.timesRanking ? Number(r.timesRanking) : null,
    shanghaiRanking: r.shanghaiRanking ? Number(r.shanghaiRanking) : null,
    cwtsLeidenRanking: r.cwtsLeidenRanking ? Number(r.cwtsLeidenRanking) : null,
    address: r.address ?? null,
    onlinePaymentUrl: r.onlinePaymentUrl ?? null,
    cricosLink: r.cricosLink ?? null,
    documentsLink: r.documentsLink ?? null,
    currentFeeListLink: r.currentFeeListLink ?? null,
    initialDepositOptions: r.initialDepositOptions ?? null,
    admissionProcess: r.admissionProcess ?? null,
    contactPersonName: r.contactPersonName ?? null,
    contactPersonPhone: r.contactPersonPhone ?? null,
    contactPersonEmail: r.contactPersonEmail ?? null,
    status: r.status ?? "open",
    isActive: r.isActive === false || (typeof r.isActive === "string" && ["no", "false", "0"].includes(r.isActive.toLowerCase().trim())) ? false : true,
  }));

  if (values.length === 0) { res.status(400).json({ error: "No valid rows" }); return; }
  const inserted = await db.insert(universitiesTable).values(values).onConflictDoNothing().returning();
  await logAudit(req.user!.id, "bulk_import_universities", "university", undefined, { count: inserted.length }, req.ip);
  res.json({ inserted: inserted.length, skipped: rows.length - inserted.length });
});

/* ─── PROGRAMS BULK ──────────────────────────────────────────── */

router.post("/programs/bulk", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  try {
  const rows: ({
    universityId?: number; universityName?: string; name: string;
    degree?: string; field?: string; language?: string;
    duration?: string; tuitionFee?: number; currency?: string;
    scholarship?: number; intakes?: string; requirements?: string;
    commissionRate?: number; applicationFee?: number; advancedFee?: number;
    depositFee?: number; serviceFeeAmount?: number; discountedFee?: number;
    languageFee?: number; feeType?: string; minGpa?: number; minLanguageScore?: number;
    quota?: number; isActive?: string | boolean;
  } & Record<string, any>)[] = req.body;
  if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: "Expected non-empty array" }); return; }

  const allUnis = await db.select({ id: universitiesTable.id, name: universitiesTable.name }).from(universitiesTable);
  const uniNameMap = Object.fromEntries(allUnis.map(u => [u.name.toLowerCase(), u.id]));

  const docColsByRowIdx = new Map<number, { documentType: string; mandatory: boolean; sortOrder: number }[] | undefined>();
  const rowIdxByParsedIdx: number[] = [];
  let invalidDocCells = 0;
  const skipReasons: { row: number; reason: string }[] = [];
  const parsed = rows.map((r, rowIdx) => {
    // Excel parsed via XLSX often gives "" for empty cells, which `??` does
    // not treat as missing — coerce blanks to undefined first.
    const rawId = r.universityId === "" || r.universityId === null ? undefined : r.universityId;
    const rawName = typeof r.universityName === "string" && r.universityName.trim() ? r.universityName.trim() : undefined;
    const uid = rawId ?? (rawName ? uniNameMap[rawName.toLowerCase()] : undefined);
    if (!uid) {
      skipReasons.push({
        row: rowIdx + 2,
        reason: rawName
          ? `unknown universityName "${rawName}" (not found in database)`
          : "missing universityId / universityName",
      });
      return null;
    }
    if (!r.name) {
      skipReasons.push({ row: rowIdx + 2, reason: "missing program name" });
      return null;
    }
    let docList: { documentType: string; mandatory: boolean; sortOrder: number }[] | undefined;
    let sawAnyDocCol = false;
    PROGRAM_DOC_TYPES.forEach((dt, idx) => {
      if (Object.prototype.hasOwnProperty.call(r, dt)) {
        sawAnyDocCol = true;
        const { value, invalid } = parseDocCellValue((r as any)[dt]);
        if (invalid) invalidDocCells++;
        if (value !== null) {
          if (!docList) docList = [];
          docList.push({ documentType: dt, mandatory: value === "mandatory", sortOrder: idx });
        }
      }
    });
    if (sawAnyDocCol) docColsByRowIdx.set(rowIdx, docList ?? []);
    rowIdxByParsedIdx.push(rowIdx);
    return {
      universityId: uid, name: r.name, degree: r.degree ?? null,
      field: r.field ?? null, language: r.language ?? null,
      duration: r.duration ?? null,
      tuitionFee: r.tuitionFee ? Number(r.tuitionFee) : null,
      currency: r.currency ?? "USD",
      scholarship: r.scholarship ? Number(r.scholarship) : null,
      intakes: r.intakes ?? null, requirements: r.requirements ?? null,
      commissionRate: r.commissionRate ? Number(r.commissionRate) : null,
      applicationFee: r.applicationFee ? Number(r.applicationFee) : null,
      advancedFee: r.advancedFee ? Number(r.advancedFee) : null,
      depositFee: r.depositFee ? Number(r.depositFee) : null,
      serviceFeeAmount: r.serviceFeeAmount ? Number(r.serviceFeeAmount) : null,
      discountedFee: r.discountedFee ? Number(r.discountedFee) : null,
      languageFee: r.languageFee ? Number(r.languageFee) : null,
      feeType: r.feeType ?? null,
      minGpa: r.minGpa ? Number(r.minGpa) : null,
      minLanguageScore: r.minLanguageScore ? Number(r.minLanguageScore) : null,
      quota: r.quota ? (isNaN(Number(r.quota)) || Math.round(Number(r.quota)) < 1 ? null : Math.round(Number(r.quota))) : null,
      isActive: r.isActive === false || (typeof r.isActive === "string" && ["no", "false", "0"].includes(r.isActive.toLowerCase().trim())) ? false : true,
    };
  }).filter(Boolean) as (typeof programsTable.$inferInsert)[];

  if (parsed.length === 0) {
    const sample = skipReasons.slice(0, 5).map(s => `row ${s.row}: ${s.reason}`).join("; ");
    const more = skipReasons.length > 5 ? ` (+${skipReasons.length - 5} more)` : "";
    res.status(400).json({
      error: `No valid rows imported. ${sample}${more}`,
      skipReasons,
    });
    return;
  }

  const existingPrograms = await db.select().from(programsTable);
  const existingMap = new Map<string, number>();
  for (const p of existingPrograms) {
    const key = `${p.universityId}|${(p.name || "").toLowerCase()}|${(p.degree || "").toLowerCase()}|${(p.language || "").toLowerCase()}`;
    existingMap.set(key, p.id);
  }

  let insertedCount = 0;
  let updatedCount = 0;
  const toInsert: typeof parsed = [];
  const insertRowIdxs: number[] = [];
  const docsToReplace = new Map<number, { documentType: string; mandatory: boolean; sortOrder: number }[]>();

  const seenKeys = new Set<string>();
  for (let i = 0; i < parsed.length; i++) {
    const val = parsed[i];
    const origRowIdx = rowIdxByParsedIdx[i] ?? i;
    const key = `${val.universityId}|${(val.name || "").toLowerCase()}|${(val.degree || "").toLowerCase()}|${(val.language || "").toLowerCase()}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const existingId = existingMap.get(key);
    if (existingId) {
      const { universityId: _uid, ...updates } = val;
      await db.update(programsTable).set({ ...updates, updatedAt: new Date() }).where(eq(programsTable.id, existingId));
      updatedCount++;
      if (docColsByRowIdx.has(origRowIdx)) {
        docsToReplace.set(existingId, docColsByRowIdx.get(origRowIdx) || []);
      }
    } else {
      toInsert.push(val);
      insertRowIdxs.push(origRowIdx);
    }
  }

  // Postgres bind-parameter limit is 32767 (16-bit). For 7000+ row imports,
  // a single INSERT...VALUES blows past this, so we chunk all bulk writes.
  // ~22 cols × 500 rows = 11000 params, well under the limit.
  const INSERT_CHUNK = 500;

  if (toInsert.length > 0) {
    const allInserted: { id: number }[] = [];
    for (let off = 0; off < toInsert.length; off += INSERT_CHUNK) {
      const slice = toInsert.slice(off, off + INSERT_CHUNK);
      const inserted = await db.insert(programsTable).values(slice).returning({ id: programsTable.id });
      allInserted.push(...inserted);
    }
    insertedCount = allInserted.length;
    allInserted.forEach((p, idx) => {
      const origRowIdx = insertRowIdxs[idx];
      if (docColsByRowIdx.has(origRowIdx)) {
        docsToReplace.set(p.id, docColsByRowIdx.get(origRowIdx) || []);
      }
    });
  }

  if (docsToReplace.size > 0) {
    const ids = [...docsToReplace.keys()];
    // Chunk DELETE too — inArray with 7000 ids = 7000 bind params, still fine,
    // but be safe for future growth.
    const ID_CHUNK = 5000;
    for (let off = 0; off < ids.length; off += ID_CHUNK) {
      await db.delete(programDocumentRequirementsTable)
        .where(inArray(programDocumentRequirementsTable.programId, ids.slice(off, off + ID_CHUNK)));
    }
    const allDocRows: { programId: number; documentType: string; mandatory: boolean; sortOrder: number }[] = [];
    for (const [pid, docs] of docsToReplace.entries()) {
      for (const d of docs) allDocRows.push({ programId: pid, ...d });
    }
    if (allDocRows.length > 0) {
      // 4 cols × 1000 rows = 4000 params per chunk.
      const DOC_CHUNK = 1000;
      for (let off = 0; off < allDocRows.length; off += DOC_CHUNK) {
        await db.insert(programDocumentRequirementsTable)
          .values(allDocRows.slice(off, off + DOC_CHUNK));
      }
    }
  }

  await logAudit(req.user!.id, "bulk_import_programs", "program", undefined, { inserted: insertedCount, updated: updatedCount, docsTouched: docsToReplace.size, invalidDocCells }, req.ip);
  res.json({ inserted: insertedCount, updated: updatedCount, skipped: rows.length - parsed.length, docsTouched: docsToReplace.size, invalidDocCells });
  } catch (err: any) {
    console.error("[programs/bulk] failed:", err?.message || err, err?.code, err?.detail, err?.stack?.split("\n").slice(0, 4).join(" | "));
    res.status(500).json({
      error: err?.message || "Bulk import failed",
      code: err?.code,
      detail: err?.detail,
      hint: err?.hint,
    });
  }
});

/* ─── CATALOG OPTIONS ──────────────────────────────────────── */

const VALID_CATEGORIES = ["degree", "language", "duration", "fee_type", "intake", "field", "university_type"];

router.get("/catalog-options", async (_req, res): Promise<void> => {
  const data = await db.select().from(catalogOptionsTable).orderBy(asc(catalogOptionsTable.category), asc(catalogOptionsTable.sortOrder));
  const grouped: Record<string, typeof data> = {};
  for (const row of data) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(row);
  }
  res.json({ data, grouped });
});

router.post("/catalog-options", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const { category, value, sortOrder = 0 } = req.body;
  if (!category || !value) { res.status(400).json({ error: "category and value are required" }); return; }
  if (!VALID_CATEGORIES.includes(category)) { res.status(400).json({ error: "Invalid category" }); return; }
  const [opt] = await db.insert(catalogOptionsTable).values({ category, value, sortOrder }).returning();
  await logAudit(req.user!.id, "create_catalog_option", "catalog_option", opt.id, { category, value }, req.ip);
  res.status(201).json(opt);
});

router.patch("/catalog-options/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { value, sortOrder, isActive } = req.body;
  const updates: Record<string, unknown> = {};
  if (value !== undefined) updates.value = value;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  if (isActive !== undefined) updates.isActive = isActive;
  const [opt] = await db.update(catalogOptionsTable).set(updates).where(eq(catalogOptionsTable.id, id)).returning();
  if (!opt) { res.status(404).json({ error: "Not found" }); return; }
  res.json(opt);
});

router.delete("/catalog-options/:id", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(catalogOptionsTable).where(eq(catalogOptionsTable.id, id));
  await logAudit(req.user!.id, "delete_catalog_option", "catalog_option", id, {}, req.ip);
  res.sendStatus(204);
});

export default router;
