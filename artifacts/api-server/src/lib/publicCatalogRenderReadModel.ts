import {
  db,
  destinationsTable,
  programsTable,
  programTranslationsTable,
  universitiesTable,
  websiteBlogPostsTable,
  websitePagesTable,
  websitePageVersionsTable,
} from "@workspace/db";
import { and, asc, desc, eq, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import {
  PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT,
  PUBLIC_CATALOG_RELATED_LIMIT,
  PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT,
  PUBLIC_GUIDE_RELATED_LIMIT,
  parsePublicWebInternalLinkMode,
  publicCatalogCanonicalState,
  publicCatalogPath,
} from "./publicCatalogRouteContract";
import {
  addPublicCatalogConditions,
  getPublicCatalogPolicy,
} from "./publicCatalogQueryPolicy";
import type {
  PublicCatalogRenderModel,
  PublicCatalogRenderRoute,
  PublicPageBlock,
} from "./publicCatalogRenderContract";
import {
  readIndexableArticleIds,
  readIndexableProgramIds,
  readIndexableUniversityIds,
  readPublishedLocalizedEntity,
  resolvePublishedLocalizedDestinationRoute,
  resolvePublishedEntitySeoState,
} from "./publicWebDiscoveryReadModel";
import { buildPublicWebCanonicalPath } from "./publicWebContentContract";
import type { ProgramSupportedLocale } from "./programTranslationContract";
import {
  resolveLocalizedDestinationFields,
  resolveLocalizedUniversityFields,
} from "./publicLocalizedEntityContract";

const PILOT_LIST_LIMIT = 12;
const CACHE_FRESH_MS = 5 * 60_000;
const CACHE_STALE_MS = 60 * 60_000;
const CACHE_MAX_ENTRIES = 500;

const LIST_TITLES: Record<ProgramSupportedLocale, string> = {
  en: "Study programs", tr: "Eğitim programları", ar: "البرامج الدراسية",
  fr: "Programmes d’études", ru: "Учебные программы", fa: "برنامه‌های تحصیلی",
  zh: "留学课程", hi: "अध्ययन कार्यक्रम", es: "Programas de estudio",
  id: "Program studi", ur: "تعلیمی پروگرام", tk: "Okuw programmalary",
  ky: "Окуу программалары", kk: "Оқу бағдарламалары", uz: "Ta’lim dasturlari",
  tg: "Барномаҳои таҳсил", bn: "শিক্ষা প্রোগ্রাম", pt: "Programas de estudo",
  ne: "अध्ययन कार्यक्रमहरू", vi: "Chương trình học", ko: "유학 프로그램",
  uk: "Навчальні програми", it: "Programmi di studio",
};

const LIST_DESCRIPTIONS: Record<ProgramSupportedLocale, string> = {
  en: "Compare current study opportunities from universities around the world.",
  tr: "Dünyanın farklı üniversitelerindeki güncel eğitim fırsatlarını karşılaştırın.",
  ar: "قارن فرص الدراسة الحالية في الجامعات حول العالم.",
  fr: "Comparez les possibilités d’études actuelles dans les universités du monde entier.",
  ru: "Сравните актуальные возможности обучения в университетах по всему миру.",
  fa: "فرصت‌های تحصیلی به‌روز دانشگاه‌های سراسر جهان را مقایسه کنید.",
  zh: "比较世界各地大学的最新留学机会。",
  hi: "दुनिया भर के विश्वविद्यालयों में उपलब्ध वर्तमान अध्ययन अवसरों की तुलना करें।",
  es: "Compara oportunidades de estudio actuales en universidades de todo el mundo.",
  id: "Bandingkan peluang studi terbaru di universitas di seluruh dunia.",
  ur: "دنیا بھر کی جامعات میں موجودہ تعلیمی مواقع کا موازنہ کریں۔",
  tk: "Dünýäniň dürli uniwersitetlerindäki häzirki okuw mümkinçiliklerini deňeşdiriň.",
  ky: "Дүйнөдөгү университеттердин учурдагы окуу мүмкүнчүлүктөрүн салыштырыңыз.",
  kk: "Әлем университеттеріндегі қазіргі оқу мүмкіндіктерін салыстырыңыз.",
  uz: "Dunyo universitetlaridagi amaldagi ta’lim imkoniyatlarini solishtiring.",
  tg: "Имкониятҳои ҷории таҳсилро дар донишгоҳҳои ҷаҳон муқоиса кунед.",
  bn: "বিশ্বজুড়ে বিশ্ববিদ্যালয়ের বর্তমান পড়াশোনার সুযোগগুলো তুলনা করুন।",
  pt: "Compare as oportunidades de estudo atuais em universidades de todo o mundo.",
  ne: "विश्वभरका विश्वविद्यालयमा उपलब्ध हालका अध्ययन अवसरहरू तुलना गर्नुहोस्।",
  vi: "So sánh các cơ hội học tập hiện có tại các trường đại học trên toàn thế giới.",
  ko: "전 세계 대학의 최신 유학 기회를 비교해 보세요.",
  uk: "Порівнюйте актуальні можливості навчання в університетах усього світу.",
  it: "Confronta le opportunità di studio attuali nelle università di tutto il mondo.",
};

type CacheEntry = {
  freshUntil: number;
  staleUntil: number;
  value: PublicCatalogRenderModel;
};

export type PublicCatalogRenderCacheStatus = "HIT" | "MISS" | "STALE" | "COALESCED";

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<PublicCatalogRenderModel>>();

function boundedText(value: string | null | undefined, fallback: string): string {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();
  return text.slice(0, 320);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

const PUBLIC_PAGE_BLOCK_TYPES = new Set([
  "hero", "rich_text", "stats_strip", "feature_cards", "icon_cards",
  "cta_banner", "faq", "team_grid", "office_list", "logo_grid",
  "testimonials", "section_title", "spacer_divider",
]);

function publicPageBlocks(value: unknown): PublicPageBlock[] {
  if (!Array.isArray(value) || value.length > 64) return [];
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 1_048_576) return [];
  } catch {
    return [];
  }
  return value.flatMap((item, index) => {
    if (!isRecord(item) || item.isVisible === false) return [];
    const blockType = boundedString(item.blockType, 64);
    if (!PUBLIC_PAGE_BLOCK_TYPES.has(blockType)) return [];
    return [{
      blockType,
      content: isRecord(item.content) ? item.content : {},
      settings: isRecord(item.settings) ? item.settings : {},
      sortOrder: Number.isSafeInteger(item.sortOrder) ? Number(item.sortOrder) : index,
    }];
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

function cacheKey(route: PublicCatalogRenderRoute): string {
  const identity = route.kind === "program_list"
    ? "index"
    : route.kind === "destination_detail" || route.kind === "page_detail"
      ? route.slug
      : route.identity?.id ?? route.routeKey;
  return `${route.locale}:${route.kind}:${identity}`;
}

function pruneCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.staleUntil <= now) cache.delete(key);
  }
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function saveCache(key: string, value: PublicCatalogRenderModel): void {
  const now = Date.now();
  pruneCache(now);
  cache.set(key, {
    freshUntil: now + CACHE_FRESH_MS,
    staleUntil: now + CACHE_STALE_MS,
    value,
  });
}

async function readProgramList(
  route: Extract<PublicCatalogRenderRoute, { kind: "program_list" }>,
): Promise<PublicCatalogRenderModel> {
  const policy = await getPublicCatalogPolicy();
  const conditions: any[] = [eq(programsTable.isActive, true)];
  addPublicCatalogConditions(conditions, policy);
  const localizedName = sql<string>`COALESCE(${programTranslationsTable.name}, ${programsTable.name})`;
  const [[countRow], rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(programsTable)
      .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
      .where(and(...conditions)),
    db
      .select({
        id: programsTable.id,
        name: localizedName,
        universityName: universitiesTable.name,
        country: universitiesTable.country,
        city: universitiesTable.city,
        degree: programsTable.degree,
        field: sql<string | null>`COALESCE(${programTranslationsTable.field}, ${programsTable.field})`,
        duration: sql<string | null>`COALESCE(${programTranslationsTable.duration}, ${programsTable.duration})`,
        language: programsTable.language,
      })
      .from(programsTable)
      .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
      .leftJoin(programTranslationsTable, and(
        eq(programTranslationsTable.programId, programsTable.id),
        eq(programTranslationsTable.locale, route.locale),
        eq(programTranslationsTable.status, "published"),
      ))
      .where(and(...conditions))
      .orderBy(asc(universitiesTable.name), asc(localizedName), asc(programsTable.id))
      .limit(PILOT_LIST_LIMIT),
  ]);
  const title = LIST_TITLES[route.locale] || LIST_TITLES.en;
  return {
    kind: "program_list",
    locale: route.locale,
    canonicalPath: route.path,
    title,
    description: LIST_DESCRIPTIONS[route.locale] || LIST_DESCRIPTIONS.en,
    total: Number(countRow?.count ?? 0),
    indexable: true,
    programs: rows.map((program) => ({
      ...program,
      canonicalPath: publicCatalogPath({
        locale: route.locale,
        entityType: "program",
        id: program.id,
        name: program.name,
      }),
    })),
  };
}

async function readProgramDetail(
  route: Extract<PublicCatalogRenderRoute, { kind: "program_detail" }>,
): Promise<PublicCatalogRenderModel> {
  if (!route.identity) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "Program not found",
      description: "The requested program is unavailable.",
      indexable: false,
    };
  }
  const policy = await getPublicCatalogPolicy();
  const conditions: any[] = [
    eq(programsTable.id, route.identity.id),
    eq(programsTable.isActive, true),
  ];
  addPublicCatalogConditions(conditions, policy);
  const [program] = await db
    .select({
      id: programsTable.id,
      name: sql<string>`COALESCE(${programTranslationsTable.name}, ${programsTable.name})`,
      description: sql<string | null>`COALESCE(${programTranslationsTable.description}, ${programsTable.description})`,
      degree: programsTable.degree,
      field: sql<string | null>`COALESCE(${programTranslationsTable.field}, ${programsTable.field})`,
      duration: sql<string | null>`COALESCE(${programTranslationsTable.duration}, ${programsTable.duration})`,
      language: programsTable.language,
      tuitionFee: programsTable.tuitionFee,
      discountedFee: programsTable.discountedFee,
      currency: programsTable.currency,
      translatedLocale: programTranslationsTable.locale,
      universityId: universitiesTable.id,
      universityName: universitiesTable.name,
      country: universitiesTable.country,
      city: universitiesTable.city,
    })
    .from(programsTable)
    .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
    .leftJoin(programTranslationsTable, and(
      eq(programTranslationsTable.programId, programsTable.id),
      eq(programTranslationsTable.locale, route.locale),
      eq(programTranslationsTable.status, "published"),
    ))
    .where(and(...conditions))
    .limit(1);
  if (!program) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "Program not found",
      description: "The requested program is unavailable.",
      indexable: false,
    };
  }
  const canonical = publicCatalogCanonicalState({
    requestedRouteKey: route.routeKey,
    locale: route.locale,
    entityType: "program",
    id: program.id,
    name: program.name,
  });
  const relatedConditions: any[] = [
    eq(programsTable.isActive, true),
    ne(programsTable.id, program.id),
  ];
  addPublicCatalogConditions(relatedConditions, policy);
  const relatedScore = sql<number>`(
    CASE WHEN ${programsTable.universityId} = ${program.universityId} THEN 8 ELSE 0 END
    + CASE WHEN lower(coalesce(${programsTable.field}, '')) = lower(${program.field ?? ""}::text) AND ${program.field ?? ""}::text <> '' THEN 4 ELSE 0 END
    + CASE WHEN lower(coalesce(${programsTable.degree}, '')) = lower(${program.degree ?? ""}::text) AND ${program.degree ?? ""}::text <> '' THEN 2 ELSE 0 END
    + CASE WHEN lower(${universitiesTable.country}) = lower(${program.country}) THEN 1 ELSE 0 END
  )`;
  const internalLinkMode = parsePublicWebInternalLinkMode(process.env.PUBLIC_WEB_INTERNAL_LINK_MODE);
  const [seoState, relatedCandidates] = await Promise.all([
    resolvePublishedEntitySeoState({
      entityType: "program",
      entityId: program.id,
      locale: route.locale,
    }),
    db
      .select({
        id: programsTable.id,
        name: sql<string>`COALESCE(${programTranslationsTable.name}, ${programsTable.name})`,
        universityName: universitiesTable.name,
        degree: programsTable.degree,
        field: sql<string | null>`COALESCE(${programTranslationsTable.field}, ${programsTable.field})`,
        score: relatedScore,
      })
      .from(programsTable)
      .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
      .leftJoin(programTranslationsTable, and(
        eq(programTranslationsTable.programId, programsTable.id),
        eq(programTranslationsTable.locale, route.locale),
        eq(programTranslationsTable.status, "published"),
      ))
      .where(and(...relatedConditions))
      .orderBy(desc(relatedScore), asc(universitiesTable.name), asc(programsTable.id))
      .limit(internalLinkMode === "published" ? PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT : 0),
  ]);
  const indexableRelatedIds = internalLinkMode === "published"
    ? await readIndexableProgramIds({
      locale: route.locale,
      programIds: relatedCandidates.map((candidate) => candidate.id),
    })
    : new Set<number>();
  const relatedPrograms = relatedCandidates
    .filter((candidate) => internalLinkMode === "published" && indexableRelatedIds.has(candidate.id))
    .slice(0, PUBLIC_CATALOG_RELATED_LIMIT)
    .map(({ score: _score, ...candidate }) => ({
      ...candidate,
      canonicalPath: publicCatalogPath({
        locale: route.locale,
        entityType: "program",
        id: candidate.id,
        name: candidate.name,
      }),
    }));
  const fallbackDescription = [
    program.degree,
    program.field,
    program.duration,
    program.universityName,
    program.country,
  ].filter(Boolean).join(" · ");
  return {
    kind: "program_detail",
    locale: route.locale,
    canonicalPath: seoState.canonicalPath || canonical.canonicalPath,
    title: `${program.name} | ${program.universityName}`,
    description: boundedText(program.description, fallbackDescription),
    indexable: seoState.indexable && (route.locale === "en" || program.translatedLocale === route.locale),
    alternatePaths: seoState.alternates,
    relatedPrograms,
    program: {
      id: program.id,
      name: program.name,
      universityName: program.universityName,
      universityPath: publicCatalogPath({
        locale: route.locale,
        entityType: "university",
        id: program.universityId,
        name: program.universityName,
      }),
      country: program.country,
      city: program.city,
      degree: program.degree,
      field: program.field,
      duration: program.duration,
      language: program.language,
      tuitionFee: program.tuitionFee,
      discountedFee: program.discountedFee,
      currency: program.currency,
    },
  };
}

async function readUniversityDetail(
  route: Extract<PublicCatalogRenderRoute, { kind: "university_detail" }>,
): Promise<PublicCatalogRenderModel> {
  if (!route.identity) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "University not found",
      description: "The requested university is unavailable.",
      indexable: false,
    };
  }
  const policy = await getPublicCatalogPolicy();
  const conditions: any[] = [eq(universitiesTable.id, route.identity.id)];
  addPublicCatalogConditions(conditions, policy);
  const [university] = await db
    .select({
      id: universitiesTable.id,
      name: universitiesTable.name,
      description: universitiesTable.description,
      country: universitiesTable.country,
      city: universitiesTable.city,
      universityType: universitiesTable.universityType,
    })
    .from(universitiesTable)
    .where(and(...conditions))
    .limit(1);
  if (!university) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "University not found",
      description: "The requested university is unavailable.",
      indexable: false,
    };
  }
  const programConditions: any[] = [
    eq(programsTable.universityId, university.id),
    eq(programsTable.isActive, true),
  ];
  addPublicCatalogConditions(programConditions, policy);
  const internalLinkMode = parsePublicWebInternalLinkMode(process.env.PUBLIC_WEB_INTERNAL_LINK_MODE);
  const [[countRow], programRows, seoState, localizedDelivery] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(programsTable)
      .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
      .where(and(...programConditions)),
    db
      .select({
        id: programsTable.id,
        name: sql<string>`COALESCE(${programTranslationsTable.name}, ${programsTable.name})`,
        degree: programsTable.degree,
        field: sql<string | null>`COALESCE(${programTranslationsTable.field}, ${programsTable.field})`,
      })
      .from(programsTable)
      .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
      .leftJoin(programTranslationsTable, and(
        eq(programTranslationsTable.programId, programsTable.id),
        eq(programTranslationsTable.locale, route.locale),
        eq(programTranslationsTable.status, "published"),
      ))
      .where(and(...programConditions))
      .orderBy(asc(programsTable.name), asc(programsTable.id))
      .limit(internalLinkMode === "published" ? PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT : PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT),
    resolvePublishedEntitySeoState({
      entityType: "university",
      entityId: university.id,
      locale: route.locale,
    }),
    readPublishedLocalizedEntity({
      entityType: "university",
      entityId: university.id,
      locale: route.locale,
    }),
  ]);
  const localizedUniversity = resolveLocalizedUniversityFields({
    locale: route.locale,
    delivery: localizedDelivery,
    base: {
      name: university.name,
      description: university.description,
      universityType: university.universityType,
    },
  });
  if (!localizedUniversity.available) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "University translation not published",
      description: "The requested university translation is unavailable.",
      indexable: false,
    };
  }
  const canonical = publicCatalogCanonicalState({
    requestedRouteKey: route.routeKey,
    locale: route.locale,
    entityType: "university",
    id: university.id,
    name: localizedUniversity.name,
  });
  const indexableProgramIds = internalLinkMode === "published"
    ? await readIndexableProgramIds({
      locale: route.locale,
      programIds: programRows.map((program) => program.id),
    })
    : null;
  const deliveredPrograms = programRows
    .filter((program) => indexableProgramIds === null || indexableProgramIds.has(program.id))
    .slice(0, PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT);
  return {
    kind: "university_detail",
    locale: route.locale,
    canonicalPath: localizedDelivery.snapshot?.canonicalPath || seoState.canonicalPath || canonical.canonicalPath,
    title: localizedUniversity.name,
    description: boundedText(
      localizedUniversity.description,
      [localizedUniversity.universityType, university.city, university.country].filter(Boolean).join(" · "),
    ),
    indexable: seoState.indexable,
    alternatePaths: seoState.alternates,
    university: {
      id: university.id,
      name: localizedUniversity.name,
      country: university.country,
      city: university.city,
      universityType: localizedUniversity.universityType,
      programCount: Number(countRow?.count ?? 0),
      programs: deliveredPrograms.map((program) => ({
        ...program,
        canonicalPath: publicCatalogPath({
          locale: route.locale,
          entityType: "program",
          id: program.id,
          name: program.name,
        }),
      })),
    },
  };
}

async function readDestinationDetail(
  route: Extract<PublicCatalogRenderRoute, { kind: "destination_detail" }>,
): Promise<PublicCatalogRenderModel> {
  const routeResolution = await resolvePublishedLocalizedDestinationRoute({
    locale: route.locale,
    slug: route.slug,
  });
  const [destination] = await db
    .select({
      id: destinationsTable.id,
      name: destinationsTable.name,
      slug: destinationsTable.slug,
      country: destinationsTable.country,
      shortDescription: destinationsTable.shortDescription,
      description: destinationsTable.description,
      livingCost: destinationsTable.livingCost,
      climate: destinationsTable.climate,
      language: destinationsTable.language,
      currency: destinationsTable.currency,
      visaInfo: destinationsTable.visaInfo,
      workPermit: destinationsTable.workPermit,
      popularCities: destinationsTable.popularCities,
    })
    .from(destinationsTable)
    .where(and(
      routeResolution.destinationId
        ? eq(destinationsTable.id, routeResolution.destinationId)
        : eq(destinationsTable.slug, route.slug),
      eq(destinationsTable.isActive, true),
    ))
    .limit(1);
  if (!destination) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "Destination not found",
      description: "The requested study destination is unavailable.",
      indexable: false,
    };
  }

  const policy = await getPublicCatalogPolicy();
  const universityConditions: any[] = [
    sql`lower(trim(${universitiesTable.country})) = lower(trim(${destination.country}))`,
  ];
  addPublicCatalogConditions(universityConditions, policy);
  const programConditions: any[] = [
    sql`lower(trim(${universitiesTable.country})) = lower(trim(${destination.country}))`,
    eq(programsTable.isActive, true),
  ];
  addPublicCatalogConditions(programConditions, policy);
  const internalLinkMode = parsePublicWebInternalLinkMode(process.env.PUBLIC_WEB_INTERNAL_LINK_MODE);

  const [[universityCount], [programCount], universityRows, seoState, localizedDelivery] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(universitiesTable)
      .where(and(...universityConditions)),
    db
      .select({ count: sql<number>`count(*)` })
      .from(programsTable)
      .innerJoin(universitiesTable, eq(programsTable.universityId, universitiesTable.id))
      .where(and(...programConditions)),
    db
      .select({
        id: universitiesTable.id,
        name: universitiesTable.name,
        city: universitiesTable.city,
        universityType: universitiesTable.universityType,
      })
      .from(universitiesTable)
      .where(and(...universityConditions))
      .orderBy(asc(universitiesTable.name), asc(universitiesTable.id))
      .limit(internalLinkMode === "published" ? PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT : PILOT_LIST_LIMIT),
    resolvePublishedEntitySeoState({
      entityType: "destination",
      entityId: destination.id,
      locale: route.locale,
    }),
    readPublishedLocalizedEntity({
      entityType: "destination",
      entityId: destination.id,
      locale: route.locale,
    }),
  ]);

  const localizedDestination = resolveLocalizedDestinationFields({
    locale: route.locale,
    delivery: localizedDelivery,
    base: {
      name: destination.name,
      shortDescription: destination.shortDescription,
      description: destination.description,
      whyStudyHere: null,
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
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "Destination translation not published",
      description: "The requested destination translation is unavailable.",
      indexable: false,
    };
  }

  const canonicalPath = localizedDelivery.snapshot?.canonicalPath || seoState.canonicalPath || buildPublicWebCanonicalPath({
    entityType: "DESTINATION",
    entityId: destination.id,
    locale: route.locale,
    slug: destination.slug,
  });
  const indexableUniversityIds = internalLinkMode === "published"
    ? await readIndexableUniversityIds({
      locale: route.locale,
      universityIds: universityRows.map((university) => university.id),
    })
    : null;
  const deliveredUniversities = universityRows
    .filter((university) => indexableUniversityIds === null || indexableUniversityIds.has(university.id))
    .slice(0, PILOT_LIST_LIMIT);
  return {
    kind: "destination_detail",
    locale: route.locale,
    canonicalPath,
    title: localizedDestination.name,
    description: boundedText(
      localizedDestination.shortDescription || localizedDestination.description,
      `Study opportunities in ${localizedDestination.name}`,
    ),
    indexable: seoState.indexable,
    alternatePaths: seoState.alternates,
    destination: {
      id: destination.id,
      name: localizedDestination.name,
      country: destination.country,
      livingCost: localizedDestination.livingCost,
      climate: localizedDestination.climate,
      language: localizedDestination.language,
      currency: localizedDestination.currency,
      visaInfo: localizedDestination.visaInfo,
      workPermit: localizedDestination.workPermit,
      popularCities: localizedDestination.popularCities,
      universityCount: Number(universityCount?.count ?? 0),
      programCount: Number(programCount?.count ?? 0),
      universities: deliveredUniversities.map((university) => ({
        ...university,
        canonicalPath: publicCatalogPath({
          locale: route.locale,
          entityType: "university",
          id: university.id,
          name: university.name,
        }),
      })),
    },
  };
}

async function readArticleDetail(
  route: Extract<PublicCatalogRenderRoute, { kind: "article_detail" }>,
): Promise<PublicCatalogRenderModel> {
  if (!route.identity) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "Guide not found",
      description: "The requested guide is unavailable.",
      indexable: false,
    };
  }
  const [post] = await db
    .select({
      id: websiteBlogPostsTable.id,
      title: websiteBlogPostsTable.title,
      slug: websiteBlogPostsTable.slug,
      excerpt: websiteBlogPostsTable.excerpt,
      content: websiteBlogPostsTable.content,
      locale: websiteBlogPostsTable.locale,
      metaTitle: websiteBlogPostsTable.metaTitle,
      metaDescription: websiteBlogPostsTable.metaDescription,
      translations: websiteBlogPostsTable.translationsJson,
      publishedAt: websiteBlogPostsTable.publishedAt,
      updatedAt: websiteBlogPostsTable.updatedAt,
      categoryId: websiteBlogPostsTable.categoryId,
    })
    .from(websiteBlogPostsTable)
    .where(and(
      eq(websiteBlogPostsTable.id, route.identity.id),
      eq(websiteBlogPostsTable.status, "published"),
      isNotNull(websiteBlogPostsTable.publishedAt),
      lte(websiteBlogPostsTable.publishedAt, new Date()),
    ))
    .limit(1);
  if (!post || !post.publishedAt) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "Guide not found",
      description: "The requested guide is unavailable.",
      indexable: false,
    };
  }

  const baseContent = isRecord(post.content) ? post.content : {};
  const translations = isRecord(post.translations) ? post.translations : {};
  const translated = isRecord(translations[route.locale])
    ? translations[route.locale] as Record<string, unknown>
    : null;
  const sourceLocale = String(post.locale || "en").toLowerCase();
  const translationAvailable = route.locale === sourceLocale
    || Boolean(
      translated
      && boundedString(translated.title, 500).trim()
      && boundedString(translated.body, 200_000).trim(),
    );
  const title = translationAvailable && translated
    ? boundedString(translated.title, 500).trim()
    : post.title;
  const body = translationAvailable && translated
    ? boundedString(translated.body, 200_000)
    : boundedString(baseContent.body, 200_000);
  const excerpt = translationAvailable && translated
    ? boundedString(translated.excerpt, 2_000).trim() || null
    : post.excerpt;
  const metaTitle = translationAvailable && translated
    ? boundedString(translated.metaTitle, 500).trim()
    : post.metaTitle;
  const metaDescription = translationAvailable && translated
    ? boundedString(translated.metaDescription, 2_000).trim()
    : post.metaDescription;
  const readTimeValue = Number(baseContent.readTime);
  const seoState = await resolvePublishedEntitySeoState({
    entityType: "article",
    entityId: post.id,
    locale: route.locale,
  });
  const canonicalPath = seoState.canonicalPath || buildPublicWebCanonicalPath({
    entityType: "ARTICLE",
    entityId: post.id,
    locale: route.locale,
    slug: post.slug,
  });
  const internalLinkMode = parsePublicWebInternalLinkMode(process.env.PUBLIC_WEB_INTERNAL_LINK_MODE);
  const relatedCandidates = internalLinkMode === "published" && post.categoryId !== null
    ? await db
      .select({
        id: websiteBlogPostsTable.id,
        title: websiteBlogPostsTable.title,
        slug: websiteBlogPostsTable.slug,
        excerpt: websiteBlogPostsTable.excerpt,
        content: websiteBlogPostsTable.content,
        locale: websiteBlogPostsTable.locale,
        translations: websiteBlogPostsTable.translationsJson,
        publishedAt: websiteBlogPostsTable.publishedAt,
      })
      .from(websiteBlogPostsTable)
      .where(and(
        ne(websiteBlogPostsTable.id, post.id),
        eq(websiteBlogPostsTable.categoryId, post.categoryId),
        eq(websiteBlogPostsTable.status, "published"),
        isNotNull(websiteBlogPostsTable.publishedAt),
        lte(websiteBlogPostsTable.publishedAt, new Date()),
        or(
          eq(websiteBlogPostsTable.locale, route.locale),
          sql`${websiteBlogPostsTable.translationsJson} ? ${route.locale}`,
        ),
      ))
      .orderBy(desc(websiteBlogPostsTable.publishedAt), desc(websiteBlogPostsTable.id))
      .limit(PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT)
    : [];
  const localizedRelatedCandidates = relatedCandidates.flatMap((candidate) => {
    if (!candidate.publishedAt) return [];
    const candidateTranslations = isRecord(candidate.translations) ? candidate.translations : {};
    const candidateTranslation = isRecord(candidateTranslations[route.locale])
      ? candidateTranslations[route.locale] as Record<string, unknown>
      : null;
    const candidateIsSource = String(candidate.locale || "en").toLowerCase() === route.locale;
    const candidateTitle = candidateIsSource
      ? candidate.title.trim()
      : boundedString(candidateTranslation?.title, 500).trim();
    const candidateBody = candidateIsSource
      ? boundedString(isRecord(candidate.content) ? candidate.content.body : null, 200_000).trim()
      : boundedString(candidateTranslation?.body, 200_000).trim();
    if (!candidateTitle || !candidateBody) return [];
    return [{
      id: candidate.id,
      title: candidateTitle,
      excerpt: candidateIsSource
        ? candidate.excerpt
        : boundedString(candidateTranslation?.excerpt, 2_000).trim() || null,
      publishedAt: candidate.publishedAt.toISOString(),
      canonicalPath: buildPublicWebCanonicalPath({
        entityType: "ARTICLE",
        entityId: candidate.id,
        locale: route.locale,
        slug: candidate.slug,
      }),
    }];
  });
  const indexableRelatedIds = await readIndexableArticleIds({
    locale: route.locale,
    articleIds: localizedRelatedCandidates.map((candidate) => candidate.id),
  });
  const relatedArticles = localizedRelatedCandidates
    .filter((candidate) => indexableRelatedIds.has(candidate.id))
    .slice(0, PUBLIC_GUIDE_RELATED_LIMIT);
  return {
    kind: "article_detail",
    locale: route.locale,
    canonicalPath,
    title: metaTitle || title,
    description: boundedText(metaDescription || excerpt, title),
    indexable: seoState.indexable && translationAvailable && body.trim().length > 0,
    alternatePaths: seoState.alternates,
    relatedArticles,
    article: {
      id: post.id,
      title,
      excerpt,
      body,
      publishedAt: post.publishedAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      readTime: Number.isSafeInteger(readTimeValue) && readTimeValue > 0 && readTimeValue <= 240
        ? readTimeValue
        : null,
    },
  };
}

async function readPageDetail(
  route: Extract<PublicCatalogRenderRoute, { kind: "page_detail" }>,
): Promise<PublicCatalogRenderModel> {
  const [page] = await db
    .select({
      id: websitePagesTable.id,
      title: websitePagesTable.title,
      slug: websitePagesTable.slug,
      locale: websitePagesTable.locale,
      metaTitle: websitePagesTable.metaTitle,
      metaDescription: websitePagesTable.metaDescription,
      publishedAt: websitePagesTable.publishedAt,
    })
    .from(websitePagesTable)
    .where(and(
      eq(websitePagesTable.slug, route.slug),
      eq(websitePagesTable.status, "published"),
      isNotNull(websitePagesTable.publishedAt),
      lte(websitePagesTable.publishedAt, new Date()),
    ))
    .limit(1);
  if (!page || !page.publishedAt) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "Page not found",
      description: "The requested page is unavailable.",
      indexable: false,
    };
  }
  const [version] = await db
    .select({
      versionNumber: websitePageVersionsTable.versionNumber,
      blocksSnapshot: websitePageVersionsTable.blocksSnapshot,
      metaSnapshot: websitePageVersionsTable.metaSnapshot,
      publishedAt: websitePageVersionsTable.publishedAt,
    })
    .from(websitePageVersionsTable)
    .where(and(
      eq(websitePageVersionsTable.pageId, page.id),
      isNotNull(websitePageVersionsTable.publishedAt),
      lte(websitePageVersionsTable.publishedAt, new Date()),
    ))
    .orderBy(desc(websitePageVersionsTable.versionNumber))
    .limit(1);
  if (!version || !version.publishedAt) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "Page not found",
      description: "The requested page has no published version.",
      indexable: false,
    };
  }

  const metaSnapshot = isRecord(version.metaSnapshot) ? version.metaSnapshot : {};
  const snapshotTranslations = isRecord(metaSnapshot.translationsJson)
    ? metaSnapshot.translationsJson
    : {};
  const translation = isRecord(snapshotTranslations[route.locale])
    ? snapshotTranslations[route.locale] as Record<string, unknown>
    : null;
  const translationFields = translation && isRecord(translation.fields)
    ? translation.fields
    : translation;
  const sourceLocale = String(page.locale || "en").toLowerCase();
  const source = route.locale === sourceLocale;
  const title = source
    ? boundedString(metaSnapshot.title, 500).trim() || page.title
    : boundedString(translationFields?.title, 500).trim();
  const metaTitle = source
    ? boundedString(metaSnapshot.metaTitle, 500).trim() || page.metaTitle || ""
    : boundedString(translationFields?.metaTitle, 500).trim();
  const metaDescription = source
    ? boundedString(metaSnapshot.metaDescription, 2_000).trim() || page.metaDescription || ""
    : boundedString(translationFields?.metaDescription, 2_000).trim();
  const blocks = source
    ? publicPageBlocks(version.blocksSnapshot)
    : publicPageBlocks(translation?.blocks);
  const translationAvailable = Boolean(title && blocks.length > 0);
  if (!translationAvailable) {
    return {
      kind: "not_found",
      locale: route.locale,
      canonicalPath: route.path,
      title: "Page not found",
      description: "The requested page is unavailable in this language.",
      indexable: false,
    };
  }
  const seoState = await resolvePublishedEntitySeoState({
    entityType: "page",
    entityId: page.id,
    locale: route.locale,
  });
  const canonicalPath = seoState.canonicalPath || buildPublicWebCanonicalPath({
    entityType: "PAGE",
    entityId: page.id,
    locale: route.locale,
    slug: page.slug,
  });
  return {
    kind: "page_detail",
    locale: route.locale,
    canonicalPath,
    title: metaTitle || title,
    description: boundedText(metaDescription, title),
    indexable: metaSnapshot.robotsIndex === true && seoState.indexable,
    alternatePaths: seoState.alternates,
    page: {
      id: page.id,
      title,
      slug: page.slug,
      versionNumber: version.versionNumber,
      publishedAt: version.publishedAt.toISOString(),
      blocks,
    },
  };
}

async function loadModel(route: PublicCatalogRenderRoute): Promise<PublicCatalogRenderModel> {
  if (route.kind === "program_list") return readProgramList(route);
  if (route.kind === "program_detail") return readProgramDetail(route);
  if (route.kind === "university_detail") return readUniversityDetail(route);
  if (route.kind === "destination_detail") return readDestinationDetail(route);
  if (route.kind === "article_detail") return readArticleDetail(route);
  return readPageDetail(route);
}

function refresh(key: string, route: PublicCatalogRenderRoute): Promise<PublicCatalogRenderModel> {
  const current = inFlight.get(key);
  if (current) return current;
  const pending = loadModel(route)
    .then((value) => {
      saveCache(key, value);
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, pending);
  return pending;
}

export async function getPublicCatalogRenderModel(
  route: PublicCatalogRenderRoute,
): Promise<{ value: PublicCatalogRenderModel; cacheStatus: PublicCatalogRenderCacheStatus }> {
  const key = cacheKey(route);
  const now = Date.now();
  const entry = cache.get(key);
  if (entry?.freshUntil && entry.freshUntil > now) {
    return { value: entry.value, cacheStatus: "HIT" };
  }
  if (entry?.staleUntil && entry.staleUntil > now) {
    void refresh(key, route).catch((error) => {
      console.error("[public-render] stale refresh failed", {
        routeKind: route.kind,
        message: error instanceof Error ? error.message : "unknown_error",
      });
    });
    return { value: entry.value, cacheStatus: "STALE" };
  }
  const coalesced = inFlight.has(key);
  const value = await refresh(key, route);
  return { value, cacheStatus: coalesced ? "COALESCED" : "MISS" };
}

export function invalidatePublicCatalogRenderCache(input: {
  entityType?: "program" | "university" | "destination" | "article" | "page" | "all";
  entityId?: number;
  locale?: string;
} = {}): number {
  let removed = 0;
  for (const key of cache.keys()) {
    const [locale, kind, identity] = key.split(":");
    const localeMatches = !input.locale || input.locale === locale;
    const entityMatches = !input.entityType
      || input.entityType === "all"
      || (input.entityType === "program" && (
        kind === "program_list"
        || (input.entityId !== undefined && identity === String(input.entityId))
      ))
      || (input.entityType === "university" && kind === "university_detail"
        && input.entityId !== undefined && identity === String(input.entityId))
      || (input.entityType === "destination" && kind === "destination_detail")
      || (input.entityType === "article" && kind === "article_detail"
        && input.entityId !== undefined && identity === String(input.entityId))
      || (input.entityType === "page" && kind === "page_detail");
    if (localeMatches && entityMatches) {
      cache.delete(key);
      removed += 1;
    }
  }
  return removed;
}
