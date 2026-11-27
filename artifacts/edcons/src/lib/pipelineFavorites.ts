export const pipelineFavoritesKey = (userId: number | undefined) =>
  `edcons:pipelineFavorites:v1:${userId ?? "anonymous"}`;
export function parsePipelineFavorites(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value.filter(
          (id): id is string =>
            typeof id === "string" &&
            /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
              id,
            ),
        ),
      ),
    ].slice(0, 100);
  } catch {
    return [];
  }
}
