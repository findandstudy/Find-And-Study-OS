import { PROGRAM_SUPPORTED_LOCALES, type ProgramSupportedLocale } from "./programTranslationContract";

export const CATALOG_PAGE_KINDS = ["country", "city", "university", "program"] as const;
export type CatalogPageKind = typeof CATALOG_PAGE_KINDS[number];
export const CATALOG_INVENTORY_SORTS = ["title_asc", "title_desc", "updated_desc", "updated_asc", "id_desc", "id_asc"] as const;
export type CatalogInventorySort = typeof CATALOG_INVENTORY_SORTS[number];
export type CatalogInventoryQuery = { kind: CatalogPageKind; locale: ProgramSupportedLocale; q: string; page: number; pageSize: number; sort: CatalogInventorySort };

export function parseCatalogInventoryQuery(input: Record<string, unknown>): CatalogInventoryQuery {
  const allowed = new Set(["kind", "locale", "q", "page", "pageSize", "sort"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error("Unsupported inventory filter");
  const kind = input.kind ?? "program";
  const locale = input.locale ?? "en";
  const q = input.q ?? "";
  const sort = input.sort ?? "title_asc";
  if (typeof kind !== "string" || !CATALOG_PAGE_KINDS.includes(kind as CatalogPageKind)) throw new Error("Invalid page kind");
  if (typeof locale !== "string" || !PROGRAM_SUPPORTED_LOCALES.includes(locale as ProgramSupportedLocale)) throw new Error("Invalid locale");
  if (typeof q !== "string" || q.length > 120 || /[\u0000-\u001f\u007f]/.test(q)) throw new Error("Invalid search");
  if (typeof sort !== "string" || !CATALOG_INVENTORY_SORTS.includes(sort as CatalogInventorySort)) throw new Error("Invalid sort");
  const integer = (value: unknown, fallback: number, maximum: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value) || Number(value) > maximum) throw new Error("Invalid pagination");
    return Number(value);
  };
  return { kind: kind as CatalogPageKind, locale: locale as ProgramSupportedLocale, q: q.trim(), page: integer(input.page, 1, 999_999), pageSize: integer(input.pageSize, 25, 50), sort: sort as CatalogInventorySort };
}

export function catalogSourceEditPath(kind: CatalogPageKind, id: number, sourceName: string, countryId?: number): string {
  const tab = { country: "countries", city: "cities", university: "universities", program: "programs" }[kind];
  const params = new URLSearchParams({ tab, sourceId: String(id), q: sourceName.slice(0, 200) });
  if (kind === "city" && countryId) params.set("countryId", String(countryId));
  return `/admin/catalog?${params}`;
}

export type CatalogInventoryIssue = "SOURCE_INACTIVE" | "PARENT_INACTIVE" | "CATALOG_POLICY_HIDDEN" | "COUNTRY_ROUTE_UNAVAILABLE" | "PUBLIC_OFFERINGS_UNAVAILABLE" | "DESCRIPTION_MISSING" | "MEDIA_MISSING" | "TRANSLATION_FALLBACK";

export type CatalogEditorialState = "LIVE" | "LIVE_WITH_DRAFT" | "DRAFT" | "TEMPLATE_ONLY";

/** The authoring record is the actionable live/draft source of truth. */
export function resolveCatalogEditorialState(input: {
  pageStatus?: string | null;
  pagePublishedAt?: Date | null;
  publishedVersionNumber?: number | null;
}): CatalogEditorialState {
  if (!input.pageStatus) return "TEMPLATE_ONLY";
  const hasPublishedVersion = Boolean(input.pagePublishedAt && input.publishedVersionNumber);
  if (input.pageStatus === "published" && hasPublishedVersion) return "LIVE";
  if (hasPublishedVersion) return "LIVE_WITH_DRAFT";
  return "DRAFT";
}

export function catalogAvailability(input: { kind: CatalogPageKind; active: boolean; parentActive?: boolean; policyVisible?: boolean; countryRoute?: boolean }): { visible: boolean; admissionsOpen: boolean | null; issues: CatalogInventoryIssue[] } {
  const issues: CatalogInventoryIssue[] = [];
  if (!input.active) issues.push("SOURCE_INACTIVE");
  if (input.parentActive === false) issues.push("PARENT_INACTIVE");
  if (input.policyVisible === false) issues.push("CATALOG_POLICY_HIDDEN");
  if (input.countryRoute === false) issues.push("COUNTRY_ROUTE_UNAVAILABLE");
  const institution = input.kind === "university" || input.kind === "program";
  const visible = institution
    ? input.policyVisible !== false && (input.kind === "university" || input.active)
    : input.active && input.parentActive !== false && input.countryRoute !== false;
  return { visible, admissionsOpen: institution ? input.active && input.parentActive !== false : null, issues };
}
