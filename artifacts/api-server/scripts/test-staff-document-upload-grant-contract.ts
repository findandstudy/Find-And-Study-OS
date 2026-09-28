import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/routes/staffCards.ts", import.meta.url), "utf8");
const registerStart = source.indexOf('router.post("/staff-cards/:userId/documents"');
const deleteStart = source.indexOf('router.delete("/staff-cards/:userId/documents/:docId"');
const downloadStart = source.indexOf('router.get("/staff-cards/:userId/documents/:docId/download"');
const assignmentStart = source.indexOf("// Atanmış acenteler");
const register = source.slice(registerStart, deleteStart);
const deletion = source.slice(deleteStart, downloadStart);
const download = source.slice(downloadStart, assignmentStart);

test("staff documents are re-read from authoritative storage and signature checked", () => {
  assert.ok(registerStart >= 0 && deleteStart > registerStart);
  assert.match(source, /async function prepareStaffDocumentUpload/);
  assert.match(source, /getObjectEntityFile\(`\/objects\/\$\{objectKey\}`\)/);
  assert.match(source, /await file\.getMetadata\(\)/);
  assert.match(source, /await file\.download\(\)/);
  assert.match(source, /validateUploadedFileBuffer\(input\.filename, contentType, bytes\)/);
  assert.match(source, /bytes\.length > input\.rule\.maxBytes/);
});

test("staff document reference, upload-grant consumption and audit are atomic", () => {
  const transactionAt = register.indexOf("await db.transaction(async (tx) =>");
  const consumeAt = register.indexOf("consumeFinalizedUploadGrantInDrizzle(tx,");
  const insertAt = register.indexOf("await tx.insert(staffDocumentsTable)");
  const auditAt = register.indexOf('await writeStaffCardAudit(tx, req, "staff_card.document.upload"');
  assert.ok(transactionAt >= 0 && consumeAt > transactionAt);
  assert.ok(insertAt > consumeAt && auditAt > insertAt);
  assert.doesNotMatch(register, /await db\.insert\(staffDocumentsTable\)/);
});

test("unfinalized, foreign and reused staff document grants fail closed", () => {
  assert.match(register, /STAFF_DOCUMENT_UPLOAD_GRANT_NOT_FINALIZED/);
  assert.match(register, /status\(409\)/);
  assert.match(register, /UPLOAD_GRANT_NOT_FINALIZED/);
  assert.match(register, /uploadedBy: req\.user!\.id/);
});

test("staff document deletion is audit-atomic and downloads await their audit attempt", () => {
  assert.match(deletion, /await db\.transaction\(async \(tx\) =>/);
  assert.match(deletion, /await tx\.update\(staffDocumentsTable\)/);
  assert.match(deletion, /await writeStaffCardAudit\(tx, req, "staff_card.document.delete"/);
  assert.doesNotMatch(deletion, /logAudit\(/);
  assert.match(download, /await logAudit\(req\.user!\.id, "staff_card.document.download"/);
});
