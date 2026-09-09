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

type PublicSeoEntityType = "program" | "university" | "destination" | "article" | "page";

const ENTITY_ID_COLUMNS: Record<
  PublicSeoEntityType,
  "program_id" | "university_id" | "destination_id" | "blog_post_id" | "website_page_id"
> = {
  program: "program_id",
  university: "university_id",
  destination: "destination_id",
  article: "blog_post_id",
  page: "website_page_id",
};
const SEO_CACHE_TTL_MS = 5 * 60_000;
const SEO_CACHE_MAX_ENTRIES = 5_000;
const seoCache = new Map<string, { expiresAt: number; value: PublicEntitySeoState }>();
const seoInFlight = new Map<string, Promise<PublicEntitySeoState>>();

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
            OR (content.entity_type IN ('UNIVERSITY','DESTINATION') AND content.locale='en')
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
                content.destination_id,content.website_page_id,content.blog_post_id,
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
              OR (content.entity_type IN ('UNIVERSITY','DESTINATION') AND content.locale='en')
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
            )) OR (page.entity_type IN ('UNIVERSITY','DESTINATION') AND alt.locale='en') OR (
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
            )) OR (content.entity_type IN ('UNIVERSITY','DESTINATION') AND content.locale='en') OR (
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

export async function readIndexableUniversityIds(input: {
  locale: ProgramSupportedLocale;
  universityIds: readonly number[];
}): Promise<Set<number>> {
  const config = publicWebDiscoveryConfigFromEnvironment();
  if (config.mode !== "published" || !config.scope || input.locale !== "en") return new Set();
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
        WHERE content.tenant_id=$1 AND content.organization_id=$2
          AND content.entity_type='UNIVERSITY' AND content.locale=$3
          AND content.university_id=ANY($4::integer[])
          AND state.status='PUBLISHED' AND state.index_state='INDEX'
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
  return removed;
}
