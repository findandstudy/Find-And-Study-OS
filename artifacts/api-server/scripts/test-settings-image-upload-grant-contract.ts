import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/routes/settings.ts", import.meta.url), "utf8");
const start = source.indexOf('router.patch("/settings"');
const end = source.indexOf('router.get("/settings/available-years"');
const boundary = source.slice(start, end);

test("private settings images are owner-bound and validated from stored bytes", () => {
  assert.ok(start >= 0 && end > start);
  assert.match(boundary, /callerOwnsObject\(req\.user!\.id, value\)/);
  assert.match(source, /getObjectEntityFile\(`\/objects\/\$\{objectKey\}`\)/);
  assert.match(source, /await file\.getMetadata\(\)/);
  assert.match(source, /await file\.download\(\)/);
  assert.match(source, /bytes\.length > 5 \* 1024 \* 1024/);
  assert.match(source, /validateUploadedFileBuffer\(`branding\.\$\{extension\}`, contentType, bytes\)/);
});

test("one stored image used by several branding fields consumes one grant", () => {
  assert.match(boundary, /const preparedByKey = new Map/);
  assert.match(boundary, /if \(!preparedByKey\.has\(objectKey\)\)/);
  assert.match(boundary, /preparedByKey\.set\(objectKey, await prepareSettingsImageUpload\(value\)\)/);
  assert.match(boundary, /for \(const prepared of preparedByKey\.values\(\)\)/);
});

test("settings image grant, mutation and audit are atomic", () => {
  const consumeAt = boundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const insertAt = boundary.indexOf("await tx.insert(settingsTable)");
  const updateAt = boundary.indexOf("await tx.update(settingsTable)");
  const auditAt = boundary.indexOf("await tx.insert(auditLogsTable)");
  assert.ok(consumeAt >= 0 && insertAt > consumeAt && updateAt > consumeAt && auditAt > updateAt);
  assert.match(boundary, /await db\.transaction\(async \(tx\) =>/);
  assert.match(boundary, /SETTINGS_IMAGE_UPLOAD_GRANT_NOT_FINALIZED/);
  assert.match(boundary, /status\(409\)/);
});

test("unchanged settings fields do not consume another grant", () => {
  const compareAt = boundary.indexOf("=== updates[key]");
  const deleteAt = boundary.indexOf("delete updates[key]", compareAt);
  const prepareAt = boundary.indexOf("prepareSettingsImageUpload(value)");
  assert.ok(compareAt >= 0 && deleteAt > compareAt && prepareAt > deleteAt);
});
