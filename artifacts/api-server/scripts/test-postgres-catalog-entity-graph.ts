import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const { Client } = pg;
const ADMIN_URL =
  process.env.PG_CATALOG_GRAPH_ADMIN_URL ??
  "postgresql://postgres@127.0.0.1:5433/fasos_apply_local";
const target = new URL(ADMIN_URL);
const expectedServerPort = Number(process.env.PG_PUBLIC_WEB_SERVER_PORT ?? "5433");
if (!Number.isSafeInteger(expectedServerPort) || expectedServerPort < 1 || expectedServerPort > 65_535) {
  throw new Error("Catalog graph test requires a valid expected server port");
}
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
    "Catalog graph PostgreSQL test requires postgresql://postgres@127.0.0.1:5433/fasos_apply_local",
  );
}

const ids = {
  tenant: "018f8200-0000-7000-8000-000000000801",
  otherTenant: "018f8200-0000-7000-8000-000000000802",
  organization: "018f8200-0000-7000-8000-000000000803",
  source: "018f8200-0000-7000-8000-000000000804",
  campusSource: "018f8200-0000-7000-8000-000000000805",
  intakeSource: "018f8200-0000-7000-8000-000000000806",
  priceSource: "018f8200-0000-7000-8000-000000000807",
  wrongPriceSource: "018f8200-0000-7000-8000-000000000808",
  futurePriceSource: "018f8200-0000-7000-8000-000000000810",
  campus: "018f8200-0000-7000-8000-000000000809",
  otherCampus: "018f8200-0000-7000-8000-00000000080a",
  intake: "018f8200-0000-7000-8000-00000000080b",
  price: "018f8200-0000-7000-8000-00000000080c",
  listing: "018f8200-0000-7000-8000-00000000080d",
} as const;
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

async function expectRejectedInSavepoint(
  client: pg.Client,
  name: string,
  query: string,
  values: unknown[],
  pattern: RegExp,
): Promise<void> {
  await client.query(`SAVEPOINT ${name}`);
  await assert.rejects(client.query(query, values), pattern);
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
}

test("catalog graph keeps provenance, intake scope, precise money and tenant listing boundaries", async () => {
  const client = new Client({
    connectionString: ADMIN_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "fasos-catalog-entity-graph-test",
  });
  await client.connect();
  try {
    const identity = await client.query(
      "SELECT current_database() AS database_name, current_user AS user_name, inet_server_port() AS server_port",
    );
    assert.deepEqual(identity.rows[0], {
      database_name: "fasos_apply_local",
      user_name: "postgres",
      server_port: expectedServerPort,
    });

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tenants (id, slug, legal_name, display_name, status, home_region)
       VALUES ($1, 'catalog-graph-test', 'Catalog Graph Test', 'Catalog Graph Test', 'ACTIVE', 'local')`,
      [ids.tenant],
    );
    await client.query(
      `INSERT INTO organizations (id, tenant_id, legal_name, display_name, organization_type, status)
       VALUES ($1, $2, 'Catalog Graph Test', 'Catalog Graph Test', 'OPERATING_ENTITY', 'ACTIVE')`,
      [ids.organization, ids.tenant],
    );
    const users = await client.query(
      `INSERT INTO users (email, first_name, last_name, role)
       VALUES
         ('catalog-graph-author@example.invalid', 'Author', 'Fixture', 'admin'),
         ('catalog-graph-reviewer@example.invalid', 'Reviewer', 'Fixture', 'admin')
       RETURNING id`,
    );
    const authorId = Number(users.rows[0]?.id);
    const reviewerId = Number(users.rows[1]?.id);

    const universities = await client.query(
      `INSERT INTO universities (name, country)
       VALUES ('Graph University A', 'Turkey'), ('Graph University B', 'Turkey')
       RETURNING id`,
    );
    const universityA = Number(universities.rows[0]?.id);
    const universityB = Number(universities.rows[1]?.id);
    const program = await client.query(
      `INSERT INTO programs (university_id, name, degree, currency)
       VALUES ($1, 'Computer Engineering', 'Bachelor', 'USD') RETURNING id`,
      [universityA],
    );
    const programId = Number(program.rows[0]?.id);

    await client.query(
      `INSERT INTO catalog_sources (
         id, source_key, display_name, source_type, base_url,
         authority_rank, created_by_legacy_user_id
       ) VALUES ($1, 'catalog.graph.fixture', 'Catalog Graph Fixture',
         'MANUAL_REVIEW', 'https://example.invalid/catalog', 90, $2)`,
      [ids.source, authorId],
    );
    for (const [recordId, entityType, externalId] of [
      [ids.campusSource, "CAMPUS", "campus-a"],
      [ids.intakeSource, "INTAKE", "intake-a"],
      [ids.priceSource, "PRICE", "price-a"],
      [ids.wrongPriceSource, "INTAKE", "wrong-price-source"],
    ] as const) {
      await client.query(
        `INSERT INTO catalog_source_records (
           id, source_id, entity_type, external_id, source_url,
           raw_object_sha256, status, fetched_at, effective_at, expires_at,
           verified_by_legacy_user_id, verified_at, verification_evidence_sha256
         ) VALUES ($1, $2, $3, $4, 'https://example.invalid/catalog/source',
           $5, 'VERIFIED', now() - interval '2 days', now() - interval '3 days',
           now() + interval '30 days', $6, now() - interval '1 day', $7)`,
        [recordId, ids.source, entityType, externalId, SHA_A, reviewerId, SHA_B],
      );
    }
    await client.query(
      `INSERT INTO catalog_source_records (
         id, source_id, entity_type, external_id, source_url,
         raw_object_sha256, status, fetched_at, effective_at, expires_at,
         verified_by_legacy_user_id, verified_at, verification_evidence_sha256
       ) VALUES ($1, $2, 'PRICE', 'future-price',
         'https://example.invalid/catalog/future-price', $3, 'VERIFIED', now(),
         now() + interval '2 days', now() + interval '32 days', $4, now(), $5)`,
      [ids.futurePriceSource, ids.source, SHA_A, reviewerId, SHA_B],
    );

    await client.query(
      `INSERT INTO institution_campuses (
         id, university_id, campus_key, name, country_code, delivery_modes,
         source_timezone, source_record_id, created_by_legacy_user_id,
         updated_by_legacy_user_id
       ) VALUES ($1, $2, 'main-campus', 'Main Campus', 'TR',
         ARRAY['ON_CAMPUS'], 'Europe/Istanbul', $3, $4, $4)`,
      [ids.campus, universityA, ids.campusSource, authorId],
    );
    await client.query(
      `INSERT INTO institution_campuses (
         id, university_id, campus_key, name, country_code, delivery_modes,
         source_timezone, source_record_id, created_by_legacy_user_id,
         updated_by_legacy_user_id
       ) VALUES ($1, $2, 'other-campus', 'Other Campus', 'TR',
         ARRAY['ON_CAMPUS'], 'Europe/Istanbul', $3, $4, $4)`,
      [ids.otherCampus, universityB, ids.campusSource, authorId],
    );

    await expectRejectedInSavepoint(
      client,
      "campus_scope",
      `INSERT INTO program_intakes (
         id, program_id, campus_id, intake_key, academic_year, starts_on,
         application_deadline_at, source_timezone, capacity_status,
         delivery_mode, source_record_id, created_by_legacy_user_id,
         updated_by_legacy_user_id
       ) VALUES ('018f8200-0000-7000-8000-00000000080e', $1, $2,
         'sep-2027', 2027, '2027-09-01', '2027-06-30T20:59:59Z',
         'Europe/Istanbul', 'OPEN', 'ON_CAMPUS', $3, $4, $4)`,
      [programId, ids.otherCampus, ids.intakeSource, authorId],
      /awarding university/,
    );

    await client.query(
      `INSERT INTO program_intakes (
         id, program_id, campus_id, intake_key, academic_year, starts_on,
         application_deadline_at, source_timezone, capacity_status,
         delivery_mode, source_record_id, created_by_legacy_user_id,
         updated_by_legacy_user_id
       ) VALUES ($1, $2, $3, 'sep-2027', 2027, '2027-09-01',
         '2027-06-30T20:59:59Z', 'Europe/Istanbul', 'OPEN', 'ON_CAMPUS',
         $4, $5, $5)`,
      [ids.intake, programId, ids.campus, ids.intakeSource, authorId],
    );

    await expectRejectedInSavepoint(
      client,
      "wrong_price_source",
      `INSERT INTO price_components (
         id, program_id, intake_id, component_code, component_type,
         amount_minor, currency_code, frequency, effective_from,
         source_record_id, source_verified_at, created_by_legacy_user_id,
         updated_by_legacy_user_id
       ) VALUES ('018f8200-0000-7000-8000-00000000080f', $1, $2,
         'TUITION', 'TUITION', 1250000, 'USD', 'PER_YEAR', now(), $3,
         now(), $4, $4)`,
      [programId, ids.intake, ids.wrongPriceSource, authorId],
      /matching type/,
    );

    await client.query(
      `INSERT INTO price_components (
         id, program_id, intake_id, component_code, component_type,
         amount_minor, currency_code, frequency, effective_from,
         source_record_id, source_verified_at, created_by_legacy_user_id,
         updated_by_legacy_user_id
       ) VALUES ($1, $2, $3, 'TUITION', 'TUITION', 1250000, 'USD',
         'PER_YEAR', now(), $4, now(), $5, $5)`,
      [ids.price, programId, ids.intake, ids.priceSource, authorId],
    );
    const price = await client.query(
      `SELECT amount_minor::text, currency_code, source_verified_at IS NOT NULL AS verified
       FROM price_components WHERE id = $1`,
      [ids.price],
    );
    assert.deepEqual(price.rows[0], {
      amount_minor: "1250000",
      currency_code: "USD",
      verified: true,
    });
    await client.query(
      `UPDATE price_components
       SET source_verified_at = '2000-01-01T00:00:00Z'
       WHERE id = $1`,
      [ids.price],
    );
    const sourceBinding = await client.query(
      `SELECT pc.source_verified_at = csr.verified_at AS matches_source
       FROM price_components pc
       JOIN catalog_source_records csr ON csr.id = pc.source_record_id
       WHERE pc.id = $1`,
      [ids.price],
    );
    assert.equal(sourceBinding.rows[0]?.matches_source, true);

    await client.query("SET LOCAL ROLE fas_migrator");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [ids.tenant]);
    await client.query("SELECT set_config('app.organization_id', $1, true)", [
      ids.organization,
    ]);
    await expectRejectedInSavepoint(
      client,
      "published_insert",
      `INSERT INTO tenant_catalog_listings (
         id, tenant_id, organization_id, program_id, intake_id, visibility,
         publication_status, created_by_legacy_user_id,
         reviewed_by_legacy_user_id, reviewed_at
       ) VALUES ('018f8200-0000-7000-8000-000000000811', $1, $2, $3, $4,
         'PUBLIC', 'PUBLISHED', $5, $6, now())`,
      [
        ids.tenant,
        ids.organization,
        programId,
        ids.intake,
        authorId,
        reviewerId,
      ],
      /must begin as an unreviewed DRAFT/,
    );
    await client.query(
      `INSERT INTO tenant_catalog_listings (
         id, tenant_id, organization_id, program_id, intake_id,
         created_by_legacy_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [ids.listing, ids.tenant, ids.organization, programId, ids.intake, authorId],
    );
    await expectRejectedInSavepoint(
      client,
      "public_before_review",
      `UPDATE tenant_catalog_listings SET visibility = 'PUBLIC'
       WHERE tenant_id = $1 AND id = $2`,
      [ids.tenant, ids.listing],
      /tenant_catalog_listings_public_gate_chk/,
    );
    await expectRejectedInSavepoint(
      client,
      "direct_publish",
      `UPDATE tenant_catalog_listings
       SET publication_status = 'PUBLISHED', visibility = 'PUBLIC',
           reviewed_by_legacy_user_id = $1, reviewed_at = now()
       WHERE tenant_id = $2 AND id = $3`,
      [reviewerId, ids.tenant, ids.listing],
      /invalid tenant catalog listing transition/,
    );
    await client.query(
      `UPDATE tenant_catalog_listings
       SET publication_status = 'IN_REVIEW'
       WHERE tenant_id = $1 AND id = $2`,
      [ids.tenant, ids.listing],
    );
    await expectRejectedInSavepoint(
      client,
      "self_approval",
      `UPDATE tenant_catalog_listings
       SET publication_status = 'APPROVED',
           reviewed_by_legacy_user_id = $1, reviewed_at = now()
       WHERE tenant_id = $2 AND id = $3`,
      [authorId, ids.tenant, ids.listing],
      /independent reviewer/,
    );
    await client.query(
      `UPDATE tenant_catalog_listings
       SET publication_status = 'APPROVED',
           reviewed_by_legacy_user_id = $1, reviewed_at = now()
       WHERE tenant_id = $2 AND id = $3`,
      [reviewerId, ids.tenant, ids.listing],
    );
    await client.query(
      `UPDATE tenant_catalog_listings
       SET visibility = 'PUBLIC', publication_status = 'PUBLISHED'
       WHERE tenant_id = $1 AND id = $2`,
      [ids.tenant, ids.listing],
    );
    const published = await client.query(
      `SELECT publication_status, visibility, version::text
       FROM tenant_catalog_listings WHERE tenant_id = $1 AND id = $2`,
      [ids.tenant, ids.listing],
    );
    assert.deepEqual(published.rows[0], {
      publication_status: "PUBLISHED",
      visibility: "PUBLIC",
      version: "4",
    });

    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      ids.otherTenant,
    ]);
    const isolated = await client.query(
      "SELECT count(*)::int AS count FROM tenant_catalog_listings",
    );
    assert.equal(isolated.rows[0]?.count, 0);

    await client.query("RESET ROLE");
    await expectRejectedInSavepoint(
      client,
      "source_append_only",
      "UPDATE catalog_source_records SET status = 'SUPERSEDED' WHERE id = $1",
      [ids.priceSource],
      /append-only/,
    );
    const rls = await client.query(
      `SELECT relrowsecurity, relforcerowsecurity
       FROM pg_class WHERE relname = 'tenant_catalog_listings'`,
    );
    assert.deepEqual(rls.rows[0], {
      relrowsecurity: true,
      relforcerowsecurity: true,
    });
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
});
