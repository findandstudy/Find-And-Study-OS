export const REPORTING_SCHEMA_VERSION = 1 as const;
export const REPORTING_METRIC_VERSION = "2026-09-03.v1" as const;

export type ReportingMetricDefinition = {
  key: string;
  label: string;
  domain: "executive" | "funnel" | "applications" | "finance" | "data_quality";
  description: string;
  grain: "record" | "application" | "currency" | "issue";
  timeSemantics:
    | "created_cohort"
    | "current_inventory"
    | "financial_event"
    | "global_snapshot";
  sensitivity: "aggregate_non_personal";
  denominator?: string;
};

/**
 * Versioned semantic layer for the first Reporting Center slice. Keeping the
 * definitions beside the API prevents cards with similar names from silently
 * using different dates, grains or denominators.
 */
export const REPORTING_METRICS: readonly ReportingMetricDefinition[] = [
  {
    key: "leads.created",
    label: "Leads created",
    domain: "funnel",
    description:
      "Active lead records created inside the selected UTC date interval.",
    grain: "record",
    timeSemantics: "created_cohort",
    sensitivity: "aggregate_non_personal",
  },
  {
    key: "leads.converted_from_cohort",
    label: "Lead cohort converted",
    domain: "funnel",
    description:
      "Selected lead cohort whose current record is linked to a converted student.",
    grain: "record",
    timeSemantics: "created_cohort",
    sensitivity: "aggregate_non_personal",
    denominator: "leads.created",
  },
  {
    key: "students.created",
    label: "Students created",
    domain: "executive",
    description:
      "Active student records created inside the selected UTC date interval.",
    grain: "record",
    timeSemantics: "created_cohort",
    sensitivity: "aggregate_non_personal",
  },
  {
    key: "applications.created",
    label: "Applications created",
    domain: "applications",
    description:
      "Active application records created inside the selected UTC date interval.",
    grain: "application",
    timeSemantics: "created_cohort",
    sensitivity: "aggregate_non_personal",
  },
  {
    key: "applications.active_inventory",
    label: "Active applications",
    domain: "applications",
    description:
      "Current non-terminal application inventory, independent of creation date.",
    grain: "application",
    timeSemantics: "current_inventory",
    sensitivity: "aggregate_non_personal",
  },
  {
    key: "applications.won_from_cohort",
    label: "Application cohort won",
    domain: "applications",
    description:
      "Selected application cohort currently in a pipeline stage marked won.",
    grain: "application",
    timeSemantics: "created_cohort",
    sensitivity: "aggregate_non_personal",
    denominator: "applications.created",
  },
  {
    key: "finance.net_commission_by_currency",
    label: "Net commission by currency",
    domain: "finance",
    description:
      "University commission less agent and sub-agent liability, never combined across currencies.",
    grain: "currency",
    timeSemantics: "financial_event",
    sensitivity: "aggregate_non_personal",
  },
  {
    key: "finance.service_fee_by_currency",
    label: "Service fee by currency",
    domain: "finance",
    description:
      "Service fee billed and collected values grouped by their original currency.",
    grain: "currency",
    timeSemantics: "financial_event",
    sensitivity: "aggregate_non_personal",
  },
  {
    key: "data_quality.issue_count",
    label: "Data quality issues",
    domain: "data_quality",
    description:
      "Aggregate issue counts from read-only deterministic checks; no identifiers are returned.",
    grain: "issue",
    timeSemantics: "global_snapshot",
    sensitivity: "aggregate_non_personal",
  },
] as const;

export type ReportingFilters = {
  from: string;
  to: string;
  fromInclusive: Date;
  toExclusive: Date;
  previousFromInclusive: Date;
  season: string | null;
  branchId: number | null;
  bucket: "day" | "week" | "month";
};

export type ReportingQueryInput = Record<string, unknown>;

export class ReportingQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportingQueryError";
  }
}

export class ReportingScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportingScopeError";
  }
}

/**
 * Converts the actor's server-resolved branch visibility into the only branch
 * predicate the reporting SQL may use. `null` means platform-wide visibility;
 * an empty array deliberately matches no branch-scoped rows.
 */
export function resolveReportingBranchScope(
  requestedBranchId: number | null,
  visibleBranchIds: number[] | null,
): number[] | null {
  if (requestedBranchId !== null) {
    if (
      visibleBranchIds !== null &&
      !visibleBranchIds.includes(requestedBranchId)
    ) {
      throw new ReportingScopeError(
        "The selected branch is outside your reporting scope",
      );
    }
    return [requestedBranchId];
  }
  return visibleBranchIds === null ? null : [...new Set(visibleBranchIds)];
}

function dateOnlyUtc(value: unknown, name: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ReportingQueryError(`${name} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ReportingQueryError(`${name} is not a valid calendar date`);
  }
  return parsed;
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

export function parseReportingFilters(
  input: ReportingQueryInput,
  now = new Date(),
): ReportingFilters {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const explicitTo = dateOnlyUtc(input.to, "to");
  const explicitFrom = dateOnlyUtc(input.from, "from");
  const toDate = explicitTo ?? today;
  const fromDate = explicitFrom ?? addUtcDays(toDate, -29);
  const toExclusive = addUtcDays(toDate, 1);
  const spanDays = Math.round(
    (toExclusive.getTime() - fromDate.getTime()) / 86_400_000,
  );
  if (spanDays <= 0)
    throw new ReportingQueryError("from must be on or before to");
  if (spanDays > 366)
    throw new ReportingQueryError("date interval cannot exceed 366 days");

  let season: string | null = null;
  if (
    input.season !== undefined &&
    input.season !== null &&
    input.season !== ""
  ) {
    if (typeof input.season !== "string" || !/^\d{4}$/.test(input.season)) {
      throw new ReportingQueryError("season must be a four-digit year");
    }
    season = input.season;
  }

  let branchId: number | null = null;
  if (
    input.branchId !== undefined &&
    input.branchId !== null &&
    input.branchId !== ""
  ) {
    const raw =
      typeof input.branchId === "string"
        ? input.branchId
        : String(input.branchId);
    if (!/^\d+$/.test(raw))
      throw new ReportingQueryError("branchId must be a positive integer");
    branchId = Number(raw);
    if (!Number.isSafeInteger(branchId) || branchId <= 0) {
      throw new ReportingQueryError("branchId must be a positive integer");
    }
  }

  const bucket = spanDays <= 45 ? "day" : spanDays <= 180 ? "week" : "month";
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    fromInclusive: fromDate,
    toExclusive,
    previousFromInclusive: new Date(fromDate.getTime() - spanDays * 86_400_000),
    season,
    branchId,
    bucket,
  };
}

export function safeRate(
  numerator: number,
  denominator: number,
): number | null {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  )
    return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

export function safeChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0)
    return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000) / 100;
}

export function publicReportingFilters(filters: ReportingFilters) {
  return {
    from: filters.from,
    to: filters.to,
    season: filters.season,
    branchId: filters.branchId,
    timezone: "UTC" as const,
    endBoundary: "inclusive" as const,
  };
}

export function buildReportingMeta(
  filters: ReportingFilters,
  startedAt: number,
  warnings: string[] = [],
) {
  return {
    schemaVersion: REPORTING_SCHEMA_VERSION,
    metricVersion: REPORTING_METRIC_VERSION,
    asOf: new Date().toISOString(),
    filters: publicReportingFilters(filters),
    freshness: {
      status: "live" as const,
      source: "operational_postgresql" as const,
      cacheAgeSeconds: 0,
    },
    latencyMs: Math.max(0, Date.now() - startedAt),
    warnings,
    privacy: "aggregate_non_personal" as const,
  };
}
