import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/routes/agents.ts", import.meta.url), "utf8");
const start = source.indexOf('router.patch("/agents/me"');
const end = source.indexOf('router.get("/agents/me/embed-token"');
const boundary = source.slice(start, end);

test("agent profile uploads are re-read and signature checked", () => {
  assert.ok(start >= 0 && end > start);
  assert.match(source, /getObjectEntityFile\(`\/objects\/\$\{objectKey\}`\)/);
  assert.match(source, /await file\.getMetadata\(\)/);
  assert.match(source, /await file\.download\(\)/);
  assert.match(source, /validateUploadedFileBuffer\(fileName, contentType, bytes\)/);
  assert.match(source, /field === "logoUrl" \? 5 \* 1024 \* 1024 : 10 \* 1024 \* 1024/);
});

test("agent profile file reference and grant consumption are atomic", () => {
  assert.match(boundary, /await db\.transaction\(async \(tx\) =>/);
  assert.match(boundary, /consumeFinalizedUploadGrantInDrizzle\(tx,/);
  assert.match(boundary, /await tx\.update\(agentsTable\)/);
  assert.match(boundary, /await tx\.insert\(auditLogsTable\)/);
  assert.doesNotMatch(boundary, /await db\.update\(agentsTable\)\.set\(updates\)/);
});

test("reused or unfinalized agent upload grants fail closed", () => {
  const consumeAt = boundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const updateAt = boundary.indexOf("await tx.update(agentsTable)");
  assert.ok(consumeAt >= 0 && updateAt > consumeAt);
  assert.match(boundary, /AGENT_PROFILE_UPLOAD_GRANT_NOT_FINALIZED/);
  assert.match(boundary, /status\(409\)/);
});
