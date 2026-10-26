import type { PublicProgramSelection } from "./PublicProgramFilters";

export const emptyProgramSelection = (): PublicProgramSelection => ({ country: [], city: [], universityType: [], universityId: [], level: [], language: [], field: [], feeMin: "", feeMax: "" });

export type DetailProgramScope =
  | { kind: "country"; country: string }
  | { kind: "city"; country: string; city: string }
  | { kind: "university"; universityId: number };

export function detailProgramQuery(scope: DetailProgramScope, locale: string, search: string, selection: PublicProgramSelection): string {
  const query = new URLSearchParams({ scope: "public", locale });
  const selectable: Array<keyof PublicProgramSelection> = ["level", "language", "field"];
  if (scope.kind === "country") {
    if (!scope.country.trim()) throw new Error("Invalid country scope");
    query.set("country", scope.country.trim());
    selectable.unshift("city", "universityType", "universityId");
  } else if (scope.kind === "city") {
    if (!scope.country.trim() || !scope.city.trim()) throw new Error("Invalid city scope");
    query.set("country", scope.country.trim());
    query.set("city", scope.city.trim());
    selectable.unshift("universityType", "universityId");
  } else {
    if (!Number.isSafeInteger(scope.universityId) || scope.universityId <= 0) throw new Error("Invalid university scope");
    query.set("universityId", String(scope.universityId));
    query.set("detailUniversityId", String(scope.universityId));
  }
  if (search.trim()) query.set("search", search.trim());
  for (const key of selectable) {
    const values = selection[key];
    if (Array.isArray(values) && values.length) query.set(key, values.join(","));
  }
  for (const key of ["feeMin", "feeMax"] as const) if (selection[key]) query.set(key, selection[key]);
  return query.toString();
}

/** University identity is owned by the detail route, never by editable filters. */
export function universityProgramQuery(universityId: number, locale: string, search: string, selection: PublicProgramSelection): string {
  return detailProgramQuery({ kind: "university", universityId }, locale, search, selection);
}

export function programPageNumbers(page: number, totalPages: number): Array<number | "..."> {
  if (totalPages <= 7) return Array.from({ length: Math.max(0, totalPages) }, (_, i) => i + 1);
  return [1, ...(page > 3 ? ["..." as const] : []), ...Array.from({ length: Math.min(totalPages - 1, page + 1) - Math.max(2, page - 1) + 1 }, (_, i) => Math.max(2, page - 1) + i), ...(page < totalPages - 2 ? ["..." as const] : []), totalPages];
}
