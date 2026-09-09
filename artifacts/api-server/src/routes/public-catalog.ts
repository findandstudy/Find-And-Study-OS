import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  institutionCampusesTable,
  priceComponentsTable,
  programIntakesTable,
  programsTable,
  programTranslationsTable,
  universitiesTable,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { courseFinderUniversityLogoUrl } from "../lib/courseFinderVisibility";
import {
  PUBLIC_CATALOG_RELATED_LIMIT,
  PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT,
  PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT,
  parsePublicCatalogRouteKey,
  parsePublicWebInternalLinkMode,
  publicCatalogCanonicalState,
  publicCatalogPath,
} from "../lib/publicCatalogRouteContract";
import {
  addPublicCatalogConditions,
  getPublicCatalogPolicy,
} from "../lib/publicCatalogQueryPolicy";
import { normalizeProgramLocale } from "../lib/programTranslationContract";
import {
  readIndexableProgramIds,
  resolvePublishedEntitySeoState,
} from "../lib/publicWebDiscoveryReadModel";

const router: IRouter = Router();

const PUBLIC_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";

function setPublicCatalogHeaders(res: Response): void {
  res.setHeader("Cache-Control", PUBLIC_CACHE_CONTROL);
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function rejectInvalidRouteKey(res: Response): void {
  res.status(400).json({
    error: "Invalid catalogue route",
    code: "PUBLIC_CATALOG_ROUTE_INVALID",
  });
}

function safePublicUniversityWebsite(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 2_048 || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

router.get(
  "/public/catalog/programs/:routeKey",
  async (req: Request, res: Response): Promise<void> => {
    const identity = parsePublicCatalogRouteKey(req.params.routeKey);
    if (!identity) {
      rejectInvalidRouteKey(res);
      return;
    }

    const locale = normalizeProgramLocale(req.query.locale);
    const internalLinkMode = parsePublicWebInternalLinkMode(process.env.PUBLIC_WEB_INTERNAL_LINK_MODE);
    const policy = await getPublicCatalogPolicy();
    const localizedName = sql<string>`COALESCE(${programTranslationsTable.name}, ${programsTable.name})`;
    const conditions: any[] = [
      eq(programsTable.id, identity.id),
      eq(programsTable.isActive, true),
    ];
    addPublicCatalogConditions(conditions, policy);

    const [program] = await db
      .select({
        id: programsTable.id,
        name: localizedName,
        description: sql<string | null>`COALESCE(${programTranslationsTable.description}, ${programsTable.description})`,
        degree: programsTable.degree,
        field: sql<string | null>`COALESCE(${programTranslationsTable.field}, ${programsTable.field})`,
        language: programsTable.language,
        duration: sql<string | null>`COALESCE(${programTranslationsTable.duration}, ${programsTable.duration})`,
        tuitionFee: programsTable.tuitionFee,
        discountedFee: programsTable.discountedFee,
        scholarship: programsTable.scholarship,
        currency: programsTable.currency,
        intakes: sql<string | null>`COALESCE(${programTranslationsTable.intakes}, ${programsTable.intakes})`,
        requirements: sql<string | null>`COALESCE(${programTranslationsTable.requirements}, ${programsTable.requirements})`,
        depositFee: programsTable.depositFee,
        languageFee: programsTable.languageFee,
        feeType: programsTable.feeType,
        quota: programsTable.quota,
        contentLocale: sql<string>`${locale}`,
        translatedLocale: programTranslationsTable.locale,
        universityId: universitiesTable.id,
        universityName: universitiesTable.name,
        universityCountry: universitiesTable.country,
        universityCity: universitiesTable.city,
        universityType: universitiesTable.universityType,
        universityWebsite: universitiesTable.website,
        universityDescription: universitiesTable.description,
        universityAddress: universitiesTable.address,
        universityQsRanking: universitiesTable.qsRanking,
        universityTimesRanking: universitiesTable.timesRanking,
        universityShanghaiRanking: universitiesTable.shanghaiRanking,
        universityCwtsLeidenRanking: universitiesTable.cwtsLeidenRanking,
        universityHasLogo: sql<boolean>`${universitiesTable.logoUrl} IS NOT NULL AND length(trim(${universitiesTable.logoUrl})) > 0`,
      })
      .from(programsTable)
      .innerJoin(
        universitiesTable,
        eq(programsTable.universityId, universitiesTable.id),
      )
      .leftJoin(
        programTranslationsTable,
        and(
          eq(programTranslationsTable.programId, programsTable.id),
          eq(programTranslationsTable.locale, locale),
          eq(programTranslationsTable.status, "published"),
        ),
      )
      .where(and(...conditions))
      .limit(1);

    if (!program) {
      res.status(404).json({
        error: "Program not found",
        code: "PUBLIC_PROGRAM_NOT_FOUND",
      });
      return;
    }

    const canonical = publicCatalogCanonicalState({
      requestedRouteKey: req.params.routeKey,
      locale,
      entityType: "program",
      id: program.id,
      name: program.name,
    });
    const relatedScore = sql<number>`(
      CASE WHEN ${programsTable.universityId} = ${program.universityId} THEN 8 ELSE 0 END
      + CASE WHEN lower(coalesce(${programsTable.field}, '')) = lower(${program.field ?? ""}::text) AND ${program.field ?? ""}::text <> '' THEN 4 ELSE 0 END
      + CASE WHEN lower(coalesce(${programsTable.degree}, '')) = lower(${program.degree ?? ""}::text) AND ${program.degree ?? ""}::text <> '' THEN 2 ELSE 0 END
      + CASE WHEN lower(${universitiesTable.country}) = lower(${program.universityCountry}) THEN 1 ELSE 0 END
    )`;
    const relatedConditions: any[] = [
      eq(programsTable.isActive, true),
      ne(programsTable.id, program.id),
    ];
    addPublicCatalogConditions(relatedConditions, policy);

    const [relatedRows, intakeRows, priceRows, seoState] = await Promise.all([
      db
        .select({
          id: programsTable.id,
          name: sql<string>`COALESCE(${programTranslationsTable.name}, ${programsTable.name})`,
          degree: programsTable.degree,
          field: sql<string | null>`COALESCE(${programTranslationsTable.field}, ${programsTable.field})`,
          duration: sql<string | null>`COALESCE(${programTranslationsTable.duration}, ${programsTable.duration})`,
          language: programsTable.language,
          tuitionFee: programsTable.tuitionFee,
          discountedFee: programsTable.discountedFee,
          currency: programsTable.currency,
          universityId: universitiesTable.id,
          universityName: universitiesTable.name,
          universityCountry: universitiesTable.country,
          universityCity: universitiesTable.city,
          score: relatedScore,
        })
        .from(programsTable)
        .innerJoin(
          universitiesTable,
          eq(programsTable.universityId, universitiesTable.id),
        )
        .leftJoin(
          programTranslationsTable,
          and(
            eq(programTranslationsTable.programId, programsTable.id),
            eq(programTranslationsTable.locale, locale),
            eq(programTranslationsTable.status, "published"),
          ),
        )
        .where(and(...relatedConditions))
        .orderBy(desc(relatedScore), asc(universitiesTable.name), asc(programsTable.id))
        .limit(internalLinkMode === "published" ? PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT : PUBLIC_CATALOG_RELATED_LIMIT),
      db
        .select({
          id: programIntakesTable.id,
          intakeKey: programIntakesTable.intakeKey,
          academicYear: programIntakesTable.academicYear,
          startsOn: programIntakesTable.startsOn,
          applicationDeadlineAt: programIntakesTable.applicationDeadlineAt,
          capacityStatus: programIntakesTable.capacityStatus,
          deliveryMode: programIntakesTable.deliveryMode,
          campusName: institutionCampusesTable.name,
          campusCountryCode: institutionCampusesTable.countryCode,
          publicAddress: institutionCampusesTable.publicAddress,
        })
        .from(programIntakesTable)
        .leftJoin(
          institutionCampusesTable,
          eq(programIntakesTable.campusId, institutionCampusesTable.id),
        )
        .where(and(
          eq(programIntakesTable.programId, program.id),
          eq(programIntakesTable.status, "ACTIVE"),
          or(
            isNull(programIntakesTable.applicationDeadlineAt),
            gte(programIntakesTable.applicationDeadlineAt, new Date()),
          ),
        ))
        .orderBy(
          asc(programIntakesTable.startsOn),
          asc(programIntakesTable.academicYear),
          asc(programIntakesTable.id),
        )
        .limit(24),
      db
        .select({
          id: priceComponentsTable.id,
          intakeId: priceComponentsTable.intakeId,
          componentCode: priceComponentsTable.componentCode,
          componentType: priceComponentsTable.componentType,
          amountMinor: priceComponentsTable.amountMinor,
          currencyCode: priceComponentsTable.currencyCode,
          frequency: priceComponentsTable.frequency,
          effectiveFrom: priceComponentsTable.effectiveFrom,
          effectiveUntil: priceComponentsTable.effectiveUntil,
          sourceVerifiedAt: priceComponentsTable.sourceVerifiedAt,
          sourceExpiresAt: priceComponentsTable.sourceExpiresAt,
        })
        .from(priceComponentsTable)
        .where(and(
          eq(priceComponentsTable.programId, program.id),
          eq(priceComponentsTable.status, "ACTIVE"),
          isNotNull(priceComponentsTable.sourceVerifiedAt),
          or(
            isNull(priceComponentsTable.sourceExpiresAt),
            gte(priceComponentsTable.sourceExpiresAt, new Date()),
          ),
        ))
        .orderBy(
          asc(priceComponentsTable.componentType),
          asc(priceComponentsTable.effectiveFrom),
          asc(priceComponentsTable.id),
        )
        .limit(48),
      resolvePublishedEntitySeoState({
        entityType: "program",
        entityId: program.id,
        locale,
      }),
    ]);

    const deliveredLocaleReady = locale === "en" || program.translatedLocale === locale;
    const indexable = seoState.indexable && deliveredLocaleReady;
    const canonicalPath = seoState.canonicalPath || canonical.canonicalPath;
    const relatedProgramIds = internalLinkMode === "published"
      ? await readIndexableProgramIds({
        locale,
        programIds: relatedRows.map((related) => related.id),
      })
      : null;
    const relatedPrograms = relatedRows
      .filter((related) => relatedProgramIds === null || relatedProgramIds.has(related.id))
      .slice(0, PUBLIC_CATALOG_RELATED_LIMIT);

    setPublicCatalogHeaders(res);
    res.setHeader("Content-Location", canonicalPath);
    res.json({
      data: {
        ...program,
        translatedLocale: undefined,
        fallbackUsed: locale !== "en" && program.translatedLocale !== locale,
        universityLogoUrl: courseFinderUniversityLogoUrl(
          program.universityId,
          program.universityHasLogo,
        ),
        universityHasLogo: undefined,
        canonicalPath,
        universityPath: publicCatalogPath({
          locale,
          entityType: "university",
          id: program.universityId,
          name: program.universityName,
        }),
      },
      intakes: intakeRows,
      prices: priceRows.map((price) => ({
        ...price,
        amountMinor: price.amountMinor.toString(),
      })),
      related: relatedPrograms.map(({ score: _score, ...related }) => ({
        ...related,
        canonicalPath: publicCatalogPath({
          locale,
          entityType: "program",
          id: related.id,
          name: related.name,
        }),
      })),
      meta: {
        locale,
        indexable,
        alternatePaths: seoState.alternates,
        canonicalPath,
        relatedPolicy: internalLinkMode === "published"
          ? "PUBLISHED_INDEXABLE_ONLY"
          : "LEGACY_UNGATED",
        requestedPathIsCanonical: req.params.routeKey === canonicalPath.split("/").at(-1),
        generatedAt: new Date().toISOString(),
      },
    });
  },
);

router.get(
  "/public/catalog/universities/:routeKey",
  async (req: Request, res: Response): Promise<void> => {
    const identity = parsePublicCatalogRouteKey(req.params.routeKey);
    if (!identity) {
      rejectInvalidRouteKey(res);
      return;
    }

    const locale = normalizeProgramLocale(req.query.locale);
    const internalLinkMode = parsePublicWebInternalLinkMode(process.env.PUBLIC_WEB_INTERNAL_LINK_MODE);
    const policy = await getPublicCatalogPolicy();
    const universityConditions: any[] = [
      eq(universitiesTable.id, identity.id),
    ];
    addPublicCatalogConditions(universityConditions, policy);
    const [university] = await db
      .select({
        id: universitiesTable.id,
        name: universitiesTable.name,
        country: universitiesTable.country,
        city: universitiesTable.city,
        website: universitiesTable.website,
        description: universitiesTable.description,
        ranking: universitiesTable.ranking,
        universityType: universitiesTable.universityType,
        qsRanking: universitiesTable.qsRanking,
        timesRanking: universitiesTable.timesRanking,
        shanghaiRanking: universitiesTable.shanghaiRanking,
        cwtsLeidenRanking: universitiesTable.cwtsLeidenRanking,
        address: universitiesTable.address,
        hasLogo: sql<boolean>`${universitiesTable.logoUrl} IS NOT NULL AND length(trim(${universitiesTable.logoUrl})) > 0`,
      })
      .from(universitiesTable)
      .where(and(...universityConditions))
      .limit(1);

    if (!university) {
      res.status(404).json({
        error: "University not found",
        code: "PUBLIC_UNIVERSITY_NOT_FOUND",
      });
      return;
    }

    const programConditions: any[] = [
      eq(programsTable.universityId, university.id),
      eq(programsTable.isActive, true),
    ];
    addPublicCatalogConditions(programConditions, policy);
    const [[countRow], programRows, seoState] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(programsTable)
        .innerJoin(
          universitiesTable,
          eq(programsTable.universityId, universitiesTable.id),
        )
        .where(and(...programConditions)),
      db
        .select({
          id: programsTable.id,
          name: sql<string>`COALESCE(${programTranslationsTable.name}, ${programsTable.name})`,
          degree: programsTable.degree,
          field: sql<string | null>`COALESCE(${programTranslationsTable.field}, ${programsTable.field})`,
          language: programsTable.language,
          duration: sql<string | null>`COALESCE(${programTranslationsTable.duration}, ${programsTable.duration})`,
          tuitionFee: programsTable.tuitionFee,
          discountedFee: programsTable.discountedFee,
          scholarship: programsTable.scholarship,
          currency: programsTable.currency,
        })
        .from(programsTable)
        .innerJoin(
          universitiesTable,
          eq(programsTable.universityId, universitiesTable.id),
        )
        .leftJoin(
          programTranslationsTable,
          and(
            eq(programTranslationsTable.programId, programsTable.id),
            eq(programTranslationsTable.locale, locale),
            eq(programTranslationsTable.status, "published"),
          ),
        )
        .where(and(...programConditions))
        .orderBy(asc(programsTable.name), asc(programsTable.id))
        .limit(internalLinkMode === "published" ? PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT : PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT),
      resolvePublishedEntitySeoState({
        entityType: "university",
        entityId: university.id,
        locale,
      }),
    ]);

    const canonical = publicCatalogCanonicalState({
      requestedRouteKey: req.params.routeKey,
      locale,
      entityType: "university",
      id: university.id,
      name: university.name,
    });
    const indexable = seoState.indexable && locale === "en";
    const canonicalPath = seoState.canonicalPath || canonical.canonicalPath;
    const indexableProgramIds = internalLinkMode === "published"
      ? await readIndexableProgramIds({ locale, programIds: programRows.map((program) => program.id) })
      : null;
    const deliveredPrograms = programRows
      .filter((program) => indexableProgramIds === null || indexableProgramIds.has(program.id))
      .slice(0, PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT);
    setPublicCatalogHeaders(res);
    res.setHeader("Content-Location", canonicalPath);
    res.json({
      data: {
        ...university,
        hasLogo: undefined,
        website: safePublicUniversityWebsite(university.website),
        logoUrl: courseFinderUniversityLogoUrl(
          university.id,
          university.hasLogo,
        ),
        canonicalPath,
      },
      programs: deliveredPrograms.map((program) => ({
        ...program,
        canonicalPath: publicCatalogPath({
          locale,
          entityType: "program",
          id: program.id,
          name: program.name,
        }),
      })),
      meta: {
        locale,
        indexable,
        alternatePaths: seoState.alternates,
        programCount: Number(countRow?.count ?? 0),
        returnedPrograms: deliveredPrograms.length,
        programLinkPolicy: internalLinkMode === "published"
          ? "PUBLISHED_INDEXABLE_ONLY"
          : "LEGACY_UNGATED",
        canonicalPath,
        requestedPathIsCanonical: req.params.routeKey === canonicalPath.split("/").at(-1),
        generatedAt: new Date().toISOString(),
      },
    });
  },
);

export default router;
