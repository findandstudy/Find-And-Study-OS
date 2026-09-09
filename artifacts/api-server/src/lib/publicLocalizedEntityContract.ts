import type { ProgramSupportedLocale } from "./programTranslationContract";

export type PublicLocalizedEntitySnapshot = {
  canonicalPath: string;
  title: string;
  summary: string | null;
  content: Record<string, unknown>;
  indexState: "INDEX" | "NOINDEX";
};

export type PublicLocalizedEntityDelivery =
  | { mode: "off"; snapshot: null }
  | { mode: "published"; snapshot: PublicLocalizedEntitySnapshot | null };

export type PublicLocalizedEntityCollectionDelivery = {
  mode: "off" | "published";
  snapshots: Map<number, PublicLocalizedEntitySnapshot>;
};

export function selectLocalizedEntityDelivery(
  collection: PublicLocalizedEntityCollectionDelivery,
  entityId: number,
): PublicLocalizedEntityDelivery {
  return collection.mode === "off"
    ? { mode: "off", snapshot: null }
    : { mode: "published", snapshot: collection.snapshots.get(entityId) ?? null };
}

export type PublicLocalizedDestinationRouteResolution =
  | { mode: "off"; destinationId: null; snapshot: null }
  | {
      mode: "published";
      destinationId: number | null;
      snapshot: PublicLocalizedEntitySnapshot | null;
    };

const TEXT_LIMITS = {
  title: 500,
  summary: 4_000,
  body: 200_000,
  label: 500,
  city: 120,
} as const;

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function snapshotText(
  snapshot: PublicLocalizedEntitySnapshot,
  keys: readonly string[],
  maxLength: number,
): string | null {
  for (const key of keys) {
    const value = boundedText(snapshot.content[key], maxLength);
    if (value) return value;
  }
  return null;
}

function snapshotCities(snapshot: PublicLocalizedEntitySnapshot): string[] | null {
  const raw = snapshot.content.popularCities;
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : null;
  if (!values) return null;
  const cities = values.flatMap((value) => {
    const city = boundedText(value, TEXT_LIMITS.city);
    return city ? [city] : [];
  }).slice(0, 24);
  return cities.length > 0 ? cities : null;
}

export function resolveLocalizedUniversityFields(input: {
  locale: ProgramSupportedLocale;
  delivery: PublicLocalizedEntityDelivery;
  base: {
    name: string;
    description: string | null;
    universityType: string | null;
  };
}): {
  available: boolean;
  name: string;
  description: string | null;
  universityType: string | null;
  contentPolicy: "LEGACY_SOURCE_ONLY" | "PUBLISHED_REVISION";
} {
  const snapshot = input.delivery.snapshot;
  if (input.delivery.mode === "off") {
    return { available: true, ...input.base, contentPolicy: "LEGACY_SOURCE_ONLY" };
  }
  if (!snapshot) {
    return {
      available: input.locale === "en",
      ...input.base,
      contentPolicy: "LEGACY_SOURCE_ONLY",
    };
  }
  const description = snapshotText(snapshot, ["description", "body"], TEXT_LIMITS.body)
    ?? boundedText(snapshot.summary, TEXT_LIMITS.summary)
    ?? (input.locale === "en" ? input.base.description : null);
  const universityType = snapshotText(snapshot, ["universityType"], TEXT_LIMITS.label)
    ?? (input.locale === "en" ? input.base.universityType : null);
  return {
    available: true,
    name: boundedText(snapshot.title, TEXT_LIMITS.title) ?? input.base.name,
    description,
    universityType,
    contentPolicy: "PUBLISHED_REVISION",
  };
}

export function resolveLocalizedDestinationFields(input: {
  locale: ProgramSupportedLocale;
  delivery: PublicLocalizedEntityDelivery;
  base: {
    name: string;
    shortDescription: string | null;
    description: string | null;
    whyStudyHere: string | null;
    livingCost: string | null;
    climate: string | null;
    language: string | null;
    currency: string | null;
    visaInfo: string | null;
    workPermit: string | null;
    popularCities: string[];
  };
}): {
  available: boolean;
  name: string;
  shortDescription: string | null;
  description: string | null;
  whyStudyHere: string | null;
  livingCost: string | null;
  climate: string | null;
  language: string | null;
  currency: string | null;
  visaInfo: string | null;
  workPermit: string | null;
  popularCities: string[];
  contentPolicy: "LEGACY_SOURCE_ONLY" | "PUBLISHED_REVISION";
} {
  const snapshot = input.delivery.snapshot;
  if (input.delivery.mode === "off") {
    return { available: true, ...input.base, contentPolicy: "LEGACY_SOURCE_ONLY" };
  }
  if (!snapshot) {
    return {
      available: input.locale === "en",
      ...input.base,
      contentPolicy: "LEGACY_SOURCE_ONLY",
    };
  }

  const preserveBase = input.locale === "en";
  const optional = (keys: readonly string[], maxLength: number = TEXT_LIMITS.body, fallback: string | null) =>
    snapshotText(snapshot, keys, maxLength) ?? (preserveBase ? fallback : null);
  const description = optional(["description", "body"], TEXT_LIMITS.body, input.base.description);
  const shortDescription = optional(
    ["shortDescription", "summary"],
    TEXT_LIMITS.summary,
    boundedText(snapshot.summary, TEXT_LIMITS.summary) ?? input.base.shortDescription,
  ) ?? boundedText(snapshot.summary, TEXT_LIMITS.summary);

  return {
    available: true,
    name: boundedText(snapshot.title, TEXT_LIMITS.title) ?? input.base.name,
    shortDescription,
    description,
    whyStudyHere: optional(["whyStudyHere"], TEXT_LIMITS.body, input.base.whyStudyHere),
    livingCost: optional(["livingCost"], TEXT_LIMITS.label, input.base.livingCost),
    climate: optional(["climate"], TEXT_LIMITS.label, input.base.climate),
    language: optional(["language"], TEXT_LIMITS.label, input.base.language),
    currency: optional(["currency"], TEXT_LIMITS.label, input.base.currency),
    visaInfo: optional(["visaInfo"], TEXT_LIMITS.body, input.base.visaInfo),
    workPermit: optional(["workPermit"], TEXT_LIMITS.body, input.base.workPermit),
    popularCities: snapshotCities(snapshot) ?? (preserveBase ? input.base.popularCities : []),
    contentPolicy: "PUBLISHED_REVISION",
  };
}
