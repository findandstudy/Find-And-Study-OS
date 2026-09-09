import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";

import { PostgresPublicWebDraftSourceResolver } from "../src/lib/postgresPublicWebDraftSourceResolver.js";

const { Client, Pool } = pg;
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
const REPLAY_HARDENING_SQL = readFileSync(
  new URL("../../../lib/db/drizzle/0123_public_web_draft_intake_replay_hardening.sql", import.meta.url),
  "utf8",
);

async function waitForApplicationConnectionsToClose(
  client: InstanceType<typeof Client>,
  applicationName: string,
): Promise<string> {
  let count = "-1";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND application_name = $1`,
      [applicationName],
    );
    count = result.rows[0]?.count ?? "-1";
    if (count === "0") return count;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return count;
}

test("draft source resolver executes with a temporary column-limited reader role", async () => {
  const client = new Client({
    connectionString: ADMIN_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "fasos-public-web-source-resolver-integration",
  });
  let installedByTest = false;
  let roleCreated = false;
  let universityId: number | null = null;
  let programId: number | null = null;
  let executorPool: InstanceType<typeof Pool> | null = null;
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
    const installed = await client.query<{ installed: boolean }>(
      `SELECT to_regprocedure(
         'fas_public_web_v1.resolve_source_sha256(text,integer)'
       ) IS NOT NULL AS installed`,
    );
    if (installed.rows[0]?.installed !== true) {
      await client.query(REPLAY_HARDENING_SQL);
      installedByTest = true;
    }
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
      "GRANT USAGE ON SCHEMA fas_public_web_v1 TO fas_public_web_executor",
    );
    await client.query(
      `GRANT EXECUTE ON FUNCTION
         fas_public_web_v1.resolve_source_sha256(text, integer)
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

    await assert.rejects(
      client.query(
        `SELECT fas_public_web_v1.resolve_source_sha256_internal(
           'PROGRAM', $1::integer, NULL::boolean
         )`,
        [programId],
      ),
      /invalid public web source reference/,
    );

    await client.query("SET ROLE fas_public_web_executor");
    await assert.rejects(
      client.query(
        `SELECT fas_public_web_v1.resolve_source_sha256(
           NULL::text, $1::integer
         )`,
        [programId],
      ),
      /invalid public web source reference/,
    );
    await assert.rejects(
      client.query(
        `SELECT fas_public_web_v1.resolve_source_sha256(
           'PROGRAM', NULL::integer
         )`,
      ),
      /invalid public web source reference/,
    );
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
    const directTablePrivilege = await client.query(
      `SELECT has_table_privilege(current_user, 'public.programs', 'SELECT')
         AS programs_select,
              has_table_privilege(current_user, 'public.universities', 'SELECT')
         AS universities_select`,
    );
    assert.deepEqual(directTablePrivilege.rows[0], {
      programs_select: false,
      universities_select: false,
    });
    const exactAcl = await client.query(
      `SELECT
         has_function_privilege(current_user,
           'fas_public_web_v1.resolve_source_sha256(text,integer)', 'EXECUTE') AS safe_facade,
         has_function_privilege(current_user,
           'fas_public_web_v1.resolve_source_sha256_internal(text,integer,boolean)', 'EXECUTE') AS internal_helper,
         has_function_privilege(current_user,
           'fas_public_web_v1.resolve_source_sha256_locked(text,integer)', 'EXECUTE') AS locked_helper,
         has_function_privilege(current_user,
           'fas_public_web_v1.apply_authorized_draft_intake(jsonb,jsonb)', 'EXECUTE') AS legacy_writer`,
    );
    assert.deepEqual(exactAcl.rows[0], {
      safe_facade: true,
      internal_helper: false,
      locked_helper: false,
      legacy_writer: false,
    });
    await client.query("RESET ROLE");
    for (const drift of [
      {
        grant: "GRANT SELECT ON public.programs TO fas_public_web_executor",
        revoke: "REVOKE SELECT ON public.programs FROM fas_public_web_executor",
      },
      {
        grant: "GRANT CREATE ON SCHEMA public TO fas_public_web_executor",
        revoke: "REVOKE CREATE ON SCHEMA public FROM fas_public_web_executor",
      },
      {
        grant: "GRANT CREATE ON SCHEMA fas_public_web_v1 TO fas_public_web_executor",
        revoke: "REVOKE CREATE ON SCHEMA fas_public_web_v1 FROM fas_public_web_executor",
      },
    ]) {
      await client.query(drift.grant);
      try {
        await client.query("SET ROLE fas_public_web_executor");
        await assert.rejects(
          resolver.resolve("PROGRAM", programId),
          /public_web_draft_source_executor_identity_invalid/,
        );
      } finally {
        await client.query("RESET ROLE");
        await client.query(drift.revoke);
      }
    }
    await client.query("SET ROLE fas_public_web_executor");
    assert.equal(await resolver.resolve("PROGRAM", 2_147_483_647), null);
    await client.query("RESET ROLE");

    const executorTarget = new URL(ADMIN_URL);
    executorTarget.username = EXECUTOR_ROLE;
    executorPool = new Pool({
      connectionString: executorTarget.toString(),
      max: 1,
      connectionTimeoutMillis: 1_000,
      statement_timeout: 15_000,
      query_timeout: 15_000,
      application_name: "fasos-public-web-source-deadline-integration",
    });
    let lockTransactionOpen = false;
    try {
      await client.query("BEGIN");
      lockTransactionOpen = true;
      await client.query("LOCK TABLE public.programs IN ACCESS EXCLUSIVE MODE");
      const startedAt = Date.now();
      await assert.rejects(
        new PostgresPublicWebDraftSourceResolver({
          pool: executorPool,
        }).resolve("PROGRAM", programId, {
          deadlineAt: startedAt + 250,
          signal: new AbortController().signal,
        }),
        /public_web_draft_source_deadline_exceeded/,
      );
      assert.ok(
        Date.now() - startedAt < 2_000,
        "a blocked source query must not survive its caller deadline",
      );
    } finally {
      if (lockTransactionOpen) {
        await client.query("ROLLBACK");
      }
      await executorPool.end();
      executorPool = null;
    }
    const leakedDeadlineConnectionCount = await waitForApplicationConnectionsToClose(
      client,
      "fasos-public-web-source-deadline-integration",
    );
    assert.equal(leakedDeadlineConnectionCount, "0");

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
    if (executorPool) {
      await executorPool.end();
    }
    if (programId !== null) {
      await client.query("DELETE FROM programs WHERE id = $1", [programId]);
    }
    if (universityId !== null) {
      await client.query("DELETE FROM universities WHERE id = $1", [universityId]);
    }
    if (roleCreated) {
      await client.query(
        `REVOKE ALL ON FUNCTION
           fas_public_web_v1.resolve_source_sha256(text, integer)
         FROM fas_public_web_executor`,
      );
      await client.query(
        "REVOKE ALL PRIVILEGES ON SCHEMA public, fas_public_web_v1 FROM fas_public_web_executor",
      );
      await client.query("DROP ROLE fas_public_web_executor");
    }
    if (installedByTest) {
      await client.query(
        "DROP FUNCTION fas_public_web_v1.apply_authorized_draft_intake_v2(jsonb, jsonb, jsonb)",
      );
      await client.query(
        "DROP FUNCTION fas_public_web_v1.assert_current_draft_authority(jsonb, jsonb, jsonb)",
      );
      await client.query(
        "DROP FUNCTION fas_public_web_v1.resolve_source_sha256_locked(text, integer)",
      );
      await client.query(
        "DROP FUNCTION fas_public_web_v1.resolve_source_sha256(text, integer)",
      );
      await client.query(
        "DROP FUNCTION fas_public_web_v1.resolve_source_sha256_internal(text, integer, boolean)",
      );
    }
    await client.end();
  }
});
