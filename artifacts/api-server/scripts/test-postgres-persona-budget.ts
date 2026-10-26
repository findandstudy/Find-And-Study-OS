import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { reservePersonaBudget } from "../src/lib/personaBudgetReservation";

test("budget SQL serializes concurrent reservations in a disposable PostgreSQL database", async () => {
  if (
    process.env.ALLOW_DISPOSABLE_PERSONA_DB !== "true" ||
    process.env.ALLOW_LIVE_INTEGRATIONS !== "false"
  )
    throw new Error("DISPOSABLE_TEST_OPT_IN_REQUIRED");
  // No environment URL, production credentials, dumps, or application bootstrap.
  const admin = new pg.Pool({
    host: "127.0.0.1",
    port: 5433,
    user: "postgres",
    database: "fasos_apply_local",
    connectionTimeoutMillis: 2000,
  });
  const name = `codex_persona_test_${process.pid}_${Date.now()}`;
  if (!/^codex_persona_test_\d+_\d+$/.test(name))
    throw new Error("UNSAFE_TEST_DATABASE_NAME");
  let created = false;
  let pool: pg.Pool | undefined;
  try {
    const identity = await admin.query(
      "SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port",
    );
    assert.deepEqual(identity.rows[0], {
      db: "fasos_apply_local",
      host: "127.0.0.1",
      port: 5433,
    });
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    pool = new pg.Pool({
      host: "127.0.0.1",
      port: 5433,
      user: "postgres",
      database: name,
      max: 10,
      connectionTimeoutMillis: 2000,
    });
    await pool.query(`CREATE TABLE ai_personas(id integer PRIMARY KEY, monthly_cost_cap_usd numeric(10,2), is_active boolean);
      CREATE TABLE ai_persona_runs(id serial PRIMARY KEY, persona_id integer REFERENCES ai_personas(id), triggered_by text,
        status text, cost_usd numeric(10,6), error_message text, output_payload jsonb, created_at timestamptz DEFAULT now());
      INSERT INTO ai_personas VALUES (1,1,true),(2,1,true),(3,1,true),(4,1,true);`);
    const req = {
      personaId: 1,
      requestKey: "a",
      intentDigest: "a".repeat(64),
      upperBoundMicros: 600000,
    };
    const parallel = await Promise.allSettled([
      reservePersonaBudget(pool, req),
      reservePersonaBudget(pool, { ...req, requestKey: "b" }),
    ]);
    assert.equal(parallel.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM ai_persona_runs WHERE persona_id=1",
        )
      ).rows[0].n,
      1,
    );
    const replay = await Promise.all(
      Array.from({ length: 6 }, () =>
        reservePersonaBudget(pool!, { ...req, personaId: 2 }),
      ),
    );
    assert.equal(replay.filter((r) => !r.replay).length, 1);
    assert.equal(new Set(replay.map((r) => r.runId)).size, 1);
    await assert.rejects(
      reservePersonaBudget(pool, {
        ...req,
        personaId: 2,
        intentDigest: "b".repeat(64),
      }),
      /REPLAY_CONFLICT/,
    );
    await pool.query(
      "INSERT INTO ai_persona_runs(persona_id,status,cost_usd) VALUES (3,'success',NULL)",
    );
    await assert.rejects(
      reservePersonaBudget(pool, { ...req, personaId: 3 }),
      /RECONCILIATION_REQUIRED/,
    );
    // A missing provider receipt does not release the reservation; retry replays it.
    const uncertain = await reservePersonaBudget(pool, {
      ...req,
      personaId: 4,
    });
    assert.deepEqual(
      await reservePersonaBudget(pool, { ...req, personaId: 4 }),
      { runId: uncertain.runId, replay: true },
    );
    const actual = await pool.query(
      "SELECT cost_usd FROM ai_persona_runs WHERE id=$1",
      [uncertain.runId],
    );
    assert.equal(
      actual.rows[0].cost_usd,
      null,
      "reserved budget must not be presented as actual spend",
    );
  } finally {
    await pool?.end();
    // Drop only the exact synthetic database created by THIS test; never the local app database.
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
