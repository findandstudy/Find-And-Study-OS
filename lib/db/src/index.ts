import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const pool: pg.Pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parsePositiveInt(process.env.DB_POOL_MAX, 10),
  min: 0,
  idleTimeoutMillis: parsePositiveInt(process.env.DB_IDLE_TIMEOUT_MS, 30_000),
  connectionTimeoutMillis: parsePositiveInt(process.env.DB_CONNECT_TIMEOUT_MS, 10_000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  allowExitOnIdle: false,
  statement_timeout: parsePositiveInt(process.env.DB_STATEMENT_TIMEOUT_MS, 30_000),
  query_timeout: parsePositiveInt(process.env.DB_QUERY_TIMEOUT_MS, 30_000),
});

pool.on("error", (err: Error & { code?: string }) => {
  console.error("[db pool] idle client error", {
    code: err.code,
    message: err.message,
  });
});

pool.on("connect", (client) => {
  client.on("error", (err: Error & { code?: string }) => {
    console.error("[db client] connection error", {
      code: err.code,
      message: err.message,
    });
  });
});

export const db = drizzle(pool, { schema });

export * from "./schema";
