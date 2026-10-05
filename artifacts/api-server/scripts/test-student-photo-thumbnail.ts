import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import { loadDocumentBytes } from "../src/lib/documentBytes";
import { DocumentByteLimitError } from "../src/lib/documentByteLimits";
import {
  clearStudentPhotoThumbnailCacheForTests,
  getStudentPhotoThumbnail,
  studentPhotoThumbnailResponsePolicy,
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

test("PDF photographs render their first page into a bounded JPEG thumbnail", async (context) => {
  const hasPdfRenderer = spawnSync("pdftoppm", ["-v"]).status === 0
    || spawnSync("gs", ["--version"]).status === 0;
  if (!hasPdfRenderer) {
    context.skip("pdftoppm or ghostscript is required for PDF thumbnail rendering");
    return;
  }

  clearStudentPhotoThumbnailCacheForTests();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  page.drawRectangle({ x: 0, y: 0, width: 200, height: 200, color: rgb(0.85, 0.05, 0.05) });
  const source = Buffer.from(await pdf.save());
  const result = await getStudentPhotoThumbnail("pdf-1", {
    fileData: source.toString("base64"),
    mimeType: "application/pdf",
  }, "Test Student");
  const metadata = await sharp(result.buffer).metadata();
  const stats = await sharp(result.buffer).stats();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 128);
  assert.ok(stats.channels[0].mean > stats.channels[1].mean * 2);
  assert.ok(result.buffer.length < 50_000);
});

test("oversize image dimensions return a safe placeholder without poisoning the success cache", async () => {
  clearStudentPhotoThumbnailCacheForTests();
  // 25MP exceeds our 16MP ceiling but not sharp's much higher default ceiling.
  const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000"><rect width="100%" height="100%" fill="red"/></svg>');
  const first = await getStudentPhotoThumbnail("huge-pixels", { fileData: source.toString("base64"), mimeType: "image/svg+xml" }, "Synthetic Student");
  const metadata = await sharp(first.buffer).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 128);
  assert.equal(first.cacheable, false);
  const valid = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).png().toBuffer();
  const recovered = await getStudentPhotoThumbnail("huge-pixels", { fileData: valid.toString("base64"), mimeType: "image/png" }, "Synthetic Student");
  assert.equal(recovered.cacheStatus, "miss");
  assert.equal(recovered.cacheable, true);
  assert.notDeepEqual(recovered.buffer, first.buffer);
  assert.equal((await getStudentPhotoThumbnail("huge-pixels", {}, "Synthetic Student")).cacheStatus, "hit");
});

test("same-key callers still coalesce into one cacheable thumbnail", async () => {
  clearStudentPhotoThumbnailCacheForTests();
  const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: "blue" } }).png().toBuffer();
  const requests = Array.from({ length: 8 }, () => getStudentPhotoThumbnail("shared-source", { fileData: source.toString("base64"), mimeType: "image/png" }, "Synthetic Student"));
  const results = await Promise.all(requests);
  assert.equal(results.filter(result => result.cacheStatus === "miss").length, 1);
  assert.equal(results.filter(result => result.cacheStatus === "coalesced").length, 7);
  for (const result of results) assert.deepEqual(result.buffer, results[0].buffer);
});

test("thumbnail overload returns a bounded JPEG without caching the transient fallback", async () => {
  clearStudentPhotoThumbnailCacheForTests();
  const requests = Array.from({ length: 20 }, (_, index) => getStudentPhotoThumbnail(`burst-${index}`, {}, "Synthetic Student"));
  const results = await Promise.all(requests);
  const last = results[19];
  const metadata = await sharp(last.buffer).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 128);
  assert.ok(last.buffer.length < 1024);
  assert.equal(last.cacheable, false);
  const source = await sharp({ create: { width: 16, height: 16, channels: 3, background: "green" } }).png().toBuffer();
  const retry = await getStudentPhotoThumbnail("burst-19", { fileData: source.toString("base64"), mimeType: "image/png" }, "Synthetic Student");
  assert.equal(retry.cacheStatus, "miss");
  assert.notDeepEqual(retry.buffer, last.buffer);
});

test("fallback responses cannot be cached or validated as not modified", () => {
  const fallback = { buffer: Buffer.from("placeholder"), cacheable: false };
  for (const validator of [undefined, '"student-photo-thumb-1"', '"student-photo-thumb-v2-unknown"', "*"]) {
    assert.deepEqual(studentPhotoThumbnailResponsePolicy(fallback, validator), {
      cacheControl: "private, no-store", etag: null, notModified: false,
    });
  }
});

test("only successful identical representations get conditional304; legacy placeholder validators are replaced", () => {
  const valid = { buffer: Buffer.from("successful JPEG fixture"), cacheable: true };
  const first = studentPhotoThumbnailResponsePolicy(valid, '"student-photo-thumb-1"');
  assert.equal(first.cacheControl, "private, max-age=300");
  assert.equal(first.notModified, false);
  assert.match(first.etag!, /^"student-photo-thumb-v2-[a-f0-9]{64}"$/);
  assert.equal(studentPhotoThumbnailResponsePolicy(valid, first.etag!).notModified, true);
  assert.equal(studentPhotoThumbnailResponsePolicy({ buffer: Buffer.from("changed image"), cacheable: true }, first.etag!).notModified, false);
  assert.equal(studentPhotoThumbnailResponsePolicy({ ...valid, cacheable: false }, first.etag!).notModified, false);
});

test("thumbnail route retains authorization and makes304 decisions only after rendering", async () => {
  const source = await readFile(new URL("../src/routes/students.ts", import.meta.url), "utf8");
  const route = source.slice(source.indexOf('router.get("/students/:id/photo/thumbnail"'), source.indexOf('router.get("/students",'));
  assert.ok(route.includes('"/students/:id/photo/thumbnail", photoAccessGuard'));
  const access = route.indexOf("await assertCanAccessStudent");
  const render = route.indexOf("await getStudentPhotoThumbnail");
  const policy = route.indexOf("studentPhotoThumbnailResponsePolicy(thumbnail");
  const conditional = route.indexOf("res.status(304)");
  assert.ok(access >= 0 && access < render && render < policy && policy < conditional);
  assert.ok(route.includes('res.setHeader("Cache-Control", policy.cacheControl)'));
  assert.ok(route.includes('else res.removeHeader("ETag")'));
  assert.ok(!route.includes('if (req.headers["if-none-match"]'));
});

test("opt-in document byte bounds preserve legacy base64 and local-file callers", async () => {
  const originalDriver = process.env.STORAGE_DRIVER;
  const originalDir = process.env.STORAGE_LOCAL_DIR;
  const directory = await mkdtemp(join(tmpdir(), "fas-thumbnail-byte-test-"));
  try {
    process.env.STORAGE_DRIVER = "local";
    process.env.STORAGE_LOCAL_DIR = directory;
    await writeFile(join(directory, "synthetic.bin"), Buffer.from("123456789"));
    const bounds = { maxBytes: 8, readTimeoutMs: 1000 };
    for (const source of [{ fileKey: "/objects/synthetic.bin" }, { fileData: Buffer.from("123456789").toString("base64") }]) {
      assert.equal((await loadDocumentBytes(source))?.buffer.toString(), "123456789");
      await assert.rejects(loadDocumentBytes(source, bounds), DocumentByteLimitError);
    }
    await writeFile(join(directory, "synthetic.bin"), Buffer.from("12345678"));
    assert.equal((await loadDocumentBytes({ fileKey: "/objects/synthetic.bin" }, bounds))?.buffer.toString(), "12345678");
    assert.equal((await loadDocumentBytes({ fileKey: "/objects/missing.bin", fileData: Buffer.from("ok").toString("base64") }, bounds))?.buffer.toString(), "ok");
  } finally {
    if (originalDriver === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = originalDriver;
    if (originalDir === undefined) delete process.env.STORAGE_LOCAL_DIR;
    else process.env.STORAGE_LOCAL_DIR = originalDir;
    await rm(directory, { recursive: true, force: true });
  }
});
