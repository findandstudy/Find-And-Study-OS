import sharp from "sharp";
import { loadDocumentBytes, type DocBytesSource } from "./documentBytes";

const THUMBNAIL_SIZE = 128;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;

interface ThumbnailEntry {
  buffer: Buffer;
  expiresAt: number;
}

const cache = new Map<string, ThumbnailEntry>();
const inFlight = new Map<string, Promise<Buffer>>();
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
  return sharp(svg).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
}

async function createThumbnail(source: DocBytesSource, fallbackLabel: string): Promise<Buffer> {
  const loaded = await loadDocumentBytes(source);
  if (!loaded || loaded.mimeType === "application/pdf") {
    // The production sharp build has no PDF renderer. Returning a tiny stable
    // placeholder is safer than sending a multi-megabyte PDF to an <img> tag.
    return placeholderThumbnail(fallbackLabel);
  }
  try {
    return await sharp(loaded.buffer, { failOn: "warning" })
      .rotate()
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: "cover",
        position: "attention",
        withoutEnlargement: false,
      })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
  } catch {
    return placeholderThumbnail(fallbackLabel);
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
): Promise<{ buffer: Buffer; cacheStatus: "hit" | "miss" | "coalesced" }> {
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return { buffer: cached.buffer, cacheStatus: "hit" };
  }
  if (cached) {
    cacheBytes -= cached.buffer.length;
    cache.delete(cacheKey);
  }

  const active = inFlight.get(cacheKey);
  if (active) return { buffer: await active, cacheStatus: "coalesced" };

  const pending = createThumbnail(source, fallbackLabel);
  inFlight.set(cacheKey, pending);
  try {
    const buffer = await pending;
    store(cacheKey, buffer);
    return { buffer, cacheStatus: "miss" };
  } finally {
    inFlight.delete(cacheKey);
  }
}

export function clearStudentPhotoThumbnailCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  cacheBytes = 0;
}
