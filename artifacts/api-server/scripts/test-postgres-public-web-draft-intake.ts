import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
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
const RETRY_ACCESS_ID = "018f8300-0000-7000-8000-000000000711";
const RETRY_RECORD_ID = "018f8300-0000-7000-8000-000000000712";
const RETRY_REVISION_ID = "018f8300-0000-7000-8000-000000000713";
const RETRY_ROUTE_ID = "018f8300-0000-7000-8000-000000000714";
const RETRY_INTAKE_ID = "018f8300-0000-7000-8000-000000000715";
const SELECTION_ID = "018f8300-0000-7000-8000-000000000716";
const NEXT_SELECTION_ID = "018f8300-0000-7000-8000-000000000717";
const DENY_ROLE_DEFINITION_ID = "018f8300-0000-7000-8000-000000000718";
const DENY_ROLE_PACKAGE_ID = "018f8300-0000-7000-8000-000000000719";
const DENY_GRANT_RECEIPT_ID = "018f8300-0000-7000-8000-00000000071a";
const DENY_ASSIGNMENT_ID = "018f8300-0000-7000-8000-00000000071b";
const SESSION_ID = "4".repeat(64);
const SESSION_FINGERPRINT = crypto.createHash("sha256").update(SESSION_ID, "utf8").digest("hex");
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const REQUEST_KEY = `pwd2:${"d".repeat(64)}`;
const OTHER_REQUEST_KEY = `pwd2:${"e".repeat(64)}`;
const REPLAY_HARDENING_SQL = readFileSync(
  new URL("../../../lib/db/drizzle/0123_public_web_draft_intake_replay_hardening.sql", import.meta.url),
  "utf8",
);

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

function accessPayload(occurredAt: number, input: {
  id?: string;
  resourceId?: string;
  requestKey?: string;
} = {}) {
  return {
    actorPrincipalId: PRINCIPAL_ID,
    assignmentIds: [ASSIGNMENT_ID],
    capabilityKey: "public_web.content.write",
    contextId: CONTEXT_ID,
    correlationId: input.requestKey ?? REQUEST_KEY,
    decision: "ALLOW",
    id: input.id ?? ACCESS_ID,
    membershipId: MEMBERSHIP_ID,
    occurredAt,
    policyVersionId: POLICY_ID,
    reasonCode: "allowed",
    resourceId: input.resourceId ?? RECORD_ID,
    resourceType: "PUBLIC_WEB_CONTENT",
    rolePackageVersionIds: [ROLE_PACKAGE_ID],
    tenantId: TENANT_ID,
  };
}

function commandPayload(input: {
  accessDecisionReceiptId?: string;
  contentRecordId?: string;
  intakeReceiptId?: string;
  requestHash?: string;
  requestKey?: string;
  revisionId?: string;
  routeAliasId?: string;
  sourceSha256?: string;
} = {}) {
  return {
    accessDecisionReceiptId: input.accessDecisionReceiptId ?? ACCESS_ID,
    actorLegacyUserId: 0,
    canonicalPath: "/en/draft-intake-fixture",
    canonicalSlug: "draft-intake-fixture",
    contentJson: { body: "Governed draft content" },
    contentRecordId: input.contentRecordId ?? RECORD_ID,
    contentSha256: SHA_B,
    entityId: 0,
    entityType: "PAGE",
    generatorReceiptSha256: null,
    intakeReceiptId: input.intakeReceiptId ?? INTAKE_ID,
    locale: "en",
    organizationId: ORGANIZATION_ID,
    origin: "HUMAN",
    requestHash: input.requestHash ?? SHA_C,
    requestKey: input.requestKey ?? REQUEST_KEY,
    revisionId: input.revisionId ?? REVISION_ID,
    routeAliasId: input.routeAliasId ?? ROUTE_ID,
    seoJson: { title: "Draft intake fixture" },
    sourceSha256: input.sourceSha256 ?? SHA_A,
    structuredDataJson: { "@type": "WebPage" },
    summary: "A review-only fixture.",
    tenantId: TENANT_ID,
    title: "Draft intake fixture",
  };
}

function selectionPayload(issuedAt: number, input: {
  contextExpiresAt?: number;
  selectionId?: string;
  sessionGeneration?: number;
} = {}) {
  return {
    contextExpiresAt: input.contextExpiresAt ?? issuedAt + 5 * 60_000,
    contextId: CONTEXT_ID,
    contextIssuedAt: issuedAt,
    selectionId: input.selectionId ?? SELECTION_ID,
    sessionFingerprint: SESSION_FINGERPRINT,
    sessionGeneration: input.sessionGeneration ?? 1,
    sessionId: SESSION_ID,
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

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const installed = await client.query<{ installed: boolean }>(
      `SELECT to_regprocedure(
         'fas_public_web_v1.apply_authorized_draft_intake_v2(jsonb,jsonb,jsonb)'
       ) IS NOT NULL AS installed`,
    );
    if (installed.rows[0]?.installed !== true) {
      await client.query(REPLAY_HARDENING_SQL);
    }
    const existingExecutor = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'fas_public_web_executor'",
    );
    assert.equal(existingExecutor.rowCount, 0, "disposable DB must not have a prewired executor");
    await client.query(
      `CREATE ROLE fas_public_web_executor LOGIN NOSUPERUSER NOCREATEDB
       NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
    );
    await client.query("GRANT USAGE ON SCHEMA public, fas_public_web_v1 TO fas_public_web_executor");
    await client.query(
      `GRANT EXECUTE ON FUNCTION
         fas_public_web_v1.resolve_source_sha256(text, integer),
         fas_public_web_v1.apply_authorized_draft_intake_v2(jsonb, jsonb, jsonb)
       TO fas_public_web_executor`,
    );
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
    const occurredAt = Date.now();
    await client.query(
      `INSERT INTO sessions (sid, sess, expire, user_id)
       VALUES ($1, jsonb_build_object(
         'user', jsonb_build_object('id', $2::integer),
         'issued_at', $3::bigint
       ), now() + interval '1 hour', $2)`,
      [SESSION_ID, actorLegacyUserId, occurredAt - 1_000],
    );
    await client.query(
      `INSERT INTO active_session_context_selections (
         id, tenant_id, session_fingerprint, session_generation,
         legacy_user_id, principal_id, membership_id, organization_id,
         legacy_branch_id, status
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, NULL, 'ACTIVE')`,
      [
        SELECTION_ID, TENANT_ID, SESSION_FINGERPRINT, actorLegacyUserId,
        PRINCIPAL_ID, MEMBERSHIP_ID, ORGANIZATION_ID,
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

    await client.query("SET LOCAL ROLE fas_public_web_executor");
    const exactAcl = await client.query(
      `SELECT
         has_function_privilege(current_user,
           'fas_public_web_v1.resolve_source_sha256(text,integer)', 'EXECUTE') AS safe_source,
         has_function_privilege(current_user,
           'fas_public_web_v1.apply_authorized_draft_intake_v2(jsonb,jsonb,jsonb)', 'EXECUTE') AS v2_writer,
         has_function_privilege(current_user,
           'fas_public_web_v1.apply_authorized_draft_intake(jsonb,jsonb)', 'EXECUTE') AS v1_writer,
         has_function_privilege(current_user,
           'fas_public_web_v1.resolve_source_sha256_internal(text,integer,boolean)', 'EXECUTE') AS source_internal,
         has_function_privilege(current_user,
           'fas_public_web_v1.resolve_source_sha256_locked(text,integer)', 'EXECUTE') AS source_locked,
         has_function_privilege(current_user,
           'fas_public_web_v1.assert_current_draft_authority(jsonb,jsonb,jsonb)', 'EXECUTE') AS authority_helper`,
    );
    assert.deepEqual(exactAcl.rows[0], {
      safe_source: true,
      v2_writer: true,
      v1_writer: false,
      source_internal: false,
      source_locked: false,
      authority_helper: false,
    });
    const directAuthority = await client.query(
      `SELECT
         has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
         has_schema_privilege(current_user, 'fas_public_web_v1', 'CREATE') AS facade_create,
         EXISTS (
           SELECT 1
           FROM unnest(ARRAY[
             'public.users',
             'public.sessions',
             'public.active_session_context_selections',
             'public.tenants',
             'public.organizations',
             'public.principals',
             'public.memberships',
             'public.policy_versions',
             'public.access_assignments',
             'public.role_definitions',
             'public.role_package_versions',
             'public.role_package_capabilities',
             'public.capability_definitions',
             'public.access_decision_receipts',
             'public.public_web_content_records',
             'public.public_web_content_revisions',
             'public.public_web_publication_states',
             'public.public_web_route_aliases',
             'public.public_web_draft_intake_receipts',
             'public.programs',
             'public.universities',
             'public.destinations',
             'public.cities',
             'public.countries',
             'public.website_pages',
             'public.website_blog_posts'
           ]::text[]) AS critical(relation_name)
           WHERE has_table_privilege(current_user, relation_name,
             'SELECT,INSERT,UPDATE,DELETE')
         ) AS critical_table_dml`,
    );
    assert.deepEqual(directAuthority.rows[0], {
      public_create: false,
      facade_create: false,
      critical_table_dml: false,
    });
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_ID]);
    await client.query("SELECT set_config('app.organization_id', $1, true)", [
      ORGANIZATION_ID,
    ]);
    const command = commandPayload();
    command.actorLegacyUserId = actorLegacyUserId;
    command.entityId = pageId;
    const source = await client.query<{ source_sha256: string }>(
      `SELECT fas_public_web_v1.resolve_source_sha256(
         'PAGE', $1::integer
       ) AS source_sha256`,
      [pageId],
    );
    assert.match(source.rows[0]?.source_sha256 ?? "", /^[0-9a-f]{64}$/);
    command.sourceSha256 = source.rows[0]!.source_sha256;
    const oversizedAccess = accessPayload(occurredAt);
    oversizedAccess.reasonCode = "x".repeat(70_000);
    await rejectInSavepoint(
      client,
      "draft_intake_payload_oversized",
      () => client.query(
        `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
           $1::jsonb, $2::jsonb, $3::jsonb
         )`,
        [
          JSON.stringify(oversizedAccess), JSON.stringify(command),
          JSON.stringify(selectionPayload(occurredAt)),
        ],
      ),
      /public web draft intake payload oversized/,
    );
    const blocker = new Client({
      connectionString: ADMIN_URL,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      application_name: "fasos-public-web-draft-intake-lock-blocker",
    });
    await blocker.connect();
    let blockerTransaction = false;
    let appliedPromise: Promise<pg.QueryResult<{ result: Record<string, unknown> }>> | undefined;
    try {
      await blocker.query("BEGIN");
      blockerTransaction = true;
      await blocker.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))`,
        [TENANT_ID, REQUEST_KEY],
      );
      let appliedSettled = false;
      appliedPromise = client.query<{ result: Record<string, unknown> }>(
        `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
           $1::jsonb, $2::jsonb, $3::jsonb
         ) AS result`,
        [
          JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
          JSON.stringify(selectionPayload(occurredAt)),
        ],
      );
      void appliedPromise.then(
        () => { appliedSettled = true; },
        () => { appliedSettled = true; },
      );
      await new Promise((resolve) => setTimeout(resolve, 75));
      assert.equal(appliedSettled, false, "same scoped key must wait on the advisory lock");
      await blocker.query("COMMIT");
      blockerTransaction = false;
    } finally {
      if (blockerTransaction) await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end().catch(() => undefined);
    }
    assert.ok(appliedPromise);
    const applied = await appliedPromise;
    assert.deepEqual(applied.rows[0]?.result, {
      contentRecordId: RECORD_ID,
      indexState: "NOINDEX",
      intakeReceiptId: INTAKE_ID,
      outcome: "APPLIED",
      revisionId: REVISION_ID,
      status: "DRAFT",
      version: 1,
    });

    await client.query("RESET ROLE");
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

    await client.query("SET LOCAL ROLE fas_public_web_executor");

    const replayed = await client.query<{ result: Record<string, unknown> }>(
      `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
         $1::jsonb, $2::jsonb, $3::jsonb
       ) AS result`,
      [
        JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
        JSON.stringify(selectionPayload(occurredAt)),
      ],
    );
    assert.equal(replayed.rows[0]?.result.outcome, "REPLAY");

    const retryCommand = commandPayload({
      accessDecisionReceiptId: RETRY_ACCESS_ID,
      contentRecordId: RETRY_RECORD_ID,
      intakeReceiptId: RETRY_INTAKE_ID,
      revisionId: RETRY_REVISION_ID,
      routeAliasId: RETRY_ROUTE_ID,
      sourceSha256: command.sourceSha256,
    });
    retryCommand.actorLegacyUserId = actorLegacyUserId;
    retryCommand.entityId = pageId;
    const ambiguousCommitRetry = await client.query<{ result: Record<string, unknown> }>(
      `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
         $1::jsonb, $2::jsonb, $3::jsonb
       ) AS result`,
      [
        JSON.stringify(accessPayload(occurredAt - 10 * 60_000, {
          id: RETRY_ACCESS_ID,
          resourceId: RETRY_RECORD_ID,
        })),
        JSON.stringify(retryCommand),
        JSON.stringify(selectionPayload(occurredAt)),
      ],
    );
    assert.deepEqual(ambiguousCommitRetry.rows[0]?.result, {
      contentRecordId: RECORD_ID,
      indexState: "NOINDEX",
      intakeReceiptId: INTAKE_ID,
      outcome: "REPLAY",
      revisionId: REVISION_ID,
      status: "DRAFT",
      version: 1,
    });
    await client.query("RESET ROLE");
    const counts = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM public_web_content_records
           WHERE tenant_id = $1 AND id = $2) AS records,
         (SELECT count(*)::integer FROM public_web_content_revisions
           WHERE tenant_id = $1 AND id = $3) AS revisions,
         (SELECT count(*)::integer FROM public_web_draft_intake_receipts
           WHERE tenant_id = $1 AND request_key = $4) AS receipts,
         (SELECT count(*)::integer FROM access_decision_receipts
           WHERE tenant_id = $1 AND correlation_id = $4) AS access_receipts`,
      [TENANT_ID, RECORD_ID, REVISION_ID, command.requestKey],
    );
    assert.deepEqual(counts.rows[0], {
      records: 1,
      revisions: 1,
      receipts: 1,
      access_receipts: 1,
    });

    await client.query(
      "UPDATE website_pages SET title = title || ' changed' WHERE id = $1",
      [pageId],
    );
    await client.query("SET LOCAL ROLE fas_public_web_executor");
    const replayAfterSourceDrift = await client.query<{ result: Record<string, unknown> }>(
      `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
         $1::jsonb, $2::jsonb, $3::jsonb
       ) AS result`,
      [
        JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
        JSON.stringify(selectionPayload(occurredAt)),
      ],
    );
    assert.equal(replayAfterSourceDrift.rows[0]?.result.outcome, "REPLAY");

    const staleSourceCommand = commandPayload({
      accessDecisionReceiptId: RETRY_ACCESS_ID,
      contentRecordId: RETRY_RECORD_ID,
      intakeReceiptId: RETRY_INTAKE_ID,
      requestKey: OTHER_REQUEST_KEY,
      revisionId: RETRY_REVISION_ID,
      routeAliasId: RETRY_ROUTE_ID,
      sourceSha256: command.sourceSha256,
    });
    staleSourceCommand.actorLegacyUserId = actorLegacyUserId;
    staleSourceCommand.entityId = pageId;
    await rejectInSavepoint(
      client,
      "draft_intake_source_drift",
      () => client.query(
        `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
           $1::jsonb, $2::jsonb, $3::jsonb
         )`,
        [
          JSON.stringify(accessPayload(Date.now(), {
            id: RETRY_ACCESS_ID,
            resourceId: RETRY_RECORD_ID,
            requestKey: OTHER_REQUEST_KEY,
          })),
          JSON.stringify(staleSourceCommand),
          JSON.stringify(selectionPayload(occurredAt)),
        ],
      ),
      /public web draft intake source changed/,
    );

    const conflictingCommand = commandPayload({ requestHash: SHA_A });
    conflictingCommand.actorLegacyUserId = actorLegacyUserId;
    conflictingCommand.entityId = pageId;
    conflictingCommand.sourceSha256 = command.sourceSha256;
    await rejectInSavepoint(
      client,
      "draft_intake_idempotency_conflict",
      () =>
        client.query(
          `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
             $1::jsonb, $2::jsonb, $3::jsonb
           )`,
          [
            JSON.stringify(accessPayload(occurredAt)),
            JSON.stringify(conflictingCommand),
            JSON.stringify(selectionPayload(occurredAt)),
          ],
        ),
      /public web draft intake idempotency conflict/,
    );
    await rejectInSavepoint(
      client,
      "draft_intake_context_expired",
      () => client.query(
        `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
           $1::jsonb, $2::jsonb, $3::jsonb
         )`,
        [
          JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
          JSON.stringify(selectionPayload(occurredAt - 2_000, {
            contextExpiresAt: occurredAt - 1_000,
          })),
        ],
      ),
      /public web draft intake active selection unavailable/,
    );
    for (const [lifecycleIndex, lifecycleCase] of [
      {
        name: "deactivated",
        mutation: `UPDATE users SET is_active = false WHERE id = $1`,
      },
      {
        name: "soft_deleted",
        mutation: `UPDATE users SET deleted_at = now() WHERE id = $1`,
      },
      {
        name: "student_email_unverified",
        mutation: `UPDATE users
          SET role = 'student', email_verified = false WHERE id = $1`,
      },
    ].entries()) {
      await client.query("RESET ROLE");
      await client.query(`SAVEPOINT draft_intake_user_${lifecycleCase.name}`);
      try {
        await client.query(lifecycleCase.mutation, [actorLegacyUserId]);
        await client.query("SET LOCAL ROLE fas_public_web_executor");
        await rejectInSavepoint(
          client,
          `draft_intake_user_${lifecycleCase.name}_replay`,
          () => client.query(
            `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
               $1::jsonb, $2::jsonb, $3::jsonb
             )`,
            [
              JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
              JSON.stringify(selectionPayload(occurredAt)),
            ],
          ),
          /public web draft intake session unavailable/,
        );
        const lifecycleId = (offset: number) =>
          `018f8300-0000-7000-8000-${(
            0x720 + lifecycleIndex * 5 + offset
          ).toString(16).padStart(12, "0")}`;
        const lifecycleRequestKey = `pwd2:${String(lifecycleIndex + 6).repeat(64)}`;
        const lifecycleCommand = commandPayload({
          accessDecisionReceiptId: lifecycleId(0),
          contentRecordId: lifecycleId(1),
          revisionId: lifecycleId(2),
          routeAliasId: lifecycleId(3),
          intakeReceiptId: lifecycleId(4),
          requestKey: lifecycleRequestKey,
          sourceSha256: command.sourceSha256,
        });
        lifecycleCommand.actorLegacyUserId = actorLegacyUserId;
        lifecycleCommand.entityId = pageId;
        await rejectInSavepoint(
          client,
          `draft_intake_user_${lifecycleCase.name}_new_write`,
          () => client.query(
            `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
               $1::jsonb, $2::jsonb, $3::jsonb
             )`,
            [
              JSON.stringify(accessPayload(occurredAt, {
                id: lifecycleId(0),
                resourceId: lifecycleId(1),
                requestKey: lifecycleRequestKey,
              })),
              JSON.stringify(lifecycleCommand),
              JSON.stringify(selectionPayload(occurredAt)),
            ],
          ),
          /public web draft intake session unavailable/,
        );
      } finally {
        await client.query(`ROLLBACK TO SAVEPOINT draft_intake_user_${lifecycleCase.name}`);
        await client.query(`RELEASE SAVEPOINT draft_intake_user_${lifecycleCase.name}`);
      }
    }
    await client.query("SET LOCAL ROLE fas_public_web_executor");
    await rejectInSavepoint(
      client,
      "draft_intake_executor_direct_table_denied",
      () => client.query(
        `UPDATE public_web_draft_intake_receipts
         SET request_hash = $1 WHERE tenant_id = $2 AND id = $3`,
        [SHA_A, TENANT_ID, INTAKE_ID],
      ),
      /permission denied/,
    );

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
      `INSERT INTO role_definitions (
         id, key, display_name, purpose, principal_type, status
       ) VALUES ($1, 'public_web.draft_deny_fixture', 'Public Web Draft Deny Fixture',
         'Disposable deny verification', 'HUMAN', 'ACTIVE')`,
      [DENY_ROLE_DEFINITION_ID],
    );
    await client.query(
      `INSERT INTO role_package_versions (
         id, role_definition_id, version_number, status, default_scope_type,
         checksum, effective_at
       ) VALUES ($1, $2, 1, 'ACTIVE', 'ORGANIZATION', $3,
         now() - interval '1 day')`,
      [DENY_ROLE_PACKAGE_ID, DENY_ROLE_DEFINITION_ID, SHA_A],
    );
    await client.query(
      `INSERT INTO role_package_capabilities (
         role_package_version_id, capability_key, effect
       ) VALUES ($1, 'public_web.content.write', 'DENY')`,
      [DENY_ROLE_PACKAGE_ID],
    );
    await client.query(
      `INSERT INTO authorization_change_receipts (
         id, tenant_id, receipt_type, actor_principal_id, resource_type,
         actor_membership_id, resource_id, reason_code, correlation_id,
         evidence, receipt_hash
       ) VALUES ($1, $2, 'GRANT', $3, 'ACCESS_ASSIGNMENT', $4, $5,
         'fixture_deny', 'public-web-draft-deny-grant', '{}'::jsonb, $6)`,
      [
        DENY_GRANT_RECEIPT_ID, TENANT_ID, PRINCIPAL_ID, MEMBERSHIP_ID,
        DENY_ASSIGNMENT_ID, SHA_A,
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
        DENY_ASSIGNMENT_ID, TENANT_ID, MEMBERSHIP_ID, DENY_ROLE_PACKAGE_ID,
        ORGANIZATION_ID, PRINCIPAL_ID, MEMBERSHIP_ID, DENY_GRANT_RECEIPT_ID,
      ],
    );
    await client.query("SET LOCAL ROLE fas_public_web_executor");
    await rejectInSavepoint(
      client,
      "draft_intake_unclaimed_new_assignment",
      () => client.query(
        `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
           $1::jsonb, $2::jsonb, $3::jsonb
         )`,
        [
          JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
          JSON.stringify(selectionPayload(occurredAt)),
        ],
      ),
      /public web draft intake authority unavailable/,
    );
    const exactDenyAccess = accessPayload(occurredAt);
    exactDenyAccess.assignmentIds = [ASSIGNMENT_ID, DENY_ASSIGNMENT_ID];
    exactDenyAccess.rolePackageVersionIds = [ROLE_PACKAGE_ID, DENY_ROLE_PACKAGE_ID];
    await rejectInSavepoint(
      client,
      "draft_intake_exact_set_deny",
      () => client.query(
        `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
           $1::jsonb, $2::jsonb, $3::jsonb
         )`,
        [
          JSON.stringify(exactDenyAccess), JSON.stringify(command),
          JSON.stringify(selectionPayload(occurredAt)),
        ],
      ),
      /public web draft intake authority unavailable/,
    );
    await client.query("RESET ROLE");
    await client.query(
      "UPDATE access_assignments SET status = 'SUSPENDED' WHERE id = $1",
      [DENY_ASSIGNMENT_ID],
    );
    await client.query(
      "UPDATE access_assignments SET status = 'SUSPENDED' WHERE id = $1",
      [ASSIGNMENT_ID],
    );
    await client.query("SET LOCAL ROLE fas_public_web_executor");
    await rejectInSavepoint(
      client,
      "draft_intake_revoked_authority",
      () =>
        client.query(
          `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
             $1::jsonb, $2::jsonb, $3::jsonb
           )`,
          [
            JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
            JSON.stringify(selectionPayload(occurredAt)),
          ],
        ),
      /public web draft intake authority unavailable/,
    );

    await client.query("RESET ROLE");
    await client.query(
      "UPDATE access_assignments SET status = 'ACTIVE' WHERE id = $1",
      [ASSIGNMENT_ID],
    );
    await client.query(
      `UPDATE active_session_context_selections
       SET status = 'ROTATED', termination_reason = 'SELF_SWITCH',
           row_version = row_version + 1
       WHERE id = $1`,
      [SELECTION_ID],
    );
    await client.query(
      `INSERT INTO active_session_context_selections (
         id, tenant_id, session_fingerprint, session_generation,
         legacy_user_id, principal_id, membership_id, organization_id,
         legacy_branch_id, status, previous_selection_id
       ) VALUES ($1, $2, $3, 2, $4, $5, $6, $7, NULL, 'ACTIVE', $8)`,
      [
        NEXT_SELECTION_ID, TENANT_ID, SESSION_FINGERPRINT, actorLegacyUserId,
        PRINCIPAL_ID, MEMBERSHIP_ID, ORGANIZATION_ID, SELECTION_ID,
      ],
    );
    await client.query("SET LOCAL ROLE fas_public_web_executor");
    await rejectInSavepoint(
      client,
      "draft_intake_rotated_selection",
      () => client.query(
        `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
           $1::jsonb, $2::jsonb, $3::jsonb
         )`,
        [
          JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
          JSON.stringify(selectionPayload(occurredAt)),
        ],
      ),
      /public web draft intake active selection unavailable/,
    );
    const currentSelection = selectionPayload(occurredAt, {
      selectionId: NEXT_SELECTION_ID,
      sessionGeneration: 2,
    });
    const currentReplay = await client.query<{ result: Record<string, unknown> }>(
      `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
         $1::jsonb, $2::jsonb, $3::jsonb
       ) AS result`,
      [
        JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
        JSON.stringify(currentSelection),
      ],
    );
    assert.equal(currentReplay.rows[0]?.result.outcome, "REPLAY");

    await client.query("RESET ROLE");
    await client.query("SAVEPOINT draft_intake_deleted_session");
    await client.query("DELETE FROM sessions WHERE sid = $1", [SESSION_ID]);
    await client.query("SET LOCAL ROLE fas_public_web_executor");
    await assert.rejects(
      client.query(
        `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
           $1::jsonb, $2::jsonb, $3::jsonb
         )`,
        [
          JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
          JSON.stringify(currentSelection),
        ],
      ),
      /public web draft intake session unavailable/,
    );
    await client.query("ROLLBACK TO SAVEPOINT draft_intake_deleted_session");
    await client.query("RESET ROLE");
    await client.query(
      `UPDATE active_session_context_selections
       SET status = 'REVOKED', termination_reason = 'SECURITY_REVOKE',
           row_version = row_version + 1
       WHERE id = $1`,
      [NEXT_SELECTION_ID],
    );
    await client.query("SET LOCAL ROLE fas_public_web_executor");
    await rejectInSavepoint(
      client,
      "draft_intake_revoked_selection",
      () => client.query(
        `SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(
           $1::jsonb, $2::jsonb, $3::jsonb
         )`,
        [
          JSON.stringify(accessPayload(occurredAt)), JSON.stringify(command),
          JSON.stringify(currentSelection),
        ],
      ),
      /public web draft intake active selection unavailable/,
    );

    const directRead = await client.query(
      `SELECT has_table_privilege(
         current_user, 'public.public_web_draft_intake_receipts', 'SELECT'
       ) AS allowed`,
    );
    assert.equal(directRead.rows[0]?.allowed, false);
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
});
