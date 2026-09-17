export function parseUniversityBulkStatus(body: unknown): { ids: number[]; isActive: boolean } {
  const value = body as { ids?: unknown; isActive?: unknown } | null;
  if (!value || !Array.isArray(value.ids) || !value.ids.length || value.ids.length > 5000 || typeof value.isActive !== "boolean") {
    throw new Error("ids (1–5000 items) and boolean isActive are required");
  }
  if (!value.ids.every(id => typeof id === "number" && Number.isSafeInteger(id) && id > 0 && id <= 2147483647)) {
    throw new Error("ids must contain positive integer IDs");
  }
  return { ids: [...new Set(value.ids)], isActive: value.isActive };
}
