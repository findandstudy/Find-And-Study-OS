import test, { after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { pool } from "@workspace/db";
import { matchPublicCatalogRenderPath } from "../src/lib/publicCatalogRenderContract";
import {
  getPublicCatalogRenderModel,
  invalidatePublicCatalogRenderCache,
} from "../src/lib/publicCatalogRenderReadModel";
import { publicCatalogRouteKey } from "../src/lib/publicCatalogRouteContract";

const { Client } = pg;
const ADMIN_URL = process.env.PG_PUBLIC_CATALOG_RENDER_ADMIN_URL
  ?? "postgresql://postgres@127.0.0.1:5433/fasos_apply_local";
const target = new URL(ADMIN_URL);
if (
  target.protocol !== "postgresql:"
  || target.hostname !== "127.0.0.1"
  || target.port !== "5433"
  || target.pathname !== "/fasos_apply_local"
  || target.username !== "postgres"
  || target.password !== ""
  || target.search !== ""
  || target.hash !== ""
) {
  throw new Error("Public catalogue render test requires the disposable local PostgreSQL 16 database");
}

after(async () => {
  await pool.end();
});

test("render read model serves bounded data and coalesces the same cold key", async () => {
  const client = new Client({
    connectionString: ADMIN_URL,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "fasos-public-catalog-render-test",
  });
  await client.connect();
  let universityId: number | null = null;
  let programId: number | null = null;
  try {
    const identity = await client.query(
      "SELECT current_database() AS database_name, current_user AS user_name, inet_server_port() AS server_port",
    );
    assert.deepEqual(identity.rows[0], {
      database_name: "fasos_apply_local",
      user_name: "postgres",
      server_port: 5433,
    });
    const university = await client.query<{ id: number }>(
      `INSERT INTO universities (name, country, city, university_type, is_active)
       VALUES ('Render Pilot University', 'Turkey', 'Istanbul', 'Private', true)
       RETURNING id`,
    );
    universityId = university.rows[0].id;
    const program = await client.query<{ id: number }>(
      `INSERT INTO programs (
         university_id, name, description, degree, field, language,
         duration, tuition_fee, currency, is_active
       ) VALUES ($1, 'Render Pilot Computer Science', 'A bounded synthetic pilot record.',
         'MSc', 'Computer Science', 'English', '2 years', 12000, 'USD', true)
       RETURNING id`,
      [universityId],
    );
    programId = program.rows[0].id;

    const route = matchPublicCatalogRenderPath(
      `/en/programs/${publicCatalogRouteKey(programId, "Render Pilot Computer Science")}`,
    );
    assert.ok(route && route.kind === "program_detail");
    invalidatePublicCatalogRenderCache();
    const [first, second] = await Promise.all([
      getPublicCatalogRenderModel(route),
      getPublicCatalogRenderModel(route),
    ]);
    assert.deepEqual(new Set([first.cacheStatus, second.cacheStatus]), new Set(["MISS", "COALESCED"]));
    assert.equal(first.value.kind, "program_detail");
    assert.equal(first.value.kind === "program_detail" ? first.value.program.id : null, programId);
    assert.equal(first.value.indexable, false);
    const hit = await getPublicCatalogRenderModel(route);
    assert.equal(hit.cacheStatus, "HIT");

    const listRoute = matchPublicCatalogRenderPath("/en/programs");
    assert.ok(listRoute && listRoute.kind === "program_list");
    const list = await getPublicCatalogRenderModel(listRoute);
    assert.equal(list.value.kind, "program_list");
    assert.ok(list.value.kind === "program_list" && list.value.programs.length <= 12);
    assert.ok(list.value.kind === "program_list" && list.value.total >= 1);
  } finally {
    invalidatePublicCatalogRenderCache();
    if (programId !== null) {
      await client.query("DELETE FROM programs WHERE id = $1", [programId]);
    }
    if (universityId !== null) {
      await client.query("DELETE FROM universities WHERE id = $1", [universityId]);
    }
    await client.end();
  }
});
