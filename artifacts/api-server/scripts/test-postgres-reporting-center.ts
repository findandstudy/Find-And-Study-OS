import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const rawUrl = process.env.DATABASE_URL ?? "";
let target: URL;
try {
  target = new URL(rawUrl);
} catch {
  throw new Error("[reporting-postgres] DATABASE_URL is required");
}

const dedicatedTarget = /^\/fas_dev_reporting_[a-z0-9_]+$/.test(
  target.pathname,
);
const ciDisposableTarget =
  process.env.CI === "true" &&
  process.env.ALLOW_DISPOSABLE_REPORTING_TEST === "true" &&
  target.pathname === "/fasos_apply_local";

if (
  target.protocol !== "postgresql:" ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "5433" ||
  (!dedicatedTarget && !ciDisposableTarget) ||
  target.username !== "fas_migrator"
) {
  throw new Error(
    "[reporting-postgres] only the dedicated loopback reporting fixture is allowed",
  );
}

const routePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/routes/reporting.ts",
);
const source = fs.readFileSync(routePath, "utf8");
const queries = Array.from(
  source.matchAll(/client\.query<QueryRow>\(\s*`([\s\S]*?)`(?:\s*,|\s*\))/g),
  (match) => match[1],
);
assert.ok(
  queries.length >= 10,
  "expected every Reporting Center SQL projection",
);

const client = new pg.Client({
  connectionString: rawUrl,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000,
  application_name: "fasos-reporting-postgres-contract",
});

await client.connect();
try {
  const identity = await client.query(
    "SELECT current_database() AS database_name, current_user AS user_name, inet_server_port() AS server_port",
  );
  if (dedicatedTarget) {
    assert.match(identity.rows[0]?.database_name ?? "", /^fas_dev_reporting_/);
  } else {
    assert.equal(identity.rows[0]?.database_name, "fasos_apply_local");
  }
  assert.equal(identity.rows[0]?.user_name, "fas_migrator");
  assert.equal(
    Number(identity.rows[0]?.server_port),
    ciDisposableTarget ? 5432 : 5433,
  );

  await client.query("BEGIN READ ONLY");
  for (const [index, query] of queries.entries()) {
    const placeholders = Array.from(query.matchAll(/\$(\d+)/g), (match) =>
      Number(match[1]),
    );
    const maximum = placeholders.length ? Math.max(...placeholders) : 0;
    const values: unknown[] = [
      "2026-08-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
      null,
      null,
      "2026-07-01T00:00:00.000Z",
      "day",
    ].slice(0, maximum);
    if (maximum === 1 && query.includes("$1::int[]")) values[0] = null;
    if (query.includes("date_trunc($5::text")) values[4] = "day";
    try {
      await client.query(query, values);
    } catch (error) {
      throw new Error(
        `[reporting-postgres] query ${index + 1}/${queries.length} with ${maximum} parameters failed`,
        { cause: error },
      );
    }
  }
  await client.query("ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

console.log(
  `[reporting-postgres] PASS: ${queries.length} bounded read projections compiled`,
);
