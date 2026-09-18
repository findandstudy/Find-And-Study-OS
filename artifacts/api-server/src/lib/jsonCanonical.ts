/**
 * Produces a deterministic JSON representation independent of object-key
 * ordering. PostgreSQL jsonb normalizes key order, so plain JSON.stringify()
 * is not suitable for comparing a database value with a file-parsed value.
 */
function compareUtf16CodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    // ECMAScript relational string comparison is a locale/ICU-independent
    // lexicographic comparison of UTF-16 code units.
    .sort(([left], [right]) => compareUtf16CodeUnits(left, right));
  return `{${entries
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}:${canonicalJson(item)}`,
    )
    .join(",")}}`;
}
