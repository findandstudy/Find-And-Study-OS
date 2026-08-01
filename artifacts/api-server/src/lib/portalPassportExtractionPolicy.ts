export const PORTAL_PASSPORT_IDENTITY_EXTRACTION_VERSION = 1;

const normalizedConfidence = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase();

export function hasHighConfidencePassportIdentityExtraction(
  extracted: Record<string, unknown> | null,
  confidenceScore: number,
): boolean {
  if (!extracted) return false;
  return normalizedConfidence(extracted.identityConfidence) === "high" ||
    normalizedConfidence(extracted.confidence) === "high" ||
    confidenceScore >= 0.9;
}

/**
 * Re-read legacy/low-confidence passport extraction at most once with the
 * identity-specific prompt. A version marker prevents every staff click from
 * repeating the same AI request when the source document is genuinely unclear.
 */
export function shouldRefreshPassportIdentityExtraction(
  extracted: Record<string, unknown> | null,
  confidenceScore: number,
): boolean {
  if (hasHighConfidencePassportIdentityExtraction(extracted, confidenceScore)) {
    return false;
  }
  const version = Number(extracted?.portalPassportIdentityExtractionVersion ?? 0);
  return !Number.isFinite(version) ||
    version < PORTAL_PASSPORT_IDENTITY_EXTRACTION_VERSION;
}

export function stampPassportIdentityExtraction(
  extracted: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...extracted,
    portalPassportIdentityExtractionVersion:
      PORTAL_PASSPORT_IDENTITY_EXTRACTION_VERSION,
  };
}
