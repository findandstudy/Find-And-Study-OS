import {
  PROGRAM_SUPPORTED_LOCALES,
  type ProgramSupportedLocale,
} from "./programTranslationContract.js";

export const PUBLIC_WEB_ENTITY_TYPES = [
  "PROGRAM",
  "UNIVERSITY",
  "DESTINATION",
  "CITY",
  "PAGE",
  "ARTICLE",
] as const;

export type PublicWebEntityType = (typeof PUBLIC_WEB_ENTITY_TYPES)[number];
export type PublicWebLocale = ProgramSupportedLocale;
export type PublicWebRevisionOrigin = "HUMAN" | "AI_ASSISTED" | "IMPORT";
export type PublicWebTranslationStatus = "SOURCE" | "PUBLISHED" | "MISSING" | "STALE";

export const PUBLIC_WEB_REQUIRED_FACTS: Record<PublicWebEntityType, readonly string[]> = {
  PROGRAM: [
    "name",
    "institution",
    "degree",
    "tuition",
    "currency",
    "duration",
    "requirements",
    "intakes",
  ],
  UNIVERSITY: ["name", "country", "status"],
  DESTINATION: ["name", "country", "body"],
  CITY: ["name", "country", "body"],
  PAGE: ["title", "body"],
  ARTICLE: ["title", "body"],
};

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const INTEGER_ENTITY_ID_RE = /^[1-9][0-9]{0,9}$/;
const MAX_ALLOWLIST_ENTRIES = 1_000;

const LATIN_FALLBACKS: Record<string, string> = {
  æ: "ae",
  ø: "o",
  œ: "oe",
  ı: "i",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ß: "ss",
};

export function normalizePublicWebLocale(value: unknown): PublicWebLocale | null {
  const locale = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .split("-")[0] as PublicWebLocale;
  return PROGRAM_SUPPORTED_LOCALES.includes(locale) ? locale : null;
}

export function normalizePublicWebSlug(value: unknown): string {
  const transliterated = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[æøœıłđðþß]/g, (character) => LATIN_FALLBACKS[character] ?? "")
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (!transliterated) throw new Error("public_web_slug_empty");
  return transliterated.slice(0, 180).replace(/-+$/g, "");
}

function normalizeEntityId(value: string | number): string {
  const id = String(value).trim();
  if (!INTEGER_ENTITY_ID_RE.test(id)) {
    throw new Error("public_web_entity_id_invalid");
  }
  return id;
}

export function buildPublicWebCanonicalPath(input: {
  entityType: PublicWebEntityType;
  entityId: string | number;
  locale: PublicWebLocale;
  slug: string;
}): string {
  if (!PUBLIC_WEB_ENTITY_TYPES.includes(input.entityType)) {
    throw new Error("public_web_entity_type_invalid");
  }
  const locale = normalizePublicWebLocale(input.locale);
  if (!locale) throw new Error("public_web_locale_invalid");
  const slug = normalizePublicWebSlug(input.slug);
  const id = normalizeEntityId(input.entityId);

  switch (input.entityType) {
    case "PROGRAM":
      return `/${locale}/programs/${slug}-${id}`;
    case "UNIVERSITY":
      return `/${locale}/universities/${slug}-${id}`;
    case "DESTINATION":
      return `/${locale}/destinations/${slug}`;
    case "CITY":
      return `/${locale}/cities/${slug}-${id}`;
    case "PAGE":
      return `/${locale}/${slug}`;
    case "ARTICLE":
      return `/${locale}/guides/${slug}-${id}`;
  }
}

export function isExpectedPublicWebCanonicalPath(input: {
  entityType: PublicWebEntityType;
  entityId: string | number;
  locale: PublicWebLocale;
  slug: string;
  canonicalPath: string;
}): boolean {
  try {
    return buildPublicWebCanonicalPath(input) === input.canonicalPath;
  } catch {
    return false;
  }
}

export type PublicWebEvidenceCandidate = {
  status: "OBSERVED" | "VERIFIED" | "REJECTED" | "SUPERSEDED";
  factKeys: readonly string[];
  verifiedAt: string | Date | null;
  expiresAt: string | Date | null;
};

export type PublicWebPublicationCandidate = {
  entityType: PublicWebEntityType;
  entityId: string | number;
  entityActive: boolean;
  locale: PublicWebLocale;
  slug: string;
  canonicalPath: string;
  title: string;
  contentSizeBytes: number;
  origin: PublicWebRevisionOrigin;
  authorLegacyUserId: number;
  reviewerLegacyUserId: number | null;
  publisherLegacyUserId: number | null;
  reviewedAt: string | Date | null;
  sourceSha256: string;
  contentSha256: string;
  generatorReceiptSha256: string | null;
  qualityStatus: "PENDING" | "PASS" | "FAIL";
  sourceCoverage: "MISSING" | "PARTIAL" | "COMPLETE";
  translationStatus: PublicWebTranslationStatus;
  seoStatus: "PENDING" | "PASS" | "FAIL";
  structuredDataStatus: "PENDING" | "PASS" | "FAIL";
  requestedIndex: boolean;
  evidence: readonly PublicWebEvidenceCandidate[];
};

export type PublicWebPublicationBlocker =
  | "entity_inactive"
  | "canonical_path_invalid"
  | "title_missing"
  | "content_size_invalid"
  | "source_hash_invalid"
  | "content_hash_invalid"
  | "ai_receipt_missing"
  | "quality_not_passed"
  | "source_coverage_incomplete"
  | "verified_source_missing"
  | "critical_fact_evidence_missing"
  | "review_missing"
  | "maker_checker_conflict"
  | "publisher_missing"
  | "translation_unavailable"
  | "seo_not_passed"
  | "structured_data_not_passed"
  | "index_not_requested";

export type PublicWebPublicationDecision = {
  publishAllowed: boolean;
  indexAllowed: boolean;
  publishBlockers: PublicWebPublicationBlocker[];
  indexBlockers: PublicWebPublicationBlocker[];
  missingFactKeys: string[];
};

function validDate(value: string | Date | null): number | null {
  if (value === null) return null;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function evaluatePublicWebPublication(
  candidate: PublicWebPublicationCandidate,
  now: string | Date,
): PublicWebPublicationDecision {
  const nowTimestamp = validDate(now);
  if (nowTimestamp === null) throw new Error("public_web_evaluation_time_invalid");

  const blockers: PublicWebPublicationBlocker[] = [];
  if (!candidate.entityActive) blockers.push("entity_inactive");
  if (!isExpectedPublicWebCanonicalPath(candidate)) {
    blockers.push("canonical_path_invalid");
  }
  if (!candidate.title.trim()) blockers.push("title_missing");
  if (
    !Number.isSafeInteger(candidate.contentSizeBytes) ||
    candidate.contentSizeBytes < 1 ||
    candidate.contentSizeBytes > 1_048_576
  ) {
    blockers.push("content_size_invalid");
  }
  if (!SHA256_RE.test(candidate.sourceSha256)) blockers.push("source_hash_invalid");
  if (!SHA256_RE.test(candidate.contentSha256)) blockers.push("content_hash_invalid");
  if (
    candidate.origin === "AI_ASSISTED" &&
    !SHA256_RE.test(candidate.generatorReceiptSha256 ?? "")
  ) {
    blockers.push("ai_receipt_missing");
  }
  if (candidate.qualityStatus !== "PASS") blockers.push("quality_not_passed");
  if (candidate.sourceCoverage !== "COMPLETE") {
    blockers.push("source_coverage_incomplete");
  }

  const currentEvidence = candidate.evidence.filter((item) => {
    const verifiedAt = validDate(item.verifiedAt);
    const expiresAt = validDate(item.expiresAt);
    return (
      item.status === "VERIFIED" &&
      verifiedAt !== null &&
      verifiedAt <= nowTimestamp &&
      (item.expiresAt === null || (expiresAt !== null && expiresAt > nowTimestamp))
    );
  });
  if (currentEvidence.length === 0) blockers.push("verified_source_missing");

  const evidencedFacts = new Set(
    currentEvidence.flatMap((item) => item.factKeys.map((fact) => fact.trim())),
  );
  const missingFactKeys = PUBLIC_WEB_REQUIRED_FACTS[candidate.entityType].filter(
    (fact) => !evidencedFacts.has(fact),
  );
  if (missingFactKeys.length > 0) blockers.push("critical_fact_evidence_missing");

  if (
    candidate.reviewerLegacyUserId === null ||
    validDate(candidate.reviewedAt) === null
  ) {
    blockers.push("review_missing");
  } else if (candidate.reviewerLegacyUserId === candidate.authorLegacyUserId) {
    blockers.push("maker_checker_conflict");
  }
  if (candidate.publisherLegacyUserId === null) blockers.push("publisher_missing");

  const expectedTranslationStatus =
    candidate.locale === "en" ? "SOURCE" : "PUBLISHED";
  if (candidate.translationStatus !== expectedTranslationStatus) {
    blockers.push("translation_unavailable");
  }

  const publishBlockers = unique(blockers);
  const indexBlockers = [...publishBlockers];
  if (!candidate.requestedIndex) indexBlockers.push("index_not_requested");
  if (candidate.seoStatus !== "PASS") indexBlockers.push("seo_not_passed");
  if (candidate.structuredDataStatus !== "PASS") {
    indexBlockers.push("structured_data_not_passed");
  }

  return {
    publishAllowed: publishBlockers.length === 0,
    indexAllowed: unique(indexBlockers).length === 0,
    publishBlockers,
    indexBlockers: unique(indexBlockers),
    missingFactKeys,
  };
}

export type PublicWebRolloutDecision = {
  mode: "off" | "allowlist" | "all";
  enabled: boolean;
  reason: "mode_off" | "tenant_not_allowed" | "enabled" | "invalid_config";
};

export function resolvePublicWebRollout(input: {
  mode: string | undefined;
  tenantId: string;
  tenantAllowlist: string | undefined;
}): PublicWebRolloutDecision {
  const mode = (input.mode ?? "off").trim().toLowerCase();
  if (!UUID_V7_RE.test(input.tenantId)) {
    return { mode: "off", enabled: false, reason: "invalid_config" };
  }
  if (mode === "off") {
    return { mode: "off", enabled: false, reason: "mode_off" };
  }
  if (mode === "all") {
    return { mode: "all", enabled: true, reason: "enabled" };
  }
  if (mode !== "allowlist") {
    return { mode: "off", enabled: false, reason: "invalid_config" };
  }

  const values = (input.tenantAllowlist ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    values.length === 0 ||
    values.length > MAX_ALLOWLIST_ENTRIES ||
    values.some((value) => !UUID_V7_RE.test(value))
  ) {
    return { mode: "off", enabled: false, reason: "invalid_config" };
  }

  return values.includes(input.tenantId.toLowerCase())
    ? { mode: "allowlist", enabled: true, reason: "enabled" }
    : { mode: "allowlist", enabled: false, reason: "tenant_not_allowed" };
}
