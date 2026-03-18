import { Router, type IRouter } from "express";
import { db, countriesTable, citiesTable, universitiesTable, programsTable, catalogOptionsTable } from "@workspace/db";
import { eq, ilike, sql, and, asc } from "drizzle-orm";
import { requireAuth, requireRole, logAudit } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";

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
  }[] = req.body;
  if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: "Expected non-empty array" }); return; }

  const values = rows.filter(r => r.name && r.country).map(r => ({
    name: r.name, country: r.country, city: r.city ?? null,
    website: r.website ?? null, description: r.description ?? null,
    ranking: r.ranking ? Number(r.ranking) : null, logoUrl: r.logoUrl ?? null,
    isActive: true,
  }));

  if (values.length === 0) { res.status(400).json({ error: "No valid rows" }); return; }
  const inserted = await db.insert(universitiesTable).values(values).onConflictDoNothing().returning();
  await logAudit(req.user!.id, "bulk_import_universities", "university", undefined, { count: inserted.length }, req.ip);
  res.json({ inserted: inserted.length, skipped: rows.length - inserted.length });
});

/* ─── PROGRAMS BULK ──────────────────────────────────────────── */

router.post("/programs/bulk", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const rows: {
    universityId?: number; universityName?: string; name: string;
    degree?: string; field?: string; language?: string;
    duration?: string; tuitionFee?: number; currency?: string;
    scholarship?: number; intakes?: string; requirements?: string;
    commissionRate?: number;
  }[] = req.body;
  if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ error: "Expected non-empty array" }); return; }

  const allUnis = await db.select({ id: universitiesTable.id, name: universitiesTable.name }).from(universitiesTable);
  const uniNameMap = Object.fromEntries(allUnis.map(u => [u.name.toLowerCase(), u.id]));

  const values = rows.map(r => {
    const uid = r.universityId ?? (r.universityName ? uniNameMap[r.universityName.toLowerCase()] : undefined);
    if (!uid || !r.name) return null;
    return {
      universityId: uid, name: r.name, degree: r.degree ?? null,
      field: r.field ?? null, language: r.language ?? null,
      duration: r.duration ?? null,
      tuitionFee: r.tuitionFee ? Number(r.tuitionFee) : null,
      currency: r.currency ?? "USD",
      scholarship: r.scholarship ? Number(r.scholarship) : null,
      intakes: r.intakes ?? null, requirements: r.requirements ?? null,
      commissionRate: r.commissionRate ? Number(r.commissionRate) : null,
      isActive: true,
    };
  }).filter(Boolean) as ReturnType<typeof programsTable.$inferInsert>[];

  if (values.length === 0) { res.status(400).json({ error: "No valid rows (universityId or universityName + name required)" }); return; }
  const inserted = await db.insert(programsTable).values(values).returning();
  await logAudit(req.user!.id, "bulk_import_programs", "program", undefined, { count: inserted.length }, req.ip);
  res.json({ inserted: inserted.length, skipped: rows.length - inserted.length });
});

/* ─── CATALOG OPTIONS ──────────────────────────────────────── */

const VALID_CATEGORIES = ["degree", "language", "duration", "fee_type", "intake", "field"];

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
