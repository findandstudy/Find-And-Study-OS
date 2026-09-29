import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchBoundedPdf,
  MAX_PDF_PREVIEW_BYTES,
  runBoundedPdfPreview,
} from "../src/lib/pdfPreviewRuntime";

test("PDF preview runtime admits only two active jobs", async () => {
  let active = 0;
  let maximum = 0;
  const releases: Array<() => void> = [];
  const jobs = Array.from({ length: 4 }, () => runBoundedPdfPreview(1, new AbortController().signal, async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
  }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(active, 2);
  while (releases.length) releases.shift()!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  while (releases.length) releases.shift()!();
  await Promise.all(jobs);
  assert.equal(maximum, 2);
});
test("oversized known PDF is rejected before the task runs", async () => {
  let called = false;
  await assert.rejects(
    runBoundedPdfPreview(MAX_PDF_PREVIEW_BYTES + 1, new AbortController().signal, async () => { called = true; }),
    /PDF_PREVIEW_TOO_LARGE/,
  );
  assert.equal(called, false);
});

test("bounded fetch rejects a dishonest streaming response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PDF_PREVIEW_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "application/pdf" } });
  try {
    await assert.rejects(fetchBoundedPdf("https://local.invalid/file.pdf", new AbortController().signal), /PDF_PREVIEW_TOO_LARGE/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bounded fetch accepts a small PDF body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "application/pdf", "content-length": "3" },
  });
  try {
    const value = await fetchBoundedPdf("https://local.invalid/file.pdf", new AbortController().signal);
    assert.deepEqual([...new Uint8Array(value)], [1, 2, 3]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
