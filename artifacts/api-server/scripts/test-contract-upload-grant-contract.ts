import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync(new URL("../src/lib/storedContractUpload.ts", import.meta.url), "utf8");
const company = readFileSync(new URL("../src/routes/companyContracts.ts", import.meta.url), "utf8");
const university = readFileSync(new URL("../src/routes/universityContracts.ts", import.meta.url), "utf8");

test("contract objects are owner-bound and validated from stored bytes", () => {
  assert.match(helper, /callerOwnsObject\(actorUserId, objectPath\)/);
  assert.match(helper, /await file\.getMetadata\(\)/);
  assert.match(helper, /await file\.download\(\)/);
  assert.match(helper, /bytes\.length > 25 \* 1024 \* 1024/);
  assert.match(helper, /validateUploadedFileBuffer\(fileName, contentType, bytes\)/);
});

for (const [name, source, table] of [
  ["company", company, "companyContractsTable"],
  ["university", university, "universityContractsTable"],
] as const) {
  test(`${name} contract create/update consumes the grant with mutation and audit`, () => {
    assert.match(source, /prepareOwnedStoredContract\(actorUserId, fileObjectKey\)/);
    assert.match(source, /prepareOwnedStoredContract\(actorUserId, nextFileKey\)/);
    const createAt = source.indexOf(`await tx.insert(${table})`);
    const updateAt = source.indexOf(`await tx.update(${table})`);
    assert.ok(createAt > source.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,"));
    assert.ok(updateAt > source.lastIndexOf("consumeFinalizedUploadGrantInDrizzle(tx,"));
    assert.match(source, /await tx\.insert\(auditLogsTable\)/);
    assert.match(source, /CONTRACT_UPLOAD_GRANT_NOT_FINALIZED/);
    assert.match(source, /status\(409\)/);
  });
}
