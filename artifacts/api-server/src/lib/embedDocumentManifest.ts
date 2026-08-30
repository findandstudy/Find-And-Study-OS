export const EMBED_DOCUMENT_MANIFEST_LIMIT = 32;

const EMBED_DOCUMENT_TYPE_PATTERN = /^[a-z0-9_-]{1,64}$/;
const RESERVED_DOCUMENT_TYPES = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Normalizes the small label-only manifest sent by the embed widget after the
 * document bytes have already been persisted on the lead.
 *
 * Programs can expose more than four document slots (required + optional), so
 * this must not truncate the manifest to the historical four-file limit. A
 * generous finite cap still bounds public input without making validation
 * depend on upload order.
 */
export function normalizeEmbedDocumentManifest(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const normalized = new Set<string>();
  for (const rawLabel of value.slice(0, EMBED_DOCUMENT_MANIFEST_LIMIT)) {
    const label = String(rawLabel ?? "").trim().toLowerCase();
    if (
      !EMBED_DOCUMENT_TYPE_PATTERN.test(label) ||
      RESERVED_DOCUMENT_TYPES.has(label)
    ) {
      continue;
    }
    normalized.add(label);
  }

  return [...normalized];
}
