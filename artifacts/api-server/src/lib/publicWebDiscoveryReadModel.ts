import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import {
  PUBLIC_WEB_DISCOVERY_ENTITY_TYPES,
  PUBLIC_WEB_SITEMAP_PAGE_SIZE,
  parsePublicWebDiscoveryConfig,
  type PublicWebDiscoveryConfig,
  type PublicWebDiscoveryEntityType,
  type PublicWebDiscoveryScope,
  type PublicWebSitemapCount,
  type PublicWebSitemapEntry,
} from "./publicWebDiscoveryContract";
import type { ProgramSupportedLocale } from "./programTranslationContract";
import type {
  PublicLocalizedDestinationRouteResolution,
  PublicLocalizedEntityCollectionDelivery,
  PublicLocalizedEntityDelivery,
  PublicLocalizedEntitySnapshot,
} from "./publicLocalizedEntityContract";

type RawCount = { entity_type: string; locale: string; count: string };
type RawSitemapRow = {
  canonical_path: string;
  last_modified: Date | string;
  alternates: Record<string, string> | null;
};

export type PublicEntitySeoState = {
  indexable: boolean;
  canonicalPath: string | null;
  alternates: Partial<Record<ProgramSupportedLocale, string>>;
};

export type PublicWebRouteAliasAction =
  | { kind: "redirect"; status: 301 | 308; targetPath: string }
  | { kind: "gone"; status: 410 };

export type PublicWebRouteAliasResolution = {
  mode: "off" | "published";
  action: PublicWebRouteAliasAction | null;
};

type PublicSeoEntityType = "program" | "university" | "destination" | "city" | "article" | "page";
type PublicLocalizedEntityType = "university" | "destination" | "city";

const ENTITY_ID_COLUMNS: Record<
  PublicSeoEntityType,
  "program_id" | "university_id" | "destination_id" | "city_id" | "blog_post_id" | "website_page_id"
> = {
  program: "program_id",
  university: "university_id",
  destination: "destination_id",
  city: "city_id",
  article: "blog_post_id",
  page: "website_page_id",
};
const SEO_CACHE_TTL_MS = 5 * 60_000;
const SEO_CACHE_MAX_ENTRIES = 5_000;
const seoCache = new Map<string, { expiresAt: number; value: PublicEntitySeoState }>();
const seoInFlight = new Map<string, Promise<PublicEntitySeoState>>();
const ROUTE_ALIAS_CACHE_TTL_MS = 5 * 60_000;
const ROUTE_ALIAS_CACHE_MAX_ENTRIES = 5_000;
const routeAliasCache = new Map<string, { expiresAt: number; value: PublicWebRouteAliasResolution }>();
const routeAliasInFlight = new Map<string, Promise<PublicWebRouteAliasResolution>>();

type RawLocalizedEntityRow = {
  entity_id?: number;
  canonical_path: string;
  title: string;
  summary: string | null;
  content_json: unknown;
  index_state: string;
};

function localizedDeliveryMode(config: PublicWebDiscoveryConfig): "off" | "published" {
  if (config.mode === "published" && config.scope) return "published";
  return String(process.env.PUBLIC_WEB_SITEMAP_MODE ?? "")
    .trim()
    .toLocaleLowerCase("en-US") === "published"
    ? "published"
    : "off";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocalizedEntityRow(row: RawLocalizedEntityRow | undefined): PublicLocalizedEntitySnapshot | null {
  if (!row || !isPlainRecord(row.content_json)) return null;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const summary = typeof row.summary === "string" ? row.summary.trim() : null;
  if (
    !title
    || title.length > 500
    || (summary !== null && summary.length > 4_000)
    || (row.index_state !== "INDEX" && row.index_state !== "NOINDEX")
  ) {
    return null;
  }
  return {
    canonicalPath: row.canonical_path,
    title,
    summary: summary || null,
    content: row.content_json,
    indexState: row.index_state,
  };
}

function safeLocalPublicPath(value: unknown): string | null {
  const path = typeof value === "string" ? value : "";
  if (
    path.length < 4
    || path.length > 2_048
    || !/^\/(en|tr|ar|fr|ru|fa|zh|hi|es|id|ur|tk|ky|kk|uz|tg|bn|pt|ne|vi|ko|uk|it)(\/[a-z0-9][a-z0-9._~-]*)+\/?$/.test(path)
    || path.includes("//")
    || path.includes("..")
    || path.includes("?")
    || path.includes("#")
    || /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return null;
  }
  return path;
}

function pruneRouteAliasCache(now: number): void {
  for (const [key, entry] of routeAliasCache) {
    if (entry.expiresAt <= now) routeAliasCache.delete(key);
  }
  while (routeAliasCache.size >= ROUTE_ALIAS_CACHE_MAX_ENTRIES) {
    const oldest = routeAliasCache.keys().next().value;
    if (oldest === undefined) break;
    routeAliasCache.delete(oldest);
  }
}

function pruneSeoCache(now: number): void {
  for (const [key, entry] of seoCache) {
    if (entry.expiresAt <= now) seoCache.delete(key);
  }
  while (seoCache.size >= SEO_CACHE_MAX_ENTRIES) {
    const oldest = seoCache.keys().next().value;
    if (oldest === undefined) break;
    seoCache.delete(oldest);
  }
}

export function publicWebDiscoveryConfigFromEnvironment(): PublicWebDiscoveryConfig {
  return parsePublicWebDiscoveryConfig({
    mode: process.env.PUBLIC_WEB_SITEMAP_MODE,
    siteUrl: process.env.PUBLIC_SITE_URL,
    tenantId: process.env.PUBLIC_WEB_TENANT_ID,
    organizationId: process.env.PUBLIC_WEB_ORGANIZATION_ID,
  });
}

export async function resolvePublicWebRouteAlias(path: string): Promise<PublicWebRouteAliasResolution> {
  const config = publicWebDiscoveryConfigFromEnvironment();
  const mode = localizedDeliveryMode(config);
  const safePath = safeLocalPublicPath(path);
  if (mode !== "published" || config.mode !== "published" || !config.scope || !safePath) {
    return { mode, action: null };
  }
  const key = `${config.scope.tenantId}:${config.scope.organizationId}:${safePath}`;
  const now = Date.now();
  const cached = routeAliasCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const existing = routeAliasInFlight.get(key);
  if (existing) return existing;
  const scope = config.scope;
  const pending = withPublicScope(scope, async (client) => client.query<{
    route_kind: string;
    redirect_to_path: string | null;
    http_status: number;
  }>(
    `SELECT alias.route_kind,alias.redirect_to_path,alias.http_status
       FROM public_web_route_aliases alias
       JOIN public_web_content_records content
         ON content.tenant_id=alias.tenant_id
        AND content.organization_id=alias.organization_id
        AND content.id=alias.content_record_id
       LEFT JOIN public_web_publication_states state
         ON state.tenant_id=content.tenant_id
        AND state.organization_id=content.organization_id
        AND state.content_record_id=content.id
      WHERE alias.tenant_id=$1 AND alias.organization_id=$2 AND alias.path=$3
        AND alias.route_kind IN ('REDIRECT','GONE')
        AND alias.valid_from <= now()
        AND (alias.valid_to IS NULL OR alias.valid_to > now())
        AND (alias.route_kind='GONE' OR state.status='PUBLISHED')
      ORDER BY alias.valid_from DESC,alias.id DESC
      LIMIT 1`,
    [scope.tenantId, scope.organizationId, safePath],
  )).then((result): PublicWebRouteAliasResolution => {
    const row = result.rows[0];
    let action: PublicWebRouteAliasAction | null = null;
    if (row?.route_kind === "GONE" && Number(row.http_status) === 410) {
      action = { kind: "gone", status: 410 };
    } else if (
      row?.route_kind === "REDIRECT"
      && (Number(row.http_status) === 301 || Number(row.http_status) === 308)
    ) {
      const targetPath = safeLocalPublicPath(row.redirect_to_path);
      if (targetPath && targetPath !== safePath) {
        action = {
          kind: "redirect",
          status: Number(row.http_status) as 301 | 308,
          targetPath,
        };
      }
    }
    const value: PublicWebRouteAliasResolution = { mode: "published", action };
    pruneRouteAliasCache(Date.now());
    routeAliasCache.set(key, { value, expiresAt: Date.now() + ROUTE_ALIAS_CACHE_TTL_MS });
    return value;
  }).finally(() => routeAliasInFlight.delete(key));
  routeAliasInFlight.set(key, pending);
  return pending;
}

async function withPublicScope<T>(
  scope: PublicWebDiscoveryScope,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let finished = false;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.organization_id', $2, true)",
      [scope.tenantId, scope.organizationId],
    );
    const value = await run(client);
    await client.query("COMMIT");
    finished = true;
    return value;
  } finally {
    if (!finished) await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

export async function readPublishedSitemapCounts(
  scope: PublicWebDiscoveryScope,
): Promise<PublicWebSitemapCount[]> {
  return withPublicScope(scope, async (client) => {
    const result = await client.query<RawCount>(
      `SELECT content.entity_type,content.locale,count(*)::text AS count
         FROM public_web_content_records content
         JOIN public_web_publication_states state
           ON state.tenant_id=content.tenant_id
          AND state.organization_id=content.organization_id
          AND state.content_record_id=content.id
        WHERE content.tenant_id=$1 AND content.organization_id=$2
          AND state.status='PUBLISHED' AND state.index_state='INDEX'
          AND (
            (content.entity_type='PROGRAM' AND (
              content.locale='en' OR EXISTS (
                SELECT 1 FROM program_translations translation
                 WHERE translation.program_id=content.program_id
                   AND translation.locale=content.locale
                   AND translation.status='published'
              )
            ))
            OR (content.entity_type IN ('UNIVERSITY','DESTINATION','CITY') AND EXISTS (
              SELECT 1 FROM public_web_content_revisions localized_revision
               WHERE localized_revision.tenant_id=state.tenant_id
                 AND localized_revision.organization_id=state.organization_id
                 AND localized_revision.content_record_id=state.content_record_id
                 AND localized_revision.id=state.revision_id
                 AND localized_revision.quality_status='PASS'
                 AND localized_revision.source_coverage='COMPLETE'
                 AND localized_revision.translation_status=CASE WHEN content.locale='en' THEN 'SOURCE' ELSE 'PUBLISHED' END
                 AND length(trim(localized_revision.title)) BETWEEN 1 AND 500
                 AND octet_length(localized_revision.content_json::text) BETWEEN 1 AND 1048576
                 AND octet_length(localized_revision.seo_json::text) <= 65536
            ))
            OR (content.entity_type='ARTICLE' AND EXISTS (
              SELECT 1 FROM website_blog_posts post
               WHERE post.id=content.blog_post_id
                 AND post.status='published'
                 AND post.published_at IS NOT NULL
                 AND post.published_at <= now()
                 AND (
                   post.locale=content.locale
                   OR length(trim(COALESCE(post.translations_json->content.locale->>'body',''))) > 0
                 )
            ))
            OR (content.entity_type='PAGE' AND EXISTS (
              SELECT 1 FROM website_pages website_page
               WHERE website_page.id=content.website_page_id
                 AND website_page.status='published'
                 AND website_page.published_at IS NOT NULL
                 AND website_page.published_at <= now()
                 AND EXISTS (
                   SELECT 1 FROM website_page_versions version
                    WHERE version.page_id=website_page.id
                      AND version.published_at IS NOT NULL
                      AND version.published_at <= now()
                      AND version.id=(
                        SELECT latest_version.id FROM website_page_versions latest_version
                         WHERE latest_version.page_id=website_page.id
                           AND latest_version.published_at IS NOT NULL
                           AND latest_version.published_at <= now()
                         ORDER BY latest_version.version_number DESC
                         LIMIT 1
                      )
                      AND (
                        website_page.locale=content.locale
                        OR (
                          jsonb_typeof(version.meta_snapshot->'translationsJson'->content.locale->'blocks')='array'
                          AND jsonb_array_length(version.meta_snapshot->'translationsJson'->content.locale->'blocks') > 0
                        )
                      )
                 )
            ))
          )
        GROUP BY content.entity_type,content.locale
        ORDER BY content.entity_type,content.locale`,
      [scope.tenantId, scope.organizationId],
    );
    return result.rows.flatMap((row) => {
      const entityType = PUBLIC_WEB_DISCOVERY_ENTITY_TYPES.find((value) => value === row.entity_type);
      const count = Number(row.count);
      if (!entityType || !Number.isSafeInteger(count) || count < 1) return [];
      return [{ entityType, locale: row.locale as ProgramSupportedLocale, count }];
    });
  });
}

export async function readPublishedSitemapPage(input: {
  scope: PublicWebDiscoveryScope;
  entityType: PublicWebDiscoveryEntityType;
  locale: ProgramSupportedLocale;
  shard: number;
}): Promise<PublicWebSitemapEntry[]> {
  const offset = (input.shard - 1) * PUBLIC_WEB_SITEMAP_PAGE_SIZE;
  if (!Number.isSafeInteger(offset) || offset < 0) return [];
  return withPublicScope(input.scope, async (client) => {
    const result = await client.query<RawSitemapRow>(
      `WITH page AS (
         SELECT content.id,content.entity_type,content.program_id,content.university_id,
                content.destination_id,content.city_id,content.website_page_id,content.blog_post_id,
                content.canonical_path,GREATEST(content.updated_at,state.updated_at) AS last_modified
           FROM public_web_content_records content
           JOIN public_web_publication_states state
             ON state.tenant_id=content.tenant_id
            AND state.organization_id=content.organization_id
            AND state.content_record_id=content.id
          WHERE content.tenant_id=$1 AND content.organization_id=$2
            AND content.entity_type=$3 AND content.locale=$4
            AND state.status='PUBLISHED' AND state.index_state='INDEX'
            AND (
              (content.entity_type='PROGRAM' AND (
                content.locale='en' OR EXISTS (
                  SELECT 1 FROM program_translations translation
                   WHERE translation.program_id=content.program_id
                     AND translation.locale=content.locale
                     AND translation.status='published'
                )
              ))
              OR (content.entity_type IN ('UNIVERSITY','DESTINATION','CITY') AND EXISTS (
                SELECT 1 FROM public_web_content_revisions localized_revision
                 WHERE localized_revision.tenant_id=state.tenant_id
                   AND localized_revision.organization_id=state.organization_id
                   AND localized_revision.content_record_id=state.content_record_id
                   AND localized_revision.id=state.revision_id
                   AND localized_revision.quality_status='PASS'
                   AND localized_revision.source_coverage='COMPLETE'
                   AND localized_revision.translation_status=CASE WHEN content.locale='en' THEN 'SOURCE' ELSE 'PUBLISHED' END
                   AND length(trim(localized_revision.title)) BETWEEN 1 AND 500
                   AND octet_length(localized_revision.content_json::text) BETWEEN 1 AND 1048576
                   AND octet_length(localized_revision.seo_json::text) <= 65536
              ))
              OR (content.entity_type='ARTICLE' AND EXISTS (
                SELECT 1 FROM website_blog_posts post
                 WHERE post.id=content.blog_post_id
                   AND post.status='published'
                   AND post.published_at IS NOT NULL
                   AND post.published_at <= now()
                   AND (
                     post.locale=content.locale
                     OR length(trim(COALESCE(post.translations_json->content.locale->>'body',''))) > 0
                   )
              ))
              OR (content.entity_type='PAGE' AND EXISTS (
                SELECT 1 FROM website_pages website_page
                 WHERE website_page.id=content.website_page_id
                   AND website_page.status='published'
                   AND website_page.published_at IS NOT NULL
                   AND website_page.published_at <= now()
                   AND EXISTS (
                     SELECT 1 FROM website_page_versions version
                      WHERE version.page_id=website_page.id
                        AND version.published_at IS NOT NULL
                        AND version.published_at <= now()
                        AND version.id=(
                          SELECT latest_version.id FROM website_page_versions latest_version
                           WHERE latest_version.page_id=website_page.id
                             AND latest_version.published_at IS NOT NULL
                             AND latest_version.published_at <= now()
                           ORDER BY latest_version.version_number DESC
                           LIMIT 1
                        )
                        AND (
                          website_page.locale=content.locale
                          OR (
                            jsonb_typeof(version.meta_snapshot->'translationsJson'->content.locale->'blocks')='array'
                            AND jsonb_array_length(version.meta_snapshot->'translationsJson'->content.locale->'blocks') > 0
                          )
                        )
                   )
              ))
            )
          ORDER BY content.id
          LIMIT $5 OFFSET $6
       )
       SELECT page.canonical_path,page.last_modified,
              COALESCE(jsonb_object_agg(alt.locale,alt.canonical_path)
                FILTER (WHERE alt.locale IS NOT NULL),'{}'::jsonb) AS alternates
         FROM page
         LEFT JOIN public_web_content_records alt
           ON alt.tenant_id=$1 AND alt.organization_id=$2
          AND alt.entity_type=page.entity_type
          AND (
            (page.entity_type='PROGRAM' AND alt.program_id=page.program_id)
            OR (page.entity_type='UNIVERSITY' AND alt.university_id=page.university_id)
            OR (page.entity_type='DESTINATION' AND alt.destination_id=page.destination_id)
            OR (page.entity_type='CITY' AND alt.city_id=page.city_id)
            OR (page.entity_type='PAGE' AND alt.website_page_id=page.website_page_id)
            OR (page.entity_type='ARTICLE' AND alt.blog_post_id=page.blog_post_id)
          )
         LEFT JOIN public_web_publication_states alt_state
           ON alt_state.tenant_id=alt.tenant_id
          AND alt_state.organization_id=alt.organization_id
          AND alt_state.content_record_id=alt.id
          AND alt_state.status='PUBLISHED' AND alt_state.index_state='INDEX'
          AND (
            (page.entity_type='PROGRAM' AND (
              alt.locale='en' OR EXISTS (
                SELECT 1 FROM program_translations alt_translation
                 WHERE alt_translation.program_id=alt.program_id
                   AND alt_translation.locale=alt.locale
                   AND alt_translation.status='published'
              )
            )) OR (page.entity_type IN ('UNIVERSITY','DESTINATION','CITY') AND EXISTS (
              SELECT 1 FROM public_web_content_revisions alt_revision
               WHERE alt_revision.tenant_id=alt_state.tenant_id
                 AND alt_revision.organization_id=alt_state.organization_id
                 AND alt_revision.content_record_id=alt_state.content_record_id
                 AND alt_revision.id=alt_state.revision_id
                 AND alt_revision.quality_status='PASS'
                 AND alt_revision.source_coverage='COMPLETE'
                 AND alt_revision.translation_status=CASE WHEN alt.locale='en' THEN 'SOURCE' ELSE 'PUBLISHED' END
                 AND length(trim(alt_revision.title)) BETWEEN 1 AND 500
                 AND octet_length(alt_revision.content_json::text) BETWEEN 1 AND 1048576
                 AND octet_length(alt_revision.seo_json::text) <= 65536
            )) OR (
              page.entity_type='ARTICLE' AND EXISTS (
                SELECT 1 FROM website_blog_posts alt_post
                 WHERE alt_post.id=alt.blog_post_id
                   AND alt_post.status='published'
                   AND alt_post.published_at IS NOT NULL
                   AND alt_post.published_at <= now()
                   AND (
                     alt_post.locale=alt.locale
                     OR length(trim(COALESCE(alt_post.translations_json->alt.locale->>'body',''))) > 0
                   )
              )
            ) OR (
              page.entity_type='PAGE' AND EXISTS (
                SELECT 1 FROM website_pages alt_page
                 WHERE alt_page.id=alt.website_page_id
                   AND alt_page.status='published'
                   AND alt_page.published_at IS NOT NULL
                   AND alt_page.published_at <= now()
                   AND EXISTS (
                     SELECT 1 FROM website_page_versions alt_version
                      WHERE alt_version.page_id=alt_page.id
                        AND alt_version.published_at IS NOT NULL
                        AND alt_version.published_at <= now()
                        AND alt_version.id=(
                          SELECT latest_version.id FROM website_page_versions latest_version
                           WHERE latest_version.page_id=alt_page.id
                             AND latest_version.published_at IS NOT NULL
                             AND latest_version.published_at <= now()
                           ORDER BY latest_version.version_number DESC
                           LIMIT 1
                        )
                        AND (
                          alt_page.locale=alt.locale
                          OR (
                            jsonb_typeof(alt_version.meta_snapshot->'translationsJson'->alt.locale->'blocks')='array'
                            AND jsonb_array_length(alt_version.meta_snapshot->'translationsJson'->alt.locale->'blocks') > 0
                          )
                        )
                   )
              )
            )
          )
        WHERE alt.id IS NULL OR alt_state.content_record_id IS NOT NULL
        GROUP BY page.id,page.canonical_path,page.last_modified
        ORDER BY page.id`,
      [input.scope.tenantId, input.scope.organizationId, input.entityType, input.locale, PUBLIC_WEB_SITEMAP_PAGE_SIZE, offset],
    );
    return result.rows.map((row) => ({
      path: row.canonical_path,
      lastModified: new Date(row.last_modified).toISOString(),
      alternates: row.alternates || {},
    }));
  });
}

export async function readPublishedEntitySeoState(input: {
  scope: PublicWebDiscoveryScope;
  entityType: PublicSeoEntityType;
  entityId: number;
  locale: ProgramSupportedLocale;
}): Promise<PublicEntitySeoState> {
  const idColumn = ENTITY_ID_COLUMNS[input.entityType];
  return withPublicScope(input.scope, async (client) => {
    const result = await client.query<{ locale: string; canonical_path: string }>(
      `SELECT content.locale,content.canonical_path
         FROM public_web_content_records content
         JOIN public_web_publication_states state
           ON state.tenant_id=content.tenant_id
          AND state.organization_id=content.organization_id
          AND state.content_record_id=content.id
        WHERE content.tenant_id=$1 AND content.organization_id=$2
          AND content.entity_type=$3 AND content.${idColumn}=$4
          AND state.status='PUBLISHED' AND state.index_state='INDEX'
          AND (
            (content.entity_type='PROGRAM' AND (
              content.locale='en' OR EXISTS (
                SELECT 1 FROM program_translations translation
                 WHERE translation.program_id=content.program_id
                   AND translation.locale=content.locale
                   AND translation.status='published'
              )
            )) OR (content.entity_type IN ('UNIVERSITY','DESTINATION','CITY') AND EXISTS (
              SELECT 1 FROM public_web_content_revisions localized_revision
               WHERE localized_revision.tenant_id=state.tenant_id
                 AND localized_revision.organization_id=state.organization_id
                 AND localized_revision.content_record_id=state.content_record_id
                 AND localized_revision.id=state.revision_id
                 AND localized_revision.quality_status='PASS'
                 AND localized_revision.source_coverage='COMPLETE'
                 AND localized_revision.translation_status=CASE WHEN content.locale='en' THEN 'SOURCE' ELSE 'PUBLISHED' END
                 AND length(trim(localized_revision.title)) BETWEEN 1 AND 500
                 AND octet_length(localized_revision.content_json::text) BETWEEN 1 AND 1048576
                 AND octet_length(localized_revision.seo_json::text) <= 65536
            )) OR (
              content.entity_type='ARTICLE' AND EXISTS (
                SELECT 1 FROM website_blog_posts post
                 WHERE post.id=content.blog_post_id
                   AND post.status='published'
                   AND post.published_at IS NOT NULL
                   AND post.published_at <= now()
                   AND (
                     post.locale=content.locale
                     OR length(trim(COALESCE(post.translations_json->content.locale->>'body',''))) > 0
                   )
              )
            ) OR (
              content.entity_type='PAGE' AND EXISTS (
                SELECT 1 FROM website_pages website_page
                 WHERE website_page.id=content.website_page_id
                   AND website_page.status='published'
                   AND website_page.published_at IS NOT NULL
                   AND website_page.published_at <= now()
                   AND EXISTS (
                     SELECT 1 FROM website_page_versions version
                      WHERE version.page_id=website_page.id
                        AND version.published_at IS NOT NULL
                        AND version.published_at <= now()
                        AND version.id=(
                          SELECT latest_version.id FROM website_page_versions latest_version
                           WHERE latest_version.page_id=website_page.id
                             AND latest_version.published_at IS NOT NULL
                             AND latest_version.published_at <= now()
                           ORDER BY latest_version.version_number DESC
                           LIMIT 1
                        )
                        AND (
                          website_page.locale=content.locale
                          OR (
                            jsonb_typeof(version.meta_snapshot->'translationsJson'->content.locale->'blocks')='array'
                            AND jsonb_array_length(version.meta_snapshot->'translationsJson'->content.locale->'blocks') > 0
                          )
                        )
                   )
              )
            )
          )
        ORDER BY content.locale`,
      [input.scope.tenantId, input.scope.organizationId, input.entityType.toUpperCase(), input.entityId],
    );
    const alternates = Object.fromEntries(
      result.rows.map((row) => [row.locale, row.canonical_path]),
    ) as Partial<Record<ProgramSupportedLocale, string>>;
    return {
      indexable: typeof alternates[input.locale] === "string",
      canonicalPath: alternates[input.locale] || null,
      alternates,
    };
  });
}

export async function readPublishedLocalizedEntity(input: {
  entityType: PublicLocalizedEntityType;
  entityId: number;
  locale: ProgramSupportedLocale;
}): Promise<PublicLocalizedEntityDelivery> {
  const config = publicWebDiscoveryConfigFromEnvironment();
  if (config.mode !== "published" || !config.scope) {
    return { mode: localizedDeliveryMode(config), snapshot: null };
  }
  const scope = config.scope;
  if (!Number.isSafeInteger(input.entityId) || input.entityId < 1 || input.entityId > 2_147_483_647) {
    return { mode: "published", snapshot: null };
  }
  const entityType = input.entityType.toUpperCase();
  const idColumn = ENTITY_ID_COLUMNS[input.entityType];
  const result = await withPublicScope(scope, async (client) => client.query<RawLocalizedEntityRow>(
    `SELECT content.canonical_path,revision.title,revision.summary,
            revision.content_json,state.index_state
       FROM public_web_content_records content
       JOIN public_web_publication_states state
         ON state.tenant_id=content.tenant_id
        AND state.organization_id=content.organization_id
        AND state.content_record_id=content.id
       JOIN public_web_content_revisions revision
         ON revision.tenant_id=state.tenant_id
        AND revision.organization_id=state.organization_id
        AND revision.content_record_id=state.content_record_id
        AND revision.id=state.revision_id
      WHERE content.tenant_id=$1 AND content.organization_id=$2
        AND content.entity_type=$3 AND content.${idColumn}=$4 AND content.locale=$5
        AND state.status='PUBLISHED'
        AND revision.quality_status='PASS'
        AND revision.source_coverage='COMPLETE'
        AND revision.translation_status=CASE WHEN content.locale='en' THEN 'SOURCE' ELSE 'PUBLISHED' END
        AND length(trim(revision.title)) BETWEEN 1 AND 500
        AND octet_length(COALESCE(revision.summary,'')) <= 4000
        AND octet_length(revision.content_json::text) BETWEEN 1 AND 1048576
        AND octet_length(revision.seo_json::text) <= 65536
      ORDER BY revision.revision_number DESC
      LIMIT 1`,
    [scope.tenantId, scope.organizationId, entityType, input.entityId, input.locale],
  ));
  return { mode: "published", snapshot: parseLocalizedEntityRow(result.rows[0]) };
}

export async function readPublishedLocalizedEntities(input: {
  entityType: PublicLocalizedEntityType;
  entityIds: readonly number[];
  locale: ProgramSupportedLocale;
}): Promise<PublicLocalizedEntityCollectionDelivery> {
  const config = publicWebDiscoveryConfigFromEnvironment();
  const mode = localizedDeliveryMode(config);
  if (config.mode !== "published" || !config.scope) {
    return { mode, snapshots: new Map() };
  }
  const entityIds = [...new Set(input.entityIds)]
    .filter((id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647)
    .slice(0, 64);
  if (entityIds.length === 0) return { mode: "published", snapshots: new Map() };
  const entityType = input.entityType.toUpperCase();
  const idColumn = ENTITY_ID_COLUMNS[input.entityType];
  const scope = config.scope;
  const result = await withPublicScope(scope, async (client) => client.query<RawLocalizedEntityRow>(
    `SELECT content.${idColumn} AS entity_id,content.canonical_path,
            revision.title,revision.summary,revision.content_json,state.index_state
       FROM public_web_content_records content
       JOIN public_web_publication_states state
         ON state.tenant_id=content.tenant_id
        AND state.organization_id=content.organization_id
        AND state.content_record_id=content.id
       JOIN public_web_content_revisions revision
         ON revision.tenant_id=state.tenant_id
        AND revision.organization_id=state.organization_id
        AND revision.content_record_id=state.content_record_id
        AND revision.id=state.revision_id
      WHERE content.tenant_id=$1 AND content.organization_id=$2
        AND content.entity_type=$3 AND content.locale=$4
        AND content.${idColumn}=ANY($5::integer[])
        AND state.status='PUBLISHED'
        AND revision.quality_status='PASS'
        AND revision.source_coverage='COMPLETE'
        AND revision.translation_status=CASE WHEN content.locale='en' THEN 'SOURCE' ELSE 'PUBLISHED' END
        AND length(trim(revision.title)) BETWEEN 1 AND 500
        AND octet_length(COALESCE(revision.summary,'')) <= 4000
        AND octet_length(revision.content_json::text) BETWEEN 1 AND 1048576
        AND octet_length(revision.seo_json::text) <= 65536
      ORDER BY content.${idColumn}
      LIMIT 64`,
    [scope.tenantId, scope.organizationId, entityType, input.locale, entityIds],
  ));
  const snapshots = new Map<number, PublicLocalizedEntitySnapshot>();
  for (const row of result.rows) {
    const entityId = Number(row.entity_id);
    const snapshot = parseLocalizedEntityRow(row);
    if (snapshot && Number.isSafeInteger(entityId) && entityId > 0) {
      snapshots.set(entityId, snapshot);
    }
  }
  return { mode: "published", snapshots };
}

export async function resolvePublishedLocalizedDestinationRoute(input: {
  locale: ProgramSupportedLocale;
  slug: string;
}): Promise<PublicLocalizedDestinationRouteResolution> {
  const config = publicWebDiscoveryConfigFromEnvironment();
  if (config.mode !== "published" || !config.scope) {
    return { mode: localizedDeliveryMode(config), destinationId: null, snapshot: null };
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) || input.slug.length > 180) {
    return { mode: "published", destinationId: null, snapshot: null };
  }
  const scope = config.scope;
  const canonicalPath = `/${input.locale}/destinations/${input.slug}`;
  const result = await withPublicScope(scope, async (client) => client.query<RawLocalizedEntityRow>(
    `SELECT content.destination_id AS entity_id,content.canonical_path,
            revision.title,revision.summary,revision.content_json,state.index_state
       FROM public_web_content_records content
       JOIN public_web_publication_states state
         ON state.tenant_id=content.tenant_id
        AND state.organization_id=content.organization_id
        AND state.content_record_id=content.id
       JOIN public_web_content_revisions revision
         ON revision.tenant_id=state.tenant_id
        AND revision.organization_id=state.organization_id
        AND revision.content_record_id=state.content_record_id
        AND revision.id=state.revision_id
      WHERE content.tenant_id=$1 AND content.organization_id=$2
        AND content.entity_type='DESTINATION' AND content.locale=$3
        AND content.canonical_path=$4
        AND state.status='PUBLISHED'
        AND revision.quality_status='PASS'
        AND revision.source_coverage='COMPLETE'
        AND revision.translation_status=CASE WHEN content.locale='en' THEN 'SOURCE' ELSE 'PUBLISHED' END
        AND length(trim(revision.title)) BETWEEN 1 AND 500
        AND octet_length(COALESCE(revision.summary,'')) <= 4000
        AND octet_length(revision.content_json::text) BETWEEN 1 AND 1048576
        AND octet_length(revision.seo_json::text) <= 65536
      LIMIT 1`,
    [scope.tenantId, scope.organizationId, input.locale, canonicalPath],
  ));
  const row = result.rows[0];
  const snapshot = parseLocalizedEntityRow(row);
  const destinationId = Number(row?.entity_id);
  return {
    mode: "published",
    destinationId: snapshot && Number.isSafeInteger(destinationId) && destinationId > 0
      ? destinationId
      : null,
    snapshot,
  };
}

export async function readIndexableProgramIds(input: {
  locale: ProgramSupportedLocale;
  programIds: readonly number[];
}): Promise<Set<number>> {
  const config = publicWebDiscoveryConfigFromEnvironment();
  if (config.mode !== "published" || !config.scope) return new Set();
  const scope = config.scope;
  const programIds = [...new Set(input.programIds)]
    .filter((id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647)
    .slice(0, 64);
  if (programIds.length === 0) return new Set();
  return withPublicScope(scope, async (client) => {
    const result = await client.query<{ program_id: number }>(
      `SELECT content.program_id
         FROM public_web_content_records content
         JOIN public_web_publication_states state
           ON state.tenant_id=content.tenant_id
          AND state.organization_id=content.organization_id
          AND state.content_record_id=content.id
        WHERE content.tenant_id=$1 AND content.organization_id=$2
          AND content.entity_type='PROGRAM' AND content.locale=$3
          AND content.program_id=ANY($4::integer[])
          AND state.status='PUBLISHED' AND state.index_state='INDEX'
          AND (
            content.locale='en' OR EXISTS (
              SELECT 1 FROM program_translations translation
               WHERE translation.program_id=content.program_id
                 AND translation.locale=content.locale
                 AND translation.status='published'
            )
          )
        ORDER BY content.program_id
        LIMIT 64`,
      [scope.tenantId, scope.organizationId, input.locale, programIds],
    );
    return new Set(result.rows.map((row) => Number(row.program_id)));
  });
}

export async function readIndexableArticleIds(input: {
  locale: ProgramSupportedLocale;
  articleIds: readonly number[];
}): Promise<Set<number>> {
  const config = publicWebDiscoveryConfigFromEnvironment();
  if (config.mode !== "published" || !config.scope) return new Set();
  const scope = config.scope;
  const articleIds = [...new Set(input.articleIds)]
    .filter((id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647)
    .slice(0, 64);
  if (articleIds.length === 0) return new Set();
  return withPublicScope(scope, async (client) => {
    const result = await client.query<{ blog_post_id: number }>(
      `SELECT content.blog_post_id
         FROM public_web_content_records content
         JOIN public_web_publication_states state
           ON state.tenant_id=content.tenant_id
          AND state.organization_id=content.organization_id
          AND state.content_record_id=content.id
         JOIN website_blog_posts post ON post.id=content.blog_post_id
        WHERE content.tenant_id=$1 AND content.organization_id=$2
          AND content.entity_type='ARTICLE' AND content.locale=$3
          AND content.blog_post_id=ANY($4::integer[])
          AND state.status='PUBLISHED' AND state.index_state='INDEX'
          AND post.status='published' AND post.published_at IS NOT NULL
          AND post.published_at <= now()
          AND (
            post.locale=content.locale
            OR (
              length(trim(COALESCE(post.translations_json->content.locale->>'title',''))) > 0
              AND length(trim(COALESCE(post.translations_json->content.locale->>'body',''))) > 0
            )
          )
        ORDER BY content.blog_post_id
        LIMIT 64`,
      [scope.tenantId, scope.organizationId, input.locale, articleIds],
    );
    return new Set(result.rows.map((row) => Number(row.blog_post_id)));
  });
}

export async function readIndexableUniversityIds(input: {
  locale: ProgramSupportedLocale;
  universityIds: readonly number[];
}): Promise<Set<number>> {
  const config = publicWebDiscoveryConfigFromEnvironment();
  if (config.mode !== "published" || !config.scope) return new Set();
  const scope = config.scope;
  const universityIds = [...new Set(input.universityIds)]
    .filter((id) => Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647)
    .slice(0, 64);
  if (universityIds.length === 0) return new Set();
  return withPublicScope(scope, async (client) => {
    const result = await client.query<{ university_id: number }>(
      `SELECT content.university_id
         FROM public_web_content_records content
         JOIN public_web_publication_states state
           ON state.tenant_id=content.tenant_id
          AND state.organization_id=content.organization_id
          AND state.content_record_id=content.id
         JOIN public_web_content_revisions revision
           ON revision.tenant_id=state.tenant_id
          AND revision.organization_id=state.organization_id
          AND revision.content_record_id=state.content_record_id
          AND revision.id=state.revision_id
        WHERE content.tenant_id=$1 AND content.organization_id=$2
          AND content.entity_type='UNIVERSITY' AND content.locale=$3
          AND content.university_id=ANY($4::integer[])
          AND state.status='PUBLISHED' AND state.index_state='INDEX'
          AND revision.quality_status='PASS'
          AND revision.source_coverage='COMPLETE'
          AND revision.translation_status=CASE WHEN content.locale='en' THEN 'SOURCE' ELSE 'PUBLISHED' END
          AND length(trim(revision.title)) BETWEEN 1 AND 500
          AND octet_length(revision.content_json::text) BETWEEN 1 AND 1048576
          AND octet_length(revision.seo_json::text) <= 65536
        ORDER BY content.university_id
        LIMIT 64`,
      [scope.tenantId, scope.organizationId, input.locale, universityIds],
    );
    return new Set(result.rows.map((row) => Number(row.university_id)));
  });
}

export async function resolvePublishedEntitySeoState(input: {
  entityType: PublicSeoEntityType;
  entityId: number;
  locale: ProgramSupportedLocale;
}): Promise<PublicEntitySeoState> {
  const config = publicWebDiscoveryConfigFromEnvironment();
  if (config.mode !== "published" || !config.scope) {
    return { indexable: false, canonicalPath: null, alternates: {} };
  }
  const key = [
    config.scope.tenantId,
    config.scope.organizationId,
    input.entityType,
    input.entityId,
    input.locale,
  ].join(":");
  const now = Date.now();
  const cached = seoCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const existing = seoInFlight.get(key);
  if (existing) return existing;
  const pending = readPublishedEntitySeoState({ ...input, scope: config.scope })
    .then((value) => {
      pruneSeoCache(Date.now());
      seoCache.set(key, { value, expiresAt: Date.now() + SEO_CACHE_TTL_MS });
      return value;
    })
    .finally(() => seoInFlight.delete(key));
  seoInFlight.set(key, pending);
  return pending;
}

export function invalidatePublicWebDiscoveryCache(input: {
  entityType?: PublicSeoEntityType;
  entityId?: number;
  locale?: ProgramSupportedLocale;
  path?: string;
} = {}): number {
  let removed = 0;
  for (const key of seoCache.keys()) {
    const parts = key.split(":");
    const entityType = parts.at(-3);
    const entityId = Number(parts.at(-2));
    const locale = parts.at(-1);
    if (
      (!input.entityType || input.entityType === entityType)
      && (input.entityId === undefined || input.entityId === entityId)
      && (!input.locale || input.locale === locale)
    ) {
      seoCache.delete(key);
      removed += 1;
    }
  }
  const requestedPath = input.path ? safeLocalPublicPath(input.path) : null;
  for (const key of routeAliasCache.keys()) {
    if (!requestedPath || key.endsWith(`:${requestedPath}`)) {
      routeAliasCache.delete(key);
      removed += 1;
    }
  }
  return removed;
}
