import type { VerifiedUniversityApplicationNumber } from "./types.js";

export const UNIVERSITY_APPLICATION_ID_MAX_LENGTH = 128;
export const VERIFIED_APPLICATION_NUMBER_SOURCES = [
  "labeled_portal_field",
  "structured_portal_field",
  "matched_application_row",
  "official_document",
] as const;

export type UniversityApplicationIdParseResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/** Shared validation for manual application edits and portal writeback. */
export function parseUniversityApplicationId(
  value: unknown,
): UniversityApplicationIdParseResult {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: "University application ID must be a string or null" };
  }

  const normalized = value.trim();
  if (!normalized) return { ok: true, value: null };
  if (normalized.length > UNIVERSITY_APPLICATION_ID_MAX_LENGTH) {
    return {
      ok: false,
      error: `University application ID must be at most ${UNIVERSITY_APPLICATION_ID_MAX_LENGTH} characters`,
    };
  }
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) {
    return { ok: false, error: "University application ID contains invalid control characters" };
  }
  return { ok: true, value: normalized };
}

export type UniversityApplicationIdSyncPlan =
  | { action: "skip" }
  | { action: "set"; value: string }
  | { action: "conflict"; current: string; incoming: string };

export type VerifiedApplicationNumberParseResult =
  | { ok: true; value: VerifiedUniversityApplicationNumber }
  | { ok: false; error: string };

/** Fail closed unless the adapter supplied the complete semantic proof. */
export function parseVerifiedApplicationNumber(
  value: unknown,
): VerifiedApplicationNumberParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Verified application number evidence must be an object" };
  }
  const candidate = value as Partial<VerifiedUniversityApplicationNumber>;
  const parsedValue = parseUniversityApplicationId(candidate.value);
  if (!parsedValue.ok || !parsedValue.value) {
    return {
      ok: false,
      error: parsedValue.ok
        ? "Verified application number value is required"
        : parsedValue.error,
    };
  }
  if (!VERIFIED_APPLICATION_NUMBER_SOURCES.includes(candidate.source as never)) {
    return { ok: false, error: "Verified application number source is not allowed" };
  }
  if (
    candidate.identityBound !== true ||
    candidate.targetBound !== true ||
    candidate.uniqueMatch !== true
  ) {
    return {
      ok: false,
      error: "Verified application number must be identity-, target- and unique-record-bound",
    };
  }
  let sourceLabel: string | undefined;
  if (candidate.sourceLabel !== undefined) {
    const parsedLabel = parseUniversityApplicationId(candidate.sourceLabel);
    if (!parsedLabel.ok || !parsedLabel.value) {
      return { ok: false, error: "Verified application number sourceLabel is invalid" };
    }
    sourceLabel = parsedLabel.value;
  }
  return {
    ok: true,
    value: {
      value: parsedValue.value,
      source: candidate.source!,
      ...(sourceLabel ? { sourceLabel } : {}),
      identityBound: true,
      targetBound: true,
      uniqueMatch: true,
    },
  };
}

/** Never replaces a different value entered by staff or another confirmed run. */
export function planUniversityApplicationIdSync(
  currentValue: string | null | undefined,
  verifiedApplicationNumber: unknown,
): UniversityApplicationIdSyncPlan {
  const verified = parseVerifiedApplicationNumber(verifiedApplicationNumber);
  if (!verified.ok) return { action: "skip" };
  const incoming = verified.value.value;

  const current = parseUniversityApplicationId(currentValue);
  if (!current.ok || !current.value) return { action: "set", value: incoming };
  if (current.value === incoming) return { action: "skip" };
  return { action: "conflict", current: current.value, incoming };
}
