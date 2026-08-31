#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const adminUrl = process.env.PG_DISPOSABLE_ADMIN_URL ?? "";

if (process.env.ALLOW_DISPOSABLE_DATABASE_RESET !== "true") {
  throw new Error(
    "[disposable-db] BLOCKED: ALLOW_DISPOSABLE_DATABASE_RESET=true is required",
  );
}

let target;
try {
  target = new URL(adminUrl);
} catch {
  throw new Error("[disposable-db] BLOCKED: PG_DISPOSABLE_ADMIN_URL is malformed");
}
if (
  target.protocol !== "postgresql:" ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "5433" ||
  target.pathname !== "/postgres" ||
  target.username !== "postgres" ||
  target.search !== "" ||
  target.hash !== ""
) {
  throw new Error(
    "[disposable-db] BLOCKED: only postgresql://postgres@127.0.0.1:5433/postgres is allowed",
  );
}

const admin = new Client({
  connectionString: adminUrl,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  application_name: "fasos-disposable-database-reset",
});
await admin.connect();
try {
  const identity = await admin.query(
    "SELECT current_database() AS database_name, current_user AS user_name, host(inet_server_addr()) AS server_address, inet_server_port() AS server_port, rolsuper FROM pg_roles WHERE rolname = current_user",
  );
  assert.equal(identity.rows[0]?.database_name, "postgres");
  assert.equal(identity.rows[0]?.user_name, "postgres");
  assert.equal(typeof identity.rows[0]?.server_address, "string");
  assert.ok(identity.rows[0].server_address.length > 0);
  assert.ok(Number.isSafeInteger(Number(identity.rows[0]?.server_port)));
  assert.equal(identity.rows[0]?.rolsuper, true);

  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'fasos_apply_local' AND pid <> pg_backend_pid()",
  );
  await admin.query("DROP DATABASE IF EXISTS fasos_apply_local");

  const role = await admin.query(
    "SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls, rolcanlogin, EXISTS (SELECT 1 FROM pg_auth_members AS membership WHERE membership.member = role_row.oid) AS has_role_membership FROM pg_roles AS role_row WHERE rolname = 'fas_migrator'",
  );
  if (role.rowCount === 0) {
    await admin.query(
      "CREATE ROLE fas_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS",
    );
  } else {
    assert.deepEqual(role.rows[0], {
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolreplication: false,
      rolbypassrls: false,
      rolcanlogin: true,
      has_role_membership: false,
    });
  }

  const controlPlaneRoles = [
    { name: "fas_cp_owner", login: false },
    { name: "fas_cp_executor", login: true },
    { name: "fas_evidence_owner", login: false },
    { name: "fas_evidence_issuer", login: true },
    { name: "fas_auth_context_owner", login: false },
    { name: "fas_auth_context_resolver", login: true },
    { name: "fas_audit_owner", login: false },
    { name: "fas_audit_writer", login: true },
    { name: "fas_repair_owner", login: false },
    { name: "fas_repair_worker", login: true },
    { name: "fas_session_owner", login: false },
    { name: "fas_session_resolver", login: true },
    { name: "fas_rate_limit_owner", login: false },
    { name: "fas_rate_limit_executor", login: true },
    { name: "fas_session_lifecycle_owner", login: false },
    { name: "fas_session_lifecycle_executor", login: true },
    { name: "fas_session_repair_owner", login: false },
    { name: "fas_session_repair_executor", login: true },
  ];
  for (const roleSpec of controlPlaneRoles) {
    const existing = await admin.query(
      "SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls, rolcanlogin, EXISTS (SELECT 1 FROM pg_auth_members AS membership WHERE membership.member = role_row.oid) AS has_role_membership FROM pg_roles AS role_row WHERE rolname = $1",
      [roleSpec.name],
    );
    if (existing.rowCount === 0) {
      const loginClause = roleSpec.login ? "LOGIN" : "NOLOGIN";
      await admin.query(
        `CREATE ROLE ${roleSpec.name} ${loginClause} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
    } else {
      assert.deepEqual(existing.rows[0], {
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolreplication: false,
        rolbypassrls: false,
        rolcanlogin: roleSpec.login,
        has_role_membership: false,
      });
    }
  }

  await admin.query("CREATE DATABASE fasos_apply_local OWNER fas_migrator");
  await admin.query("ALTER ROLE fas_migrator SET statement_timeout = '15s'");
  await admin.query("ALTER ROLE fas_migrator SET lock_timeout = '5s'");
  for (const roleName of [
    "fas_cp_executor",
    "fas_evidence_issuer",
    "fas_auth_context_resolver",
    "fas_audit_writer",
    "fas_repair_worker",
    "fas_session_resolver",
    "fas_rate_limit_executor",
    "fas_session_lifecycle_executor",
    "fas_session_repair_executor",
  ]) {
    await admin.query(`ALTER ROLE ${roleName} SET statement_timeout = '15s'`);
    await admin.query(`ALTER ROLE ${roleName} SET lock_timeout = '5s'`);
    await admin.query(
      `ALTER ROLE ${roleName} SET idle_in_transaction_session_timeout = '15s'`,
    );
  }
} finally {
  await admin.end();
}

const databaseAdmin = new Client({
  connectionString:
    "postgresql://postgres@127.0.0.1:5433/fasos_apply_local",
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
});
await databaseAdmin.connect();
try {
  await databaseAdmin.query(
    "REVOKE TEMPORARY ON DATABASE fasos_apply_local FROM PUBLIC",
  );
  await databaseAdmin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await databaseAdmin.query(
    "GRANT USAGE, CREATE ON SCHEMA public TO fas_migrator",
  );
} finally {
  await databaseAdmin.end();
}

const migrator = new Client({
  connectionString:
    "postgresql://fas_migrator@127.0.0.1:5433/fasos_apply_local",
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
});
await migrator.connect();
try {
  const identity = await migrator.query(
    "SELECT current_database() AS database_name, current_user AS user_name, host(inet_server_addr()) AS server_address",
  );
  assert.equal(identity.rows[0]?.database_name, "fasos_apply_local");
  assert.equal(identity.rows[0]?.user_name, "fas_migrator");
  assert.equal(typeof identity.rows[0]?.server_address, "string");
  assert.ok(identity.rows[0].server_address.length > 0);
} finally {
  await migrator.end();
}

console.log(
  "[disposable-db] PASS: fresh fasos_apply_local owned by direct fas_migrator",
);
