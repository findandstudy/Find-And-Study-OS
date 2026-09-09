import { Router, type IRouter, type Request, type Response } from "express";
import { db, destinationsTable, universitiesTable, programsTable, programTranslationsTable } from "@workspace/db";
import { eq, and, sql, asc, desc } from "drizzle-orm";
import {
  addPublicCatalogConditions,
  getPublicCatalogPolicy,
} from "../lib/publicCatalogQueryPolicy";
import { courseFinderUniversityLogoUrl } from "../lib/courseFinderVisibility";
import { normalizeProgramLocale } from "../lib/programTranslationContract";
import { publicCatalogPath } from "../lib/publicCatalogRouteContract";
import { buildPublicWebCanonicalPath } from "../lib/publicWebContentContract";
import { resolvePublishedEntitySeoState } from "../lib/publicWebDiscoveryReadModel";

const router: IRouter = Router();

router.get("/public/destinations", async (_req: Request, res: Response): Promise<void> => {
  const policy = await getPublicCatalogPolicy();
  const destinations = await db.select()
    .from(destinationsTable)
    .where(eq(destinationsTable.isActive, true))
    .orderBy(asc(destinationsTable.sortOrder), asc(destinationsTable.name));

  const publicConditions: any[] = [eq(universitiesTable.isActive, true)];
  addPublicCatalogConditions(publicConditions, policy);
  const countryCounts = await db.select({
    countryKey: sql<string>`lower(trim(${universitiesTable.country}))`.as("country_key"),
    uniCount: sql<number>`count(DISTINCT ${universitiesTable.id})`.as("uni_count"),
    progCount: sql<number>`count(DISTINCT ${programsTable.id})`.as("prog_count"),
  })
    .from(universitiesTable)
    .leftJoin(programsTable, and(
      eq(programsTable.universityId, universitiesTable.id),
      eq(programsTable.isActive, true),
    ))
    .where(and(...publicConditions))
    .groupBy(sql`lower(trim(${universitiesTable.country}))`);

  const countMap = new Map(countryCounts.map(c => [c.countryKey, { uniCount: Number(c.uniCount), progCount: Number(c.progCount) }]));

  const enriched = destinations.map(d => {
    const key = (d.country ?? "").trim().toLowerCase();
    const live = countMap.get(key);
    return {
      ...d,
      universityCount: live?.uniCount ?? 0,
      programCount: live?.progCount ?? 0,
    };
  });

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=3600");
  res.json(enriched);
});

router.get("/public/destinations/:slug", async (req: Request, res: Response): Promise<void> => {
  const slug = String(req.params.slug);
  if (slug.length > 180 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    res.status(400).json({
      error: "Invalid destination route",
      code: "PUBLIC_DESTINATION_ROUTE_INVALID",
    });
    return;
  }
  const locale = normalizeProgramLocale(req.query.locale);

  const [destination] = await db.select()
    .from(destinationsTable)
    .where(and(eq(destinationsTable.slug, slug), eq(destinationsTable.isActive, true)))
    .limit(1);

  if (!destination) {
    res.status(404).json({ error: "Destination not found" });
    return;
  }

  const policy = await getPublicCatalogPolicy();
  const universityConditions: any[] = [
    sql`lower(trim(${universitiesTable.country})) = lower(trim(${destination.country}))`,
    eq(universitiesTable.isActive, true),
  ];
  addPublicCatalogConditions(universityConditions, policy);

  const universityRows = await db.select({
    id: universitiesTable.id,
    name: universitiesTable.name,
    city: universitiesTable.city,
    hasLogo: sql<boolean>`${universitiesTable.logoUrl} IS NOT NULL AND length(trim(${universitiesTable.logoUrl})) > 0`,
    ranking: universitiesTable.ranking,
    universityType: universitiesTable.universityType,
    programCount: sql<number>`(
      SELECT count(*) FROM ${programsTable} p
      WHERE p.university_id = ${universitiesTable.id} AND p.is_active = true
    )`,
  })
    .from(universitiesTable)
    .where(and(...universityConditions))
    .orderBy(asc(universitiesTable.name), asc(universitiesTable.id))
    .limit(24);

  const programConditions: any[] = [
    sql`lower(trim(${universitiesTable.country})) = lower(trim(${destination.country}))`,
    eq(programsTable.isActive, true),
  ];
  addPublicCatalogConditions(programConditions, policy);
  const [[universityCount], [programCount], programRows, seoState] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(universitiesTable)
      .where(and(...universityConditions)),
    db.select({ count: sql<number>`count(*)` })
      .from(programsTable)
      .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
      .where(and(...programConditions)),
    db.select({
      id: programsTable.id,
      name: sql<string>`COALESCE(${programTranslationsTable.name}, ${programsTable.name})`,
      degree: programsTable.degree,
      language: programsTable.language,
      duration: sql<string | null>`COALESCE(${programTranslationsTable.duration}, ${programsTable.duration})`,
      tuitionFee: programsTable.tuitionFee,
      currency: programsTable.currency,
      discountedFee: programsTable.discountedFee,
      universityId: programsTable.universityId,
      universityName: universitiesTable.name,
    })
      .from(programsTable)
      .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
      .leftJoin(programTranslationsTable, and(
        eq(programTranslationsTable.programId, programsTable.id),
        eq(programTranslationsTable.locale, locale),
        eq(programTranslationsTable.status, "published"),
      ))
      .where(and(...programConditions))
      .orderBy(asc(universitiesTable.name), asc(programsTable.name), asc(programsTable.id))
      .limit(24),
    resolvePublishedEntitySeoState({
      entityType: "destination",
      entityId: destination.id,
      locale,
    }),
  ]);

  const universities = universityRows.map(({ hasLogo, programCount, ...university }) => ({
    ...university,
    logoUrl: courseFinderUniversityLogoUrl(university.id, hasLogo),
    programCount: Number(programCount),
    canonicalPath: publicCatalogPath({
      locale,
      entityType: "university",
      id: university.id,
      name: university.name,
    }),
  }));
  const programs = programRows.map((program) => ({
    ...program,
    canonicalPath: publicCatalogPath({
      locale,
      entityType: "program",
      id: program.id,
      name: program.name,
    }),
  }));

  const stats = {
    universityCount: Number(universityCount?.count ?? 0),
    programCount: Number(programCount?.count ?? 0),
  };
  const canonicalPath = seoState.canonicalPath || buildPublicWebCanonicalPath({
    entityType: "DESTINATION",
    entityId: destination.id,
    locale,
    slug: destination.slug,
  });

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Location", canonicalPath);
  res.json({
    destination: {
      ...destination,
      canonicalPath,
    },
    universities,
    programs,
    stats,
    meta: {
      locale,
      indexable: seoState.indexable && locale === "en",
      canonicalPath,
      alternatePaths: seoState.alternates,
      returnedUniversities: universities.length,
      returnedPrograms: programs.length,
      generatedAt: new Date().toISOString(),
    },
  });
});

export default router;
