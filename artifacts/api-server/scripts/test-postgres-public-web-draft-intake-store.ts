import assert from "node:assert/strict";
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
} as const;

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
  };
}

function fakePool(options: {
  identityRole?: string;
  failFirstApply?: boolean;
  malformedResult?: boolean;
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
          rolbypassrls: false,
          tenant_setting: null,
          organization_setting: null,
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
        if (options.failFirstApply && applyCount === 1) {
          throw Object.assign(new Error("serialization"), { code: "40001" });
        }
        return { rows: [{ result: options.malformedResult ? { outcome: "APPLIED" } : {
          outcome: "APPLIED",
          intakeReceiptId: ID.intake,
          contentRecordId: ID.content,
          revisionId: ID.revision,
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

function store(fixture: ReturnType<typeof fakePool>, mode = "all") {
  const ids = [ID.access, ID.route, ID.intake];
  return new PostgresPublicWebDraftIntakeStore({
    pool: fixture.pool,
    config: { mode, tenantAllowlist: undefined },
    expectedRole: "fas_public_web_executor",
    now: () => 1_791_360_000_000,
    newUuidV7: () => ids.shift() ?? ID.intake,
  });
}

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
  const apply = fixture.queries.find(({ text }) => text.includes("apply_authorized_draft_intake"));
  assert.ok(apply);
  const access = JSON.parse(String(apply.values?.[0]));
  const command = JSON.parse(String(apply.values?.[1]));
  assert.equal(access.correlationId, "public-web.draft.store-1");
  assert.equal(command.requestHash, authorizedFixture().requestHash);
  assert.equal(command.entityType, "CITY");
  assert.equal(fixture.queries.filter(({ text }) => text === "COMMIT").length, 1);
});

test("retries serialization with stable internal receipt identities", async () => {
  const fixture = fakePool({ failFirstApply: true });
  await store(fixture).execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 });
  const calls = fixture.queries.filter(({ text }) => text.includes("apply_authorized_draft_intake"));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.values, calls[1]?.values);
  assert.equal(fixture.queries.filter(({ text }) => text === "ROLLBACK").length, 1);
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
