const TR_TO_LATIN_MAP: Record<string, string> = {
  "ç": "c", "Ç": "C",
  "ğ": "g", "Ğ": "G",
  "ı": "i", "İ": "I",
  "ö": "o", "Ö": "O",
  "ş": "s", "Ş": "S",
  "ü": "u", "Ü": "U",
  "â": "a", "Â": "A",
  "î": "i", "Î": "I",
  "û": "u", "Û": "U",
};

export function transliterateToLatin(input: string): string {
  let out = "";
  for (const ch of input) {
    if (TR_TO_LATIN_MAP[ch] !== undefined) {
      out += TR_TO_LATIN_MAP[ch];
      continue;
    }
    const stripped = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    out += stripped;
  }
  return out;
}

export function toLatinUpper(input: string): string {
  if (!input) return "";
  return transliterateToLatin(input).toUpperCase();
}

export function digitsOnly(input: string | null | undefined): string {
  if (!input) return "";
  return String(input).replace(/\D+/g, "");
}

const LATIN_NAME_RE = /^[A-Za-z\s'-]+$/;

export function isLatinText(text: string): boolean {
  return LATIN_NAME_RE.test(text);
}

export function normalizeNameField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return "";
  return toLatinUpper(value.trim());
}

const DEFAULT_NAME_FIELDS = new Set<string>([
  "firstName", "lastName", "motherName", "fatherName",
]);

export const EXTENDED_NAME_FIELDS: string[] = [
  "firstName", "lastName", "motherName", "fatherName",
  "highSchool", "universityBachelor", "universityMaster",
  "schoolName", "address",
];

export function normalizeAndValidateNames(
  body: Record<string, unknown>,
  fields?: string[],
): { error: string | null; normalized: Record<string, unknown> } {
  const result = { ...body };
  const checkFields = fields || [...DEFAULT_NAME_FIELDS];
  for (const field of checkFields) {
    const val = result[field];
    if (val !== undefined && val !== null && typeof val === "string" && val.trim() !== "") {
      result[field] = toLatinUpper(val.trim());
    }
  }
  return { error: null, normalized: result };
}

export function normalizePhoneField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  const raw = String(value);
  const hasLeadingPlus = raw.trim().startsWith("+");
  const digits = digitsOnly(raw);
  return hasLeadingPlus ? `+${digits}` : digits;
}
