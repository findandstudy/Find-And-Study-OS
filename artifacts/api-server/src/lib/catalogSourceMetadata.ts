export const CATALOG_SOURCE_FIELDS = {
  country: ["name", "code", "flagEmoji", "dialCode", "shortDescription", "description", "languages", "currency", "climate", "livingCost", "visaInfo", "workPermit", "heroMedia", "gallery", "highlights", "cautions", "education", "keyFacts", "admission", "requirements", "scholarships", "housing", "services", "recognition", "cities", "universities", "faq", "applyGuide", "cta"],
  city: ["name", "country", "description", "coordinates", "transportModes", "campusGeography", "programLanguages", "climate", "housing", "heroMedia", "gallery", "highlights", "cautions", "education", "keyFacts", "living", "requirements", "visa", "services", "universities", "programs", "faq", "applyGuide"],
  university: ["name", "country", "city", "website", "logoUrl", "description", "universityType", "address", "ranking", "qsRanking", "timesRanking", "shanghaiRanking", "leidenRanking", "fees", "admissionProcess", "nationalityPolicy", "admissionRules", "heroMedia", "gallery", "highlights", "cautions", "programs", "admission", "scholarships", "intakeGuide", "keyFacts", "education", "support", "services", "campus", "housing", "recognition", "living", "reviews", "faq", "applyGuide"],
  program: ["name", "description", "degree", "field", "language", "duration", "tuitionFee", "discountedFee", "scholarship", "currency", "depositFee", "applicationFee", "serviceFeeAmount", "languageFee", "feeType", "additionalFees", "intakes", "requirements", "quota", "admissionRules", "heroMedia", "gallery", "highlights", "curriculum", "admission", "fees", "living", "campus", "climate", "housing", "services", "applyGuide", "studentStory", "recognition", "related", "faq"],
} as const;

export type CatalogSourceEntity = keyof typeof CATALOG_SOURCE_FIELDS;
export type CatalogSourceEntry = { sourceName?: string; sourceUrl?: string; verifiedAt?: string; validUntil?: string; notes?: string };

const SOURCE_COLUMN_PROPERTIES = {
  "source / institution": "sourceName", source: "sourceName", institution: "sourceName", name: "sourceName",
  "source url": "sourceUrl", url: "sourceUrl", "last verified": "verifiedAt", "verified at": "verifiedAt",
  verified: "verifiedAt", "valid until": "validUntil", "internal note": "notes", notes: "notes", note: "notes",
} as const satisfies Record<string, keyof CatalogSourceEntry>;

const parseColumn = (rawKey: string): { field: string; property: keyof CatalogSourceEntry } | null => {
  const technical = rawKey.trim().match(/^source\.([A-Za-z0-9_]+)\.(sourceName|sourceUrl|verifiedAt|validUntil|notes)$/i);
  if (technical) {
    const property = ({ sourcename: "sourceName", sourceurl: "sourceUrl", verifiedat: "verifiedAt", validuntil: "validUntil", notes: "notes" } as const)[technical[2].toLowerCase() as "sourcename" | "sourceurl" | "verifiedat" | "validuntil" | "notes"];
    return { field: technical[1], property };
  }
  const friendly = rawKey.trim().match(/^source\s*[·|:]\s*.*?\[([A-Za-z0-9_]+)\]\s*[·|:]\s*(.+)$/i);
  if (!friendly) return null;
  const property = SOURCE_COLUMN_PROPERTIES[friendly[2].trim().toLowerCase().replace(/\s+/g, " ") as keyof typeof SOURCE_COLUMN_PROPERTIES];
  return property ? { field: friendly[1], property } : null;
};

export const isCatalogSourceMetadataColumn = (key: string) => parseColumn(key) !== null;

const text = (value: unknown, max: number) => {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Source text values must be strings");
  const clean = value.trim();
  if (!clean) return undefined;
  if (clean.length > max) throw new Error(`Source text cannot exceed ${max} characters`);
  return clean;
};
const url = (value: unknown) => {
  const clean = text(value, 2048);
  if (!clean) return undefined;
  let parsed: URL;
  try { parsed = new URL(clean); } catch { throw new Error("Source URL must be a valid http(s) URL"); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Source URL must be a public http(s) URL without credentials");
  return parsed.toString();
};
const date = (value: unknown, label: string) => {
  const clean = text(value, 64);
  if (!clean) return undefined;
  const parsed = new Date(clean);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date`);
  return parsed.toISOString();
};

export function normalizeCatalogSourceMetadata(entity: CatalogSourceEntity, value: unknown): Record<string, CatalogSourceEntry> {
  if (value == null || value === "") return {};
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw new Error("Source metadata JSON is invalid"); } }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Source metadata must be an object");
  const allowed = new Set<string>(CATALOG_SOURCE_FIELDS[entity]);
  const result: Record<string, CatalogSourceEntry> = {};
  if (Object.keys(value).length > allowed.size) throw new Error("Too many source metadata fields");
  for (const [field, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.has(field)) throw new Error(`Unsupported source field: ${field}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Invalid source metadata for ${field}`);
    const input = raw as Record<string, unknown>;
    const entry: CatalogSourceEntry = { sourceName: text(input.sourceName, 160), sourceUrl: url(input.sourceUrl), verifiedAt: date(input.verifiedAt, "Verified at"), validUntil: date(input.validUntil, "Valid until"), notes: text(input.notes, 500) };
    if (entry.verifiedAt && entry.validUntil && new Date(entry.validUntil) < new Date(entry.verifiedAt)) throw new Error(`Valid until cannot be before verified at for ${field}`);
    const cleaned = Object.fromEntries(Object.entries(entry).filter(([, item]) => item !== undefined));
    if (Object.keys(cleaned).length) result[field] = cleaned;
  }
  return result;
}

export function normalizeCatalogSourceMetadataFromRow(entity: CatalogSourceEntity, row: Record<string, unknown>) {
  const legacy = Object.entries(row).find(([key]) => ["sourcemetadata", "sourcemetadatajson"].includes(key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")))?.[1];
  const base = normalizeCatalogSourceMetadata(entity, legacy);
  const explicit = new Map<string, Partial<CatalogSourceEntry>>();
  for (const [key, rawValue] of Object.entries(row)) {
    const column = parseColumn(key); if (!column) continue;
    const value = rawValue == null ? "" : String(rawValue).trim(); if (!value) continue;
    explicit.set(column.field, { ...(explicit.get(column.field) ?? {}), [column.property]: value });
  }
  const merged = { ...base }; for (const [field, entry] of explicit) merged[field] = entry;
  return normalizeCatalogSourceMetadata(entity, merged);
}

export function omitCatalogSourceMetadata<T extends Record<string, unknown>>(row: T): Omit<T, "sourceMetadata"> {
  const { sourceMetadata: _sourceMetadata, ...publicRow } = row; return publicRow;
}

export function publicCatalogSources(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, CatalogSourceEntry>).map(([field, entry]) => [field, { sourceName: entry.sourceName, sourceUrl: entry.sourceUrl, verifiedAt: entry.verifiedAt, validUntil: entry.validUntil }]).filter(([, entry]) => Object.values(entry as object).some(Boolean)));
}
