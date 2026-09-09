import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const { Client } = pg;

const ADMIN_URL =
  process.env.PG_PUBLIC_WEB_ADMIN_URL ??
  "postgresql://postgres@127.0.0.1:5433/fasos_apply_local";
const target = new URL(ADMIN_URL);
const databaseName = target.pathname.slice(1);
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
    "Public Web draft intake PostgreSQL test requires a named disposable loopback database",
  );
}

const TENANT_ID = "018f8300-0000-7000-8000-000000000701";
const OTHER_TENANT_ID = "018f8300-0000-7000-8000-000000000702";
const ORGANIZATION_ID = "018f8300-0000-7000-8000-000000000703";
const PRINCIPAL_ID = "018f8300-0000-7000-8000-000000000704";
const MEMBERSHIP_ID = "018f8300-0000-7000-8000-000000000705";
const POLICY_ID = "018f8300-0000-7000-8000-000000000706";
const ROLE_DEFINITION_ID = "018f8300-0000-7000-8000-000000000707";
const ROLE_PACKAGE_ID = "018f8300-0000-7000-8000-000000000708";
const GRANT_RECEIPT_ID = "018f8300-0000-7000-8000-000000000709";
const ASSIGNMENT_ID = "018f8300-0000-7000-8000-00000000070a";
const CONTEXT_ID = "018f8300-0000-7000-8000-00000000070b";
const ACCESS_ID = "018f8300-0000-7000-8000-00000000070c";
const RECORD_ID = "018f8300-0000-7000-8000-00000000070d";
const REVISION_ID = "018f8300-0000-7000-8000-00000000070e";
const ROUTE_ID = "018f8300-0000-7000-8000-00000000070f";
const INTAKE_ID = "018f8300-0000-7000-8000-000000000710";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

async function rejectInSavepoint(
  client: pg.Client,
  name: string,
  action: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  await client.query(`SAVEPOINT ${name}`);
  await assert.rejects(action(), pattern);
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
}

function accessPayload(occurredAt: number) {
  return {
    actorPrincipalId: PRINCIPAL_ID,
    assignmentIds: [ASSIGNMENT_ID],
    capabilityKey: "public_web.content.write",
    contextId: CONTEXT_ID,
    correlationId: "public-web-draft-intake-fixture-1",
    decision: "ALLOW",
    id: ACCESS_ID,
    membershipId: MEMBERSHIP_ID,
    occurredAt,
    policyVersionId: POLICY_ID,
    reasonCode: "allowed",
    resourceId: RECORD_ID,
    resourceType: "PUBLIC_WEB_CONTENT",
    rolePackageVersionIds: [ROLE_PACKAGE_ID],
    tenantId: TENANT_ID,
  };
}

function commandPayload(input?: { requestHash?: string }) {
  return {
    accessDecisionReceiptId: ACCESS_ID,
    actorLegacyUserId: 0,
    canonicalPath: "/en/draft-intake-fixture",
    canonicalSlug: "draft-intake-fixture",
    contentJson: { body: "Governed draft content" },
    contentRecordId: RECORD_ID,
    contentSha256: SHA_B,
    entityId: 0,
    entityType: "PAGE",
    generatorReceiptSha256: null,
    intakeReceiptId: INTAKE_ID,
    locale: "en",
    organizationId: ORGANIZATION_ID,
    origin: "HUMAN",
    requestHash: input?.requestHash ?? SHA_C,
    requestKey: "public-web-draft-intake-fixture-1",
    revisionId: REVISION_ID,
    routeAliasId: ROUTE_ID,
    seoJson: { title: "Draft intake fixture" },
    sourceSha256: SHA_A,
    structuredDataJson: { "@type": "WebPage" },
    summary: "A review-only fixture.",
    tenantId: TENANT_ID,
    title: "Draft intake fixture",
  };
}

test("authorized public web intake creates only an idempotent DRAFT and NOINDEX record", async () => {
  const client = new Client({
    connectionString: ADMIN_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "fasos-public-web-draft-intake-test",
  });
  await client.connect();
  try {
    const identity = await client.query(
      "SELECT current_database() AS database_name, current_user AS user_name, inet_server_port() AS server_port",
    );
    assert.deepEqual(identity.rows[0], {
      database_name: databaseName,
      user_name: "postgres",
      server_port: 5433,
    });

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tenants (id, slug, legal_name, display_name, status, home_region)
       VALUES ($1, 'public-web-draft-test', 'Public Web Draft Test',
         'Public Web Draft Test', 'ACTIVE', 'local')`,
      [TENANT_ID],
    );
    await client.query(
      `INSERT INTO organizations (
         id, tenant_id, legal_name, display_name, organization_type, status
       ) VALUES ($1, $2, 'Public Web Draft Test', 'Public Web Draft Test',
         'OPERATING_ENTITY', 'ACTIVE')`,
      [ORGANIZATION_ID, TENANT_ID],
    );
    const user = await client.query<{ id: number }>(
      `INSERT INTO users (email, first_name, last_name, role)
       VALUES ('public-web-draft@example.invalid', 'Draft', 'Fixture', 'admin')
       RETURNING id`,
    );
    const actorLegacyUserId = Number(user.rows[0]?.id);
    assert.ok(Number.isSafeInteger(actorLegacyUserId));

    await client.query(
      `INSERT INTO principals (
         id, principal_type, issuer, subject, legacy_user_id, status, risk_state
       ) VALUES ($1, 'HUMAN', 'public-web-draft-test', 'author', $2,
         'ACTIVE', 'NORMAL')`,
      [PRINCIPAL_ID, actorLegacyUserId],
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
    const capability = await client.query(
      `SELECT status, step_up_required, approval_required
       FROM capability_definitions WHERE key = 'public_web.content.write'`,
    );
    assert.deepEqual(capability.rows[0], {
      status: "ACTIVE",
      step_up_required: false,
      approval_required: false,
    });
    await client.query(
      `INSERT INTO role_definitions (
         id, key, display_name, purpose, principal_type, status
       ) VALUES ($1, 'public_web.draft_fixture', 'Public Web Draft Fixture',
         'Disposable draft intake verification', 'HUMAN', 'ACTIVE')`,
      [ROLE_DEFINITION_ID],
    );
    await client.query(
      `INSERT INTO role_package_versions (
         id, role_definition_id, version_number, status, default_scope_type,
         checksum, effective_at
       ) VALUES ($1, $2, 1, 'ACTIVE', 'ORGANIZATION', $3,
         now() - interval '1 day')`,
      [ROLE_PACKAGE_ID, ROLE_DEFINITION_ID, SHA_B],
    );
    await client.query(
      `INSERT INTO role_package_capabilities (
         role_package_version_id, capability_key, effect
       ) VALUES ($1, 'public_web.content.write', 'ALLOW')`,
      [ROLE_PACKAGE_ID],
    );
    await client.query(
      `INSERT INTO authorization_change_receipts (
       id, tenant_id, receipt_type, actor_principal_id, resource_type,
         actor_membership_id, resource_id, reason_code, correlation_id,
         evidence, receipt_hash
       ) VALUES ($1, $2, 'GRANT', $3, 'ACCESS_ASSIGNMENT', $4, $5,
         'fixture', 'public-web-draft-grant', '{}'::jsonb, $6)`,
      [
        GRANT_RECEIPT_ID,
        TENANT_ID,
        PRINCIPAL_ID,
        MEMBERSHIP_ID,
        ASSIGNMENT_ID,
        SHA_C,
      ],
    );
    await client.query(
      `INSERT INTO access_assignments (
         id, tenant_id, membership_id, role_package_version_id, scope_type,
         organization_id, status, valid_from, granted_by_principal_id,
         granted_by_membership_id, grant_receipt_id, grant_receipt_type
       ) VALUES ($1, $2, $3, $4, 'ORGANIZATION', $5, 'ACTIVE',
         now() - interval '1 day', $6, $7, $8, 'GRANT')`,
      [
        ASSIGNMENT_ID,
        TENANT_ID,
        MEMBERSHIP_ID,
        ROLE_PACKAGE_ID,
        ORGANIZATION_ID,
        PRINCIPAL_ID,
        MEMBERSHIP_ID,
        GRANT_RECEIPT_ID,
      ],
    );
    const page = await client.query<{ id: number }>(
      `INSERT INTO website_pages (title, slug, status, locale, created_by, updated_by)
       VALUES ('Draft intake fixture', 'draft-intake-fixture', 'draft', 'en', $1, $1)
       RETURNING id`,
      [actorLegacyUserId],
    );
    const pageId = Number(page.rows[0]?.id);
    assert.ok(Number.isSafeInteger(pageId));

    await client.query("SET LOCAL ROLE fas_migrator");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_ID]);
    await client.query("SELECT set_config('app.organization_id', $1, true)", [
      ORGANIZATION_ID,
    ]);
    const occurredAt = Date.now();
    const command = commandPayload();
    command.actorLegacyUserId = actorLegacyUserId;
    command.entityId = pageId;
    const applied = await client.query<{ result: Record<string, unknown> }>(
      `SELECT fas_public_web_v1.apply_authorized_draft_intake(
         $1::jsonb, $2::jsonb
       ) AS result`,
      [JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command)],
    );
    assert.deepEqual(applied.rows[0]?.result, {
      contentRecordId: RECORD_ID,
      indexState: "NOINDEX",
      intakeReceiptId: INTAKE_ID,
      outcome: "APPLIED",
      revisionId: REVISION_ID,
      status: "DRAFT",
      version: 1,
    });

    const persisted = await client.query(
      `SELECT state.status, state.index_state, state.version::integer AS version,
              revision.quality_status, revision.source_coverage,
              revision.translation_status, revision.seo_status,
              revision.structured_data_status, route.route_kind,
              route.http_status, receipt.request_hash
       FROM public_web_publication_states state
       JOIN public_web_content_revisions revision
         ON revision.tenant_id = state.tenant_id
        AND revision.organization_id = state.organization_id
        AND revision.content_record_id = state.content_record_id
        AND revision.id = state.revision_id
       JOIN public_web_route_aliases route
         ON route.tenant_id = state.tenant_id
        AND route.organization_id = state.organization_id
        AND route.content_record_id = state.content_record_id
       JOIN public_web_draft_intake_receipts receipt
         ON receipt.tenant_id = state.tenant_id
        AND receipt.content_record_id = state.content_record_id
       WHERE state.tenant_id = $1 AND state.content_record_id = $2`,
      [TENANT_ID, RECORD_ID],
    );
    assert.deepEqual(persisted.rows[0], {
      status: "DRAFT",
      index_state: "NOINDEX",
      version: 1,
      quality_status: "PENDING",
      source_coverage: "MISSING",
      translation_status: "SOURCE",
      seo_status: "PENDING",
      structured_data_status: "PENDING",
      route_kind: "CANONICAL",
      http_status: 200,
      request_hash: SHA_C,
    });

    const replayed = await client.query<{ result: Record<string, unknown> }>(
      `SELECT fas_public_web_v1.apply_authorized_draft_intake(
         $1::jsonb, $2::jsonb
       ) AS result`,
      [JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command)],
    );
    assert.equal(replayed.rows[0]?.result.outcome, "REPLAY");
    const counts = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM public_web_content_records
           WHERE tenant_id = $1 AND id = $2) AS records,
         (SELECT count(*)::integer FROM public_web_content_revisions
           WHERE tenant_id = $1 AND id = $3) AS revisions,
         (SELECT count(*)::integer FROM public_web_draft_intake_receipts
           WHERE tenant_id = $1 AND request_key = $4) AS receipts`,
      [TENANT_ID, RECORD_ID, REVISION_ID, command.requestKey],
    );
    assert.deepEqual(counts.rows[0], { records: 1, revisions: 1, receipts: 1 });

    const conflictingCommand = commandPayload({ requestHash: SHA_A });
    conflictingCommand.actorLegacyUserId = actorLegacyUserId;
    conflictingCommand.entityId = pageId;
    await rejectInSavepoint(
      client,
      "draft_intake_idempotency_conflict",
      () =>
        client.query(
          `SELECT fas_public_web_v1.apply_authorized_draft_intake(
             $1::jsonb, $2::jsonb
           )`,
          [
            JSON.stringify(accessPayload(occurredAt)),
            JSON.stringify(conflictingCommand),
          ],
        ),
      /public web draft intake idempotency conflict/,
    );
    const deniedMutation = await client.query(
      `UPDATE public_web_draft_intake_receipts
       SET request_hash = $1 WHERE tenant_id = $2 AND id = $3`,
      [SHA_A, TENANT_ID, INTAKE_ID],
    );
    assert.equal(deniedMutation.rowCount, 0);

    await client.query("RESET ROLE");
    await rejectInSavepoint(
      client,
      "draft_intake_append_only",
      () =>
        client.query(
          `UPDATE public_web_draft_intake_receipts
           SET request_hash = $1 WHERE tenant_id = $2 AND id = $3`,
          [SHA_A, TENANT_ID, INTAKE_ID],
        ),
      /public web draft intake receipts are append-only/,
    );
    await client.query(
      "UPDATE access_assignments SET status = 'SUSPENDED' WHERE id = $1",
      [ASSIGNMENT_ID],
    );
    await client.query("SET LOCAL ROLE fas_migrator");
    await rejectInSavepoint(
      client,
      "draft_intake_revoked_authority",
      () =>
        client.query(
          `SELECT fas_public_web_v1.apply_authorized_draft_intake(
             $1::jsonb, $2::jsonb
           )`,
          [JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command)],
        ),
      /public web draft intake authority unavailable/,
    );

    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      OTHER_TENANT_ID,
    ]);
    const isolated = await client.query(
      "SELECT count(*)::integer AS count FROM public_web_draft_intake_receipts",
    );
    assert.equal(isolated.rows[0]?.count, 0);
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
});
