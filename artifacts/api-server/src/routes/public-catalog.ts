import { Router, type IRouter, type Request, type Response } from "express";
import { publicCatalogRequirements } from "../lib/publicCatalogRequirements";
import {
  db,
  institutionCampusesTable,
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
  readPublishedLocalizedEntity,
  resolvePublishedEntitySeoState,
} from "../lib/publicWebDiscoveryReadModel";
import { resolveLocalizedUniversityFields } from "../lib/publicLocalizedEntityContract";
import { readPublicCatalogPrices } from "../lib/publicCatalogPriceReadModel";
import { projectPublicTuition, publicCurrency } from "../lib/publicCatalogTuition";
import { resolvePublicCatalogLocationLinks } from "../lib/publicCatalogLocationLinks";

const router: IRouter = Router();

const PUBLIC_CACHE_CONTROL =
  // Admissions flags must revalidate after an admin closes applications.
  "public, max-age=0, must-revalidate";

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
        universityIsActive: universitiesTable.isActive,
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

    const now = new Date();
    const [relatedRows, intakeRows, priceMap, seoState, locationLinks] = await Promise.all([
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
            gte(programIntakesTable.applicationDeadlineAt, now),
          ),
          or(
            isNull(programIntakesTable.sourceExpiresAt),
            gte(programIntakesTable.sourceExpiresAt, now),
          ),
        ))
        .orderBy(
          asc(programIntakesTable.startsOn),
          asc(programIntakesTable.academicYear),
          asc(programIntakesTable.id),
        )
        .limit(24),
      readPublicCatalogPrices([program.id], now),
      resolvePublishedEntitySeoState({
        entityType: "program",
        entityId: program.id,
        locale,
      }),
      resolvePublicCatalogLocationLinks({ locale, country: program.universityCountry, city: program.universityCity }),
    ]);
    const priceRows = priceMap.get(program.id) ?? [];

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
    const relatedPrices = await readPublicCatalogPrices(relatedPrograms.map(row => row.id), now);

    setPublicCatalogHeaders(res);
    res.setHeader("Content-Location", canonicalPath);
    res.json({
      data: {
        ...program,
        ...locationLinks,
        requirements: publicCatalogRequirements(program.requirements),
        tuition: projectPublicTuition(program, priceRows),
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
      prices: priceRows.filter(price => publicCurrency(price.currencyCode)).map((price) => ({
        ...price,
        amountMinor: price.amountMinor.toString(),
      })),
      related: relatedPrograms.map(({ score: _score, ...related }) => ({
        ...related,
        tuition: projectPublicTuition(related, relatedPrices.get(related.id) ?? []),
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
        isActive: universitiesTable.isActive,
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
    const [[countRow], programRows, seoState, localizedDelivery, locationLinks] = await Promise.all([
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
      readPublishedLocalizedEntity({
        entityType: "university",
        entityId: university.id,
        locale,
      }),
      resolvePublicCatalogLocationLinks({ locale, country: university.country, city: university.city }),
    ]);

    const localizedUniversity = resolveLocalizedUniversityFields({
      locale,
      delivery: localizedDelivery,
      base: {
        name: university.name,
        description: university.description,
        universityType: university.universityType,
      },
    });
    if (!localizedUniversity.available) {
      res.status(404).json({
        error: "University translation not published",
        code: "PUBLIC_UNIVERSITY_TRANSLATION_NOT_PUBLISHED",
      });
      return;
    }

    const canonical = publicCatalogCanonicalState({
      requestedRouteKey: req.params.routeKey,
      locale,
      entityType: "university",
      id: university.id,
      name: localizedUniversity.name,
    });
    const indexable = seoState.indexable;
    const canonicalPath = localizedDelivery.snapshot?.canonicalPath
      || seoState.canonicalPath
      || canonical.canonicalPath;
    const indexableProgramIds = internalLinkMode === "published"
      ? await readIndexableProgramIds({ locale, programIds: programRows.map((program) => program.id) })
      : null;
    const deliveredPrograms = programRows
      .filter((program) => indexableProgramIds === null || indexableProgramIds.has(program.id))
      .slice(0, PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT);
    const programPrices = await readPublicCatalogPrices(deliveredPrograms.map(program => program.id));
    setPublicCatalogHeaders(res);
    res.setHeader("Content-Location", canonicalPath);
    res.json({
      data: {
        ...university,
        ...locationLinks,
        name: localizedUniversity.name,
        description: localizedUniversity.description,
        universityType: localizedUniversity.universityType,
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
        tuition: projectPublicTuition(program, programPrices.get(program.id) ?? []),
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
        contentPolicy: localizedUniversity.contentPolicy,
        canonicalPath,
        requestedPathIsCanonical: req.params.routeKey === canonicalPath.split("/").at(-1),
        generatedAt: new Date().toISOString(),
      },
    });
  },
);

export default router;
