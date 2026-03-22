import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const res = await client.query(`
    DELETE FROM pipeline_stages
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM pipeline_stages
      GROUP BY entity_type, key
    )
  `);
  console.log(`Pre-migration: removed ${res.rowCount} duplicate pipeline_stages rows`);
  await client.end();
} catch (err) {
  console.log("Pre-migration: skipped (table may not exist yet)");
  try { await client.end(); } catch {}
}
