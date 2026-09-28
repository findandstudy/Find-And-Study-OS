import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/routes/users.ts", import.meta.url), "utf8");
const start = source.indexOf('router.patch("/users/:id"');
const end = source.indexOf('router.delete("/users/:id"');
const boundary = source.slice(start, end);

test("user avatar upload is restricted to owned verified image bytes", () => {
  assert.ok(start >= 0 && end > start);
  assert.match(source, /callerOwnsObject\(req\.user!\.id, avatarUrl\)/);
  assert.match(source, /getObjectEntityFile\(`\/objects\/\$\{objectKey\}`\)/);
  assert.match(source, /await file\.getMetadata\(\)/);
  assert.match(source, /await file\.download\(\)/);
  assert.match(source, /bytes\.length > 5 \* 1024 \* 1024/);
  assert.match(source, /validateUploadedFileBuffer\(`avatar\.\$\{extension\}`, contentType, bytes\)/);
});

test("avatar grant consumption and user reference update share a transaction", () => {
  const consumeAt = boundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const updateAt = boundary.indexOf("await tx.update(usersTable)");
  assert.ok(consumeAt >= 0 && updateAt > consumeAt);
  assert.match(boundary, /await db\.transaction\(async \(tx\) =>/);
  assert.match(boundary, /USER_AVATAR_UPLOAD_GRANT_NOT_FINALIZED/);
  assert.match(boundary, /status\(409\)/);
});

test("same avatar retry is a no-op and does not consume another grant", () => {
  const sameAt = boundary.indexOf("avatarUrl === targetCheck.avatarUrl");
  const deleteAt = boundary.indexOf("delete updates.avatarUrl", sameAt);
  const prepareAt = boundary.indexOf("prepareUserAvatarUpload(avatarUrl)");
  assert.ok(sameAt >= 0 && deleteAt > sameAt && prepareAt > deleteAt);
});
