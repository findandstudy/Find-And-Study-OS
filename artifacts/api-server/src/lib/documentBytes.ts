import type { Response } from "express";
import { Readable } from "stream";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

export interface DocBytesSource {
  fileKey?: string | null;
  fileData?: string | null;
  mimeType?: string | null;
}

const objectStorageService = new ObjectStorageService();

function normalizeFileKey(fileKey: string): string {
  if (fileKey.startsWith("/objects/")) return fileKey;
  if (fileKey.startsWith("objects/")) return `/${fileKey}`;
  if (fileKey.startsWith("/")) return `/objects${fileKey}`;
  return `/objects/${fileKey}`;
}

/**
 * Load full document bytes into memory.
 *
 * Prefers `fileKey` (object storage) when present, falls back to legacy
 * base64 `fileData`. Returns null when neither is available.
 */
export async function loadDocumentBytes(
  doc: DocBytesSource,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const mime = doc.mimeType || "application/octet-stream";
  if (doc.fileKey) {
    try {
      const file = await objectStorageService.getObjectEntityFile(
        normalizeFileKey(doc.fileKey),
      );
      const [contents] = await file.download();
      return { buffer: contents, mimeType: mime };
    } catch (err) {
      if (err instanceof ObjectNotFoundError && doc.fileData) {
        // fall through to legacy data
      } else if (!(err instanceof ObjectNotFoundError)) {
        throw err;
      } else {
        return null;
      }
    }
  }
  if (doc.fileData) {
    return { buffer: Buffer.from(doc.fileData, "base64"), mimeType: mime };
  }
  return null;
}

/**
 * Stream document content to an HTTP response. Sets Content-Type header.
 * Caller should set any additional headers (Cache-Control, Content-Disposition).
 */
export async function streamDocumentToResponse(
  doc: DocBytesSource,
  res: Response,
): Promise<boolean> {
  const mime = doc.mimeType || "application/octet-stream";
  if (doc.fileKey) {
    try {
      const file = await objectStorageService.getObjectEntityFile(
        normalizeFileKey(doc.fileKey),
      );
      res.setHeader("Content-Type", mime);
      const nodeStream = file.createReadStream();
      await new Promise<void>((resolve, reject) => {
        nodeStream.on("error", reject);
        nodeStream.on("end", () => resolve());
        nodeStream.pipe(res);
      });
      return true;
    } catch (err) {
      if (!(err instanceof ObjectNotFoundError)) throw err;
      // fall through to legacy fileData if present
    }
  }
  if (doc.fileData) {
    const buffer = Buffer.from(doc.fileData, "base64");
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
    return true;
  }
  return false;
}
