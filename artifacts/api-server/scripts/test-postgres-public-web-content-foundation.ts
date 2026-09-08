import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const { Client } = pg;

const ADMIN_URL =
  process.env.PG_PUBLIC_WEB_ADMIN_URL ??
  "postgresql://postgres@127.0.0.1:5433/fasos_apply_local";
const target = new URL(ADMIN_URL);
if (
  target.protocol !== "postgresql:" ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "5433" ||
  target.pathname !== "/fasos_apply_local" ||
  target.username !== "postgres" ||
  target.password !== "" ||
  target.search !== "" ||
  target.hash !== ""
) {
  throw new Error(
    "Public Web PostgreSQL test requires postgresql://postgres@127.0.0.1:5433/fasos_apply_local",
  );
}

const TENANT_ID = "018f8200-0000-7000-8000-000000000701";
const OTHER_TENANT_ID = "018f8200-0000-7000-8000-000000000702";
const ORGANIZATION_ID = "018f8200-0000-7000-8000-000000000703";
const RECORD_ID = "018f8200-0000-7000-8000-000000000704";
const REVISION_ID = "018f8200-0000-7000-8000-000000000705";
const EVIDENCE_ID = "018f8200-0000-7000-8000-000000000706";
const EVIDENCE_BODY_ID = "018f8200-0000-7000-8000-000000000709";
const RECEIPT_ID = "018f8200-0000-7000-8000-000000000707";
const ROUTE_ID = "018f8200-0000-7000-8000-000000000708";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

async function expectRejectedInSavepoint(
  client: pg.Client,
  name: string,
  query: string,
  pattern: RegExp,
): Promise<void> {
  await client.query(`SAVEPOINT ${name}`);
  await assert.rejects(client.query(query), pattern);
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
}

test("public web foundation enforces RLS, immutable evidence and controlled publication", async () => {
  const client = new Client({
    connectionString: ADMIN_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "fasos-public-web-foundation-test",
  });
  await client.connect();
  try {
    const identity = await client.query(
      "SELECT current_database() AS database_name, current_user AS user_name, inet_server_port() AS server_port",
    );
    assert.deepEqual(identity.rows[0], {
      database_name: "fasos_apply_local",
      user_name: "postgres",
      server_port: 5433,
    });

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tenants (id, slug, legal_name, display_name, status, home_region)
       VALUES ($1, 'public-web-test', 'Public Web Test', 'Public Web Test', 'ACTIVE', 'local')`,
      [TENANT_ID],
    );
    await client.query(
      `INSERT INTO organizations (id, tenant_id, legal_name, display_name, organization_type, status)
       VALUES ($1, $2, 'Public Web Test', 'Public Web Test', 'OPERATING_ENTITY', 'ACTIVE')`,
      [ORGANIZATION_ID, TENANT_ID],
    );
    const users = await client.query(
      `INSERT INTO users (email, first_name, last_name, role)
       VALUES
         ('public-web-author@example.invalid', 'Author', 'Fixture', 'admin'),
         ('public-web-reviewer@example.invalid', 'Reviewer', 'Fixture', 'admin')
       RETURNING id`,
    );
    const authorId = Number(users.rows[0]?.id);
    const reviewerId = Number(users.rows[1]?.id);
    assert.ok(Number.isSafeInteger(authorId));
    assert.ok(Number.isSafeInteger(reviewerId));

    const page = await client.query(
      `INSERT INTO website_pages (title, slug, status, locale, created_by, updated_by)
       VALUES ('Foundation Fixture', 'public-web-foundation-fixture', 'draft', 'en', $1, $1)
       RETURNING id`,
      [authorId],
    );
    const pageId = Number(page.rows[0]?.id);

    await client.query("SET LOCAL ROLE fas_migrator");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_ID]);
    await client.query("SELECT set_config('app.organization_id', $1, true)", [
      ORGANIZATION_ID,
    ]);

    await client.query(
      `INSERT INTO public_web_content_records (
         id, tenant_id, organization_id, entity_type, website_page_id, locale,
         canonical_slug, canonical_path, created_by_legacy_user_id
       ) VALUES ($1, $2, $3, 'PAGE', $4, 'en', 'foundation-fixture',
         '/en/foundation-fixture', $5)`,
      [RECORD_ID, TENANT_ID, ORGANIZATION_ID, pageId, authorId],
    );
    await client.query(
      `INSERT INTO public_web_content_revisions (
         id, tenant_id, organization_id, content_record_id, revision_number,
         origin, title, content_json, seo_json, structured_data_json,
         source_sha256, content_sha256, quality_status, source_coverage,
         translation_status, seo_status, structured_data_status,
         created_by_legacy_user_id
       ) VALUES ($1, $2, $3, $4, 1, 'HUMAN', 'Foundation Fixture',
         '{"blocks":[]}'::jsonb, '{"title":"Foundation Fixture"}'::jsonb,
         '{"@type":"WebPage"}'::jsonb, $5, $6, 'PASS', 'COMPLETE',
         'SOURCE', 'PASS', 'PASS', $7)`,
      [REVISION_ID, TENANT_ID, ORGANIZATION_ID, RECORD_ID, SHA_A, SHA_B, authorId],
    );
    await client.query(
      `INSERT INTO public_web_source_evidence (
         id, tenant_id, organization_id, content_record_id, revision_id,
         source_type, source_visibility, source_url, source_reference_sha256,
         source_content_sha256, fact_keys, status, observed_at,
         verified_by_legacy_user_id, verified_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'EDITORIAL', 'PUBLIC',
         'https://example.invalid/foundation-source', $6, $7,
         ARRAY['title'], 'VERIFIED', now() - interval '1 day', $8,
         now() - interval '1 day', now() + interval '30 days')`,
      [
        EVIDENCE_ID,
        TENANT_ID,
        ORGANIZATION_ID,
        RECORD_ID,
        REVISION_ID,
        SHA_A,
        SHA_B,
        reviewerId,
      ],
    );
    await client.query(
      `INSERT INTO public_web_publication_states (
         tenant_id, organization_id, content_record_id, revision_id
       ) VALUES ($1, $2, $3, $4)`,
      [TENANT_ID, ORGANIZATION_ID, RECORD_ID, REVISION_ID],
    );
    await client.query(
      `UPDATE public_web_publication_states
       SET status = 'PENDING_REVIEW'
       WHERE tenant_id = '${TENANT_ID}' AND content_record_id = '${RECORD_ID}'`,
    );

    await expectRejectedInSavepoint(
      client,
      "critical_fact_coverage",
      `UPDATE public_web_publication_states
       SET status = 'APPROVED', reviewed_by_legacy_user_id = ${reviewerId}, reviewed_at = now()
       WHERE tenant_id = '${TENANT_ID}' AND content_record_id = '${RECORD_ID}'`,
      /lacks current verified critical facts: body/,
    );

    await client.query(
      `INSERT INTO public_web_source_evidence (
         id, tenant_id, organization_id, content_record_id, revision_id,
         source_type, source_visibility, source_url, source_reference_sha256,
         source_content_sha256, fact_keys, status, observed_at,
         verified_by_legacy_user_id, verified_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'EDITORIAL', 'PUBLIC',
         'https://example.invalid/foundation-body-source', $6, $7,
         ARRAY['body'], 'VERIFIED', now() - interval '1 day', $8,
         now() - interval '1 day', now() + interval '30 days')`,
      [
        EVIDENCE_BODY_ID,
        TENANT_ID,
        ORGANIZATION_ID,
        RECORD_ID,
        REVISION_ID,
        SHA_A,
        SHA_B,
        reviewerId,
      ],
    );

    await expectRejectedInSavepoint(
      client,
      "maker_checker",
      `UPDATE public_web_publication_states
       SET status = 'APPROVED', reviewed_by_legacy_user_id = ${authorId}, reviewed_at = now()
       WHERE tenant_id = '${TENANT_ID}' AND content_record_id = '${RECORD_ID}'`,
      /independent reviewer/,
    );

    await client.query(
      `UPDATE public_web_publication_states
       SET status = 'APPROVED', reviewed_by_legacy_user_id = $1, reviewed_at = now()
       WHERE tenant_id = $2 AND content_record_id = $3`,
      [reviewerId, TENANT_ID, RECORD_ID],
    );
    await client.query(
      `UPDATE public_web_publication_states
       SET status = 'PUBLISHED', index_state = 'INDEX',
           published_by_legacy_user_id = $1, published_at = now()
       WHERE tenant_id = $2 AND content_record_id = $3`,
      [reviewerId, TENANT_ID, RECORD_ID],
    );

    const published = await client.query(
      `SELECT status, index_state, version
       FROM public_web_publication_states
       WHERE tenant_id = $1 AND content_record_id = $2`,
      [TENANT_ID, RECORD_ID],
    );
    assert.deepEqual(published.rows[0], {
      status: "PUBLISHED",
      index_state: "INDEX",
      version: "4",
    });

    await client.query(
      `INSERT INTO public_web_publication_receipts (
         id, tenant_id, organization_id, content_record_id, revision_id,
         from_status, to_status, index_state, actor_legacy_user_id,
         request_key, evidence_sha256
       ) VALUES ($1, $2, $3, $4, $5, 'APPROVED', 'PUBLISHED', 'INDEX', $6,
         'public-web-foundation.publish.1', $7)`,
      [
        RECEIPT_ID,
        TENANT_ID,
        ORGANIZATION_ID,
        RECORD_ID,
        REVISION_ID,
        reviewerId,
        SHA_A,
      ],
    );
    // INSERT-only RLS already makes these rows immutable for the runtime role.
    // Exercise the trigger itself as the local disposable superuser as well.
    await client.query("RESET ROLE");
    await expectRejectedInSavepoint(
      client,
      "immutable_receipt",
      `UPDATE public_web_publication_receipts SET to_status = 'RETIRED'
       WHERE tenant_id = '${TENANT_ID}' AND id = '${RECEIPT_ID}'`,
      /append-only/,
    );
    await expectRejectedInSavepoint(
      client,
      "immutable_revision",
      `UPDATE public_web_content_revisions SET title = 'Changed'
       WHERE id = '${REVISION_ID}'`,
      /append-only/,
    );
    await client.query("SET LOCAL ROLE fas_migrator");

    await client.query(
      `INSERT INTO public_web_route_aliases (
         id, tenant_id, organization_id, content_record_id, path, route_kind,
         http_status, created_by_legacy_user_id
       ) VALUES ($1, $2, $3, $4, '/en/foundation-fixture', 'CANONICAL', 200, $5)`,
      [ROUTE_ID, TENANT_ID, ORGANIZATION_ID, RECORD_ID, authorId],
    );
    await client.query(
      `UPDATE public_web_route_aliases SET valid_to = now()
       WHERE tenant_id = $1 AND id = $2`,
      [TENANT_ID, ROUTE_ID],
    );
    await expectRejectedInSavepoint(
      client,
      "route_close_once",
      `UPDATE public_web_route_aliases SET valid_to = now() + interval '1 day'
       WHERE tenant_id = '${TENANT_ID}' AND id = '${ROUTE_ID}'`,
      /immutable except for one-way closure/,
    );

    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      OTHER_TENANT_ID,
    ]);
    const isolated = await client.query(
      "SELECT count(*)::int AS count FROM public_web_content_records",
    );
    assert.equal(isolated.rows[0]?.count, 0);

    await client.query("RESET ROLE");
    const rls = await client.query(
      `SELECT count(*)::int AS count
       FROM pg_class
       WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity`,
      [[
        "public_web_content_records",
        "public_web_content_revisions",
        "public_web_source_evidence",
        "public_web_publication_states",
        "public_web_publication_receipts",
        "public_web_route_aliases",
      ]],
    );
    assert.equal(rls.rows[0]?.count, 6);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
});
