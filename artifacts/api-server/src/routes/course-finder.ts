import { Router, type IRouter } from "express";
import { db, programsTable, universitiesTable, wishlistsTable } from "@workspace/db";
import { eq, ilike, sql, and, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/course-finder", async (req, res): Promise<void> => {
  const { country, level, language, search, intake, page = "1", limit = "24" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [eq(programsTable.isActive, true)];
  if (country) conditions.push(eq(universitiesTable.country, country));
  if (level) conditions.push(ilike(programsTable.degree, `%${level}%`));
  if (language) conditions.push(ilike(programsTable.language, language));
  if (intake) conditions.push(ilike(programsTable.intakes, `%${intake}%`));
  if (search) {
    conditions.push(
      sql`(${ilike(programsTable.name, `%${search}%`)} OR ${ilike(universitiesTable.name, `%${search}%`)})`
    );
  }

  const where = and(...conditions);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(programsTable)
    .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .where(where);

  const rows = await db
    .select({
      id: programsTable.id,
      name: programsTable.name,
      degree: programsTable.degree,
      field: programsTable.field,
      language: programsTable.language,
      duration: programsTable.duration,
      tuitionFee: programsTable.tuitionFee,
      currency: programsTable.currency,
      scholarship: programsTable.scholarship,
      intakes: programsTable.intakes,
      requirements: programsTable.requirements,
      commissionRate: programsTable.commissionRate,
      applicationFee: programsTable.applicationFee,
      advancedFee: programsTable.advancedFee,
      depositFee: programsTable.depositFee,
      serviceFeeAmount: programsTable.serviceFeeAmount,
      discountedFee: programsTable.discountedFee,
      languageFee: programsTable.languageFee,
      isActive: programsTable.isActive,
      universityId: programsTable.universityId,
      universityName: universitiesTable.name,
      universityLogoUrl: universitiesTable.logoUrl,
      universityCountry: universitiesTable.country,
      universityCity: universitiesTable.city,
      universityStatus: universitiesTable.status,
      universityType: universitiesTable.universityType,
    })
    .from(programsTable)
    .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .where(where)
    .orderBy(universitiesTable.name, programsTable.name)
    .limit(limitNum)
    .offset(offset);

  res.json({
    data: rows,
    meta: {
      total: Number(count),
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(Number(count) / limitNum),
    },
  });
});

router.get("/course-finder/filters", async (_req, res): Promise<void> => {
  const countries = await db
    .selectDistinct({ country: universitiesTable.country })
    .from(universitiesTable)
    .innerJoin(programsTable, eq(programsTable.universityId, universitiesTable.id))
    .where(eq(programsTable.isActive, true))
    .orderBy(universitiesTable.country);

  const degrees = await db
    .selectDistinct({ degree: programsTable.degree })
    .from(programsTable)
    .where(and(eq(programsTable.isActive, true), sql`${programsTable.degree} IS NOT NULL`))
    .orderBy(programsTable.degree);

  const languages = await db
    .selectDistinct({ language: programsTable.language })
    .from(programsTable)
    .where(and(eq(programsTable.isActive, true), sql`${programsTable.language} IS NOT NULL`))
    .orderBy(programsTable.language);

  res.json({
    countries: countries.map(r => r.country).filter(Boolean),
    degrees: degrees.map(r => r.degree).filter(Boolean),
    languages: languages.map(r => r.language).filter(Boolean),
  });
});

router.get("/wishlists", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const rows = await db.select().from(wishlistsTable).where(eq(wishlistsTable.userId, userId));
  res.json(rows.map(r => r.programId));
});

router.post("/wishlists", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { programId } = req.body;
  if (!programId) { res.status(400).json({ error: "programId required" }); return; }
  try {
    const [row] = await db.insert(wishlistsTable).values({ userId, programId }).returning();
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "Already in wishlist" });
  }
});

router.delete("/wishlists/:programId", requireAuth, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const programId = parseInt(req.params.programId, 10);
  if (isNaN(programId)) { res.status(400).json({ error: "Invalid programId" }); return; }
  await db.delete(wishlistsTable)
    .where(and(eq(wishlistsTable.userId, userId), eq(wishlistsTable.programId, programId)));
  res.sendStatus(204);
});

export default router;
