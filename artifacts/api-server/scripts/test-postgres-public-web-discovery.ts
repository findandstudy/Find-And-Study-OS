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
const RECORDS = {
  en: "018f8500-0000-7000-8000-000000000011",
  tr: "018f8500-0000-7000-8000-000000000012",
  fr: "018f8500-0000-7000-8000-000000000013",
  it: "018f8500-0000-7000-8000-000000000014",
} as const;
const REVISIONS = {
  en: "018f8500-0000-7000-8000-000000000021",
  tr: "018f8500-0000-7000-8000-000000000022",
  fr: "018f8500-0000-7000-8000-000000000023",
  it: "018f8500-0000-7000-8000-000000000024",
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
