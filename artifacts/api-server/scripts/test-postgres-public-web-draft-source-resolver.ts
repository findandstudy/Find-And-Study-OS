import assert from "node:assert/strict";
import test from "node:test";

import { PostgresPublicWebDraftSourceResolver } from "../src/lib/postgresPublicWebDraftSourceResolver.js";

function fakePool(options: {
  identityRole?: string;
  rows?: Array<Record<string, unknown>>;
  sourceError?: Error;
} = {}) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const releases: unknown[] = [];
  const client = {
    async query<T extends Record<string, unknown>>(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (text.includes("FROM pg_roles")) {
        return {
          rows: [{
            current_user: options.identityRole ?? "fas_public_web_executor",
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolinherit: false,
            rolreplication: false,
            rolbypassrls: false,
            rolcanlogin: true,
            has_role_membership: false,
            tenant_setting: null,
            organization_setting: null,
          }],
          rowCount: 1,
        } as unknown as { rows: T[]; rowCount: number };
      }
      if (text.includes("FROM programs program")) {
        if (options.sourceError) throw options.sourceError;
        const rows = options.rows ?? [{
          id: 42,
          university_id: 7,
          name: "Computer Science",
          description: "Verified source",
          updated_at: "2026-09-09T00:00:00.000Z",
        }];
        return { rows, rowCount: rows.length } as unknown as {
          rows: T[];
          rowCount: number;
        };
      }
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
    release(error?: unknown) { releases.push(error); },
  };
  return { pool: { connect: async () => client } as never, queries, releases };
}

test("resolves one active source through a bounded read-only query", async () => {
  const fixture = fakePool();
  const resolver = new PostgresPublicWebDraftSourceResolver({ pool: fixture.pool });
  const first = await resolver.resolve("PROGRAM", 42);
  assert.deepEqual(first, {
    entityType: "PROGRAM",
    entityId: 42,
    sourceSha256: first?.sourceSha256,
  });
  assert.match(first?.sourceSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.equal(fixture.queries.some(({ text }) => text === "BEGIN READ ONLY"), true);
  assert.equal(fixture.queries.some(({ text }) => text === "COMMIT"), true);
  const source = fixture.queries.find(({ text }) => text.includes("FROM programs program"));
  assert.deepEqual(source?.values, [42]);
  assert.match(source?.text ?? "", /octet_length/);
  assert.doesNotMatch(
    source?.text ?? "",
    /service_fee_amount|commission_rate|contact_person|assigned_staff_ids/i,
  );
});

test("source hashes are deterministic and change with allowed source facts", async () => {
  const a = await new PostgresPublicWebDraftSourceResolver({
    pool: fakePool().pool,
  }).resolve("PROGRAM", 42);
  const b = await new PostgresPublicWebDraftSourceResolver({
    pool: fakePool().pool,
  }).resolve("PROGRAM", 42);
  const changed = await new PostgresPublicWebDraftSourceResolver({
    pool: fakePool({ rows: [{
      id: 42,
      university_id: 7,
      name: "Computer Science",
      description: "Changed source",
      updated_at: "2026-09-09T00:00:00.000Z",
    }] }).pool,
  }).resolve("PROGRAM", 42);
  assert.equal(a?.sourceSha256, b?.sourceSha256);
  assert.notEqual(a?.sourceSha256, changed?.sourceSha256);
});

test("missing and invalid source references fail closed", async () => {
  const missing = new PostgresPublicWebDraftSourceResolver({
    pool: fakePool({ rows: [] }).pool,
  });
  assert.equal(await missing.resolve("PROGRAM", 42), null);
  await assert.rejects(missing.resolve("PROGRAM", 0), /source_input_invalid/);
  await assert.rejects(
    missing.resolve("UNKNOWN" as "PROGRAM", 42),
    /source_input_invalid/,
  );
});

test("wrong executor and query failures cannot leak a dirty pooled transaction", async () => {
  const wrongRole = fakePool({ identityRole: "fas_migrator" });
  await assert.rejects(
    new PostgresPublicWebDraftSourceResolver({ pool: wrongRole.pool }).resolve(
      "PROGRAM",
      42,
    ),
    /executor_identity_invalid/,
  );
  assert.equal(wrongRole.queries.some(({ text }) => text === "BEGIN READ ONLY"), false);

  const failed = fakePool({ sourceError: new Error("database unavailable") });
  await assert.rejects(
    new PostgresPublicWebDraftSourceResolver({ pool: failed.pool }).resolve(
      "PROGRAM",
      42,
    ),
    /database unavailable/,
  );
  assert.equal(failed.queries.some(({ text }) => text === "ROLLBACK"), true);
  assert.equal(failed.releases.length, 1);
});
