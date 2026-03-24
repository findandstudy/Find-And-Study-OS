const LATIN_NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ\s'-]+$/;

export function isLatinText(text: string): boolean {
  return LATIN_NAME_RE.test(text);
}

export function normalizeNameField(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  return value.trim().toUpperCase();
}

const NAME_FIELDS = new Set([
  "firstName", "lastName", "motherName", "fatherName",
]);

export function normalizeAndValidateNames(
  body: Record<string, unknown>,
  fields?: string[],
): { error: string | null; normalized: Record<string, unknown> } {
  const result = { ...body };
  const checkFields = fields || [...NAME_FIELDS];
  for (const field of checkFields) {
    const val = result[field];
    if (val !== undefined && val !== null && typeof val === "string" && val.trim() !== "") {
      const trimmed = val.trim();
      if (!isLatinText(trimmed)) {
        return {
          error: `${field} must contain only Latin characters`,
          normalized: result,
        };
      }
      result[field] = trimmed.toUpperCase();
    }
  }
  return { error: null, normalized: result };
}
