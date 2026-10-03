import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/routes/agents.ts", import.meta.url), "utf8");
const start = source.indexOf('router.patch("/agents/me"');
const end = source.indexOf('router.get("/agents/me/embed-token"');
const boundary = source.slice(start, end);
const adminCreateStart = source.indexOf('router.post("/agents"');
const adminCreateEnd = source.indexOf('router.get("/agents/:id"');
const adminCreateBoundary = source.slice(adminCreateStart, adminCreateEnd);
const adminPatchStart = source.indexOf('router.patch("/agents/:id"');
const adminPatchEnd = source.indexOf('router.delete("/agents/:id"');
const adminPatchBoundary = source.slice(adminPatchStart, adminPatchEnd);
const subAgentCreateStart = source.indexOf('router.post("/agents/me/sub-agents"');
const subAgentPatchStart = source.indexOf('router.patch("/agents/me/sub-agents/:id"');
const subAgentDeleteStart = source.indexOf('router.delete("/agents/me/sub-agents/:id"');
const subAgentCreateBoundary = source.slice(subAgentCreateStart, subAgentPatchStart);
const subAgentPatchBoundary = source.slice(subAgentPatchStart, subAgentDeleteStart);

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

test("admin agent creation binds owned uploads to the account and consumes them atomically", () => {
  assert.ok(adminCreateStart >= 0 && adminCreateEnd > adminCreateStart);
  assert.match(adminCreateBoundary, /callerOwnsObject\(req\.user!\.id, value\)/);
  assert.match(adminCreateBoundary, /prepareAgentProfileUpload\(field, value\)/);
  const transactionAt = adminCreateBoundary.indexOf("await db.transaction(async (tx) =>");
  const consumeAt = adminCreateBoundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const userInsertAt = adminCreateBoundary.indexOf("await tx.insert(usersTable)");
  const agentInsertAt = adminCreateBoundary.indexOf("await tx.insert(agentsTable)");
  assert.ok(transactionAt >= 0 && consumeAt > transactionAt);
  assert.ok(userInsertAt > consumeAt && agentInsertAt > userInsertAt);
  assert.match(adminCreateBoundary, /await tx\.insert\(auditLogsTable\)/);
  assert.doesNotMatch(adminCreateBoundary, /await db\.insert\(agentsTable\)/);
});

test("admin agent edits consume uploads with the profile mutation and audit", () => {
  assert.ok(adminPatchStart >= 0 && adminPatchEnd > adminPatchStart);
  assert.match(adminPatchBoundary, /callerOwnsObject\(req\.user!\.id, value\)/);
  assert.match(adminPatchBoundary, /prepareAgentProfileUpload\(field, value\)/);
  const consumeAt = adminPatchBoundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const updateAt = adminPatchBoundary.indexOf("await tx.update(agentsTable)");
  const auditAt = adminPatchBoundary.indexOf("await tx.insert(auditLogsTable)");
  assert.ok(consumeAt >= 0 && updateAt > consumeAt && auditAt > updateAt);
  assert.match(adminPatchBoundary, /AGENT_PROFILE_UPLOAD_GRANT_NOT_FINALIZED/);
});

test("sub-agent creation consumes an owned logo with user, agent and audit rows", () => {
  assert.ok(subAgentCreateStart >= 0 && subAgentPatchStart > subAgentCreateStart);
  assert.match(subAgentCreateBoundary, /callerOwnsObject\(userId, logoUrl\)/);
  const consumeAt = subAgentCreateBoundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const userAt = subAgentCreateBoundary.indexOf("await tx.insert(usersTable)");
  const agentAt = subAgentCreateBoundary.indexOf("await tx.insert(agentsTable)");
  const auditAt = subAgentCreateBoundary.indexOf("await tx.insert(auditLogsTable)");
  assert.ok(consumeAt >= 0 && userAt > consumeAt && agentAt > userAt && auditAt > agentAt);
  assert.doesNotMatch(subAgentCreateBoundary, /await db\.insert\((usersTable|agentsTable)\)/);
});

test("sub-agent edit consumes an owned logo with linked user and audit mutations", () => {
  assert.ok(subAgentPatchStart >= 0 && subAgentDeleteStart > subAgentPatchStart);
  assert.match(subAgentPatchBoundary, /callerOwnsObject\(userId, value\)/);
  const consumeAt = subAgentPatchBoundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const agentAt = subAgentPatchBoundary.indexOf("await tx.update(agentsTable)");
  const userAt = subAgentPatchBoundary.indexOf("await tx.update(usersTable)");
  const auditAt = subAgentPatchBoundary.indexOf("await tx.insert(auditLogsTable)");
  assert.ok(consumeAt >= 0 && agentAt > consumeAt && userAt > agentAt && auditAt > userAt);
});
