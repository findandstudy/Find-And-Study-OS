const MAX_ACTIVE_PREVIEWS = 2;
const MAX_QUEUED_PREVIEWS = 12;
export const MAX_PDF_PREVIEW_BYTES = 20 * 1024 * 1024;
const MAX_RESERVED_BYTES = 64 * 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 15_000;

type QueueEntry = {
  resolve: () => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

let active = 0;
let reservedBytes = 0;
const queue: QueueEntry[] = [];

function abortError(message = "PDF_PREVIEW_CANCELLED") {
  return new DOMException(message, "AbortError");
}

function drain() {
  while (active < MAX_ACTIVE_PREVIEWS && queue.length) {
    const entry = queue.shift()!;
    entry.signal.removeEventListener("abort", entry.onAbort);
    if (entry.signal.aborted) {
      entry.reject(abortError());
      continue;
    }
    active += 1;
    entry.resolve();
  }
}

async function acquire(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
  if (active < MAX_ACTIVE_PREVIEWS) {
    active += 1;
    return;
  }
  if (queue.length >= MAX_QUEUED_PREVIEWS) throw new Error("PDF_PREVIEW_QUEUE_FULL");
  await new Promise<void>((resolve, reject) => {
    const entry: QueueEntry = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        reject(abortError());
      },
    };
    signal.addEventListener("abort", entry.onAbort, { once: true });
    queue.push(entry);
  });
}

export async function runBoundedPdfPreview<T>(
  expectedBytes: number | null | undefined,
  externalSignal: AbortSignal,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const reservation = expectedBytes && expectedBytes > 0
    ? Math.min(expectedBytes, MAX_PDF_PREVIEW_BYTES)
    : MAX_PDF_PREVIEW_BYTES;
  if (expectedBytes && expectedBytes > MAX_PDF_PREVIEW_BYTES) throw new Error("PDF_PREVIEW_TOO_LARGE");
  if (reservedBytes + reservation > MAX_RESERVED_BYTES) throw new Error("PDF_PREVIEW_BYTE_BUDGET_EXCEEDED");
  reservedBytes += reservation;

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort("PDF_PREVIEW_TIMEOUT"), PREVIEW_TIMEOUT_MS);
  const combinedController = new AbortController();
  const forwardExternalAbort = () => combinedController.abort(externalSignal.reason);
  const forwardTimeoutAbort = () => combinedController.abort(timeout.signal.reason);
  externalSignal.addEventListener("abort", forwardExternalAbort, { once: true });
  timeout.signal.addEventListener("abort", forwardTimeoutAbort, { once: true });
  if (externalSignal.aborted) forwardExternalAbort();
  const combined = combinedController.signal;
  let acquired = false;
  try {
    await acquire(combined);
    acquired = true;
    return await task(combined);
  } finally {
    clearTimeout(timer);
    externalSignal.removeEventListener("abort", forwardExternalAbort);
    timeout.signal.removeEventListener("abort", forwardTimeoutAbort);
    reservedBytes -= reservation;
    if (acquired) {
      active -= 1;
      drain();
    }
  }
}

export async function fetchBoundedBytes(url: string, signal: AbortSignal, maxBytes: number): Promise<{ data: ArrayBuffer; contentType: string; headers: Headers }> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PDF_PREVIEW_BYTES) throw new Error("PDF_PREVIEW_LIMIT_INVALID");
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) throw new Error(`PDF_PREVIEW_HTTP_${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error("PDF_PREVIEW_TOO_LARGE");
  }
  if (!response.body) {
    const value = await response.arrayBuffer();
    if (value.byteLength > maxBytes) throw new Error("PDF_PREVIEW_TOO_LARGE");
    return { data: value, contentType: response.headers.get("content-type") || "", headers: response.headers };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("PDF_PREVIEW_TOO_LARGE");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { data: merged.buffer, contentType: response.headers.get("content-type") || "", headers: response.headers };
}

export async function fetchBoundedPdf(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  return (await fetchBoundedBytes(url, signal, MAX_PDF_PREVIEW_BYTES)).data;
}
