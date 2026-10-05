import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/routes/users.ts", import.meta.url), "utf8");
const createStart = source.indexOf('router.post("/users"');
const start = source.indexOf('router.patch("/users/:id"');
const end = source.indexOf('router.delete("/users/:id"');
const createBoundary = source.slice(createStart, start);
const boundary = source.slice(start, end);

test("user avatar upload is restricted to owned verified image bytes", () => {
  assert.ok(start >= 0 && end > start);
  assert.match(source, /callerOwnsObject\(req\.user!\.id, value\)/);
  assert.match(source, /getObjectEntityFile\(`\/objects\/\$\{objectKey\}`\)/);
  assert.match(source, /await file\.getMetadata\(\)/);
  assert.match(source, /await file\.download\(\)/);
  assert.match(source, /field === "avatarUrl" \? 5 \* 1024 \* 1024 : 10 \* 1024 \* 1024/);
  assert.match(source, /validateUploadedFileBuffer\(`\$\{stem\}\.\$\{extension\}`, contentType, bytes\)/);
});

test("user create consumes avatar grant with row and audit", () => {
  assert.ok(createStart >= 0 && start > createStart);
  const consumeAt = createBoundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const insertAt = createBoundary.indexOf("await tx.insert(usersTable)");
  const auditAt = createBoundary.indexOf("await tx.insert(auditLogsTable)");
  assert.ok(consumeAt >= 0 && insertAt > consumeAt && auditAt > insertAt);
  assert.match(createBoundary, /await db\.transaction\(async \(tx\) =>/);
  assert.match(createBoundary, /USER_AVATAR_UPLOAD_GRANT_NOT_FINALIZED/);
  assert.match(createBoundary, /status\(409\)/);
  assert.doesNotMatch(createBoundary, /await db\s*\.insert\(usersTable\)/);
});

test("avatar, contract and passport grant consumption share the user transaction and audit", () => {
  assert.match(boundary, /\["avatarUrl", "contractUrl", "passportUrl"\]/);
  const consumeAt = boundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const updateAt = boundary.indexOf("await tx.update(usersTable)");
  const auditAt = boundary.indexOf("await tx.insert(auditLogsTable)");
  assert.ok(consumeAt >= 0 && updateAt > consumeAt && auditAt > updateAt);
  assert.match(boundary, /await db\.transaction\(async \(tx\) =>/);
  assert.match(boundary, /USER_FILE_UPLOAD_GRANT_NOT_FINALIZED/);
  assert.match(boundary, /status\(409\)/);
  assert.doesNotMatch(boundary, /await logAudit\(req\.user!\.id, "update_user"/);
});

test("same file retry is a no-op and does not consume another grant", () => {
  const sameAt = boundary.indexOf("value === targetCheck[field]");
  const deleteAt = boundary.indexOf("delete updates[field]", sameAt);
  const prepareAt = boundary.indexOf("prepareUserUpload(field, value)");
  assert.ok(sameAt >= 0 && deleteAt > sameAt && prepareAt > deleteAt);
});
