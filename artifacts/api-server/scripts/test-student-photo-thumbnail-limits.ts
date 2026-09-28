import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createThumbnailAdmission, ThumbnailAdmissionError } from "../src/lib/studentPhotoThumbnailAdmission";
import { decodeBoundedDocumentBase64, readBoundedDocumentStream, DocumentByteLimitError } from "../src/lib/documentByteLimits";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const limits = { maxBytes: 8, readTimeoutMs: 100 };

test("thumbnail admission starts at most two jobs and does not load queued sources", async () => {
  const admission = createThumbnailAdmission({ maxActive: 2, maxQueued: 2, maxReservedBytes: 16, queueTimeoutMs: 1000 });
  const gate = deferred();
  const started: number[] = [];
  const jobs = Array.from({ length: 4 }, (_, index) => admission.run(8, async () => {
    started.push(index);
    await gate.promise;
    return index;
  }));
  await turn();
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(admission.snapshot(), { active: 2, queued: 2, reservedBytes: 16 });
  await assert.rejects(admission.run(8, async () => { throw new Error("must not start"); }),
    (error: unknown) => error instanceof ThumbnailAdmissionError && error.reason === "queue_full");
  gate.resolve();
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3]);
  assert.deepEqual(started, [0, 1, 2, 3]);
  assert.deepEqual(admission.snapshot(), { active: 0, queued: 0, reservedBytes: 0 });
});

test("source-byte reservation independently limits concurrency and rejects oversize reservations", async () => {
  const admission = createThumbnailAdmission({ maxActive: 4, maxQueued: 2, maxReservedBytes: 10, queueTimeoutMs: 1000 });
  const gate = deferred();
  const first = admission.run(8, () => gate.promise);
  let secondStarted = false;
  const second = admission.run(8, async () => { secondStarted = true; });
  await turn();
  assert.equal(secondStarted, false);
  assert.deepEqual(admission.snapshot(), { active: 1, queued: 1, reservedBytes: 8 });
  for (const size of [0, -1, 11, NaN, 1.5]) {
    await assert.rejects(admission.run(size, async () => {}), ThumbnailAdmissionError);
  }
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(secondStarted, true);
  assert.equal(admission.snapshot().reservedBytes, 0);
});

test("expired queued jobs never run later and do not release still-active reservations", async () => {
  const admission = createThumbnailAdmission({ maxActive: 1, maxQueued: 1, maxReservedBytes: 8, queueTimeoutMs: 15 });
  const gate = deferred();
  const first = admission.run(8, () => gate.promise);
  let started = false;
  await assert.rejects(admission.run(8, async () => { started = true; }),
    (error: unknown) => error instanceof ThumbnailAdmissionError && error.reason === "queue_timeout");
  assert.deepEqual(admission.snapshot(), { active: 1, queued: 0, reservedBytes: 8 });
  gate.resolve();
  await first;
  await turn();
  assert.equal(started, false);
  assert.deepEqual(admission.snapshot(), { active: 0, queued: 0, reservedBytes: 0 });
});

test("synchronous and asynchronous partial failures release admission for the next job", async () => {
  const admission = createThumbnailAdmission({ maxActive: 1, maxQueued: 1, maxReservedBytes: 8, queueTimeoutMs: 1000 });
  const failed = admission.run(8, () => { throw new Error("decode failure"); });
  const next = admission.run(8, async () => 42);
  await assert.rejects(failed, /decode failure/);
  assert.equal(await next, 42);
  await assert.rejects(admission.run(8, async () => { await turn(); throw new Error("read failure"); }), /read failure/);
  assert.deepEqual(admission.snapshot(), { active: 0, queued: 0, reservedBytes: 0 });
});

test("invalid admission limits fail closed", () => {
  const valid = { maxActive: 2, maxQueued: 8, maxReservedBytes: 16, queueTimeoutMs: 10 };
  for (const invalid of [{ maxActive: 0 }, { maxQueued: -1 }, { maxReservedBytes: NaN }, { queueTimeoutMs: 0 }]) {
    assert.throws(() => createThumbnailAdmission({ ...valid, ...invalid }), /Invalid thumbnail/);
  }
});

test("bounded reader accepts the exact cap and exposes no uninitialized tail", async () => {
  const exact = Readable.from([Buffer.from("1234"), Buffer.from("5678")]);
  assert.equal((await readBoundedDocumentStream(exact, limits)).toString(), "12345678");
  assert.equal(exact.destroyed, true);
  assert.equal((await readBoundedDocumentStream(Readable.from([Buffer.from("hi")]), limits)).length, 2);
  assert.equal((await readBoundedDocumentStream(Readable.from([]), limits)).length, 0);
});

test("bounded reader rejects an overflow byte and destroys the source", async () => {
  for (const chunks of [[Buffer.alloc(9)], [Buffer.alloc(8), Buffer.alloc(1)]]) {
    const source = Readable.from(chunks);
    await assert.rejects(readBoundedDocumentStream(source, limits),
      (error: unknown) => error instanceof DocumentByteLimitError && error.reason === "too_large");
    assert.equal(source.destroyed, true);
  }
});

test("bounded reader times out stalled streams and releases the enclosing admission slot", async () => {
  const admission = createThumbnailAdmission({ maxActive: 1, maxQueued: 1, maxReservedBytes: 8, queueTimeoutMs: 1000 });
  const source = new Readable({ read() {} });
  await assert.rejects(admission.run(8, () => readBoundedDocumentStream(source, { maxBytes: 8, readTimeoutMs: 15 })),
    (error: unknown) => error instanceof DocumentByteLimitError && error.reason === "read_timeout");
  assert.equal(source.destroyed, true);
  assert.deepEqual(admission.snapshot(), { active: 0, queued: 0, reservedBytes: 0 });
  assert.equal(await admission.run(8, async () => "recovered"), "recovered");
});

test("reader partial errors and invalid chunks do not leak live streams", async () => {
  const partial = new Readable({ read() { this.push(Buffer.from("12")); this.destroy(new Error("synthetic source failure")); } });
  await assert.rejects(readBoundedDocumentStream(partial, limits), /synthetic source failure/);
  assert.equal(partial.destroyed, true);
  const invalid = Readable.from(["not binary"]);
  await assert.rejects(readBoundedDocumentStream(invalid, limits), DocumentByteLimitError);
  assert.equal(invalid.destroyed, true);
});

test("invalid byte/time bounds fail before consumption and destroy streams", async () => {
  for (const invalid of [{ maxBytes: 0 }, { maxBytes: 26 * 1024 * 1024 }, { readTimeoutMs: 0 }, { readTimeoutMs: 30_001 }]) {
    const source = new Readable({ read() { throw new Error("must not read"); } });
    await assert.rejects(readBoundedDocumentStream(source, { ...limits, ...invalid }), /Invalid bounded/);
    assert.equal(source.destroyed, true);
  }
});

test("base64 bounds reject before decoding and retain exact-cap compatibility", () => {
  for (const size of [1, 2, 3, 8]) {
    const input = Buffer.alloc(size, 65);
    assert.deepEqual(decodeBoundedDocumentBase64(input.toString("base64"), limits), input);
  }
  assert.throws(() => decodeBoundedDocumentBase64(Buffer.alloc(9).toString("base64"), limits), DocumentByteLimitError);
  assert.throws(() => decodeBoundedDocumentBase64(" ".repeat(100), limits), DocumentByteLimitError);
});
