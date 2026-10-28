export type DetailCatalogSource = {
  sourceName?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  validUntil?: string;
};

export type DetailGenerationSource = DetailCatalogSource & { field: string };

const SECTION_SOURCE_FIELDS: Record<string, readonly string[]> = {
  hero: ["heroMedia", "description", "shortDescription", "name", "website"],
  overview: ["description", "shortDescription", "name"],
  gallery: ["gallery", "heroMedia", "description"],
  highlights: ["highlights", "education", "universities", "programs", "description"],
  cautions: ["cautions", "admission", "requirements", "education"],
  curriculum: ["curriculum", "education", "programs"],
  education: ["education", "programs", "languages", "programLanguages"],
  facts: ["keyFacts", "currency", "languages", "name", "country", "city"],
  admission: ["admission", "admissionProcess", "admissionRules", "requirements"],
  requirements: ["requirements", "entryRequirements", "admissionRules", "admission"],
  fees: ["fees", "tuitionFee", "additionalFees", "currency"],
  intakes: ["intakes", "intakeGuide", "admission"],
  intakeGuide: ["intakeGuide", "intakes", "admission"],
  scholarships: ["scholarships", "fees"],
  living: ["living", "livingCost", "housing", "workPermit"],
  campus: ["campus", "address", "gallery"],
  climate: ["climate", "coordinates"],
  weather: ["climate", "coordinates"],
  housing: ["housing", "livingCost"],
  transport: ["transportModes", "campusGeography", "coordinates"],
  visa: ["visa", "visaInfo", "workPermit"],
  services: ["services", "support"],
  support: ["support", "services"],
  recognition: ["recognition", "ranking", "education", "universities"],
  cities: ["cities", "description"],
  universities: ["universities", "education"],
  programs: ["programs", "education"],
  related: ["related", "programs"],
  studentStory: ["studentStory", "services", "campus"],
  reviews: ["reviews", "services"],
  faq: ["faq", "admission", "requirements"],
  applyGuide: ["applyGuide", "admission", "requirements", "visaInfo"],
  cta: ["cta", "applyGuide", "admission"],
  mobileActions: ["cta", "applyGuide"],
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

const safePublicUrl = (value: unknown): string | undefined => {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
};

const sourceMetadata = (kind: string, payload: unknown): Record<string, unknown> => {
  const root = record(payload);
  const entity = record(kind === "destination" ? root?.destination : root?.data);
  return record(entity?.sourceMetadata) ?? {};
};

export function detailGenerationSources(kind: string, payload: unknown): DetailGenerationSource[] {
  return Object.entries(sourceMetadata(kind, payload)).flatMap(([field, raw]) => {
    const entry = record(raw);
    if (!entry) return [];
    const sourceUrl = safePublicUrl(entry.sourceUrl);
    const sourceName = text(entry.sourceName);
    if (!sourceUrl || !sourceName) return [];
    return [{
      field,
      sourceName,
      sourceUrl,
      ...(text(entry.verifiedAt) ? { verifiedAt: text(entry.verifiedAt) } : {}),
      ...(text(entry.validUntil) ? { validUntil: text(entry.validUntil) } : {}),
    }];
  }).slice(0, 32);
}

export function detailSectionSources(
  sectionKey: string,
  sources: readonly DetailGenerationSource[],
  fallback?: { label: string; url: string },
) {
  const preferred = SECTION_SOURCE_FIELDS[sectionKey] ?? [sectionKey];
  const byField = new Map(sources.map(source => [source.field, source] as const));
  const selected = preferred.flatMap(field => byField.get(field) ?? []).filter((source, index, all) =>
    all.findIndex(candidate => candidate.sourceUrl === source.sourceUrl) === index,
  ).slice(0, 8);
  const resolved = selected.length ? selected : sources.filter(source => ["description", "website", "name"].includes(source.field)).slice(0, 1);
  if (resolved.length) return resolved.map(source => ({ label: source.sourceName!, url: source.sourceUrl! }));
  return fallback ? [fallback] : [];
}

export function detailSectionReviewedOn(sectionKey: string, sources: readonly DetailGenerationSource[], fallback: string) {
  const urls = new Set(detailSectionSources(sectionKey, sources).map(source => source.url));
  const dates = sources.filter(source => source.sourceUrl && urls.has(source.sourceUrl))
    .map(source => source.verifiedAt?.slice(0, 10))
    .filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= fallback))
    .sort();
  return dates.at(-1) ?? fallback;
}
