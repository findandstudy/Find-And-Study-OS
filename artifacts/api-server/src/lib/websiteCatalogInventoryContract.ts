import { PROGRAM_SUPPORTED_LOCALES, type ProgramSupportedLocale } from "./programTranslationContract";

export const CATALOG_PAGE_KINDS = ["country", "city", "university", "program"] as const;
export type CatalogPageKind = typeof CATALOG_PAGE_KINDS[number];
export type CatalogInventoryQuery = { kind: CatalogPageKind; locale: ProgramSupportedLocale; q: string; page: number; pageSize: number };

export function parseCatalogInventoryQuery(input: Record<string, unknown>): CatalogInventoryQuery {
  const allowed = new Set(["kind", "locale", "q", "page", "pageSize"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error("Unsupported inventory filter");
  const kind = input.kind ?? "program";
  const locale = input.locale ?? "en";
  const q = input.q ?? "";
  if (typeof kind !== "string" || !CATALOG_PAGE_KINDS.includes(kind as CatalogPageKind)) throw new Error("Invalid page kind");
  if (typeof locale !== "string" || !PROGRAM_SUPPORTED_LOCALES.includes(locale as ProgramSupportedLocale)) throw new Error("Invalid locale");
  if (typeof q !== "string" || q.length > 120 || /[\u0000-\u001f\u007f]/.test(q)) throw new Error("Invalid search");
  const integer = (value: unknown, fallback: number, maximum: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value) || Number(value) > maximum) throw new Error("Invalid pagination");
    return Number(value);
  };
  return { kind: kind as CatalogPageKind, locale: locale as ProgramSupportedLocale, q: q.trim(), page: integer(input.page, 1, 10_000), pageSize: integer(input.pageSize, 25, 50) };
}

export function catalogSourceEditPath(kind: CatalogPageKind, id: number, sourceName: string, countryId?: number): string {
  const tab = { country: "countries", city: "cities", university: "universities", program: "programs" }[kind];
  const params = new URLSearchParams({ tab, sourceId: String(id), q: sourceName.slice(0, 200) });
  if (kind === "city" && countryId) params.set("countryId", String(countryId));
  return `/admin/catalog?${params}`;
}

export type CatalogInventoryIssue = "SOURCE_INACTIVE" | "PARENT_INACTIVE" | "CATALOG_POLICY_HIDDEN" | "COUNTRY_ROUTE_UNAVAILABLE" | "DESCRIPTION_MISSING" | "MEDIA_MISSING" | "TRANSLATION_FALLBACK";

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
