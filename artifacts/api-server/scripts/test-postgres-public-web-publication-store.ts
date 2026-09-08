import assert from "node:assert/strict";
import test from "node:test";

import {
  hashPublicWebPublicationCommand,
  type AuthorizedPublicWebPublicationCommand,
  type PublicWebPublicationCommand,
} from "../src/lib/publicWebPublicationCommand.js";
import { PostgresPublicWebPublicationStore } from "../src/lib/postgresPublicWebPublicationStore.js";

const ID = {
  tenant: "018f8300-0000-7000-8000-000000000001",
  organization: "018f8300-0000-7000-8000-000000000002",
  content: "018f8300-0000-7000-8000-000000000003",
  revision: "018f8300-0000-7000-8000-000000000004",
  context: "018f8300-0000-7000-8000-000000000005",
  principal: "018f8300-0000-7000-8000-000000000006",
  membership: "018f8300-0000-7000-8000-000000000007",
  assignment: "018f8300-0000-7000-8000-000000000008",
  packageVersion: "018f8300-0000-7000-8000-000000000009",
  policy: "018f8300-0000-7000-8000-00000000000a",
  access: "018f8300-0000-7000-8000-00000000000b",
  publication: "018f8300-0000-7000-8000-00000000000c",
} as const;

function authorizedFixture(): AuthorizedPublicWebPublicationCommand {
  const command: PublicWebPublicationCommand = {
    type: "PUBLISH",
    tenantId: ID.tenant,
    organizationId: ID.organization,
    contentRecordId: ID.content,
    revisionId: ID.revision,
    expectedVersion: 3,
    idempotencyKey: "public-web.publish.test-1",
    evidenceSha256: "a".repeat(64),
    staleReasonCode: null,
  };
  return {
    command,
    capabilityKey: "public_web.content.publish",
    requestHash: hashPublicWebPublicationCommand(command),
    decisionReceipt: {
      tenantId: ID.tenant,
      contextId: ID.context,
      actorPrincipalId: ID.principal,
      membershipId: ID.membership,
      assignmentIds: [ID.assignment],
      rolePackageVersionIds: [ID.packageVersion],
      capabilityKey: "public_web.content.publish",
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
        return {
          rows: [{
            current_user: options.identityRole ?? "fas_public_web_executor",
            rolsuper: false,
            rolbypassrls: false,
            tenant_setting: null,
            organization_setting: null,
          }],
          rowCount: 1,
        } as unknown as { rows: T[]; rowCount: number };
      }
      if (text.includes("set_config('app.tenant_id'")) {
        return {
          rows: [{ tenant_id: ID.tenant, organization_id: ID.organization }],
          rowCount: 1,
        } as unknown as { rows: T[]; rowCount: number };
      }
      if (text.includes("apply_authorized_publication_command")) {
        applyCount += 1;
        if (options.failFirstApply && applyCount === 1) {
          throw Object.assign(new Error("serialization"), { code: "40001" });
        }
        return {
          rows: [{ result: options.malformedResult ? { outcome: "APPLIED" } : {
            outcome: "APPLIED",
            publicationReceiptId: ID.publication,
            status: "PUBLISHED",
            indexState: "NOINDEX",
            version: 4,
          } }],
          rowCount: 1,
        } as unknown as { rows: T[]; rowCount: number };
      }
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
    release(error?: unknown) {
      releases.push(error);
    },
  };
  return {
    pool: { connect: async () => client } as never,
    queries,
    releases,
  };
}

function store(fixture: ReturnType<typeof fakePool>, mode = "all") {
  const ids = [ID.access, ID.publication];
  return new PostgresPublicWebPublicationStore({
    pool: fixture.pool,
    config: { mode, tenantAllowlist: undefined },
    expectedRole: "fas_public_web_executor",
    now: () => 1_791_360_000_000,
    newUuidV7: () => ids.shift() ?? ID.publication,
  });
}

test("executes an authorized command with clean executor identity and bound scope", async () => {
  const fixture = fakePool();
  const result = await store(fixture).execute({
    authorized: authorizedFixture(),
    actorLegacyUserId: 42,
  });
  assert.deepEqual(result, {
    outcome: "APPLIED",
    publicationReceiptId: ID.publication,
    status: "PUBLISHED",
    indexState: "NOINDEX",
    version: 4,
  });
  assert.ok(fixture.queries.some(({ text }) => text === "BEGIN ISOLATION LEVEL READ COMMITTED"));
  assert.ok(fixture.queries.some(({ text }) => text.includes("app.organization_id")));
  const apply = fixture.queries.find(({ text }) => text.includes("apply_authorized_publication_command"));
  assert.ok(apply);
  assert.equal(JSON.parse(String(apply.values?.[0])).correlationId, "public-web.publish.test-1");
  assert.equal(JSON.parse(String(apply.values?.[1])).requestHash, authorizedFixture().requestHash);
  assert.equal(fixture.queries.filter(({ text }) => text === "COMMIT").length, 1);
  assert.deepEqual(fixture.releases, [undefined]);
});

test("retries serialization with stable receipt identities", async () => {
  const fixture = fakePool({ failFirstApply: true });
  await store(fixture).execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 });
  const calls = fixture.queries.filter(({ text }) => text.includes("apply_authorized_publication_command"));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.values, calls[1]?.values);
  assert.equal(fixture.queries.filter(({ text }) => text === "ROLLBACK").length, 1);
  assert.equal(fixture.queries.filter(({ text }) => text === "COMMIT").length, 1);
});

test("fails closed for disabled rollout, tampered authorization and wrong executor", async () => {
  const disabledFixture = fakePool();
  await assert.rejects(
    store(disabledFixture, "off").execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 }),
    /rollout_mode_off/,
  );
  assert.equal(disabledFixture.queries.length, 0);

  const tamperedFixture = fakePool();
  const tampered = authorizedFixture();
  tampered.requestHash = "f".repeat(64);
  await assert.rejects(
    store(tamperedFixture).execute({ authorized: tampered, actorLegacyUserId: 42 }),
    /authorization_invalid/,
  );
  assert.equal(tamperedFixture.queries.length, 0);

  const wrongRoleFixture = fakePool({ identityRole: "fas_migrator" });
  await assert.rejects(
    store(wrongRoleFixture).execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 }),
    /executor_identity_invalid/,
  );
  assert.equal(wrongRoleFixture.queries.some(({ text }) => text.startsWith("BEGIN")), false);
});

test("rejects malformed database results and rolls back", async () => {
  const fixture = fakePool({ malformedResult: true });
  await assert.rejects(
    store(fixture).execute({ authorized: authorizedFixture(), actorLegacyUserId: 42 }),
    /result_invalid/,
  );
  assert.equal(fixture.queries.filter(({ text }) => text === "ROLLBACK").length, 1);
  assert.equal(fixture.queries.some(({ text }) => text === "COMMIT"), false);
});
