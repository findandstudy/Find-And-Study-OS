type ExportFilters = string | Record<string, string | number | undefined>;

export function downloadCrmExcel(
  baseUrl: string,
  kind: "leads" | "students" | "applications",
  filters: ExportFilters,
  selectedIds: ReadonlySet<number>,
) {
  const params = new URLSearchParams(typeof filters === "string" ? filters : undefined);
  if (typeof filters !== "string") {
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
  }
  for (const key of ["page", "limit", "includeFacets"]) params.delete(key);
  if (selectedIds.size) params.set("ids", [...selectedIds].join(","));
  const link = document.createElement("a");
  link.href = `${baseUrl}/api/export/${kind}?${params}`;
  link.click();
}
