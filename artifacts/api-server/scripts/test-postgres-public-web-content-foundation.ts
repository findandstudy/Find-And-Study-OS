import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const { Client } = pg;

const ADMIN_URL =
  process.env.PG_PUBLIC_WEB_ADMIN_URL ??
  "postgresql://postgres@127.0.0.1:5433/fasos_apply_local";
const target = new URL(ADMIN_URL);
const databaseName = target.pathname.slice(1);
const expectedServerPort = Number(process.env.PG_PUBLIC_WEB_SERVER_PORT ?? "5433");
if (!Number.isSafeInteger(expectedServerPort) || expectedServerPort < 1 || expectedServerPort > 65_535) {
  throw new Error("Public Web PostgreSQL test requires a valid expected server port");
}
if (
  target.protocol !== "postgresql:" ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "5433" ||
  !/^(?:fasos_apply_local|fas_dev_[a-z0-9_]+)$/.test(databaseName) ||
  target.username !== "postgres" ||
  target.password !== "" ||
  target.search !== "" ||
  target.hash !== ""
) {
  throw new Error(
    "Public Web PostgreSQL test requires a named disposable loopback PostgreSQL database",
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
const PRINCIPAL_ID = "018f8200-0000-7000-8000-000000000710";
const MEMBERSHIP_ID = "018f8200-0000-7000-8000-000000000711";
const POLICY_ID = "018f8200-0000-7000-8000-000000000712";
const CONTEXT_ID = "018f8200-0000-7000-8000-000000000713";
const ACCESS_SUBMIT_ID = "018f8200-0000-7000-8000-000000000714";
const ACCESS_APPROVE_ID = "018f8200-0000-7000-8000-000000000715";
const ACCESS_PUBLISH_ID = "018f8200-0000-7000-8000-000000000716";
const ACCESS_INDEX_ID = "018f8200-0000-7000-8000-000000000717";
const SUBMIT_RECEIPT_ID = "018f8200-0000-7000-8000-000000000718";
const APPROVE_RECEIPT_ID = "018f8200-0000-7000-8000-000000000719";
const INDEX_RECEIPT_ID = "018f8200-0000-7000-8000-00000000071a";
const ACCESS_DISABLE_ID = "018f8200-0000-7000-8000-00000000071b";
const DISABLE_RECEIPT_ID = "018f8200-0000-7000-8000-00000000071c";
const CITY_RECORD_ID = "018f8200-0000-7000-8000-00000000071d";
const CITY_DUPLICATE_RECORD_ID = "018f8200-0000-7000-8000-00000000071e";
const CITY_REVISION_ID = "018f8200-0000-7000-8000-00000000071f";
const CITY_EVIDENCE_ID = "018f8200-0000-7000-8000-000000000720";
const CITY_BODY_EVIDENCE_ID = "018f8200-0000-7000-8000-000000000721";
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

async function insertAccessDecision(
  client: pg.Client,
  input: {
    id: string;
    capability: string;
    correlationId: string;
    actorLegacyUserId: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO access_decision_receipts (
       id, tenant_id, context_id, actor_principal_id, membership_id,
       assignment_ids, role_package_version_ids, capability_key,
       resource_type, resource_id, decision, reason_code, policy_version_id,
       correlation_id, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, ARRAY[$5]::uuid[], ARRAY[$5]::uuid[],
       $6, 'PUBLIC_WEB_CONTENT', $7, 'ALLOW', 'allowed', $8, $9, now())`,
    [
      input.id,
      TENANT_ID,
      CONTEXT_ID,
      PRINCIPAL_ID,
      MEMBERSHIP_ID,
      input.capability,
      RECORD_ID,
      POLICY_ID,
      input.correlationId,
    ],
  );
  const principal = await client.query(
    `SELECT legacy_user_id FROM principals WHERE id = $1`,
    [PRINCIPAL_ID],
  );
  assert.equal(Number(principal.rows[0]?.legacy_user_id), input.actorLegacyUserId);
}

async function applyCommand(
  client: pg.Client,
  input: {
    accessDecisionReceiptId: string;
    actorLegacyUserId: number;
    command: string;
    expectedVersion: number;
    publicationReceiptId: string;
    requestKey: string;
    requestHash: string;
    staleReasonCode?: string | null;
  },
) {
  const result = await client.query<{ result: Record<string, unknown> }>(
    `SELECT fas_public_web_v1.apply_publication_command_v2($1::jsonb) AS result`,
    [
      JSON.stringify({
        accessDecisionReceiptId: input.accessDecisionReceiptId,
        actorLegacyUserId: input.actorLegacyUserId,
        command: input.command,
        contentRecordId: RECORD_ID,
        evidenceSha256: SHA_A,
        expectedVersion: input.expectedVersion,
        organizationId: ORGANIZATION_ID,
        publicationReceiptId: input.publicationReceiptId,
        requestHash: input.requestHash,
        requestKey: input.requestKey,
        revisionId: REVISION_ID,
        staleReasonCode: input.staleReasonCode ?? null,
        tenantId: TENANT_ID,
      }),
    ],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0]?.result;
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
      database_name: databaseName,
      user_name: "postgres",
      server_port: expectedServerPort,
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

    await client.query(
      `INSERT INTO principals (
         id, principal_type, issuer, subject, legacy_user_id, status, risk_state
       ) VALUES ($1, 'HUMAN', 'public-web-test', 'reviewer', $2, 'ACTIVE', 'NORMAL')`,
      [PRINCIPAL_ID, reviewerId],
    );
    await client.query(
      `INSERT INTO memberships (
         id, tenant_id, organization_id, principal_id, status, valid_from
       ) VALUES ($1, $2, $3, $4, 'ACTIVE', now() - interval '1 day')`,
      [MEMBERSHIP_ID, TENANT_ID, ORGANIZATION_ID, PRINCIPAL_ID],
    );
    await client.query(
      `INSERT INTO policy_versions (
         id, tenant_id, version_number, checksum, state, effective_at
       ) VALUES ($1, $2, 1, $3, 'ACTIVE', now() - interval '1 day')`,
      [POLICY_ID, TENANT_ID, SHA_A],
    );

    const page = await client.query(
      `INSERT INTO website_pages (title, slug, status, locale, created_by, updated_by)
       VALUES ('Foundation Fixture', 'public-web-foundation-fixture', 'draft', 'en', $1, $1)
       RETURNING id`,
      [authorId],
    );
    const pageId = Number(page.rows[0]?.id);
    const country = await client.query(
      `INSERT INTO countries (name, code, is_active)
       VALUES ('Public Web Cityland', 'PZ', true) RETURNING id`,
    );
    const city = await client.query(
      `INSERT INTO cities (name, country_id, is_active)
       VALUES ('Public Web City', $1, true) RETURNING id`,
      [country.rows[0]?.id],
    );
    const cityId = Number(city.rows[0]?.id);
    assert.ok(Number.isSafeInteger(cityId));

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
      `INSERT INTO public_web_content_records (
         id, tenant_id, organization_id, entity_type, city_id, locale,
         canonical_slug, canonical_path, created_by_legacy_user_id
       ) VALUES ($1, $2, $3, 'CITY', $4::integer, 'en', 'public-web-city',
         '/en/cities/public-web-city-' || $4::text, $5)`,
      [CITY_RECORD_ID, TENANT_ID, ORGANIZATION_ID, cityId, authorId],
    );
    await expectRejectedInSavepoint(
      client,
      "city_locale_unique",
      `INSERT INTO public_web_content_records (
         id, tenant_id, organization_id, entity_type, city_id, locale,
         canonical_slug, canonical_path, created_by_legacy_user_id
       ) VALUES ('${CITY_DUPLICATE_RECORD_ID}', '${TENANT_ID}', '${ORGANIZATION_ID}',
         'CITY', ${cityId}, 'en', 'public-web-city-copy',
         '/en/cities/public-web-city-copy-${cityId}', ${authorId})`,
      /public_web_content_records_city_locale_uq/,
    );
    await expectRejectedInSavepoint(
      client,
      "city_binding_exclusive",
      `INSERT INTO public_web_content_records (
         id, tenant_id, organization_id, entity_type, city_id, website_page_id,
         locale, canonical_slug, canonical_path, created_by_legacy_user_id
       ) VALUES ('${CITY_DUPLICATE_RECORD_ID}', '${TENANT_ID}', '${ORGANIZATION_ID}',
         'CITY', ${cityId}, ${pageId}, 'tr', 'public-web-city',
         '/tr/cities/public-web-city-${cityId}', ${authorId})`,
      /public_web_content_records_entity_binding_chk/,
    );
    await client.query(
      `INSERT INTO public_web_content_revisions (
         id, tenant_id, organization_id, content_record_id, revision_number,
         origin, title, content_json, seo_json, structured_data_json,
         source_sha256, content_sha256, quality_status, source_coverage,
         translation_status, seo_status, structured_data_status,
         created_by_legacy_user_id
       ) VALUES ($1, $2, $3, $4, 1, 'HUMAN', 'Public Web City',
         '{"country":"Public Web Cityland","body":"Verified city guide"}'::jsonb,
         '{"title":"Public Web City"}'::jsonb, '{"@type":"City"}'::jsonb,
         $5, $6, 'PASS', 'COMPLETE', 'SOURCE', 'PASS', 'PASS', $7)`,
      [CITY_REVISION_ID, TENANT_ID, ORGANIZATION_ID, CITY_RECORD_ID, SHA_A, SHA_B, authorId],
    );
    await client.query(
      `INSERT INTO public_web_source_evidence (
         id, tenant_id, organization_id, content_record_id, revision_id,
         source_type, source_visibility, source_url, source_reference_sha256,
         source_content_sha256, fact_keys, status, observed_at,
         verified_by_legacy_user_id, verified_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'EDITORIAL', 'PUBLIC',
         'https://example.invalid/public-web-city-source', $6, $7,
         ARRAY['name','country'], 'VERIFIED', now() - interval '1 day', $8,
         now() - interval '1 day', now() + interval '30 days')`,
      [CITY_EVIDENCE_ID, TENANT_ID, ORGANIZATION_ID, CITY_RECORD_ID, CITY_REVISION_ID, SHA_A, SHA_B, reviewerId],
    );
    await client.query(
      `INSERT INTO public_web_publication_states (
         tenant_id, organization_id, content_record_id, revision_id
       ) VALUES ($1, $2, $3, $4)`,
      [TENANT_ID, ORGANIZATION_ID, CITY_RECORD_ID, CITY_REVISION_ID],
    );
    await client.query(
      `UPDATE public_web_publication_states SET status='PENDING_REVIEW'
       WHERE tenant_id=$1 AND content_record_id=$2`,
      [TENANT_ID, CITY_RECORD_ID],
    );
    await expectRejectedInSavepoint(
      client,
      "city_required_facts",
      `UPDATE public_web_publication_states
       SET status='APPROVED', reviewed_by_legacy_user_id=${reviewerId}, reviewed_at=now()
       WHERE tenant_id='${TENANT_ID}' AND content_record_id='${CITY_RECORD_ID}'`,
      /city approval lacks current verified critical facts: body/,
    );
    await client.query(
      `INSERT INTO public_web_source_evidence (
         id, tenant_id, organization_id, content_record_id, revision_id,
         source_type, source_visibility, source_url, source_reference_sha256,
         source_content_sha256, fact_keys, status, observed_at,
         verified_by_legacy_user_id, verified_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'EDITORIAL', 'PUBLIC',
         'https://example.invalid/public-web-city-body-source', $6, $7,
         ARRAY['body'], 'VERIFIED', now() - interval '1 day', $8,
         now() - interval '1 day', now() + interval '30 days')`,
      [CITY_BODY_EVIDENCE_ID, TENANT_ID, ORGANIZATION_ID, CITY_RECORD_ID, CITY_REVISION_ID, SHA_A, SHA_B, reviewerId],
    );
    await client.query(
      `UPDATE public_web_publication_states
       SET status='APPROVED', reviewed_by_legacy_user_id=$3, reviewed_at=now()
       WHERE tenant_id=$1 AND content_record_id=$2`,
      [TENANT_ID, CITY_RECORD_ID, reviewerId],
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
      `SELECT set_config('app.organization_id', $1, true)`,
      [ORGANIZATION_ID],
    );
    const submitKey = "public-web.submit.fixture-1";
    await insertAccessDecision(client, {
      id: ACCESS_SUBMIT_ID,
      capability: "public_web.content.write",
      correlationId: submitKey,
      actorLegacyUserId: reviewerId,
    });
    assert.deepEqual(
      await applyCommand(client, {
        accessDecisionReceiptId: ACCESS_SUBMIT_ID,
        actorLegacyUserId: reviewerId,
        command: "SUBMIT_REVIEW",
        expectedVersion: 1,
        publicationReceiptId: SUBMIT_RECEIPT_ID,
        requestKey: submitKey,
        requestHash: "1".repeat(64),
      }),
      {
        outcome: "APPLIED",
        publicationReceiptId: SUBMIT_RECEIPT_ID,
        status: "PENDING_REVIEW",
        indexState: "NOINDEX",
        version: 2,
      },
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

    const approveKey = "public-web.approve.fixture-1";
    await insertAccessDecision(client, {
      id: ACCESS_APPROVE_ID,
      capability: "public_web.content.review",
      correlationId: approveKey,
      actorLegacyUserId: reviewerId,
    });
    assert.equal(
      (await applyCommand(client, {
        accessDecisionReceiptId: ACCESS_APPROVE_ID,
        actorLegacyUserId: reviewerId,
        command: "APPROVE",
        expectedVersion: 2,
        publicationReceiptId: APPROVE_RECEIPT_ID,
        requestKey: approveKey,
        requestHash: "2".repeat(64),
      }))?.status,
      "APPROVED",
    );

    const publishKey = "public-web.publish.fixture-1";
    await insertAccessDecision(client, {
      id: ACCESS_PUBLISH_ID,
      capability: "public_web.content.publish",
      correlationId: publishKey,
      actorLegacyUserId: reviewerId,
    });
    assert.deepEqual(
      await applyCommand(client, {
        accessDecisionReceiptId: ACCESS_PUBLISH_ID,
        actorLegacyUserId: reviewerId,
        command: "PUBLISH",
        expectedVersion: 3,
        publicationReceiptId: RECEIPT_ID,
        requestKey: publishKey,
        requestHash: "3".repeat(64),
      }),
      {
        outcome: "APPLIED",
        publicationReceiptId: RECEIPT_ID,
        status: "PUBLISHED",
        indexState: "NOINDEX",
        version: 4,
      },
    );

    const indexKey = "public-web.index.fixture-1";
    await insertAccessDecision(client, {
      id: ACCESS_INDEX_ID,
      capability: "public_web.content.index",
      correlationId: indexKey,
      actorLegacyUserId: reviewerId,
    });
    const indexCommand = {
      accessDecisionReceiptId: ACCESS_INDEX_ID,
      actorLegacyUserId: reviewerId,
      command: "ENABLE_INDEX",
      expectedVersion: 4,
      publicationReceiptId: INDEX_RECEIPT_ID,
      requestKey: indexKey,
      requestHash: "4".repeat(64),
    };
    assert.equal((await applyCommand(client, indexCommand))?.outcome, "APPLIED");
    const indexReceiptProbe = await client.query(
      `SELECT request_key, request_hash, to_status, index_state
       FROM public_web_publication_receipts
       WHERE tenant_id = $1 AND id = $2`,
      [TENANT_ID, INDEX_RECEIPT_ID],
    );
    assert.deepEqual(indexReceiptProbe.rows[0], {
      request_key: indexKey,
      request_hash: "4".repeat(64),
      to_status: "PUBLISHED",
      index_state: "INDEX",
    });
    assert.deepEqual(await applyCommand(client, indexCommand), {
      outcome: "REPLAY",
      publicationReceiptId: INDEX_RECEIPT_ID,
      status: "PUBLISHED",
      indexState: "INDEX",
    });
    await expectRejectedInSavepoint(
      client,
      "idempotency_conflict",
      `SELECT fas_public_web_v1.apply_publication_command_v2(
        jsonb_build_object(
          'accessDecisionReceiptId', '${ACCESS_INDEX_ID}',
          'actorLegacyUserId', ${reviewerId},
          'command', 'ENABLE_INDEX',
          'contentRecordId', '${RECORD_ID}',
          'evidenceSha256', '${SHA_A}',
          'expectedVersion', 4,
          'organizationId', '${ORGANIZATION_ID}',
          'publicationReceiptId', '${INDEX_RECEIPT_ID}',
          'requestHash', '${"5".repeat(64)}',
          'requestKey', '${indexKey}',
          'revisionId', '${REVISION_ID}',
          'staleReasonCode', NULL,
          'tenantId', '${TENANT_ID}'
        )
      )`,
      /idempotency conflict/,
    );

    const disableKey = "public-web.disable-index.fixture-1";
    const accessPayload = {
      actorPrincipalId: PRINCIPAL_ID,
      assignmentIds: [MEMBERSHIP_ID],
      capabilityKey: "public_web.content.index",
      contextId: CONTEXT_ID,
      correlationId: disableKey,
      decision: "ALLOW",
      id: ACCESS_DISABLE_ID,
      membershipId: MEMBERSHIP_ID,
      occurredAt: Date.now() - 1_000,
      policyVersionId: POLICY_ID,
      reasonCode: "allowed",
      resourceId: RECORD_ID,
      resourceType: "PUBLIC_WEB_CONTENT",
      rolePackageVersionIds: [MEMBERSHIP_ID],
      tenantId: TENANT_ID,
    };
    const disableCommand = {
      accessDecisionReceiptId: ACCESS_DISABLE_ID,
      actorLegacyUserId: reviewerId,
      command: "DISABLE_INDEX",
      contentRecordId: RECORD_ID,
      evidenceSha256: SHA_A,
      expectedVersion: 5,
      organizationId: ORGANIZATION_ID,
      publicationReceiptId: DISABLE_RECEIPT_ID,
      requestHash: "6".repeat(64),
      requestKey: disableKey,
      revisionId: REVISION_ID,
      staleReasonCode: null,
      tenantId: TENANT_ID,
    };
    const authorizedApply = await client.query<{ result: Record<string, unknown> }>(
      `SELECT fas_public_web_v1.apply_authorized_publication_command(
         $1::jsonb, $2::jsonb
       ) AS result`,
      [JSON.stringify(accessPayload), JSON.stringify(disableCommand)],
    );
    assert.deepEqual(authorizedApply.rows[0]?.result, {
      outcome: "APPLIED",
      publicationReceiptId: DISABLE_RECEIPT_ID,
      status: "PUBLISHED",
      indexState: "NOINDEX",
      version: 6,
    });
    const authorizedReplay = await client.query<{ result: Record<string, unknown> }>(
      `SELECT fas_public_web_v1.apply_authorized_publication_command(
         $1::jsonb, $2::jsonb
       ) AS result`,
      [JSON.stringify(accessPayload), JSON.stringify(disableCommand)],
    );
    assert.deepEqual(authorizedReplay.rows[0]?.result, {
      outcome: "REPLAY",
      publicationReceiptId: DISABLE_RECEIPT_ID,
      status: "PUBLISHED",
      indexState: "NOINDEX",
    });
    const accessRecorded = await client.query(
      `SELECT capability_key, correlation_id, decision
       FROM access_decision_receipts WHERE tenant_id = $1 AND id = $2`,
      [TENANT_ID, ACCESS_DISABLE_ID],
    );
    assert.deepEqual(accessRecorded.rows[0], {
      capability_key: "public_web.content.index",
      correlation_id: disableKey,
      decision: "ALLOW",
    });

    const published = await client.query(
      `SELECT status, index_state, version
       FROM public_web_publication_states
       WHERE tenant_id = $1 AND content_record_id = $2`,
      [TENANT_ID, RECORD_ID],
    );
    assert.deepEqual(published.rows[0], {
      status: "PUBLISHED",
      index_state: "NOINDEX",
      version: "6",
    });
    // INSERT-only RLS already makes these rows immutable for the runtime role.
    // Exercise the trigger itself as the local disposable superuser as well.
    await client.query("RESET ROLE");
    await expectRejectedInSavepoint(
      client,
      "immutable_receipt",
      `UPDATE public_web_publication_receipts SET to_status = 'RETIRED'
       WHERE tenant_id = '${TENANT_ID}' AND id = '${INDEX_RECEIPT_ID}'`,
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
    const publicExecution = await client.query(
      `SELECT
         has_function_privilege('public', 'fas_public_web_v1.apply_publication_command_v2(jsonb)', 'EXECUTE') AS v2,
         has_function_privilege('public', 'fas_public_web_v1.apply_authorized_publication_command(jsonb,jsonb)', 'EXECUTE') AS authorized`,
    );
    assert.deepEqual(publicExecution.rows[0], { v2: false, authorized: false });
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
});
