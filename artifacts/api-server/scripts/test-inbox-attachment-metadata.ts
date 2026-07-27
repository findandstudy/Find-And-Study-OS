import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureAttachmentFilenameExtension,
  readNestedZernioAttachmentMetadata,
} from "../src/lib/inboxAttachmentMetadata";

test("reads the real Zernio WhatsApp image metadata shape", () => {
  const metadata = {
    attachments: [{ type: "image", name: "image" }],
    raw: {
      message: {
        attachments: [{
          type: "image",
          payload: { mimeType: "image/jpeg" },
        }],
      },
    },
  };

  const nested = readNestedZernioAttachmentMetadata(metadata, 0);
  assert.equal(nested.mimeType, "image/jpeg");
  assert.equal(ensureAttachmentFilenameExtension("image", nested.mimeType!), "image.jpg");
});

test("preserves an already-valid filename", () => {
  assert.equal(
    ensureAttachmentFilenameExtension("degree.pdf", "application/pdf"),
    "degree.pdf",
  );
});

test("adds Office extensions for generic document placeholders", () => {
  assert.equal(
    ensureAttachmentFilenameExtension(
      "document",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "document.docx",
  );
});
