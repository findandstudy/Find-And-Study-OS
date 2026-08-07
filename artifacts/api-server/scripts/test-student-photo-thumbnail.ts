import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  clearStudentPhotoThumbnailCacheForTests,
  getStudentPhotoThumbnail,
} from "../src/lib/studentPhotoThumbnail";

test("large source images become small cacheable JPEG thumbnails", async () => {
  clearStudentPhotoThumbnailCacheForTests();
  const source = await sharp({
    create: { width: 1800, height: 2400, channels: 3, background: "#2f6ad9" },
  }).png().toBuffer();
  const first = await getStudentPhotoThumbnail("doc-1", {
    fileData: source.toString("base64"),
    mimeType: "image/png",
  }, "Test Student");
  const metadata = await sharp(first.buffer).metadata();
  assert.equal(first.cacheStatus, "miss");
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 128);
  assert.ok(first.buffer.length < source.length / 10);

  const second = await getStudentPhotoThumbnail("doc-1", {
    fileData: source.toString("base64"),
    mimeType: "image/png",
  }, "Test Student");
  assert.equal(second.cacheStatus, "hit");
  assert.deepEqual(second.buffer, first.buffer);
});

test("PDF photographs use a bounded image placeholder instead of downloading a PDF into img", async () => {
  clearStudentPhotoThumbnailCacheForTests();
  const result = await getStudentPhotoThumbnail("pdf-1", {
    fileData: Buffer.from("%PDF-1.4 fixture").toString("base64"),
    mimeType: "application/pdf",
  }, "Test Student");
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 128);
  assert.ok(result.buffer.length < 50_000);
});
