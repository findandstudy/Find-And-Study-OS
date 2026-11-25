import type { Readable } from "node:stream";

export type DocumentByteLimits = { maxBytes: number; readTimeoutMs: number };

export class DocumentByteLimitError extends Error {
  constructor(readonly reason: "too_large" | "read_timeout" | "invalid_chunk") {
    super(`Document read rejected: ${reason}`);
    this.name = "DocumentByteLimitError";
  }
}

export function validateDocumentByteLimits(limits: DocumentByteLimits): void {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0 || limits.maxBytes > 25 * 1024 * 1024
    || !Number.isSafeInteger(limits.readTimeoutMs) || limits.readTimeoutMs <= 0 || limits.readTimeoutMs > 30_000) {
    throw new Error("Invalid bounded document read limits");
  }
}

/** Fixed allocation avoids a chunk-array/concat peak or unbounded tiny-chunk metadata. */
export async function readBoundedDocumentStream(stream: Readable, limits: DocumentByteLimits): Promise<Buffer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    validateDocumentByteLimits(limits);
    const target = Buffer.allocUnsafe(limits.maxBytes);
    let length = 0;
    timer = setTimeout(() => stream.destroy(new DocumentByteLimitError("read_timeout")), limits.readTimeoutMs);
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) throw new DocumentByteLimitError("invalid_chunk");
      if (chunk.byteLength > limits.maxBytes - length) throw new DocumentByteLimitError("too_large");
      target.set(chunk, length);
      length += chunk.byteLength;
    }
    // Never expose the uninitialized suffix. The allocation stays within the reserved cap.
    return target.subarray(0, length);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // An exception raised inside for-await (e.g. overflow) can finish the
    // iterator before an asynchronous _destroy callback completes. Hold the
    // enclosing thumbnail admission reservation until this source really closes;
    // racing cleanup against another timer would release a still-live operation.
    if (!stream.closed) {
      await new Promise<void>((resolve) => {
        const onClose = () => resolve();
        stream.once("close", onClose);
        stream.destroy();
        if (stream.closed) {
          stream.removeListener("close", onClose);
          resolve();
        }
      });
    }
  }
}

export function decodeBoundedDocumentBase64(value: string, limits: DocumentByteLimits): Buffer {
  validateDocumentByteLimits(limits);
  // Bound both the encoded input and decoded allocation BEFORE Buffer.from.
  if (value.length > 4 * Math.ceil(limits.maxBytes / 3) || Buffer.byteLength(value, "base64") > limits.maxBytes) {
    throw new DocumentByteLimitError("too_large");
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.length > limits.maxBytes) throw new DocumentByteLimitError("too_large");
  return buffer;
}
