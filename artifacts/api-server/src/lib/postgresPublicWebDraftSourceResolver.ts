import crypto from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import { canonicalJson } from "./jsonCanonical.js";
import type {
  PublicWebDraftSourceBinding,
} from "./publicWebDraftIntakeBuilder.js";
import type { PublicWebEntityType } from "./publicWebContentContract.js";

const EXACT_EXECUTOR_ROLE = "fas_public_web_executor";
const MAX_ENTITY_ID = 2_147_483_647;
const MAX_CANONICAL_SOURCE_BYTES = 2 * 1024 * 1024;

const SOURCE_QUERIES: Record<PublicWebEntityType, string> = {
  PROGRAM: `SELECT program.id, program.university_id, program.name,
      program.description, program.degree, program.field, program.language,
      program.duration, program.tuition_fee, program.currency,
      program.scholarship, program.intakes, program.requirements,
      program.application_fee, program.advanced_fee, program.deposit_fee,
      program.discounted_fee, program.language_fee, program.min_gpa,
      program.min_language_score, program.quota,
      program.updated_at::text AS updated_at
    FROM programs program
    JOIN universities university ON university.id = program.university_id
    WHERE program.id = $1 AND program.is_active = true
      AND university.is_active = true
      AND octet_length(program.name) <= 2048
      AND octet_length(coalesce(program.description, '')) <= 262144
      AND octet_length(coalesce(program.requirements, '')) <= 262144
      AND octet_length(coalesce(program.intakes, '')) <= 65536
    LIMIT 2`,
  UNIVERSITY: `SELECT university.id, university.name, university.country,
      university.city, university.website, university.logo_url,
      university.description, university.ranking, university.university_type,
      university.qs_ranking, university.times_ranking,
      university.shanghai_ranking, university.cwts_leiden_ranking,
      university.address, university.status,
      university.updated_at::text AS updated_at
    FROM universities university
    WHERE university.id = $1 AND university.is_active = true
      AND university.status = 'open'
      AND octet_length(university.name) <= 2048
      AND octet_length(coalesce(university.description, '')) <= 262144
      AND octet_length(coalesce(university.address, '')) <= 65536
    LIMIT 2`,
  DESTINATION: `SELECT destination.id, destination.name, destination.slug,
      destination.country, destination.flag_emoji, destination.hero_image_url,
      destination.thumbnail_url, destination.short_description,
      destination.description, destination.why_study_here,
      destination.living_cost, destination.climate, destination.language,
      destination.currency, destination.visa_info, destination.work_permit,
      destination.popular_cities, destination.university_count,
      destination.program_count, destination.average_tuition,
      destination.updated_at::text AS updated_at
    FROM destinations destination
    WHERE destination.id = $1 AND destination.is_active = true
      AND octet_length(destination.name) <= 2048
      AND octet_length(coalesce(destination.description, '')) <= 262144
      AND octet_length(coalesce(destination.why_study_here, '')) <= 262144
      AND octet_length(coalesce(destination.visa_info, '')) <= 262144
    LIMIT 2`,
  CITY: `SELECT city.id, city.name, city.country_id, country.name AS country_name,
      country.code AS country_code, city.updated_at::text AS updated_at,
      country.updated_at::text AS country_updated_at
    FROM cities city
    JOIN countries country ON country.id = city.country_id
    WHERE city.id = $1 AND city.is_active = true AND country.is_active = true
      AND octet_length(city.name) <= 2048
      AND octet_length(country.name) <= 2048
    LIMIT 2`,
  PAGE: `SELECT page.id, page.title, page.slug, page.status, page.template,
      page.meta_title, page.meta_description, page.og_image_url,
      page.canonical_url, page.robots_index, page.robots_follow,
      page.og_title, page.og_description, page.twitter_title,
      page.twitter_description, page.twitter_image_url, page.locale,
      page.updated_at::text AS updated_at
    FROM website_pages page
    WHERE page.id = $1 AND page.status IN ('draft', 'published')
      AND octet_length(page.title) <= 2048
      AND octet_length(coalesce(page.meta_description, '')) <= 65536
    LIMIT 2`,
  ARTICLE: `SELECT article.id, article.title, article.slug, article.excerpt,
      article.content, article.featured_image_url, article.status,
      article.category_id, article.locale, article.meta_title,
      article.meta_description, article.updated_at::text AS updated_at
    FROM website_blog_posts article
    WHERE article.id = $1 AND article.status IN ('draft', 'published')
      AND octet_length(article.title) <= 2048
      AND octet_length(coalesce(article.excerpt, '')) <= 65536
      AND octet_length(article.content::text) <= 1048576
      AND octet_length(coalesce(article.meta_description, '')) <= 65536
    LIMIT 2`,
};

export type PostgresPublicWebDraftSourceResolverOptions = {
  pool: Pool;
  expectedRole?: typeof EXACT_EXECUTOR_ROLE;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function rollback(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error("public_web_draft_source_rollback_failed");
  }
}

function sourceDigest(entityType: PublicWebEntityType, entityId: number, row: QueryResultRow) {
  const canonical = canonicalJson({ entityId, entityType, source: row });
  if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_SOURCE_BYTES) {
    throw new Error("public_web_draft_source_oversized");
  }
  return crypto
    .createHash("sha256")
    .update("fas.public-web.source.v1\0", "utf8")
    .update(canonical, "utf8")
    .digest("hex");
}

export class PostgresPublicWebDraftSourceResolver {
  private readonly pool: Pool;
  private readonly expectedRole: string;

  constructor(options: PostgresPublicWebDraftSourceResolverOptions) {
    if (
      !options?.pool ||
      (options.expectedRole !== undefined && options.expectedRole !== EXACT_EXECUTOR_ROLE)
    ) {
      throw new Error("public_web_draft_source_configuration_invalid");
    }
    this.pool = options.pool;
    this.expectedRole = options.expectedRole ?? EXACT_EXECUTOR_ROLE;
  }

  async resolve(
    entityType: PublicWebEntityType,
    entityId: number,
  ): Promise<PublicWebDraftSourceBinding | null> {
    if (
      !Object.hasOwn(SOURCE_QUERIES, entityType) ||
      !Number.isSafeInteger(entityId) ||
      entityId < 1 ||
      entityId > MAX_ENTITY_ID
    ) {
      throw new Error("public_web_draft_source_input_invalid");
    }
    const client = await this.pool.connect();
    let transactionStarted = false;
    let releaseError: Error | undefined;
    try {
      const identity = await client.query<{
        current_user: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolinherit: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
        has_role_membership: boolean;
        tenant_setting: string | null;
        organization_setting: string | null;
      }>(`SELECT current_user, role.rolsuper, role.rolcreatedb,
          role.rolcreaterole, role.rolinherit, role.rolreplication,
          role.rolbypassrls, role.rolcanlogin,
          EXISTS (
            SELECT 1 FROM pg_auth_members membership
            WHERE membership.member = role.oid
          ) AS has_role_membership,
          nullif(current_setting('app.tenant_id', true), '') AS tenant_setting,
          nullif(current_setting('app.organization_id', true), '') AS organization_setting
        FROM pg_roles role WHERE role.rolname = current_user`);
      if (
        identity.rowCount !== 1 ||
        identity.rows[0]?.current_user !== this.expectedRole ||
        identity.rows[0]?.rolsuper !== false ||
        identity.rows[0]?.rolcreatedb !== false ||
        identity.rows[0]?.rolcreaterole !== false ||
        identity.rows[0]?.rolinherit !== false ||
        identity.rows[0]?.rolreplication !== false ||
        identity.rows[0]?.rolbypassrls !== false ||
        identity.rows[0]?.rolcanlogin !== true ||
        identity.rows[0]?.has_role_membership !== false ||
        identity.rows[0]?.tenant_setting !== null ||
        identity.rows[0]?.organization_setting !== null
      ) {
        throw new Error("public_web_draft_source_executor_identity_invalid");
      }
      await client.query("BEGIN READ ONLY");
      transactionStarted = true;
      await client.query(
        `SELECT set_config('lock_timeout', '1500ms', true),
                set_config('statement_timeout', '5000ms', true),
                set_config('idle_in_transaction_session_timeout', '8000ms', true)`,
      );
      const result = await client.query<QueryResultRow>(SOURCE_QUERIES[entityType], [
        entityId,
      ]);
      if (result.rowCount === 0) {
        await client.query("COMMIT");
        transactionStarted = false;
        return null;
      }
      if (result.rowCount !== 1 || !isRecord(result.rows[0])) {
        throw new Error("public_web_draft_source_result_invalid");
      }
      const sourceSha256 = sourceDigest(entityType, entityId, result.rows[0]);
      await client.query("COMMIT");
      transactionStarted = false;
      return { entityType, entityId, sourceSha256 };
    } catch (error) {
      if (transactionStarted) {
        releaseError = await rollback(client);
        transactionStarted = false;
      }
      throw error instanceof Error
        ? error
        : new Error("public_web_draft_source_failed");
    } finally {
      client.release(releaseError);
    }
  }
}
