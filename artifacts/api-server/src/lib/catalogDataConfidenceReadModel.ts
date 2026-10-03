import type { PoolClient } from "pg";

export const CATALOG_DATA_CONFIDENCE_LIMIT = 200;
export const CATALOG_DATA_CONFIDENCE_STATEMENT_TIMEOUT_MS = 8_000;

export type CatalogConfidenceRow = {
  programId: number;
  programName: string;
  universityId: number;
  universityName: string;
  country: string;
  city: string | null;
  confidence: "verified" | "partial" | "missing";
  missingFields: Array<"tuition" | "intake" | "deadline">;
  sourceName: string | null;
  sourceUrl: string | null;
  lastVerifiedAt: string | null;
  sourceExpiresAt: string | null;
  publicPagesAffected: number;
  activeApplicationsAffected: number;
};

export type CatalogConfidenceResponse = {
  generatedAt: string;
  mode: "read_only";
  data: CatalogConfidenceRow[];
  summary: {
    activePrograms: number;
    verifiedPrograms: number;
    partialPrograms: number;
    missingPrograms: number;
    missingTuition: number;
    missingIntake: number;
    missingDeadline: number;
    rowsReturned: number;
    truncated: boolean;
  };
  policy: string;
};

const QUERY = `
WITH active_programs AS MATERIALIZED (
  SELECT p.id, p.name, p.university_id, u.name AS university_name,
         u.country, u.city
  FROM programs p
  JOIN universities u ON u.id = p.university_id
  WHERE p.is_active = true AND u.is_active = true
),
price_facts AS MATERIALIZED (
  SELECT DISTINCT ON (pc.program_id)
         pc.program_id, pc.source_verified_at, pc.source_expires_at,
         source.display_name AS source_name, record.source_url
  FROM price_components pc
  JOIN catalog_source_records record ON record.id = pc.source_record_id
  JOIN catalog_sources source ON source.id = record.source_id
  WHERE pc.component_type = 'TUITION'
    AND pc.status = 'ACTIVE'
    AND pc.effective_from <= now()
    AND (pc.effective_until IS NULL OR pc.effective_until >= now())
    AND (pc.source_expires_at IS NULL OR pc.source_expires_at >= now())
    AND record.entity_type = 'PRICE'
    AND record.status = 'VERIFIED'
    AND record.verified_at IS NOT NULL AND record.verified_at <= now()
    AND record.effective_at <= now()
    AND (record.expires_at IS NULL OR record.expires_at >= now())
    AND source.status = 'ACTIVE'
  ORDER BY pc.program_id, pc.source_verified_at DESC, pc.id DESC
),
intake_facts AS MATERIALIZED (
  SELECT i.program_id,
         count(*)::int AS active_intakes,
         count(i.application_deadline_at)::int AS dated_intakes,
         max(i.source_verified_at) AS source_verified_at,
         max(i.source_expires_at) AS source_expires_at,
         (array_agg(source.display_name ORDER BY i.source_verified_at DESC NULLS LAST, i.id)
           FILTER (WHERE source.display_name IS NOT NULL))[1] AS source_name,
         (array_agg(record.source_url ORDER BY i.source_verified_at DESC NULLS LAST, i.id)
           FILTER (WHERE record.source_url IS NOT NULL))[1] AS source_url
  FROM program_intakes i
  LEFT JOIN catalog_source_records record ON record.id = i.source_record_id
  LEFT JOIN catalog_sources source ON source.id = record.source_id AND source.status = 'ACTIVE'
  WHERE i.status = 'ACTIVE'
    AND (i.application_deadline_at IS NULL OR i.application_deadline_at >= now())
    AND (i.source_expires_at IS NULL OR i.source_expires_at >= now())
  GROUP BY i.program_id
),
application_impact AS MATERIALIZED (
  SELECT program_id, count(*)::int AS active_applications
  FROM applications
  WHERE deleted_at IS NULL AND program_id IS NOT NULL
  GROUP BY program_id
),
classified AS (
  SELECT ap.*, price.source_verified_at AS price_verified_at,
         price.source_expires_at AS price_expires_at,
         price.source_name AS price_source_name, price.source_url AS price_source_url,
         COALESCE(intake.active_intakes, 0) AS active_intakes,
         COALESCE(intake.dated_intakes, 0) AS dated_intakes,
         intake.source_verified_at AS intake_verified_at,
         intake.source_expires_at AS intake_expires_at,
         intake.source_name AS intake_source_name, intake.source_url AS intake_source_url,
         COALESCE(impact.active_applications, 0) AS active_applications,
         CASE
           WHEN price.program_id IS NOT NULL AND COALESCE(intake.active_intakes, 0) > 0
                AND COALESCE(intake.dated_intakes, 0) > 0 THEN 'verified'
           WHEN price.program_id IS NOT NULL OR COALESCE(intake.active_intakes, 0) > 0 THEN 'partial'
           ELSE 'missing'
         END AS confidence
  FROM active_programs ap
  LEFT JOIN price_facts price ON price.program_id = ap.id
  LEFT JOIN intake_facts intake ON intake.program_id = ap.id
  LEFT JOIN application_impact impact ON impact.program_id = ap.id
),
scored AS (
  SELECT *,
    count(*) OVER ()::int AS total_programs,
    count(*) FILTER (WHERE confidence = 'verified') OVER ()::int AS verified_programs,
    count(*) FILTER (WHERE confidence = 'partial') OVER ()::int AS partial_programs,
    count(*) FILTER (WHERE confidence = 'missing') OVER ()::int AS missing_programs,
    count(*) FILTER (WHERE price_verified_at IS NULL) OVER ()::int AS missing_tuition,
    count(*) FILTER (WHERE active_intakes = 0) OVER ()::int AS missing_intake,
    count(*) FILTER (WHERE active_intakes > 0 AND dated_intakes = 0) OVER ()::int AS missing_deadline
  FROM classified
)
SELECT * FROM scored
ORDER BY CASE confidence WHEN 'missing' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END,
         active_applications DESC, id
LIMIT $1`;

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function publicHttpUrl(value: unknown): string | null {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function readCatalogDataConfidence(
  client: Pick<PoolClient, "query">,
): Promise<CatalogConfidenceResponse> {
  const result = await client.query(QUERY, [CATALOG_DATA_CONFIDENCE_LIMIT]);
  const raw = result.rows as Array<Record<string, unknown>>;
  const data: CatalogConfidenceRow[] = raw.map((row) => {
    const activeIntakes = Number(row.active_intakes ?? 0);
    const datedIntakes = Number(row.dated_intakes ?? 0);
    const missingFields: CatalogConfidenceRow["missingFields"] = [];
    if (!row.price_verified_at) missingFields.push("tuition");
    if (activeIntakes === 0) missingFields.push("intake");
    else if (datedIntakes === 0) missingFields.push("deadline");
    const priceVerifiedAt = iso(row.price_verified_at);
    const intakeVerifiedAt = iso(row.intake_verified_at);
    const usePrice = Boolean(priceVerifiedAt && (!intakeVerifiedAt || priceVerifiedAt >= intakeVerifiedAt));
    return {
      programId: Number(row.id),
      programName: String(row.name ?? ""),
      universityId: Number(row.university_id),
      universityName: String(row.university_name ?? ""),
      country: String(row.country ?? ""),
      city: row.city ? String(row.city) : null,
      confidence: row.confidence as CatalogConfidenceRow["confidence"],
      missingFields,
      sourceName: String((usePrice ? row.price_source_name : row.intake_source_name) ?? "") || null,
      sourceUrl: publicHttpUrl(usePrice ? row.price_source_url : row.intake_source_url),
      lastVerifiedAt: usePrice ? priceVerifiedAt : intakeVerifiedAt,
      sourceExpiresAt: iso(usePrice ? row.price_expires_at : row.intake_expires_at),
      publicPagesAffected: 2 + (row.city ? 1 : 0) + (row.country ? 1 : 0),
      activeApplicationsAffected: Number(row.active_applications ?? 0),
    };
  });
  const first = raw[0] ?? {};
  const activePrograms = Number(first.total_programs ?? 0);
  return {
    generatedAt: new Date().toISOString(),
    mode: "read_only",
    data,
    summary: {
      activePrograms,
      verifiedPrograms: Number(first.verified_programs ?? 0),
      partialPrograms: Number(first.partial_programs ?? 0),
      missingPrograms: Number(first.missing_programs ?? 0),
      missingTuition: Number(first.missing_tuition ?? 0),
      missingIntake: Number(first.missing_intake ?? 0),
      missingDeadline: Number(first.missing_deadline ?? 0),
      rowsReturned: data.length,
      truncated: activePrograms > data.length,
    },
    policy: "Read-only preview. It never creates facts, changes applications, or publishes catalogue pages.",
  };
}
