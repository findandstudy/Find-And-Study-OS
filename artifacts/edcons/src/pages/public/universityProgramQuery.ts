import type { PublicProgramSelection } from "./PublicProgramFilters";

export const emptyProgramSelection = (): PublicProgramSelection => ({ country: [], city: [], universityType: [], universityId: [], level: [], language: [], field: [], feeMin: "", feeMax: "" });

/** University identity is owned by the detail route, never by editable filters. */
export function universityProgramQuery(universityId: number, locale: string, search: string, selection: PublicProgramSelection): string {
  if (!Number.isSafeInteger(universityId) || universityId <= 0) throw new Error("Invalid university scope");
  const query = new URLSearchParams({ scope: "public", universityId: String(universityId), detailUniversityId: String(universityId), locale });
  if (search.trim()) query.set("search", search.trim());
  for (const key of ["level", "language", "field"] as const) if (selection[key].length) query.set(key, selection[key].join(","));
  for (const key of ["feeMin", "feeMax"] as const) if (selection[key]) query.set(key, selection[key]);
  return query.toString();
}

export function programPageNumbers(page: number, totalPages: number): Array<number | "..."> {
  if (totalPages <= 7) return Array.from({ length: Math.max(0, totalPages) }, (_, i) => i + 1);
  return [1, ...(page > 3 ? ["..." as const] : []), ...Array.from({ length: Math.min(totalPages - 1, page + 1) - Math.max(2, page - 1) + 1 }, (_, i) => Math.max(2, page - 1) + i), ...(page < totalPages - 2 ? ["..." as const] : []), totalPages];
}
