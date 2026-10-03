import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/routes/inbox.ts", import.meta.url), "utf8");
const start = source.indexOf('"/inbox/conversations/:id/manual-document"');
const end = source.indexOf('"/inbox/conversations/:id/messages/:msgId/attachments/:attachId/save-as-document"');
const boundary = source.slice(start, end);

test("manual inbox document re-reads stored bytes and MIME", () => {
  assert.ok(start >= 0 && end > start);
  assert.match(boundary, /await file\.getMetadata\(\)/);
  assert.match(boundary, /await file\.download\(\)/);
  assert.match(boundary, /bytes\.length !== sizeBytes/);
  assert.match(boundary, /storedMimeType !== declaredMimeType/);
});

test("manual inbox document consumes the grant with its insert in one transaction", () => {
  assert.match(boundary, /await db\.transaction\(async \(tx\) =>/);
  assert.match(boundary, /consumeFinalizedUploadGrantInDrizzle\(tx,/);
  assert.match(boundary, /await tx\.insert\(documentsTable\)/);
  assert.doesNotMatch(boundary, /await db\.insert\(documentsTable\)/);
});

test("a missing or reused finalized grant cannot create a document", () => {
  const consumeAt = boundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const insertAt = boundary.indexOf("await tx.insert(documentsTable)");
  assert.ok(consumeAt >= 0 && insertAt > consumeAt);
  assert.match(boundary, /INBOX_MANUAL_UPLOAD_GRANT_NOT_FINALIZED/);
  assert.match(boundary, /status\(409\)/);
});
