import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

const target = new URL(process.env.DATABASE_URL ?? "");
if (process.env.ALLOW_UPLOAD_GRANT_DB_TEST !== "true"
  || process.env.ALLOW_LIVE_INTEGRATIONS !== "false"
  || target.hostname !== "127.0.0.1" || target.port !== "5433"
  || target.pathname !== "/fasos_apply_local" || target.search || target.hash) {
  throw new Error("Upload-grant DB test requires explicit opt-in and disposable 127.0.0.1:5433/fasos_apply_local");
}

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const identity = await admin.query("SELECT current_database() name, inet_server_addr()::text host, inet_server_port() port");
assert.equal(identity.rows[0]?.name, "fasos_apply_local");
assert.ok(["127.0.0.1", "127.0.0.1/32"].includes(identity.rows[0]?.host));
assert.equal(identity.rows[0]?.port, 5433);

const run = crypto.randomUUID();
const email = `upload-grant-${run}@example.invalid`;
const keys = [`uploads/${run}-ok`, `uploads/${run}-expired`, `uploads/${run}-drizzle`];
let userId = 0;
try {
  userId = Number((await admin.query(
    "INSERT INTO users(email, role) VALUES ($1, 'staff') RETURNING id",
    [email],
  )).rows[0].id);
  for (const key of keys) {
    await admin.query(
      "INSERT INTO object_owners(object_key, uploaded_by, source_priority) VALUES ($1, $2, 0)",
      [key, userId],
    );
  }

  const { issueUploadGrant, finalizeUploadGrant, consumeFinalizedUploadGrant, consumeFinalizedUploadGrantInDrizzle, UPLOAD_GRANT_TTL_MS } = await import("../src/lib/uploadGrant");
  const bytes = Buffer.from("synthetic-upload-grant-content", "utf8");
  assert.equal(await issueUploadGrant({
    objectPath: `/objects/${keys[0]}`, uploadedBy: userId,
    expectedSize: bytes.length, expectedContentType: "text/plain",
  }), true);
  assert.equal(UPLOAD_GRANT_TTL_MS, 15 * 60 * 1000);

  const finalized = await finalizeUploadGrant({
    objectPath: `/objects/${keys[0]}`, uploadedBy: userId,
    declaredSize: bytes.length, declaredContentType: "text/plain",
    bytes, contentType: "text/plain",
  });
  assert.equal(finalized.ok, true);
  assert.equal(finalized.ok && finalized.replayed, false);

  const replay = await finalizeUploadGrant({
    objectPath: `/objects/${keys[0]}`, uploadedBy: userId,
    declaredSize: bytes.length, declaredContentType: "text/plain",
    bytes, contentType: "text/plain",
  });
  assert.deepEqual(replay, finalized.ok
    ? { ok: true, replayed: true, sha256: finalized.sha256 }
    : replay);
  const changed = await finalizeUploadGrant({
    objectPath: `/objects/${keys[0]}`, uploadedBy: userId,
    declaredSize: bytes.length, declaredContentType: "text/plain",
    bytes: Buffer.from("different-content"), contentType: "text/plain",
  });
  assert.deepEqual(changed, { ok: false, reason: "conflict" });

  const old = new Date(Date.now() - UPLOAD_GRANT_TTL_MS - 1000);
  assert.equal(await issueUploadGrant({
    objectPath: `/objects/${keys[1]}`, uploadedBy: userId,
    expectedSize: bytes.length, expectedContentType: "text/plain", now: old,
  }), true);
  assert.deepEqual(await finalizeUploadGrant({
    objectPath: `/objects/${keys[1]}`, uploadedBy: userId,
    declaredSize: bytes.length, declaredContentType: "text/plain",
    bytes, contentType: "text/plain",
  }), { ok: false, reason: "expired" });

  const row = await admin.query(
    "SELECT status, final_size, final_content_type, content_sha256 FROM object_upload_grants WHERE object_key=$1",
    [keys[0]],
  );
  assert.equal(row.rows[0].status, "FINALIZED");
  assert.equal(row.rows[0].final_size, bytes.length);
  assert.equal(row.rows[0].final_content_type, "text/plain");
  assert.match(row.rows[0].content_sha256, /^[0-9a-f]{64}$/);
  assert.equal(await consumeFinalizedUploadGrant(admin, {
    objectPath: `/objects/${keys[0]}`, uploadedBy: userId, bytes, contentType: "text/plain",
  }), true);
  assert.equal(await consumeFinalizedUploadGrant(admin, {
    objectPath: `/objects/${keys[0]}`, uploadedBy: userId, bytes, contentType: "text/plain",
  }), false);
  const consumed = await admin.query(
    "SELECT status, consumed_at IS NOT NULL AS consumed FROM object_upload_grants WHERE object_key=$1",
    [keys[0]],
  );
  assert.deepEqual(consumed.rows[0], { status: "CONSUMED", consumed: true });

  assert.equal(await issueUploadGrant({
    objectPath: `/objects/${keys[2]}`, uploadedBy: userId,
    expectedSize: bytes.length, expectedContentType: "text/plain",
  }), true);
  assert.equal((await finalizeUploadGrant({
    objectPath: `/objects/${keys[2]}`, uploadedBy: userId,
    declaredSize: bytes.length, declaredContentType: "text/plain",
    bytes, contentType: "text/plain",
  })).ok, true);
  const { db } = await import("@workspace/db");
  assert.equal(await db.transaction(tx => consumeFinalizedUploadGrantInDrizzle(tx, {
    objectPath: `/objects/${keys[2]}`, uploadedBy: userId, bytes, contentType: "text/plain",
  })), true);
  assert.equal((await admin.query("SELECT status FROM object_upload_grants WHERE object_key=$1", [keys[2]])).rows[0]?.status, "CONSUMED");
  console.log("[postgres-upload-grants] 17/17 PASS");
} finally {
  await admin.query("DELETE FROM object_upload_grants WHERE object_key = ANY($1::text[])", [keys]);
  await admin.query("DELETE FROM object_owners WHERE object_key = ANY($1::text[])", [keys]);
  if (userId) await admin.query("DELETE FROM users WHERE id=$1", [userId]);
  await admin.end();
  const { pool } = await import("@workspace/db");
  await pool.end();
}
