import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  hashPublicWebDraftIntakeCommand,
  hashPublicWebDraftRevision,
  type AuthorizedPublicWebDraftIntakeCommand,
  type PublicWebDraftIntakeCommand,
} from "../src/lib/publicWebDraftIntakeCommand.js";
import { PostgresPublicWebDraftIntakeStore } from "../src/lib/postgresPublicWebDraftIntakeStore.js";

const ID = {
  tenant: "018fa300-0000-7000-8000-000000000001",
  organization: "018fa300-0000-7000-8000-000000000002",
  content: "018fa300-0000-7000-8000-000000000003",
  revision: "018fa300-0000-7000-8000-000000000004",
  context: "018fa300-0000-7000-8000-000000000005",
  principal: "018fa300-0000-7000-8000-000000000006",
  membership: "018fa300-0000-7000-8000-000000000007",
  assignment: "018fa300-0000-7000-8000-000000000008",
  packageVersion: "018fa300-0000-7000-8000-000000000009",
  policy: "018fa300-0000-7000-8000-00000000000a",
  access: "018fa300-0000-7000-8000-00000000000b",
  route: "018fa300-0000-7000-8000-00000000000c",
  intake: "018fa300-0000-7000-8000-00000000000d",
  selection: "018fa300-0000-7000-8000-00000000000e",
} as const;

const NOW = 1_791_360_000_000;
const SESSION_ID = "3".repeat(64);
const SESSION_FINGERPRINT = crypto.createHash("sha256").update(SESSION_ID, "utf8").digest("hex");

function authorizedFixture(): AuthorizedPublicWebDraftIntakeCommand {
  const draft = {
    tenantId: ID.tenant,
    organizationId: ID.organization,
    contentRecordId: ID.content,
    revisionId: ID.revision,
    entityType: "CITY" as const,
    entityId: 17,
    locale: "en" as const,
    canonicalSlug: "test-city",
    canonicalPath: "/en/cities/test-city-17",
    origin: "HUMAN" as const,
    title: "Test City",
    summary: null,
    contentJson: { body: "Draft city guide" },
    seoJson: {},
    structuredDataJson: { "@type": "City" },
    sourceSha256: "a".repeat(64),
    contentSha256: "",
    generatorReceiptSha256: null,
    idempotencyKey: "public-web.draft.store-1",
  };
  const command: PublicWebDraftIntakeCommand = {
    ...draft,
    contentSha256: hashPublicWebDraftRevision(draft),
  };
  return {
    command,
    capabilityKey: "public_web.content.write",
    requestHash: hashPublicWebDraftIntakeCommand(command),
    decisionReceipt: {
      tenantId: ID.tenant,
      contextId: ID.context,
      actorPrincipalId: ID.principal,
      membershipId: ID.membership,
      assignmentIds: [ID.assignment],
      rolePackageVersionIds: [ID.packageVersion],
      capabilityKey: "public_web.content.write",
      resourceType: "PUBLIC_WEB_CONTENT",
      resourceId: ID.content,
      decision: "ALLOW",
      reasonCode: "allowed",
      policyVersionId: ID.policy,
    },
    executionBinding: {
      contextId: ID.context,
      contextIssuedAt: NOW - 1_000,
      contextExpiresAt: NOW + 60_000,
      sessionId: SESSION_ID,
      sessionFingerprint: SESSION_FINGERPRINT,
      selectionId: ID.selection,
      sessionGeneration: 1,
    },
  };
}

function fakePool(options: {
  identityRole?: string;
  identityOverrides?: Partial<{
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolinherit: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    rolcanlogin: boolean;
    has_role_membership: boolean;
    can_execute_v2: boolean;
    can_execute_v1: boolean;
    can_execute_authority_helper: boolean;
    can_execute_source_internal: boolean;
    can_execute_source_locked: boolean;
    can_create_public_schema: boolean;
    can_create_facade_schema: boolean;
    has_critical_table_dml: boolean;
  }>;
  failFirstApply?: boolean;
  malformedResult?: boolean;
  replayResult?: boolean;
  replayAfterFirstApply?: boolean;
  sourceChanged?: boolean;
} = {}) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const releases: Array<unknown> = [];
  let applyCount = 0;
  const client = {
    async query<T extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes("FROM pg_roles")) {
        return { rows: [{
          current_user: options.identityRole ?? "fas_public_web_executor",
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolinherit: false,
          rolreplication: false,
          rolbypassrls: false,
          rolcanlogin: true,
          has_role_membership: false,
          can_execute_v2: true,
          can_execute_v1: false,
          can_execute_authority_helper: false,
          can_execute_source_internal: false,
          can_execute_source_locked: false,
          can_create_public_schema: false,
          can_create_facade_schema: false,
          has_critical_table_dml: false,
          tenant_setting: null,
          organization_setting: null,
          ...options.identityOverrides,
        }], rowCount: 1 } as unknown as { rows: T[]; rowCount: number };
      }
      if (text.includes("set_config('app.tenant_id'")) {
        return ({
          rows: [{ tenant_id: ID.tenant, organization_id: ID.organization }],
          rowCount: 1,
        } as unknown as { rows: T[]; rowCount: number });
      }
      if (text.includes("apply_authorized_draft_intake")) {
        applyCount += 1;
        if (options.sourceChanged) {
          throw Object.assign(
            new Error("public web draft intake source changed"),
            { code: "40001" },
          );
        }
        if (options.failFirstApply && applyCount === 1) {
          throw Object.assign(new Error("serialization"), { code: "40001" });
        }
        return { rows: [{ result: options.malformedResult ? { outcome: "APPLIED" } : {
          outcome: options.replayResult || (options.replayAfterFirstApply && applyCount > 1)
            ? "REPLAY" : "APPLIED",
          intakeReceiptId: options.replayResult || (options.replayAfterFirstApply && applyCount > 1)
            ? "018fa300-0000-7000-8000-000000000021"
            : ID.intake,
          contentRecordId: options.replayResult || (options.replayAfterFirstApply && applyCount > 1)
            ? "018fa300-0000-7000-8000-000000000022"
            : ID.content,
          revisionId: options.replayResult || (options.replayAfterFirstApply && applyCount > 1)
            ? "018fa300-0000-7000-8000-000000000023"
            : ID.revision,
          status: "DRAFT",
          indexState: "NOINDEX",
          version: 1,
        } }], rowCount: 1 } as unknown as { rows: T[]; rowCount: number };
      }
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
    release(error?: unknown) { releases.push(error); },
  };
  return { pool: { connect: async () => client } as never, queries, releases };
}

function store(
  fixture: ReturnType<typeof fakePool>,
  mode = "all",
  ids = [ID.access, ID.route, ID.intake],
) {
  return new PostgresPublicWebDraftIntakeStore({
    pool: fixture.pool,
    config: { mode, tenantAllowlist: undefined },
    expectedRole: "fas_public_web_executor",
    now: () => NOW,
    newUuidV7: () => ids.shift() ?? ID.intake,
  });
}

test("concurrent same-key callers preserve one scoped key and accept durable replay identity", async () => {
  const fixture = fakePool({ replayAfterFirstApply: true });
  const instance = store(fixture, "all", [
    ID.access, ID.route, ID.intake,
    "018fa300-0000-7000-8000-000000000031",
    "018fa300-0000-7000-8000-000000000032",
    "018fa300-0000-7000-8000-000000000033",
  ]);
  const results = await Promise.all([
    instance.execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 }),
    instance.execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 }),
  ]);
  assert.deepEqual(results.map(({ outcome }) => outcome).sort(), ["APPLIED", "REPLAY"]);
  const calls = fixture.queries.filter(({ text }) =>
    text.includes("SELECT fas_public_web_v1.apply_authorized_draft_intake_v2("));
  assert.equal(calls.length, 2);
  const firstCommand = JSON.parse(String(calls[0]?.values?.[1]));
  const secondCommand = JSON.parse(String(calls[1]?.values?.[1]));
  assert.equal(firstCommand.requestKey, secondCommand.requestKey);
  assert.deepEqual(calls[0]?.values?.[2], calls[1]?.values?.[2]);
});

test("scopes request keys to tenant, organization, principal and membership", async () => {
  const firstFixture = fakePool();
  const secondFixture = fakePool();
  const first = authorizedFixture();
  const second = authorizedFixture();
  second.decisionReceipt = {
    ...second.decisionReceipt,
    actorPrincipalId: "018fa300-0000-7000-8000-000000000041",
    membershipId: "018fa300-0000-7000-8000-000000000042",
  };
  await store(firstFixture).execute({ authorized: first, actorLegacyUserId: 42 });
  await store(secondFixture).execute({ authorized: second, actorLegacyUserId: 42 });
  const firstCall = firstFixture.queries.find(({ text }) =>
    text.includes("SELECT fas_public_web_v1.apply_authorized_draft_intake_v2("));
  const secondCall = secondFixture.queries.find(({ text }) =>
    text.includes("SELECT fas_public_web_v1.apply_authorized_draft_intake_v2("));
  const firstCommand = JSON.parse(String(firstCall?.values?.[1]));
  const secondCommand = JSON.parse(String(secondCall?.values?.[1]));
  assert.notEqual(firstCommand.requestKey, secondCommand.requestKey);
});

test("executes one authorized DRAFT+NOINDEX intake with bound scope", async () => {
  const fixture = fakePool();
  const result = await store(fixture).execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 });
  assert.deepEqual(result, {
    outcome: "APPLIED",
    intakeReceiptId: ID.intake,
    contentRecordId: ID.content,
    revisionId: ID.revision,
    status: "DRAFT",
    indexState: "NOINDEX",
    version: 1,
  });
  const apply = fixture.queries.find(({ text }) =>
    text.includes("SELECT fas_public_web_v1.apply_authorized_draft_intake_v2("));
  assert.ok(apply);
  const access = JSON.parse(String(apply.values?.[0]));
  const command = JSON.parse(String(apply.values?.[1]));
  const selection = JSON.parse(String(apply.values?.[2]));
  assert.match(access.correlationId, /^pwd2:[0-9a-f]{64}$/);
  assert.equal(access.correlationId, command.requestKey);
  assert.notEqual(access.correlationId, "public-web.draft.store-1");
  assert.equal(command.requestHash, authorizedFixture().requestHash);
  assert.equal(command.entityType, "CITY");
  assert.deepEqual(selection, authorizedFixture().executionBinding);
  assert.equal(fixture.queries.some(({ text }) => text === "BEGIN ISOLATION LEVEL SERIALIZABLE"), true);
  assert.equal(fixture.queries.filter(({ text }) => text === "COMMIT").length, 1);
  const identityProbe = fixture.queries.find(({ text }) => text.includes("FROM pg_roles"));
  assert.equal(identityProbe?.values?.length, 1);
  const criticalRelations = identityProbe?.values?.[0];
  assert.ok(Array.isArray(criticalRelations));
  assert.equal(criticalRelations.length, new Set(criticalRelations).size);
  assert.deepEqual(
    [
      "public.users",
      "public.public_web_draft_intake_receipts",
      "public.programs",
      "public.website_blog_posts",
    ].every((relation) => criticalRelations.includes(relation)),
    true,
  );
  assert.equal(JSON.stringify(identityProbe).includes(SESSION_ID), false);
});

test("retries serialization with stable internal receipt identities", async () => {
  const fixture = fakePool({ failFirstApply: true });
  await store(fixture).execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 });
  const calls = fixture.queries.filter(({ text }) =>
    text.includes("SELECT fas_public_web_v1.apply_authorized_draft_intake_v2("));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.values, calls[1]?.values);
  assert.equal(fixture.queries.filter(({ text }) => text === "ROLLBACK").length, 1);
  assert.equal(fixture.queries.filter(({ text }) => text === "COMMIT").length, 1);
});

test("does not retry a semantic source-change conflict", async () => {
  const fixture = fakePool({ sourceChanged: true });
  await assert.rejects(
    store(fixture).execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 }),
    /source changed/,
  );
  const calls = fixture.queries.filter(({ text }) =>
    text.includes("SELECT fas_public_web_v1.apply_authorized_draft_intake_v2("));
  assert.equal(calls.length, 1);
  assert.equal(fixture.queries.filter(({ text }) => text === "ROLLBACK").length, 1);
  assert.equal(fixture.queries.some(({ text }) => text === "COMMIT"), false);
});

test("returns persisted identities for a durable database replay", async () => {
  const fixture = fakePool({ replayResult: true });
  const result = await store(fixture).execute({
    authorized: authorizedFixture(),
    actorLegacyUserId: 42,
  });
  assert.deepEqual(result, {
    outcome: "REPLAY",
    intakeReceiptId: "018fa300-0000-7000-8000-000000000021",
    contentRecordId: "018fa300-0000-7000-8000-000000000022",
    revisionId: "018fa300-0000-7000-8000-000000000023",
    status: "DRAFT",
    indexState: "NOINDEX",
    version: 1,
  });
  assert.equal(fixture.queries.filter(({ text }) => text === "COMMIT").length, 1);
});

test("fails before SQL for disabled rollout and tampered authorization", async () => {
  const disabled = fakePool();
  await assert.rejects(
    store(disabled, "off").execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 }),
    /rollout_mode_off/,
  );
  assert.equal(disabled.queries.length, 0);

  const tampered = authorizedFixture();
  tampered.requestHash = "f".repeat(64);
  const denied = fakePool();
  await assert.rejects(
    store(denied).execute({ authorized: tampered, actorLegacyUserId: 42 }),
    /authorization_invalid/,
  );
  assert.equal(denied.queries.length, 0);
});

test("rejects wrong executor identity and malformed database results", async () => {
  const wrongRole = fakePool({ identityRole: "fas_migrator" });
  await assert.rejects(
    store(wrongRole).execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 }),
    /executor_identity_invalid/,
  );
  assert.equal(wrongRole.queries.some(({ text }) => text.startsWith("BEGIN")), false);

  const malformed = fakePool({ malformedResult: true });
  await assert.rejects(
    store(malformed).execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 }),
    /result_invalid/,
  );
  assert.equal(malformed.queries.filter(({ text }) => text === "ROLLBACK").length, 1);
  assert.equal(malformed.queries.some(({ text }) => text === "COMMIT"), false);
});

test("rejects privileged, inheriting, non-login, or member executor identities", async () => {
  const invalidIdentities = [
    { rolsuper: true },
    { rolcreatedb: true },
    { rolcreaterole: true },
    { rolinherit: true },
    { rolreplication: true },
    { rolbypassrls: true },
    { rolcanlogin: false },
    { has_role_membership: true },
    { can_execute_v2: false },
    { can_execute_v1: true },
    { can_execute_authority_helper: true },
    { can_execute_source_internal: true },
    { can_execute_source_locked: true },
    { can_create_public_schema: true },
    { can_create_facade_schema: true },
    { has_critical_table_dml: true },
  ] as const;

  for (const identityOverrides of invalidIdentities) {
    const fixture = fakePool({ identityOverrides });
    await assert.rejects(
      store(fixture).execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 }),
      /executor_identity_invalid/,
    );
    assert.equal(fixture.queries.some(({ text }) => text.startsWith("BEGIN")), false);
    assert.equal(
      fixture.queries.some(({ text }) =>
        text.includes("SELECT fas_public_web_v1.apply_authorized_draft_intake_v2(")),
      false,
    );
  }
});
