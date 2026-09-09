import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { PostgresPublicWebDraftSourceResolver } from "../src/lib/postgresPublicWebDraftSourceResolver.js";

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
    "Public Web source resolver integration requires a named disposable loopback database",
  );
}

const EXECUTOR_ROLE = "fas_public_web_executor";
const PROGRAM_COLUMNS = [
  "id",
  "university_id",
  "name",
  "description",
  "degree",
  "field",
  "language",
  "duration",
  "tuition_fee",
  "currency",
  "scholarship",
  "intakes",
  "requirements",
  "application_fee",
  "advanced_fee",
  "deposit_fee",
  "discounted_fee",
  "language_fee",
  "min_gpa",
  "min_language_score",
  "quota",
  "is_active",
  "updated_at",
].join(", ");

test("draft source resolver executes with a temporary column-limited reader role", async () => {
  const client = new Client({
    connectionString: ADMIN_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "fasos-public-web-source-resolver-integration",
  });
  let roleCreated = false;
  let universityId: number | null = null;
  let programId: number | null = null;
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
    const existingRole = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [EXECUTOR_ROLE],
    );
    assert.equal(
      existingRole.rowCount,
      0,
      "disposable test database must not contain a prewired public-web executor",
    );
    await client.query(
      `CREATE ROLE fas_public_web_executor LOGIN NOSUPERUSER NOCREATEDB
       NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
    );
    roleCreated = true;
    await client.query("GRANT USAGE ON SCHEMA public TO fas_public_web_executor");
    await client.query(
      `GRANT SELECT (${PROGRAM_COLUMNS}) ON TABLE programs
       TO fas_public_web_executor`,
    );
    await client.query(
      `GRANT SELECT (id, is_active) ON TABLE universities
       TO fas_public_web_executor`,
    );
    const university = await client.query<{ id: number }>(
      `INSERT INTO universities (name, country, is_active, status)
       VALUES ('Draft Resolver Fixture University', 'Testland', true, 'open')
       RETURNING id`,
    );
    universityId = Number(university.rows[0]?.id);
    const program = await client.query<{ id: number }>(
      `INSERT INTO programs (
         university_id, name, description, degree, field, language,
         tuition_fee, currency, is_active
       ) VALUES ($1, 'Draft Resolver Fixture Programme', 'Verified source',
         'BSc', 'Computer Science', 'English', 12000, 'USD', true)
       RETURNING id`,
      [universityId],
    );
    programId = Number(program.rows[0]?.id);
    assert.ok(Number.isSafeInteger(programId));

    await client.query("SET ROLE fas_public_web_executor");
    const resolver = new PostgresPublicWebDraftSourceResolver({
      pool: {
        connect: async () => ({
          query: client.query.bind(client),
          release: () => undefined,
        }),
      } as never,
    });
    const source = await resolver.resolve("PROGRAM", programId);
    assert.equal(source?.entityType, "PROGRAM");
    assert.equal(source?.entityId, programId);
    assert.match(source?.sourceSha256 ?? "", /^[0-9a-f]{64}$/);
    assert.equal(await resolver.resolve("PROGRAM", 2_147_483_647), null);
    await client.query("RESET ROLE");

    await client.query("UPDATE programs SET is_active = false WHERE id = $1", [
      programId,
    ]);
    await client.query("SET ROLE fas_public_web_executor");
    assert.equal(await resolver.resolve("PROGRAM", programId), null);
    await client.query("RESET ROLE");
  } finally {
    try {
      await client.query("RESET ROLE");
    } catch {
      // The connection may already be closed after an infrastructure failure.
    }
    if (programId !== null) {
      await client.query("DELETE FROM programs WHERE id = $1", [programId]);
    }
    if (universityId !== null) {
      await client.query("DELETE FROM universities WHERE id = $1", [universityId]);
    }
    if (roleCreated) {
      await client.query(
        "REVOKE ALL PRIVILEGES ON TABLE programs, universities FROM fas_public_web_executor",
      );
      await client.query(
        "REVOKE ALL PRIVILEGES ON SCHEMA public FROM fas_public_web_executor",
      );
      await client.query("DROP ROLE fas_public_web_executor");
    }
    await client.end();
  }
});
