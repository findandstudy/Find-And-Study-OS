import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/routes/messages.ts", import.meta.url), "utf8");

test("all three internal message send routes use the atomic attachment persistence boundary", () => {
  const calls = source.match(/await persistInternalMessage\(\{/g) ?? [];
  assert.equal(calls.length, 3);
  assert.match(source, /router\.post\("\/conversations\/:id\/messages"/);
  assert.match(source, /router\.post\("\/student\/conversations\/:id\/messages"/);
  assert.match(source, /router\.post\("\/agent\/conversations\/:id\/messages"/);
});

test("message insert and FINALIZED to CONSUMED transition share one transaction", () => {
  const boundary = source.slice(source.indexOf("async function persistInternalMessage"), source.indexOf("const STAFF_ROLE_LIST"));
  assert.match(boundary, /return db\.transaction\(async \(tx\) =>/);
  assert.match(boundary, /consumeFinalizedUploadGrantInDrizzle\(tx,/);
  assert.match(boundary, /await tx\.insert\(messagesTable\)/);
  assert.match(boundary, /await tx\.update\(conversationsTable\)/);
  assert.doesNotMatch(boundary, /await db\.insert\(messagesTable\)/);
});

test("server verifies stored bytes, size and MIME instead of trusting attachment metadata", () => {
  assert.match(source, /await file\.getMetadata\(\)/);
  assert.match(source, /await file\.download\(\)/);
  assert.match(source, /bytes\.length !== size/);
  assert.match(source, /attachment\.fileSize !== size/);
  assert.match(source, /declaredType && declaredType !== contentType/);
});
