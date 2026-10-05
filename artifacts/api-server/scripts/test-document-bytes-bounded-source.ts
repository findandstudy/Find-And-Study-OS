import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import test, { mock, type TestContext } from "node:test";
import { Storage } from "@google-cloud/storage";
import { loadDocumentBytes } from "../src/lib/documentBytes.js";
import { DocumentByteLimitError } from "../src/lib/documentByteLimits.js";
import { normalizeObjectReadError, ObjectNotFoundError, ObjectReadCancellationUnavailableError, ObjectStorageService, type ObjectFileHandle } from "../src/lib/objectStorage.js";
import { createThumbnailAdmission } from "../src/lib/studentPhotoThumbnailAdmission.js";
import { getStudentPhotoThumbnail, studentPhotoThumbnailResponsePolicy } from "../src/lib/studentPhotoThumbnail.js";

mock.method(Socket.prototype, "connect", () => { throw new Error("REAL_NETWORK_FORBIDDEN"); });
mock.method(globalThis, "fetch", () => { throw new Error("REAL_NETWORK_FORBIDDEN"); });
const bounds = { maxBytes: 8, readTimeoutMs: 100 };
const source = { fileKey: "/objects/synthetic", mimeType: "application/pdf" };

function environment(context: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  context.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

function cloudFixture(context: TestContext, stream: () => Readable, existence = true) {
  environment(context, { STORAGE_DRIVER: "replit", PRIVATE_OBJECT_DIR: "/synthetic-bucket/private" });
  const calls = { exists: 0, metadata: 0, stream: 0, download: 0, range: undefined as { start?: number; end?: number } | undefined };
  const file = {
    async exists() { calls.exists++; return [existence]; },
    async getMetadata() { calls.metadata++; throw new Error("METADATA_PROBE_FORBIDDEN"); },
    async download() { calls.download++; return [Buffer.from("legacy")]; },
    createReadStream(range?: { start?: number; end?: number }) { calls.stream++; calls.range = range; return stream(); },
  };
  context.mock.method(Storage.prototype, "bucket", (bucketName: string) => {
    assert.equal(bucketName, "synthetic-bucket");
    return { file(objectName: string) { assert.equal(objectName, "private/synthetic"); return file; } } as never;
  });
  return { calls, file };
}

// Inject an independently cancellable stream at the local handle boundary.
// This deliberately is NOT evidence of GCS SDK cancellation.
function cancellableSourceFixture(context: TestContext, stream: () => Readable) {
  const fixture = cloudFixture(context, stream);
  context.mock.method(ObjectStorageService.prototype, "getObjectEntityFile", async (key, options) => {
    assert.equal(key, source.fileKey);
    assert.deepEqual(options, { requireCancellableRead: true });
    return fixture.file as unknown as ObjectFileHandle;
  });
  return fixture;
}

test("bounded GCS loads fail closed before any SDK handle or request starts", async (context) => {
  const { calls, file } = cloudFixture(context, () => { throw new Error("CLOUD_STREAM_FORBIDDEN"); });
  const bucket = context.mock.method(Storage.prototype, "bucket", () => { throw new Error("SDK_HANDLE_START_FORBIDDEN"); });
  file.exists = () => { calls.exists++; return new Promise(() => {}); };
  await assert.rejects(loadDocumentBytes(source, bounds), ObjectReadCancellationUnavailableError);
  // An unverified remote object cannot silently turn into stale legacy data.
  await assert.rejects(loadDocumentBytes({ ...source, fileData: "b2s=" }, bounds), ObjectReadCancellationUnavailableError);
  assert.equal(bucket.mock.callCount(), 0);
  assert.deepEqual(calls, { exists: 0, metadata: 0, stream: 0, download: 0, range: undefined });
  assert.equal((await loadDocumentBytes({ fileData: "b2s=" }, bounds))?.buffer.toString(), "ok");
});

test("default object lookup and unbounded document loads retain the existence probe", async (context) => {
  const { calls, file } = cloudFixture(context, () => { throw new Error("STREAM_NOT_EXPECTED"); });
  assert.equal(await new ObjectStorageService().getObjectEntityFile(source.fileKey), file);
  assert.equal((await loadDocumentBytes(source))?.buffer.toString(), "legacy");
  assert.equal(calls.exists, 2);
  assert.equal(calls.download, 1);
  assert.equal(calls.stream, 0);
});

test("unsupported GCS thumbnail is a non-cacheable placeholder without starting a provider request", async (context) => {
  const { calls } = cloudFixture(context, () => { throw new Error("CLOUD_STREAM_FORBIDDEN"); });
  const bucket = context.mock.method(Storage.prototype, "bucket", () => { throw new Error("SDK_HANDLE_START_FORBIDDEN"); });
  for (let attempt = 0; attempt < 2; attempt++) {
    const thumbnail = await getStudentPhotoThumbnail("unsupported-gcs-cancellation-fixture", source, "Synthetic Student");
    assert.equal(thumbnail.cacheable, false);
    assert.equal(thumbnail.cacheStatus, "miss");
    assert.ok(thumbnail.buffer.length > 0 && thumbnail.buffer.length < 100_000);
    assert.deepEqual(studentPhotoThumbnailResponsePolicy(thumbnail, undefined), { cacheControl: "private, no-store", etag: null, notModified: false });
  }
  assert.equal(bucket.mock.callCount(), 0);
  assert.equal(calls.exists + calls.stream + calls.metadata + calls.download, 0);
});

test("default missing-object lookup still throws before any download", async (context) => {
  const { calls } = cloudFixture(context, () => { throw new Error("STREAM_NOT_EXPECTED"); }, false);
  await assert.rejects(new ObjectStorageService().getObjectEntityFile(source.fileKey), ObjectNotFoundError);
  assert.equal(await loadDocumentBytes(source), null);
  assert.equal(calls.exists, 2);
  assert.equal(calls.download, 0);
});

test("missing cancellable streams preserve bounded legacy fallback", async (context) => {
  let code: number | string = 404;
  const { calls } = cancellableSourceFixture(context, () => new Readable({ read() { this.destroy(Object.assign(new Error("synthetic missing"), { code })); } }));
  for (const missingCode of [404, "ENOENT"]) {
    code = missingCode;
    assert.equal(await loadDocumentBytes(source, bounds), null);
    const result = await loadDocumentBytes({ ...source, fileData: Buffer.from("fallback").toString("base64") }, bounds);
    assert.equal(result?.buffer.toString(), "fallback");
    await assert.rejects(loadDocumentBytes({ ...source, fileData: Buffer.from("too-much-fallback").toString("base64") }, bounds), DocumentByteLimitError);
  }
  assert.equal(calls.exists, 0);
});

test("permission, provider and timeout failures cannot turn into a legacy fallback", async (context) => {
  let code = 403;
  cancellableSourceFixture(context, () => new Readable({ read() { this.destroy(Object.assign(new Error("synthetic provider failure"), { code })); } }));
  for (const value of [403, 429, 500, 503]) {
    code = value;
    await assert.rejects(loadDocumentBytes({ ...source, fileData: Buffer.from("fallback").toString("base64") }, bounds), (error: unknown) => {
      return (error as { code?: number }).code === value && !(error instanceof ObjectNotFoundError);
    });
  }
  for (const error of [new Error("404 in a message"), { code: "404" }, { status: 404 }, null]) {
    assert.equal(normalizeObjectReadError(error), error);
  }
});

test("stream timeout destroys the real source and releases admission only after close", async (context) => {
  let closeCompleted = false;
  let notifyDestroy!: () => void;
  const destroying = new Promise<void>((resolve) => { notifyDestroy = resolve; });
  const stalled = new Readable({
    read() {},
    destroy(error, callback) {
      notifyDestroy();
      setTimeout(() => { closeCompleted = true; callback(error); }, 30);
    },
  });
  const { calls } = cancellableSourceFixture(context, () => stalled);
  const admission = createThumbnailAdmission({ maxActive: 1, maxQueued: 1, maxReservedBytes: 8, queueTimeoutMs: 1000 });
  const pending = admission.run(8, () => loadDocumentBytes({ ...source, fileData: "b2s=" }, { maxBytes: 8, readTimeoutMs: 10 }));
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof DocumentByteLimitError && error.reason === "read_timeout");
  await destroying;
  const next = admission.run(8, async () => { assert.equal(closeCompleted, true); return "slot-reused"; });
  assert.deepEqual(admission.snapshot(), { active: 1, queued: 1, reservedBytes: 8 });
  await rejected;
  assert.equal(await next, "slot-reused");
  assert.equal(stalled.closed, true);
  assert.equal(calls.exists, 0);
  assert.deepEqual(admission.snapshot(), { active: 0, queued: 0, reservedBytes: 0 });
});

test("overflow destroys the source before its admission slot is reused", async (context) => {
  let closeCompleted = false;
  const oversized = new Readable({
    read() { this.push(Buffer.alloc(9)); },
    destroy(error, callback) { setTimeout(() => { closeCompleted = true; callback(error); }, 15); },
  });
  cancellableSourceFixture(context, () => oversized);
  const admission = createThumbnailAdmission({ maxActive: 1, maxQueued: 1, maxReservedBytes: 8, queueTimeoutMs: 1000 });
  await assert.rejects(admission.run(8, () => loadDocumentBytes(source, bounds)), (error: unknown) => error instanceof DocumentByteLimitError && error.reason === "too_large");
  assert.equal(closeCompleted, true);
  assert.equal(oversized.closed, true);
  assert.deepEqual(admission.snapshot(), { active: 0, queued: 0, reservedBytes: 0 });
});

test("successful stream cleanup completes before admission is released", async (context) => {
  let closeCompleted = false;
  const readable = new Readable({
    read() { this.push(Buffer.from("ok")); this.push(null); },
    destroy(error, callback) { setTimeout(() => { closeCompleted = true; callback(error); }, 15); },
  });
  cancellableSourceFixture(context, () => readable);
  const admission = createThumbnailAdmission({ maxActive: 1, maxQueued: 1, maxReservedBytes: 8, queueTimeoutMs: 1000 });
  assert.equal((await admission.run(8, () => loadDocumentBytes(source, bounds)))?.buffer.toString(), "ok");
  assert.equal(closeCompleted, true);
  assert.equal(readable.closed, true);
  assert.deepEqual(admission.snapshot(), { active: 0, queued: 0, reservedBytes: 0 });
});

test("opt-in local reads preserve realpath containment and missing-file fallback", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "fasos-bounded-source-"));
  const outside = await mkdtemp(path.join(tmpdir(), "fasos-bounded-source-"));
  context.after(async () => {
    for (const directory of [root, outside]) {
      assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
      assert.ok(path.basename(directory).startsWith("fasos-bounded-source-"));
      await rm(directory, { recursive: true, force: true });
    }
  });
  environment(context, { STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: root });
  await writeFile(path.join(root, "synthetic"), "ok");
  await writeFile(path.join(outside, "synthetic"), "outside");
  await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await loadDocumentBytes(source, bounds))?.buffer.toString(), "ok");
  for (const fileKey of ["/objects/../synthetic", "/objects/escape/synthetic", "/objects/missing"]) {
    await assert.rejects(new ObjectStorageService().getObjectEntityFile(fileKey, { requireCancellableRead: true }), ObjectNotFoundError);
    assert.equal((await loadDocumentBytes({ fileKey, fileData: "b2s=" }, bounds))?.buffer.toString(), "ok");
  }
});

test("bounded path is opt-in and has no uncancelled metadata Promise.race", async () => {
  const text = await readFile(new URL("../src/lib/documentBytes.ts", import.meta.url), "utf8");
  assert.match(text, /limits \? \{ requireCancellableRead: true \} : undefined/);
  assert.match(text, /limits \? normalizeObjectReadError\(readError\) : readError/);
  assert.doesNotMatch(text, /Promise\.race/);
  assert.doesNotMatch(text, /deferExistenceCheck/);
});
