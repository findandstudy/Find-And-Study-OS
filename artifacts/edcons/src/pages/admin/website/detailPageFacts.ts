export type DetailPageFacts = {
  city?: string;
  country?: string;
  university?: string;
  program?: string;
  universities?: string[];
  programs?: string[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const valueText = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const namedItems = (value: unknown, limit = 12): string[] =>
  Array.isArray(value)
    ? [...new Set(value.flatMap((item) => {
        if (typeof item === "string") return valueText(item) ? [item.trim()] : [];
        const row = record(item);
        const name = valueText(row?.name) ?? valueText(row?.title) ?? valueText(row?.programName) ?? valueText(row?.universityName);
        return name ? [name] : [];
      }))].slice(0, limit)
    : [];

/** Extracts catalogue-authoritative identity values for deterministic SEO defaults. */
export function detailPageFacts(
  kind: "program" | "university" | "destination" | "city",
  payload: unknown,
  fallbackTitle = "",
): DetailPageFacts {
  const root = record(payload);
  const entity = record(kind === "destination" ? root?.destination : root?.data);
  const name = valueText(entity?.name) ?? valueText(entity?.programName) ?? valueText(fallbackTitle);
  const country = kind === "destination"
    ? valueText(entity?.country) ?? name
    : valueText(entity?.country) ?? valueText(entity?.universityCountry);
  const city = kind === "city" ? name : valueText(entity?.city) ?? valueText(entity?.universityCity);
  const university = kind === "university" ? name : valueText(entity?.universityName);
  const program = kind === "program" ? name : undefined;
  const universities = namedItems(root?.universities ?? entity?.universities);
  const programs = namedItems(root?.programs ?? root?.related ?? entity?.programs);
  return {
    ...(city ? { city } : {}),
    ...(country ? { country } : {}),
    ...(university ? { university } : {}),
    ...(program ? { program } : {}),
    ...(universities.length ? { universities } : {}),
    ...(programs.length ? { programs } : {}),
  };
}
