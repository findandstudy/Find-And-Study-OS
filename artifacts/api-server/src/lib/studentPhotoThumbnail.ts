import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { loadDocumentBytes, type DocBytesSource } from "./documentBytes";
import { readBoundedDocumentStream } from "./documentByteLimits";
import { createThumbnailAdmission } from "./studentPhotoThumbnailAdmission";

const THUMBNAIL_SIZE = 128;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_RENDERABLE_PDF_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_BYTES = MAX_RENDERABLE_PDF_BYTES;
const MAX_INPUT_PIXELS = 16_000_000;
const MAX_RENDERED_BYTES = 1024 * 1024;
const SOURCE_READ_TIMEOUT_MS = 10_000;
const thumbnailAdmission = createThumbnailAdmission({
  maxActive: 2,
  maxQueued: 8,
  maxReservedBytes: 2 * MAX_SOURCE_BYTES,
  queueTimeoutMs: 5_000,
});
const execFileAsync = promisify(execFile);

// Fixed 128px JPEG for admission failures: no further image jobs, user data or
// unbounded per-label fallback work can be created when the queue is already full.
const OVERLOAD_PLACEHOLDER = Buffer.from("/9j/2wBDAAcFBQYFBAcGBgYIBwcICxILCwoKCxYPEA0SGhYbGhkWGRgcICgiHB4mHhgZIzAkJiorLS4tGyIyNTEsNSgsLSz/2wBDAQcICAsJCxULCxUsHRkdLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCz/wAARCACAAIADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAME/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwDSkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//9k=", "base64");

interface ThumbnailEntry {
  buffer: Buffer;
  expiresAt: number;
}

const cache = new Map<string, ThumbnailEntry>();
type ThumbnailResult = { buffer: Buffer; cacheable: boolean };
const inFlight = new Map<string, Promise<ThumbnailResult>>();
let cacheBytes = 0;

function safeInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(part => part[0] || "").join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "?";
}

async function placeholderThumbnail(label: string): Promise<Buffer> {
  const initials = safeInitials(label);
  const svg = Buffer.from(`
    <svg width="${THUMBNAIL_SIZE}" height="${THUMBNAIL_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#e8eefc"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle"
        font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#173b92">${initials}</text>
    </svg>
  `);
  return sharp(svg, { limitInputPixels: MAX_INPUT_PIXELS }).timeout({ seconds: 5 })
    .jpeg({ quality: 78, mozjpeg: true }).toBuffer();
}

function isPdf(buffer: Buffer, declaredMimeType: string): boolean {
  return declaredMimeType === "application/pdf"
    || buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

async function renderPdfFirstPage(buffer: Buffer): Promise<Buffer | null> {
  if (buffer.length === 0 || buffer.length > MAX_RENDERABLE_PDF_BYTES) return null;

  // The outer admission slot covers download, both renderers, decode and cleanup.
  const tempDirectory = await mkdtemp(join(tmpdir(), "fas-student-photo-"));
  const pdfPath = join(tempDirectory, "source.pdf");
  const outputBase = join(tempDirectory, "page");
  const outputPath = `${outputBase}.jpg`;
  try {
    await writeFile(pdfPath, buffer);
    let rendered = false;
    try {
      await execFileAsync(
        "pdftoppm",
        ["-jpeg", "-f", "1", "-l", "1", "-scale-to", "512", "-singlefile", pdfPath, outputBase],
        { timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 },
      );
      rendered = true;
    } catch {
      try {
        await execFileAsync(
          "gs",
          [
            "-dSAFER",
            "-dBATCH",
            "-dNOPAUSE",
            "-dFirstPage=1",
            "-dLastPage=1",
            "-dFIXEDMEDIA",
            "-dPDFFitPage",
            "-sDEVICE=jpeg",
            "-r96",
            "-g512x512",
            `-sOutputFile=${outputPath}`,
            pdfPath,
          ],
          { timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 },
        );
        rendered = true;
      } catch {
        // A missing/failed renderer is not fatal. The caller returns initials.
      }
    }
    if (!rendered) return null;
    return await readBoundedDocumentStream(createReadStream(outputPath, { end: MAX_RENDERED_BYTES }), {
      maxBytes: MAX_RENDERED_BYTES, readTimeoutMs: SOURCE_READ_TIMEOUT_MS,
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function normalizeThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { failOn: "warning", limitInputPixels: MAX_INPUT_PIXELS, pages: 1, animated: false })
    .timeout({ seconds: 5 })
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
      fit: "cover",
      position: "attention",
      withoutEnlargement: false,
    })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

async function createThumbnail(source: DocBytesSource, fallbackLabel: string): Promise<ThumbnailResult> {
  try {
    return await thumbnailAdmission.run(MAX_SOURCE_BYTES, async () => {
      try {
        const loaded = await loadDocumentBytes(source, { maxBytes: MAX_SOURCE_BYTES, readTimeoutMs: SOURCE_READ_TIMEOUT_MS });
        if (loaded) {
          const image = isPdf(loaded.buffer, loaded.mimeType) ? await renderPdfFirstPage(loaded.buffer) : loaded.buffer;
          if (image) return { buffer: await normalizeThumbnail(image), cacheable: true };
        }
      } catch {
        // Invalid/oversize/timed-out inputs are never rendered outside admission.
      }
      return { buffer: await placeholderThumbnail(fallbackLabel), cacheable: false };
    });
  } catch {
    return { buffer: OVERLOAD_PLACEHOLDER, cacheable: false };
  }
}

function store(key: string, buffer: Buffer): void {
  while (cache.size > 0 && cacheBytes + buffer.length > MAX_CACHE_BYTES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = cache.get(oldestKey);
    if (oldest) cacheBytes -= oldest.buffer.length;
    cache.delete(oldestKey);
  }
  cache.set(key, { buffer, expiresAt: Date.now() + CACHE_TTL_MS });
  cacheBytes += buffer.length;
}

export async function getStudentPhotoThumbnail(
  cacheKey: string,
  source: DocBytesSource,
  fallbackLabel: string,
): Promise<{ buffer: Buffer; cacheStatus: "hit" | "miss" | "coalesced"; cacheable: boolean }> {
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return { buffer: cached.buffer, cacheStatus: "hit", cacheable: true };
  }
  if (cached) {
    cacheBytes -= cached.buffer.length;
    cache.delete(cacheKey);
  }

  const active = inFlight.get(cacheKey);
  if (active) return { ...await active, cacheStatus: "coalesced" };

  const pending = createThumbnail(source, fallbackLabel);
  inFlight.set(cacheKey, pending);
  try {
    const { buffer, cacheable } = await pending;
    // Queue/decoder failures must not poison the six-hour success cache.
    if (cacheable) store(cacheKey, buffer);
    return { buffer, cacheStatus: "miss", cacheable };
  } finally {
    inFlight.delete(cacheKey);
  }
}

/** Evaluate only after authorization and a successful render/cache lookup. */
export function studentPhotoThumbnailResponsePolicy(thumbnail: ThumbnailResult, ifNoneMatch: string | string[] | undefined): {
  cacheControl: string; etag: string | null; notModified: boolean;
} {
  if (!thumbnail.cacheable) return { cacheControl: "private, no-store", etag: null, notModified: false };
  // Old document-id-only validators may refer to a cached error placeholder.
  // A successful representation gets its own opaque validator instead.
  const etag = `"student-photo-thumb-v2-${createHash("sha256").update(thumbnail.buffer).digest("hex")}"`;
  return { cacheControl: "private, max-age=300", etag, notModified: ifNoneMatch === etag };
}

export function clearStudentPhotoThumbnailCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  cacheBytes = 0;
}
