export function catalogLimit(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? Math.max(1, Math.min(12, n)) : 6;
}
export function catalogLayoutClass(content: Record<string, unknown>) {
  if (content.layout === "list") return "grid grid-cols-1 gap-5";
  if (content.layout === "carousel") return "flex gap-5 overflow-x-auto snap-x snap-mandatory pb-4 [&>article]:min-w-[min(85vw,320px)] [&>article]:snap-start";
  return Number(content.columns) === 2 ? "grid gap-5 sm:grid-cols-2" : Number(content.columns) === 4 ? "grid gap-5 sm:grid-cols-2 lg:grid-cols-4" : "grid gap-5 sm:grid-cols-2 lg:grid-cols-3";
}
export function catalogParameters(content: Record<string, unknown>, locale: string) {
  const params = new URLSearchParams({ source: String(content.source || "programs"), locale, limit: String(catalogLimit(content.limit)) });
  for (const key of ["country", "city", "countryId", "cityId", "universityId", "degree", "language", "institutionType"]) {
    if (content[key]) params.set(key, String(content[key]));
  }
  return params.toString();
}
