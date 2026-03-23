import pg from "pg";

async function run(attempt = 1) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
  });
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
    try { await client.end(); } catch {}
    if (attempt < 3 && err.code && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' || err.code === '57P03')) {
      console.log(`Pre-migration: connection attempt ${attempt} failed, retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
      return run(attempt + 1);
    }
    console.log("Pre-migration: skipped (table may not exist yet)");
  }
}

await run();
