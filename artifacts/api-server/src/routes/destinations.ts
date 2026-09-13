import { Router, type IRouter, type Request, type Response } from "express";
import { db, citiesTable, countriesTable, destinationsTable, universitiesTable, programsTable, programTranslationsTable } from "@workspace/db";
import { eq, and, sql, asc, desc } from "drizzle-orm";
import {
  addPublicCatalogConditions,
  getPublicCatalogPolicy,
} from "../lib/publicCatalogQueryPolicy";
import { courseFinderUniversityLogoUrl } from "../lib/courseFinderVisibility";
import { normalizeProgramLocale } from "../lib/programTranslationContract";
import {
  parsePublicWebInternalLinkMode,
  publicCatalogPath,
} from "../lib/publicCatalogRouteContract";
import { buildPublicWebCanonicalPath } from "../lib/publicWebContentContract";
import {
  readIndexableProgramIds,
  readIndexableUniversityIds,
  readPublishedLocalizedEntities,
  readPublishedLocalizedEntity,
  resolvePublishedLocalizedDestinationRoute,
  resolvePublishedEntitySeoState,
} from "../lib/publicWebDiscoveryReadModel";
import {
  resolveLocalizedDestinationFields,
  resolveLocalizedCityFields,
  resolveLocalizedUniversityFields,
  selectLocalizedEntityDelivery,
} from "../lib/publicLocalizedEntityContract";

const router: IRouter = Router();
const DESTINATION_LINK_LIMIT = 24;
const DESTINATION_LINK_CANDIDATE_LIMIT = 64;

router.get("/public/destinations", async (req: Request, res: Response): Promise<void> => {
  const locale = normalizeProgramLocale(req.query.locale);
  const policy = await getPublicCatalogPolicy();
  const destinations = await db.select()
    .from(destinationsTable)
    .where(eq(destinationsTable.isActive, true))
    .orderBy(asc(destinationsTable.sortOrder), asc(destinationsTable.name))
    .limit(64);

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

  const localizedDelivery = await readPublishedLocalizedEntities({
    entityType: "destination",
    entityIds: destinations.map((destination) => destination.id),
    locale,
  });
  const enriched = destinations.flatMap(d => {
    const key = (d.country ?? "").trim().toLowerCase();
    const live = countMap.get(key);
    const localized = resolveLocalizedDestinationFields({
      locale,
      delivery: selectLocalizedEntityDelivery(localizedDelivery, d.id),
      base: {
        name: d.name,
        shortDescription: d.shortDescription,
        description: d.description,
        whyStudyHere: d.whyStudyHere,
        livingCost: d.livingCost,
        climate: d.climate,
        language: d.language,
        currency: d.currency,
        visaInfo: d.visaInfo,
        workPermit: d.workPermit,
        popularCities: String(d.popularCities || "")
          .split(",")
          .map((city) => city.trim())
          .filter(Boolean)
          .slice(0, 24),
      },
    });
    if (!localized.available) return [];
    const canonicalPath = localizedDelivery.snapshots.get(d.id)?.canonicalPath
      || buildPublicWebCanonicalPath({
        entityType: "DESTINATION",
        entityId: d.id,
        locale,
        slug: d.slug,
      });
    return [{
      ...d,
      name: localized.name,
      shortDescription: localized.shortDescription,
      description: localized.description,
      whyStudyHere: localized.whyStudyHere,
      livingCost: localized.livingCost,
      climate: localized.climate,
      language: localized.language,
      currency: localized.currency,
      visaInfo: localized.visaInfo,
      workPermit: localized.workPermit,
      popularCities: localized.popularCities.join(", ") || null,
      canonicalPath,
      contentPolicy: localized.contentPolicy,
      universityCount: live?.uniCount ?? 0,
      programCount: live?.progCount ?? 0,
    }];
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
  const internalLinkMode = parsePublicWebInternalLinkMode(process.env.PUBLIC_WEB_INTERNAL_LINK_MODE);
  const routeResolution = await resolvePublishedLocalizedDestinationRoute({ locale, slug });

  const [destination] = await db.select()
    .from(destinationsTable)
    .where(and(
      routeResolution.destinationId
        ? eq(destinationsTable.id, routeResolution.destinationId)
        : eq(destinationsTable.slug, slug),
      eq(destinationsTable.isActive, true),
    ))
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
    .limit(internalLinkMode === "published" ? DESTINATION_LINK_CANDIDATE_LIMIT : DESTINATION_LINK_LIMIT);

  const programConditions: any[] = [
    sql`lower(trim(${universitiesTable.country})) = lower(trim(${destination.country}))`,
    eq(programsTable.isActive, true),
  ];
  addPublicCatalogConditions(programConditions, policy);
  const [[universityCount], [programCount], programRows, seoState, localizedDelivery] = await Promise.all([
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
      .limit(internalLinkMode === "published" ? DESTINATION_LINK_CANDIDATE_LIMIT : DESTINATION_LINK_LIMIT),
    resolvePublishedEntitySeoState({
      entityType: "destination",
      entityId: destination.id,
      locale,
    }),
    readPublishedLocalizedEntity({
      entityType: "destination",
      entityId: destination.id,
      locale,
    }),
  ]);

  const localizedDestination = resolveLocalizedDestinationFields({
    locale,
    delivery: localizedDelivery,
    base: {
      name: destination.name,
      shortDescription: destination.shortDescription,
      description: destination.description,
      whyStudyHere: destination.whyStudyHere,
      livingCost: destination.livingCost,
      climate: destination.climate,
      language: destination.language,
      currency: destination.currency,
      visaInfo: destination.visaInfo,
      workPermit: destination.workPermit,
      popularCities: String(destination.popularCities || "")
        .split(",")
        .map((city) => city.trim())
        .filter(Boolean)
        .slice(0, 24),
    },
  });
  if (!localizedDestination.available) {
    res.status(404).json({
      error: "Destination translation not published",
      code: "PUBLIC_DESTINATION_TRANSLATION_NOT_PUBLISHED",
    });
    return;
  }

  const cityRows = await db.select({
    id: citiesTable.id,
    name: citiesTable.name,
    country: countriesTable.name,
  })
    .from(citiesTable)
    .innerJoin(countriesTable, eq(citiesTable.countryId, countriesTable.id))
    .where(and(
      eq(citiesTable.isActive, true),
      eq(countriesTable.isActive, true),
      sql`(lower(trim(${countriesTable.name})) = lower(trim(${destination.country})) OR upper(trim(${countriesTable.code})) = upper(trim(${destination.country})))`,
    ))
    .orderBy(asc(citiesTable.name), asc(citiesTable.id))
    .limit(256);
  const popularCityKeys = new Set(localizedDestination.popularCities.map((city) => city.toLocaleLowerCase("en-US")));
  const cityCandidates = cityRows;
  const cityIdBatches = Array.from(
    { length: Math.max(1, Math.ceil(cityCandidates.length / 64)) },
    (_, index) => cityCandidates.slice(index * 64, (index + 1) * 64).map((row) => row.id),
  );

  const [localizedUniversityDelivery, localizedCityDeliveries, indexableUniversityIds, indexableProgramIds] = await Promise.all([
    readPublishedLocalizedEntities({
      entityType: "university",
      entityIds: universityRows.map((row) => row.id),
      locale,
    }),
    Promise.all(cityIdBatches.map((entityIds) => readPublishedLocalizedEntities({
      entityType: "city",
      entityIds,
      locale,
    }))),
    internalLinkMode === "published"
      ? readIndexableUniversityIds({ locale, universityIds: universityRows.map((row) => row.id) })
      : Promise.resolve(null),
    internalLinkMode === "published"
      ? readIndexableProgramIds({ locale, programIds: programRows.map((row) => row.id) })
      : Promise.resolve(null),
  ]);
  const localizedCityDelivery = {
    mode: localizedCityDeliveries.some((delivery) => delivery.mode === "published")
      ? "published" as const
      : "off" as const,
    snapshots: new Map(localizedCityDeliveries.flatMap((delivery) => [...delivery.snapshots.entries()])),
  };
  const deliveredUniversityRows = universityRows
    .filter((row) => indexableUniversityIds === null || indexableUniversityIds.has(row.id))
    .flatMap((row) => {
      const localized = resolveLocalizedUniversityFields({
        locale,
        delivery: selectLocalizedEntityDelivery(localizedUniversityDelivery, row.id),
        base: {
          name: row.name,
          description: null,
          universityType: row.universityType,
        },
      });
      return localized.available
        ? [{ ...row, name: localized.name, universityType: localized.universityType }]
        : [];
    })
    .slice(0, DESTINATION_LINK_LIMIT);
  const deliveredProgramRows = programRows
    .filter((row) => indexableProgramIds === null || indexableProgramIds.has(row.id))
    .slice(0, DESTINATION_LINK_LIMIT);
  const universities = deliveredUniversityRows.map(({ hasLogo, programCount, ...university }) => ({
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
  const programs = deliveredProgramRows.map((program) => ({
    ...program,
    canonicalPath: publicCatalogPath({
      locale,
      entityType: "program",
      id: program.id,
      name: program.name,
    }),
  }));
  const cities = cityCandidates.flatMap((city) => {
    const delivery = selectLocalizedEntityDelivery(localizedCityDelivery, city.id);
    const localized = resolveLocalizedCityFields({
      locale,
      delivery,
      base: { name: city.name, country: city.country, description: null },
    });
    if (!localized.available || !delivery.snapshot || delivery.snapshot.indexState !== "INDEX") return [];
    const sourceKey = city.name.toLocaleLowerCase("en-US");
    const localizedKey = localized.name.toLocaleLowerCase("en-US");
    if (!popularCityKeys.has(sourceKey) && !popularCityKeys.has(localizedKey)) return [];
    return [{
      id: city.id,
      name: localized.name,
      sourceName: city.name,
      canonicalPath: delivery.snapshot.canonicalPath,
    }];
  }).slice(0, 24);

  const stats = {
    universityCount: Number(universityCount?.count ?? 0),
    programCount: Number(programCount?.count ?? 0),
  };
  const canonicalPath = localizedDelivery.snapshot?.canonicalPath || seoState.canonicalPath || buildPublicWebCanonicalPath({
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
      name: localizedDestination.name,
      shortDescription: localizedDestination.shortDescription,
      description: localizedDestination.description,
      whyStudyHere: localizedDestination.whyStudyHere,
      livingCost: localizedDestination.livingCost,
      climate: localizedDestination.climate,
      language: localizedDestination.language,
      currency: localizedDestination.currency,
      visaInfo: localizedDestination.visaInfo,
      workPermit: localizedDestination.workPermit,
      popularCities: localizedDestination.popularCities.join(", ") || null,
      canonicalPath,
    },
    universities,
    programs,
    cities,
    stats,
    meta: {
      locale,
      indexable: seoState.indexable,
      canonicalPath,
      alternatePaths: seoState.alternates,
      returnedUniversities: universities.length,
      returnedPrograms: programs.length,
      internalLinkPolicy: internalLinkMode === "published"
        ? "PUBLISHED_INDEXABLE_ONLY"
        : "LEGACY_UNGATED",
      contentPolicy: localizedDestination.contentPolicy,
      generatedAt: new Date().toISOString(),
    },
  });
});

export default router;
