import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const { Client } = pg;
const ADMIN_URL = process.env.PG_PUBLIC_WEB_ADMIN_URL
  ?? "postgresql://postgres@127.0.0.1:5433/fasos_apply_local";
const MIGRATOR_URL = process.env.PG_PUBLIC_WEB_DISCOVERY_URL
  ?? "postgresql://fas_migrator@127.0.0.1:5433/fasos_apply_local";

function assertDisposableUrl(raw: string, user: string): void {
  const target = new URL(raw);
  if (
    target.protocol !== "postgresql:"
    || target.hostname !== "127.0.0.1"
    || target.port !== "5433"
    || target.pathname !== "/fasos_apply_local"
    || target.username !== user
    || target.password !== ""
    || target.search !== ""
    || target.hash !== ""
  ) {
    throw new Error(`Public discovery test requires disposable loopback PostgreSQL as ${user}`);
  }
}

assertDisposableUrl(ADMIN_URL, "postgres");
assertDisposableUrl(MIGRATOR_URL, "fas_migrator");
process.env.DATABASE_URL = MIGRATOR_URL;

const TENANT_ID = "018f8500-0000-7000-8000-000000000001";
const ORGANIZATION_ID = "018f8500-0000-7000-8000-000000000002";
const OTHER_TENANT_ID = "018f8500-0000-7000-8000-000000000003";
process.env.PUBLIC_WEB_SITEMAP_MODE = "published";
process.env.PUBLIC_SITE_URL = "https://findandstudy.com";
process.env.PUBLIC_WEB_TENANT_ID = TENANT_ID;
process.env.PUBLIC_WEB_ORGANIZATION_ID = ORGANIZATION_ID;
const RECORDS = {
  en: "018f8500-0000-7000-8000-000000000011",
  tr: "018f8500-0000-7000-8000-000000000012",
  fr: "018f8500-0000-7000-8000-000000000013",
  it: "018f8500-0000-7000-8000-000000000014",
  destinationEn: "018f8500-0000-7000-8000-000000000015",
  articleEn: "018f8500-0000-7000-8000-000000000016",
  articleTr: "018f8500-0000-7000-8000-000000000017",
  pageEn: "018f8500-0000-7000-8000-000000000018",
  pageTr: "018f8500-0000-7000-8000-000000000019",
  universityEn: "018f8500-0000-7000-8000-000000000030",
} as const;
const REVISIONS = {
  en: "018f8500-0000-7000-8000-000000000021",
  tr: "018f8500-0000-7000-8000-000000000022",
  fr: "018f8500-0000-7000-8000-000000000023",
  it: "018f8500-0000-7000-8000-000000000024",
  destinationEn: "018f8500-0000-7000-8000-000000000025",
  articleEn: "018f8500-0000-7000-8000-000000000026",
  articleTr: "018f8500-0000-7000-8000-000000000027",
  pageEn: "018f8500-0000-7000-8000-000000000028",
  pageTr: "018f8500-0000-7000-8000-000000000029",
  universityEn: "018f8500-0000-7000-8000-000000000040",
} as const;

test("published discovery is tenant-scoped and excludes NOINDEX or undeliverable locales", async () => {
  const admin = new Client({
    connectionString: ADMIN_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "fasos-public-discovery-fixture",
  });
  await admin.connect();
  let userId = 0;
  let universityId = 0;
  let programId = 0;
  let destinationId = 0;
  let articleId = 0;
  let pageId = 0;
  try {
    await admin.query("BEGIN");
    await admin.query("SET LOCAL session_replication_role = replica");
    await admin.query(
      `INSERT INTO tenants (id,slug,legal_name,display_name,status,home_region)
       VALUES ($1,'public-discovery-fixture','Discovery Fixture','Discovery Fixture','ACTIVE','local')`,
      [TENANT_ID],
    );
    await admin.query(
      `INSERT INTO organizations (id,tenant_id,legal_name,display_name,organization_type,status)
       VALUES ($1,$2,'Discovery Fixture','Discovery Fixture','OPERATING_ENTITY','ACTIVE')`,
      [ORGANIZATION_ID, TENANT_ID],
    );
    const user = await admin.query<{ id: number }>(
      `INSERT INTO users (email,first_name,last_name,role)
       VALUES ('public-discovery-fixture@example.invalid','Discovery','Fixture','admin') RETURNING id`,
    );
    userId = Number(user.rows[0]?.id);
    const university = await admin.query<{ id: number }>(
      `INSERT INTO universities (name,country,city,university_type,is_active)
       VALUES ('Discovery Fixture University','Testland','Test City','Private',true) RETURNING id`,
    );
    universityId = Number(university.rows[0]?.id);
    const program = await admin.query<{ id: number }>(
      `INSERT INTO programs (university_id,name,description,degree,field,language,duration,is_active)
       VALUES ($1,'Discovery Fixture Program','Verified programme','MSc','Computing','English','1 year',true)
       RETURNING id`,
      [universityId],
    );
    programId = Number(program.rows[0]?.id);
    const destination = await admin.query<{ id: number }>(
      `INSERT INTO destinations (name,slug,country,short_description,is_active)
       VALUES ('Discovery Fixture Destination','discovery-fixture-destination','Testland','Verified destination',true)
       RETURNING id`,
    );
    destinationId = Number(destination.rows[0]?.id);
    const article = await admin.query<{ id: number }>(
      `INSERT INTO website_blog_posts
         (title,slug,excerpt,content,status,locale,translations_json,published_at)
       VALUES ('Discovery Guide','discovery-guide','Verified guide',
         '{"body":"Verified English body"}'::jsonb,'published','en',
         '{"tr":{"title":"Doğrulanmış Rehber","body":"Doğrulanmış Türkçe içerik"}}'::jsonb,
         now()) RETURNING id`,
    );
    articleId = Number(article.rows[0]?.id);
    const page = await admin.query<{ id: number }>(
      `INSERT INTO website_pages
         (title,slug,status,locale,published_at,translations_json)
       VALUES ('Discovery Public Page','discovery-public-page','published','en',now(),
         '{"tr":{"fields":{"title":"Keşif Sayfası"},"blocks":[{"blockType":"rich_text","content":{"content":"Türkçe içerik"},"settings":{},"sortOrder":0,"isVisible":true}]}}'::jsonb)
       RETURNING id`,
    );
    pageId = Number(page.rows[0]?.id);
    await admin.query(
      `INSERT INTO website_page_versions
         (page_id,version_number,blocks_snapshot,meta_snapshot,published_at)
       VALUES ($1,1,
         '[{"blockType":"rich_text","content":{"content":"English content"},"settings":{},"sortOrder":0,"isVisible":true}]'::jsonb,
         '{"title":"Discovery Public Page","translationsJson":{"tr":{"fields":{"title":"Keşif Sayfası"},"blocks":[{"blockType":"rich_text","content":{"content":"Türkçe içerik"},"settings":{},"sortOrder":0,"isVisible":true}]}}}'::jsonb,
         now())`,
      [pageId],
    );
    for (const locale of ["tr", "it"] as const) {
      await admin.query(
        `INSERT INTO program_translations
           (program_id,locale,name,description,source_hash,status,is_manual,attempts,next_attempt_at)
         VALUES ($1,$2,$3,$4,$5,'published',true,0,now())`,
        [programId, locale, `Discovery ${locale}`, `Verified ${locale}`, "c".repeat(64)],
      );
    }
    for (const locale of ["en", "tr", "fr", "it"] as const) {
      await admin.query(
        `INSERT INTO public_web_content_records
           (id,tenant_id,organization_id,entity_type,program_id,locale,
            canonical_slug,canonical_path,created_by_legacy_user_id)
         VALUES ($1,$2,$3,'PROGRAM',$4,$5,'discovery-fixture',$6,$7)`,
        [RECORDS[locale], TENANT_ID, ORGANIZATION_ID, programId, locale, `/${locale}/programs/discovery-fixture-${programId}`, userId],
      );
      await admin.query(
        `INSERT INTO public_web_content_revisions
           (id,tenant_id,organization_id,content_record_id,revision_number,origin,title,
            content_json,seo_json,structured_data_json,source_sha256,content_sha256,
            quality_status,source_coverage,translation_status,seo_status,
            structured_data_status,created_by_legacy_user_id)
         VALUES ($1,$2,$3,$4,1,'HUMAN','Discovery Fixture','{}','{}','{}',$5,$6,
           'PASS','COMPLETE',$7,'PASS','PASS',$8)`,
        [
          REVISIONS[locale], TENANT_ID, ORGANIZATION_ID, RECORDS[locale],
          "a".repeat(64), "b".repeat(64), locale === "en" ? "SOURCE" : "PUBLISHED", userId,
        ],
      );
      await admin.query(
        `INSERT INTO public_web_publication_states
           (tenant_id,organization_id,content_record_id,revision_id,status,index_state,
            reviewed_by_legacy_user_id,reviewed_at,published_by_legacy_user_id,published_at)
         VALUES ($1,$2,$3,$4,'PUBLISHED',$5,$6,now(),$6,now())`,
        [TENANT_ID, ORGANIZATION_ID, RECORDS[locale], REVISIONS[locale], locale === "it" ? "NOINDEX" : "INDEX", userId],
      );
    }
    await admin.query(
      `INSERT INTO public_web_content_records
         (id,tenant_id,organization_id,entity_type,destination_id,locale,
          canonical_slug,canonical_path,created_by_legacy_user_id)
       VALUES ($1,$2,$3,'DESTINATION',$4,'en','discovery-fixture-destination',
         '/en/destinations/discovery-fixture-destination',$5)`,
      [RECORDS.destinationEn, TENANT_ID, ORGANIZATION_ID, destinationId, userId],
    );
    await admin.query(
      `INSERT INTO public_web_content_revisions
         (id,tenant_id,organization_id,content_record_id,revision_number,origin,title,
          content_json,seo_json,structured_data_json,source_sha256,content_sha256,
          quality_status,source_coverage,translation_status,seo_status,
          structured_data_status,created_by_legacy_user_id)
       VALUES ($1,$2,$3,$4,1,'HUMAN','Discovery Destination','{}','{}','{}',$5,$6,
         'PASS','COMPLETE','SOURCE','PASS','PASS',$7)`,
      [REVISIONS.destinationEn, TENANT_ID, ORGANIZATION_ID, RECORDS.destinationEn, "d".repeat(64), "e".repeat(64), userId],
    );
    await admin.query(
      `INSERT INTO public_web_publication_states
         (tenant_id,organization_id,content_record_id,revision_id,status,index_state,
          reviewed_by_legacy_user_id,reviewed_at,published_by_legacy_user_id,published_at)
       VALUES ($1,$2,$3,$4,'PUBLISHED','INDEX',$5,now(),$5,now())`,
      [TENANT_ID, ORGANIZATION_ID, RECORDS.destinationEn, REVISIONS.destinationEn, userId],
    );
    await admin.query(
      `INSERT INTO public_web_content_records
         (id,tenant_id,organization_id,entity_type,university_id,locale,
          canonical_slug,canonical_path,created_by_legacy_user_id)
       VALUES ($1,$2,$3,'UNIVERSITY',$4,'en','discovery-fixture-university',$5,$6)`,
      [
        RECORDS.universityEn, TENANT_ID, ORGANIZATION_ID, universityId,
        `/en/universities/discovery-fixture-university-${universityId}`, userId,
      ],
    );
    await admin.query(
      `INSERT INTO public_web_content_revisions
         (id,tenant_id,organization_id,content_record_id,revision_number,origin,title,
          content_json,seo_json,structured_data_json,source_sha256,content_sha256,
          quality_status,source_coverage,translation_status,seo_status,
          structured_data_status,created_by_legacy_user_id)
       VALUES ($1,$2,$3,$4,1,'HUMAN','Discovery University','{}','{}','{}',$5,$6,
         'PASS','COMPLETE','SOURCE','PASS','PASS',$7)`,
      [REVISIONS.universityEn, TENANT_ID, ORGANIZATION_ID, RECORDS.universityEn, "6".repeat(64), "5".repeat(64), userId],
    );
    await admin.query(
      `INSERT INTO public_web_publication_states
         (tenant_id,organization_id,content_record_id,revision_id,status,index_state,
          reviewed_by_legacy_user_id,reviewed_at,published_by_legacy_user_id,published_at)
       VALUES ($1,$2,$3,$4,'PUBLISHED','INDEX',$5,now(),$5,now())`,
      [TENANT_ID, ORGANIZATION_ID, RECORDS.universityEn, REVISIONS.universityEn, userId],
    );
    for (const locale of ["en", "tr"] as const) {
      await admin.query(
        `INSERT INTO public_web_content_records
           (id,tenant_id,organization_id,entity_type,blog_post_id,locale,
            canonical_slug,canonical_path,created_by_legacy_user_id)
         VALUES ($1,$2,$3,'ARTICLE',$4,$5,$6,$7,$8)`,
        [
          RECORDS[locale === "en" ? "articleEn" : "articleTr"],
          TENANT_ID,
          ORGANIZATION_ID,
          articleId,
          locale,
          locale === "en" ? "discovery-guide" : "dogrulanmis-rehber",
          `/${locale}/guides/${locale === "en" ? "discovery-guide" : "dogrulanmis-rehber"}-${articleId}`,
          userId,
        ],
      );
      await admin.query(
        `INSERT INTO public_web_content_revisions
           (id,tenant_id,organization_id,content_record_id,revision_number,origin,title,
            content_json,seo_json,structured_data_json,source_sha256,content_sha256,
            quality_status,source_coverage,translation_status,seo_status,
            structured_data_status,created_by_legacy_user_id)
         VALUES ($1,$2,$3,$4,1,'HUMAN','Discovery Guide','{}','{}','{}',$5,$6,
           'PASS','COMPLETE',$7,'PASS','PASS',$8)`,
        [
          REVISIONS[locale === "en" ? "articleEn" : "articleTr"],
          TENANT_ID,
          ORGANIZATION_ID,
          RECORDS[locale === "en" ? "articleEn" : "articleTr"],
          "f".repeat(64),
          "9".repeat(64),
          locale === "en" ? "SOURCE" : "PUBLISHED",
          userId,
        ],
      );
      await admin.query(
        `INSERT INTO public_web_publication_states
           (tenant_id,organization_id,content_record_id,revision_id,status,index_state,
            reviewed_by_legacy_user_id,reviewed_at,published_by_legacy_user_id,published_at)
         VALUES ($1,$2,$3,$4,'PUBLISHED','INDEX',$5,now(),$5,now())`,
        [
          TENANT_ID,
          ORGANIZATION_ID,
          RECORDS[locale === "en" ? "articleEn" : "articleTr"],
          REVISIONS[locale === "en" ? "articleEn" : "articleTr"],
          userId,
        ],
      );
    }
    for (const locale of ["en", "tr"] as const) {
      const recordKey = locale === "en" ? "pageEn" : "pageTr";
      await admin.query(
        `INSERT INTO public_web_content_records
           (id,tenant_id,organization_id,entity_type,website_page_id,locale,
            canonical_slug,canonical_path,created_by_legacy_user_id)
         VALUES ($1,$2,$3,'PAGE',$4,$5,$6,$7,$8)`,
        [
          RECORDS[recordKey], TENANT_ID, ORGANIZATION_ID, pageId, locale,
          "discovery-public-page", `/${locale}/discovery-public-page`, userId,
        ],
      );
      await admin.query(
        `INSERT INTO public_web_content_revisions
           (id,tenant_id,organization_id,content_record_id,revision_number,origin,title,
            content_json,seo_json,structured_data_json,source_sha256,content_sha256,
            quality_status,source_coverage,translation_status,seo_status,
            structured_data_status,created_by_legacy_user_id)
         VALUES ($1,$2,$3,$4,1,'HUMAN','Discovery Page','{}','{}','{}',$5,$6,
           'PASS','COMPLETE',$7,'PASS','PASS',$8)`,
        [
          REVISIONS[recordKey], TENANT_ID, ORGANIZATION_ID, RECORDS[recordKey],
          "8".repeat(64), "7".repeat(64), locale === "en" ? "SOURCE" : "PUBLISHED", userId,
        ],
      );
      await admin.query(
        `INSERT INTO public_web_publication_states
           (tenant_id,organization_id,content_record_id,revision_id,status,index_state,
            reviewed_by_legacy_user_id,reviewed_at,published_by_legacy_user_id,published_at)
         VALUES ($1,$2,$3,$4,'PUBLISHED','INDEX',$5,now(),$5,now())`,
        [TENANT_ID, ORGANIZATION_ID, RECORDS[recordKey], REVISIONS[recordKey], userId],
      );
    }
    await admin.query("COMMIT");

    const discovery = await import("../src/lib/publicWebDiscoveryReadModel");
    const counts = await discovery.readPublishedSitemapCounts({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    });
    assert.deepEqual(
      counts.filter((row) => row.entityType === "PROGRAM"),
      [
        { entityType: "PROGRAM", locale: "en", count: 1 },
        { entityType: "PROGRAM", locale: "tr", count: 1 },
      ],
    );
    assert.deepEqual(
      counts.filter((row) => row.entityType === "DESTINATION"),
      [{ entityType: "DESTINATION", locale: "en", count: 1 }],
    );
    assert.deepEqual(
      counts.filter((row) => row.entityType === "UNIVERSITY"),
      [{ entityType: "UNIVERSITY", locale: "en", count: 1 }],
    );
    assert.deepEqual(
      counts.filter((row) => row.entityType === "ARTICLE"),
      [
        { entityType: "ARTICLE", locale: "en", count: 1 },
        { entityType: "ARTICLE", locale: "tr", count: 1 },
      ],
    );
    assert.deepEqual(
      counts.filter((row) => row.entityType === "PAGE"),
      [
        { entityType: "PAGE", locale: "en", count: 1 },
        { entityType: "PAGE", locale: "tr", count: 1 },
      ],
    );
    assert.deepEqual(
      [...await discovery.readIndexableProgramIds({
        locale: "en",
        programIds: [programId, programId, 0, 2_147_483_648],
      })],
      [programId],
    );
    assert.deepEqual(
      [...await discovery.readIndexableUniversityIds({
        locale: "en",
        universityIds: [universityId, universityId, 0],
      })],
      [universityId],
    );
    assert.deepEqual(
      [...await discovery.readIndexableUniversityIds({
        locale: "tr",
        universityIds: [universityId],
      })],
      [],
    );
    assert.deepEqual(
      await discovery.readPublishedEntitySeoState({
        scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
        entityType: "destination",
        entityId: destinationId,
        locale: "en",
      }),
      {
        indexable: true,
        canonicalPath: "/en/destinations/discovery-fixture-destination",
        alternates: { en: "/en/destinations/discovery-fixture-destination" },
      },
    );
    assert.deepEqual(
      await discovery.readPublishedEntitySeoState({
        scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
        entityType: "page",
        entityId: pageId,
        locale: "tr",
      }),
      {
        indexable: true,
        canonicalPath: "/tr/discovery-public-page",
        alternates: {
          en: "/en/discovery-public-page",
          tr: "/tr/discovery-public-page",
        },
      },
    );
    assert.deepEqual(
      await discovery.readPublishedEntitySeoState({
        scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
        entityType: "article",
        entityId: articleId,
        locale: "tr",
      }),
      {
        indexable: true,
        canonicalPath: `/tr/guides/dogrulanmis-rehber-${articleId}`,
        alternates: {
          en: `/en/guides/discovery-guide-${articleId}`,
          tr: `/tr/guides/dogrulanmis-rehber-${articleId}`,
        },
      },
    );
    const rows = await discovery.readPublishedSitemapPage({
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      entityType: "PROGRAM",
      locale: "en",
      shard: 1,
    });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.alternates, {
      en: `/en/programs/discovery-fixture-${programId}`,
      tr: `/tr/programs/discovery-fixture-${programId}`,
    });
    assert.deepEqual(
      await discovery.readPublishedEntitySeoState({
        scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
        entityType: "program",
        entityId: programId,
        locale: "fr",
      }),
      {
        indexable: false,
        canonicalPath: null,
        alternates: {
          en: `/en/programs/discovery-fixture-${programId}`,
          tr: `/tr/programs/discovery-fixture-${programId}`,
        },
      },
    );
    await admin.query("UPDATE website_blog_posts SET status='draft',published_at=NULL WHERE id=$1", [articleId]);
    await admin.query("UPDATE website_pages SET status='draft',published_at=NULL WHERE id=$1", [pageId]);
    const afterLegacyUnpublish = await discovery.readPublishedSitemapCounts({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    });
    assert.deepEqual(afterLegacyUnpublish.filter((row) => row.entityType === "ARTICLE"), []);
    assert.deepEqual(afterLegacyUnpublish.filter((row) => row.entityType === "PAGE"), []);
    assert.deepEqual(
      await discovery.readPublishedSitemapCounts({ tenantId: OTHER_TENANT_ID, organizationId: ORGANIZATION_ID }),
      [],
    );
  } finally {
    await admin.query("ROLLBACK").catch(() => undefined);
    await admin.query("BEGIN");
    await admin.query("SET LOCAL session_replication_role = replica");
    await admin.query("DELETE FROM public_web_publication_states WHERE tenant_id=$1", [TENANT_ID]);
    await admin.query("DELETE FROM public_web_content_revisions WHERE tenant_id=$1", [TENANT_ID]);
    await admin.query("DELETE FROM public_web_content_records WHERE tenant_id=$1", [TENANT_ID]);
    if (programId) await admin.query("DELETE FROM programs WHERE id=$1", [programId]);
    if (destinationId) await admin.query("DELETE FROM destinations WHERE id=$1", [destinationId]);
    if (articleId) await admin.query("DELETE FROM website_blog_posts WHERE id=$1", [articleId]);
    if (pageId) await admin.query("DELETE FROM website_pages WHERE id=$1", [pageId]);
    if (universityId) await admin.query("DELETE FROM universities WHERE id=$1", [universityId]);
    if (userId) await admin.query("DELETE FROM users WHERE id=$1", [userId]);
    await admin.query("DELETE FROM organizations WHERE id=$1 AND tenant_id=$2", [ORGANIZATION_ID, TENANT_ID]);
    await admin.query("DELETE FROM tenants WHERE id=$1", [TENANT_ID]);
    await admin.query("COMMIT");
    await admin.end();
    const { pool } = await import("@workspace/db");
    await pool.end().catch(() => undefined);
  }
});
