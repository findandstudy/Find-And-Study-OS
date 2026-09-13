import { PROGRAM_SUPPORTED_LOCALES } from "./programTranslationContract.js";

export type LegacyPublicationPageRow = {
  id: number;
  title: string;
  slug: string;
  status: string;
  locale: string;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  ogImageUrl: string | null;
  robotsIndex: boolean;
  translationsJson: unknown;
  publishedAt: Date | string | null;
  updatedAt: Date | string;
};

export type LegacyPublicationBlogRow = {
  id: number;
  status: string;
  locale: string;
  metaTitle: string | null;
  metaDescription: string | null;
  updatedAt: Date | string;
};

export type LegacyPublicationVersionRow = {
  id: number;
  pageId: number;
  versionNumber: number;
  publishedAt: Date | string | null;
  createdAt: Date | string;
};

export type PublicWebPublicationQueueItem = {
  id: number;
  title: string;
  slug: string;
  locale: string;
  status: string;
  robotsIndex: boolean;
  seoScore: number;
  translationCoveragePercent: number;
  translatedLocaleCount: number;
  totalLocaleCount: number;
  blockers: string[];
  priority: "CRITICAL" | "HIGH" | "NORMAL";
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteDate(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

function present(value: string | null, min: number, max: number) {
  const length = value?.trim().length ?? 0;
  return length >= min && length <= max;
}

function httpsUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

function translationLocales(page: LegacyPublicationPageRow): Set<string> {
  const found = new Set<string>();
  if (PROGRAM_SUPPORTED_LOCALES.includes(page.locale as never)) found.add(page.locale);
  if (!isRecord(page.translationsJson)) return found;
  for (const [locale, content] of Object.entries(page.translationsJson)) {
    if (
      PROGRAM_SUPPORTED_LOCALES.includes(locale as never) &&
      isRecord(content) &&
      Object.keys(content).length > 0
    ) {
      found.add(locale);
    }
  }
  return found;
}

function evaluatePage(page: LegacyPublicationPageRow): PublicWebPublicationQueueItem {
  const blockers: string[] = [];
  let seoScore = 0;
  if (present(page.metaTitle, 10, 60)) seoScore += 25;
  else blockers.push("META_TITLE_INVALID");
  if (present(page.metaDescription, 50, 160)) seoScore += 25;
  else blockers.push("META_DESCRIPTION_INVALID");
  if (httpsUrl(page.canonicalUrl)) seoScore += 25;
  else blockers.push("CANONICAL_INVALID");
  if (httpsUrl(page.ogImageUrl)) seoScore += 25;
  else blockers.push("SOCIAL_IMAGE_MISSING");

  const locales = translationLocales(page);
  const totalLocaleCount = PROGRAM_SUPPORTED_LOCALES.length;
  const translationCoveragePercent = Math.floor((locales.size / totalLocaleCount) * 100);
  if (translationCoveragePercent < 100) blockers.push("TRANSLATIONS_INCOMPLETE");
  if (page.status !== "published") blockers.push("NOT_PUBLISHED");
  if (page.status === "published" && !page.robotsIndex) blockers.push("NOINDEX");
  if (page.status === "published" && finiteDate(page.publishedAt) === null) {
    blockers.push("PUBLISH_RECEIPT_MISSING");
  }

  const critical = blockers.includes("PUBLISH_RECEIPT_MISSING") ||
    (page.status === "published" && blockers.includes("CANONICAL_INVALID"));
  const high = page.status === "published" && blockers.length > 0;
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    locale: page.locale,
    status: page.status,
    robotsIndex: page.robotsIndex,
    seoScore,
    translationCoveragePercent,
    translatedLocaleCount: locales.size,
    totalLocaleCount,
    blockers,
    priority: critical ? "CRITICAL" : high ? "HIGH" : "NORMAL",
    updatedAt: finiteDate(page.updatedAt) ?? new Date(0).toISOString(),
  };
}

export function buildPublicWebPublicationReadModel(input: {
  pages: LegacyPublicationPageRow[];
  blogPosts: LegacyPublicationBlogRow[];
  versions: LegacyPublicationVersionRow[];
  generatedAt: Date | string;
}) {
  const generatedAt = finiteDate(input.generatedAt);
  if (!generatedAt) throw new Error("public_web_read_model_time_invalid");
  if (input.pages.length > 10_000 || input.blogPosts.length > 10_000 || input.versions.length > 1_000) {
    throw new Error("public_web_read_model_denominator_exceeded");
  }
  const queue = input.pages.map(evaluatePage).sort((left, right) => {
    const rank = { CRITICAL: 0, HIGH: 1, NORMAL: 2 } as const;
    return rank[left.priority] - rank[right.priority] ||
      right.blockers.length - left.blockers.length ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id - right.id;
  });
  const localeCoverage = PROGRAM_SUPPORTED_LOCALES.map((locale) => ({
    locale,
    pages: input.pages.filter((page) => translationLocales(page).has(locale)).length,
    coveragePercent: input.pages.length === 0
      ? 0
      : Math.floor((input.pages.filter((page) => translationLocales(page).has(locale)).length / input.pages.length) * 100),
  }));
  const versions = [...input.versions]
    .sort((left, right) => (finiteDate(right.createdAt) ?? "").localeCompare(finiteDate(left.createdAt) ?? ""))
    .slice(0, 20)
    .map((version) => ({
      id: version.id,
      pageId: version.pageId,
      versionNumber: version.versionNumber,
      publishedAt: finiteDate(version.publishedAt),
      createdAt: finiteDate(version.createdAt) ?? new Date(0).toISOString(),
    }));

  return {
    schemaVersion: 1 as const,
    generatedAt,
    foundation: {
      state: "DEFAULT_UNWIRED" as const,
      mutationsEnabled: false,
      indexAutomationEnabled: false,
    },
    summary: {
      totalPages: input.pages.length,
      publishedPages: input.pages.filter((page) => page.status === "published").length,
      draftPages: input.pages.filter((page) => page.status === "draft").length,
      indexablePublishedPages: queue.filter((page) => page.status === "published" && page.robotsIndex).length,
      seoReadyPages: queue.filter((page) => page.seoScore === 100).length,
      translationCompletePages: queue.filter((page) => page.translationCoveragePercent === 100).length,
      criticalPages: queue.filter((page) => page.priority === "CRITICAL").length,
      totalBlogPosts: input.blogPosts.length,
      publishedBlogPosts: input.blogPosts.filter((post) => post.status === "published").length,
      blogSeoReady: input.blogPosts.filter((post) =>
        present(post.metaTitle, 10, 60) && present(post.metaDescription, 50, 160)
      ).length,
      recentVersionCount: versions.length,
    },
    localeCoverage,
    queue: queue.slice(0, 200),
    recentVersions: versions,
  };
}
