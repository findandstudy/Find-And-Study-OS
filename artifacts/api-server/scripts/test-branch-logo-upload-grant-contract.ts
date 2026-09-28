import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/routes/branches.ts", import.meta.url), "utf8");
const createStart = source.indexOf('router.post("/branches"');
const patchStart = source.indexOf('router.patch("/branches/:id"');
const archiveStart = source.indexOf('router.post("/branches/:id/archive"');
const createBoundary = source.slice(createStart, patchStart);
const patchBoundary = source.slice(patchStart, archiveStart);

test("private branch logos are owner-bound and validated from stored bytes", () => {
  assert.ok(createStart >= 0 && patchStart > createStart && archiveStart > patchStart);
  assert.match(source, /callerOwnsObject\(userId, logoUrl\)/);
  assert.match(source, /getObjectEntityFile\(`\/objects\/\$\{objectKey\}`\)/);
  assert.match(source, /await file\.getMetadata\(\)/);
  assert.match(source, /await file\.download\(\)/);
  assert.match(source, /bytes\.length > 5 \* 1024 \* 1024/);
  assert.match(source, /validateUploadedFileBuffer\(`branch-logo\.\$\{extension\}`, contentType, bytes\)/);
});

for (const [name, boundary, mutation] of [
  ["create", createBoundary, "insert"],
  ["update", patchBoundary, "update"],
] as const) {
  test(`branch ${name} consumes the logo grant with mutation and audit`, () => {
    const consumeAt = boundary.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
    const mutationAt = boundary.indexOf(`await tx.${mutation}(branchesTable)`);
    const auditAt = boundary.indexOf("await tx.insert(auditLogsTable)");
    assert.ok(consumeAt >= 0 && mutationAt > consumeAt && auditAt > mutationAt);
    assert.match(boundary, /await db\.transaction\(async \(tx\) =>/);
    assert.match(boundary, /BRANCH_LOGO_UPLOAD_GRANT_NOT_FINALIZED/);
    assert.match(boundary, /status\(409\)/);
  });
}

test("existing HTTPS branch logos remain backward compatible", () => {
  assert.match(source, /if \(!logoUrl\?\.startsWith\("\/api\/storage\/objects\/"\)\) return null/);
  assert.match(source, /v\.startsWith\("\/api\/storage\/objects\/"\) \|\| v\.startsWith\("https:\/\/"\)/);
});
