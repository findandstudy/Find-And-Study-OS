export type EmbedUniversityScope = {
  mode: "all" | "selected";
  universityIds: number[];
};

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveEmbedUniversityScope(presetFilters: unknown): EmbedUniversityScope {
  if (!presetFilters || typeof presetFilters !== "object" || Array.isArray(presetFilters)) {
    return { mode: "all", universityIds: [] };
  }

  const filters = presetFilters as Record<string, unknown>;
  if (filters.universityScope === "all") {
    return { mode: "all", universityIds: [] };
  }

  const universityIds = Array.isArray(filters.universityIds)
    ? [...new Set(filters.universityIds.map(positiveInteger).filter((id): id is number => id !== null))]
    : [];
  const legacyUniversityId = positiveInteger(filters.universityId);

  if (universityIds.length > 0) {
    return { mode: "selected", universityIds };
  }
  if (legacyUniversityId !== null) {
    return { mode: "selected", universityIds: [legacyUniversityId] };
  }
  if (filters.universityScope === "selected") {
    return { mode: "selected", universityIds: [] };
  }
  return { mode: "all", universityIds: [] };
}

export function isValidEmbedUniversityScope(presetFilters: unknown): boolean {
  const scope = resolveEmbedUniversityScope(presetFilters);
  return scope.mode === "all" || scope.universityIds.length > 0;
}
