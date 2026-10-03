import assert from "node:assert/strict";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";

const target = new URL(process.env.DATABASE_URL ?? "");
if (process.env.ALLOW_CATALOG_BENCHMARK !== "true"
  || process.env.ALLOW_LIVE_INTEGRATIONS !== "false"
  || target.hostname !== "127.0.0.1" || target.port !== "5433"
  || target.pathname !== "/fasos_apply_local") {
  throw new Error("Catalog benchmark requires explicit disposable PostgreSQL opt-in");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
const run = `__cf_bench_${crypto.randomUUID().replaceAll("-", "")}__`;
const universityCount = 1_000;
const programsPerUniversity = 200;
const expectedPrograms = universityCount * programsPerUniversity;

const searchWhere = `p.is_active = true AND u.is_active = true AND (
  p.name ILIKE $1 OR pt.name ILIKE $1 OR p.field ILIKE $1 OR pt.field ILIKE $1 OR u.name ILIKE $1
)`;
const listSql = `SELECT p.id, u.name AS university_name, COALESCE(pt.name,p.name) AS program_name
  FROM programs p JOIN universities u ON u.id=p.university_id
  LEFT JOIN program_translations pt ON pt.program_id=p.id AND pt.locale='en' AND pt.status='published'
  WHERE ${searchWhere}
  ORDER BY u.name, COALESCE(pt.name,p.name) LIMIT 30 OFFSET 5000`;
const countSql = `SELECT count(*)::int AS count FROM programs p
  JOIN universities u ON u.id=p.university_id
  LEFT JOIN program_translations pt ON pt.program_id=p.id AND pt.locale='en' AND pt.status='published'
  WHERE ${searchWhere}`;

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function summarizePlan(node: Record<string, any>, output: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  output.push({
    node: node["Node Type"], relation: node["Relation Name"] ?? null,
    index: node["Index Name"] ?? null, actualRows: node["Actual Rows"],
    loops: node["Actual Loops"], removedByFilter: node["Rows Removed by Filter"] ?? 0,
  });
  for (const child of node.Plans ?? []) summarizePlan(child, output);
  return output;
}

try {
  const identity = await pool.query("SELECT current_database() name, inet_server_addr()::text host, inet_server_port() port");
  assert.equal(identity.rows[0]?.name, "fasos_apply_local");
  assert.equal(identity.rows[0]?.port, 5433);
  const setup = await pool.connect();
  try {
    await setup.query("BEGIN");
    await setup.query("SET LOCAL statement_timeout='120s'");
    await setup.query("SET LOCAL session_replication_role=replica");
    await setup.query(`INSERT INTO universities(name,country,city,is_active,university_type)
      SELECT $1 || g, 'Benchmark Country ' || (g % 20), 'Benchmark City ' || (g % 100), true,
             CASE WHEN g % 2 = 0 THEN 'Public' ELSE 'Private' END
      FROM generate_series(1,$2::int) g`, [run, universityCount]);
    await setup.query(`INSERT INTO programs(university_id,name,degree,field,language,duration,tuition_fee,currency,is_active)
      SELECT u.id,
        CASE WHEN p % 20 = 0 THEN 'Bachelor of Nursing ' ELSE 'Engineering Programme ' END || p,
        CASE WHEN p % 3 = 0 THEN 'Master' ELSE 'Bachelor' END,
        CASE WHEN p % 20 = 0 THEN 'Nursing' ELSE 'Engineering' END,
        CASE WHEN p % 4 = 0 THEN 'Turkish' ELSE 'English' END,
        CASE WHEN p % 2 = 0 THEN '4 Years' ELSE '3 Years' END,
        5000 + p, 'USD', true
      FROM universities u CROSS JOIN generate_series(1,$2::int) p
      WHERE u.name LIKE $1 || '%'`, [run, programsPerUniversity]);
    await setup.query("COMMIT");
  } catch (error) {
    await setup.query("ROLLBACK");
    throw error;
  } finally { setup.release(); }

  const inserted = Number((await pool.query(`SELECT count(*) AS count FROM programs p JOIN universities u ON u.id=p.university_id WHERE u.name LIKE $1 || '%'`, [run])).rows[0].count);
  assert.equal(inserted, expectedPrograms);
  await pool.query("ANALYZE universities");
  await pool.query("ANALYZE programs");

  const explain = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${listSql}`, ["%nursing%"]);
  const plan = explain.rows[0]["QUERY PLAN"][0];
  const coldStart = performance.now();
  const [coldList, coldCount] = await Promise.all([pool.query(listSql, ["%nursing%"]), pool.query(countSql, ["%nursing%"])]);
  const coldMs = performance.now() - coldStart;
  assert.equal(coldList.rows.length, 30);
  assert.equal(Number(coldCount.rows[0].count), 10_000);

  const facetQueries = ["country", "city", "university_type"].map(column =>
    `SELECT DISTINCT u.${column} AS value FROM universities u JOIN programs p ON p.university_id=u.id WHERE p.is_active=true AND u.is_active=true ORDER BY value`);
  facetQueries.push(...["degree", "language", "field", "duration"].map(column =>
    `SELECT DISTINCT p.${column} AS value FROM programs p JOIN universities u ON u.id=p.university_id WHERE p.is_active=true AND u.is_active=true ORDER BY value`));
  const facetStart = performance.now();
  await Promise.all(facetQueries.map(query => pool.query(query)));
  const facetMs = performance.now() - facetStart;

  const burstDurations: number[] = [];
  let errors = 0;
  await Promise.all(Array.from({ length: 32 }, async (_, index) => {
    const started = performance.now();
    try { await pool.query(index % 2 === 0 ? listSql : countSql, [index % 4 < 2 ? "%nursing%" : "%engineering%"]); }
    catch { errors += 1; }
    burstDurations.push(performance.now() - started);
  }));
  const burstP50 = percentile(burstDurations, .5);
  const burstP95 = percentile(burstDurations, .95);
  const burstP99 = percentile(burstDurations, .99);
  assert.equal(errors, 0);
  assert.ok(coldMs < 1_000, `cold list+count exceeded safety ceiling: ${coldMs}ms`);
  assert.ok(facetMs < 1_500, `facet fan-out exceeded safety ceiling: ${facetMs}ms`);
  assert.ok(burstP95 < 3_000, `32-query burst p95 exceeded safety ceiling: ${burstP95}ms`);

  console.log(JSON.stringify({
    fixture: { universities: universityCount, programs: inserted },
    plan: { executionMs: plan["Execution Time"], planningMs: plan["Planning Time"], topNode: plan.Plan["Node Type"], sharedHitBlocks: plan.Plan["Shared Hit Blocks"], nodes: summarizePlan(plan.Plan) },
    coldListAndCountMs: Number(coldMs.toFixed(2)),
    sevenFacetQueriesMs: Number(facetMs.toFixed(2)),
    burst32: { errors, p50Ms: Number(burstP50.toFixed(2)), p95Ms: Number(burstP95.toFixed(2)), p99Ms: Number(burstP99.toFixed(2)) },
    gate: "PASS",
  }, null, 2));
} finally {
  try { await pool.query("DELETE FROM universities WHERE name LIKE $1 || '%'", [run]); }
  finally { await pool.end(); }
}
