import assert from "node:assert/strict";
import test from "node:test";
import { hasStoredDocumentContent } from "../src/lib/documentContentPolicy";

test("rejects document registrations without stored content", () => {
  assert.equal(hasStoredDocumentContent({}), false);
  assert.equal(hasStoredDocumentContent({ fileKey: null, fileUrl: null }), false);
  assert.equal(hasStoredDocumentContent({ fileKey: "   ", fileUrl: "\t" }), false);
});

test("accepts document registrations with a stored object or remote reference", () => {
  assert.equal(hasStoredDocumentContent({ fileKey: "student-documents/a.pdf" }), true);
  assert.equal(hasStoredDocumentContent({ fileUrl: "https://files.example.test/a.pdf" }), true);
});
