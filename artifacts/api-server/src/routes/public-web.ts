import { Router, type IRouter, type Request, type Response } from "express";
import { db, websiteBlogCategoriesTable, websiteBlogPostsTable } from "@workspace/db";
import { and, desc, eq, isNotNull, lt, lte, or, sql } from "drizzle-orm";

import {
  getPublicCatalogRenderModel,
} from "../lib/publicCatalogRenderReadModel";
import {
  matchPublicCatalogRenderPath,
} from "../lib/publicCatalogRenderContract";
import {
  buildPublicWebCanonicalPath,
} from "../lib/publicWebContentContract";
import {
  normalizeProgramLocale,
} from "../lib/programTranslationContract";

const router: IRouter = Router();
const PUBLIC_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";

function setPublicHeaders(res: Response): void {
  res.setHeader("Cache-Control", PUBLIC_CACHE_CONTROL);
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.slice(0, maximum).trim() : "";
}

router.get("/public/web/guides", async (req: Request, res: Response): Promise<void> => {
  const locale = normalizeProgramLocale(req.query.locale);
  const rawLimit = Number(req.query.limit ?? 12);
  const limit = Number.isSafeInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 24
    ? rawLimit
    : 12;
  const rawCursor = req.query.cursor === undefined ? null : Number(req.query.cursor);
  if (rawCursor !== null && (!Number.isSafeInteger(rawCursor) || rawCursor < 1)) {
    res.status(400).json({ error: "Invalid cursor", code: "PUBLIC_GUIDE_CURSOR_INVALID" });
    return;
  }

  const conditions: any[] = [
    eq(websiteBlogPostsTable.status, "published"),
    isNotNull(websiteBlogPostsTable.publishedAt),
    lte(websiteBlogPostsTable.publishedAt, new Date()),
    or(
      eq(websiteBlogPostsTable.locale, locale),
      sql`${websiteBlogPostsTable.translationsJson} ? ${locale}`,
    ),
  ];
  if (rawCursor !== null) conditions.push(lt(websiteBlogPostsTable.id, rawCursor));

  const rows = await db
    .select({
      id: websiteBlogPostsTable.id,
      title: websiteBlogPostsTable.title,
      slug: websiteBlogPostsTable.slug,
      excerpt: websiteBlogPostsTable.excerpt,
      content: websiteBlogPostsTable.content,
      sourceLocale: websiteBlogPostsTable.locale,
      translations: websiteBlogPostsTable.translationsJson,
      featuredImageUrl: websiteBlogPostsTable.featuredImageUrl,
      publishedAt: websiteBlogPostsTable.publishedAt,
      updatedAt: websiteBlogPostsTable.updatedAt,
      category: websiteBlogCategoriesTable.name,
    })
    .from(websiteBlogPostsTable)
    .leftJoin(
      websiteBlogCategoriesTable,
      eq(websiteBlogPostsTable.categoryId, websiteBlogCategoriesTable.id),
    )
    .where(and(...conditions))
    .orderBy(desc(websiteBlogPostsTable.id))
    .limit(limit + 1);

  const delivered = rows.slice(0, limit).flatMap((row) => {
    const translations = isRecord(row.translations) ? row.translations : {};
    const translated = isRecord(translations[locale])
      ? translations[locale] as Record<string, unknown>
      : null;
    const source = String(row.sourceLocale || "en").toLowerCase() === locale;
    const title = source ? row.title : text(translated?.title, 500);
    const excerpt = source ? row.excerpt : text(translated?.excerpt, 2_000) || null;
    const body = source
      ? text(isRecord(row.content) ? row.content.body : null, 200_000)
      : text(translated?.body, 200_000);
    if (!title || !body || !row.publishedAt) return [];
    return [{
      id: row.id,
      title,
      excerpt,
      category: row.category,
      featuredImageUrl: row.featuredImageUrl,
      publishedAt: row.publishedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      canonicalPath: buildPublicWebCanonicalPath({
        entityType: "ARTICLE",
        entityId: row.id,
        locale,
        slug: row.slug,
      }),
    }];
  });
  const hasMore = rows.length > limit;
  setPublicHeaders(res);
  res.json({
    data: delivered,
    meta: {
      locale,
      limit,
      hasMore,
      nextCursor: hasMore ? rows[limit - 1]?.id ?? null : null,
      generatedAt: new Date().toISOString(),
    },
  });
});

router.get("/public/web/guides/:routeKey", async (req: Request, res: Response): Promise<void> => {
  const locale = normalizeProgramLocale(req.query.locale);
  const path = `/${locale}/guides/${String(req.params.routeKey)}`;
  const route = matchPublicCatalogRenderPath(path);
  if (!route || route.kind !== "article_detail" || !route.identity) {
    res.status(400).json({ error: "Invalid guide route", code: "PUBLIC_GUIDE_ROUTE_INVALID" });
    return;
  }
  const rendered = await getPublicCatalogRenderModel(route);
  if (rendered.value.kind === "not_found") {
    res.status(404).json({ error: "Guide not found", code: "PUBLIC_GUIDE_NOT_FOUND" });
    return;
  }
  if (rendered.value.kind !== "article_detail") {
    res.status(500).json({ error: "Guide projection unavailable", code: "PUBLIC_GUIDE_PROJECTION_INVALID" });
    return;
  }
  setPublicHeaders(res);
  res.setHeader("Content-Location", rendered.value.canonicalPath);
  res.json({
    data: rendered.value.article,
    meta: {
      locale,
      title: rendered.value.title,
      description: rendered.value.description,
      indexable: rendered.value.indexable,
      canonicalPath: rendered.value.canonicalPath,
      alternatePaths: rendered.value.alternatePaths,
      requestedPathIsCanonical: rendered.value.canonicalPath === path,
      generatedAt: new Date().toISOString(),
    },
  });
});

export default router;
