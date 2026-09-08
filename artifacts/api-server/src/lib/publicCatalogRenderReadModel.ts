import {
  db,
  programsTable,
  programTranslationsTable,
  universitiesTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import {
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
} from "./publicCatalogRenderContract";
import { resolvePublishedEntitySeoState } from "./publicWebDiscoveryReadModel";
import type { ProgramSupportedLocale } from "./programTranslationContract";

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

function cacheKey(route: PublicCatalogRenderRoute): string {
  return `${route.locale}:${route.kind}:${route.kind === "program_list" ? "index" : route.identity?.id ?? route.routeKey}`;
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
  const seoState = await resolvePublishedEntitySeoState({
    entityType: "program",
    entityId: program.id,
    locale: route.locale,
  });
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
  const [[countRow], programRows, seoState] = await Promise.all([
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
      .limit(12),
    resolvePublishedEntitySeoState({
      entityType: "university",
      entityId: university.id,
      locale: route.locale,
    }),
  ]);
  const canonical = publicCatalogCanonicalState({
    requestedRouteKey: route.routeKey,
    locale: route.locale,
    entityType: "university",
    id: university.id,
    name: university.name,
  });
  return {
    kind: "university_detail",
    locale: route.locale,
    canonicalPath: seoState.canonicalPath || canonical.canonicalPath,
    title: university.name,
    description: boundedText(
      university.description,
      [university.universityType, university.city, university.country].filter(Boolean).join(" · "),
    ),
    indexable: seoState.indexable && route.locale === "en",
    alternatePaths: seoState.alternates,
    university: {
      id: university.id,
      name: university.name,
      country: university.country,
      city: university.city,
      universityType: university.universityType,
      programCount: Number(countRow?.count ?? 0),
      programs: programRows.map((program) => ({
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

async function loadModel(route: PublicCatalogRenderRoute): Promise<PublicCatalogRenderModel> {
  if (route.kind === "program_list") return readProgramList(route);
  if (route.kind === "program_detail") return readProgramDetail(route);
  return readUniversityDetail(route);
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
  entityType?: "program" | "university" | "all";
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
        && input.entityId !== undefined && identity === String(input.entityId));
    if (localeMatches && entityMatches) {
      cache.delete(key);
      removed += 1;
    }
  }
  return removed;
}
