import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  APPLICATION_DOCUMENT_MAX_SIZE,
  validateApplicationDocumentFile,
  validateStudentDocumentFile,
} from "@workspace/file-upload-validation";
import { validateStudentDocumentBuffer } from "../src/lib/fileUploadValidation";
import { buildBotSystemPrompt } from "../src/lib/inbox/botBrain";

test("student documents enforce the 5 MB boundary and reject empty files", () => {
  assert.equal(
    validateApplicationDocumentFile("passport.pdf", "application/pdf", APPLICATION_DOCUMENT_MAX_SIZE),
    null,
  );
  assert.equal(
    validateApplicationDocumentFile("passport.pdf", "application/pdf", APPLICATION_DOCUMENT_MAX_SIZE + 1)?.type,
    "size_exceeded",
  );
  assert.equal(
    validateApplicationDocumentFile("passport.pdf", "application/pdf", 0)?.type,
    "empty_file",
  );
});

test("passport accepts PDF/image while the photograph slot rejects PDF", () => {
  assert.equal(validateStudentDocumentFile("passport", "passport.pdf", "application/pdf", 1024), null);
  assert.equal(
    validateStudentDocumentFile("photo", "photo.pdf", "application/pdf", 1024)?.type,
    "document_type_mismatch",
  );
  assert.equal(validateStudentDocumentFile("photograph", "photo.jpg", "image/jpeg", 1024), null);
});

test("content validation accepts a readable PDF and rejects a corrupt PDF", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const valid = Buffer.from(await pdf.save());
  assert.equal(await validateStudentDocumentBuffer("passport", "passport.pdf", "application/pdf", valid), null);

  const corrupt = Buffer.from("%PDF-1.7\nthis is not a readable PDF document\n%%EOF");
  assert.ok(await validateStudentDocumentBuffer("passport", "passport.pdf", "application/pdf", corrupt));
});

test("AI intake prompt keeps document safety rules outside editable knowledge", () => {
  const prompt = buildBotSystemPrompt("en", "Custom university knowledge only");
  assert.match(prompt, /at most 5 MB/i);
  assert.match(prompt, /separate file/i);
  assert.match(prompt, /passport-style photo must be JPG, JPEG or PNG/i);
  assert.match(prompt, /one PDF appears to contain multiple document types/i);
  assert.match(prompt, /Do not treat a mere attachment as a completed document/i);
});

test("staff profile upload surfaces use canonical types and downstream lifecycle hooks", () => {
  const studentDetail = readFileSync(
    new URL("../../edcons/src/pages/staff/StudentDetail.tsx", import.meta.url),
    "utf8",
  );
  const studentDocumentsRoute = readFileSync(
    new URL("../src/routes/documents.ts", import.meta.url),
    "utf8",
  );
  const leadDocumentsRoute = readFileSync(
    new URL("../src/routes/leads.ts", import.meta.url),
    "utf8",
  );

  assert.match(studentDetail, /queryFn:\s*\(\)\s*=>\s*customFetch\("\/api\/catalog-options"\)/);
  assert.match(studentDetail, /key:\s*"diploma_certificate"/);
  assert.match(studentDetail, /key:\s*"diploma_transcript"/);
  assert.doesNotMatch(studentDetail, /key:\s*"diploma"\s*,/);
  assert.doesNotMatch(studentDetail, /key:\s*"transcript"\s*,/);

  assert.match(studentDocumentsRoute, /reEvaluateMandatoryDocsForStudent\(doc\.studentId\)/);
  assert.match(leadDocumentsRoute, /recompressStoredObjectIfNeeded\(fileKey, mimeType\)/);
  assert.match(leadDocumentsRoute, /db\.transaction\(async \(tx\) =>/);
  assert.match(leadDocumentsRoute, /recomputeStudentPhoto\(doc\.studentId\)/);
  assert.match(leadDocumentsRoute, /reEvaluateMandatoryDocsForStudent\(doc\.studentId\)/);
});
