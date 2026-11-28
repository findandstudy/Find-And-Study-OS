import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, test } from "node:test";
import express from "express";

const database = new URL(process.env.DATABASE_URL ?? "invalid:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port, "5433");
assert.equal(database.pathname, "/fas_dev_pipeline_hardening");
assert.equal(database.username, "postgres");
assert.equal(database.password, "");
assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
assert.equal(process.env.EMAIL_DELIVERY_DISABLED, "true");

const { pool } = await import("@workspace/db");
const { default: auth } = await import("../src/routes/auth");
const app = express();
app.use(express.json());
app.use("/api", auth);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const port = (server.address() as { port: number }).port;
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
});

const post = (path: string, body: Record<string, unknown>) => fetch(`http://127.0.0.1:${port}/api/auth/${path}`, {
  method: "POST", redirect: "error", headers: { "content-type": "application/json" },
  body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
});

test("a pending student can activate once and a suspended account stays suspended during recovery", async () => {
  const email = `qa-activation-${randomUUID()}@example.invalid`;
  const password = `Synthetic!Qa1-${randomUUID()}`;
  const identity = { email, password, firstName: "Synthetic", lastName: "Student" };
  const registration = await post("register", identity);
  assert.equal(registration.status, 201);
  const active = async () => (await pool.query(
    "SELECT id, is_active, activation_pending, email_verified FROM users WHERE email=$1",
    [email],
  )).rows[0];
  assert.equal((await active()).activation_pending, true);
  assert.equal((await active()).is_active, false);
  const code = (await pool.query(
    "SELECT code FROM email_verification_codes WHERE email=$1 AND NOT used AND token IS NULL",
    [email],
  )).rows[0].code;
  const verified = await post("verify-email", { email, code });
  assert.equal(verified.status, 200);
  assert.equal((await active()).is_active, true);
  assert.equal((await active()).activation_pending, false);
  assert.equal((await post("verify-email", { email, code })).status, 400);
  const id = (await active()).id;
  const receipt = await pool.query(
    "SELECT count(*)::int AS n FROM audit_logs WHERE resource_id=$1 AND action='auth.email_verify'",
    [id],
  );
  assert.equal(receipt.rows[0].n, 1);
  const legacyRecovery = randomUUID() + randomUUID();
  await pool.query(
    "UPDATE users SET is_active=false, password_reset_token=$2, password_reset_expires=now()+interval '1 minute' WHERE id=$1",
    [id, createHash("sha256").update(legacyRecovery).digest("hex")],
  );
  const request = await post("forgot-password", { email });
  assert.equal(request.status, 200);
  const denied = await post("set-password", { token: legacyRecovery, password });
  assert.equal(denied.status, 400);
  assert.equal((await active()).is_active, false);
  assert.equal((await active()).activation_pending, false);
  const deliveries = await pool.query("SELECT count(*)::int AS n FROM email_queue WHERE to_email=$1", [email]);
  assert.equal(deliveries.rows[0].n, 0);
});
