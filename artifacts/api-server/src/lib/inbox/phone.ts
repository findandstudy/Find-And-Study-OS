import { parsePhoneNumberFromString, isValidPhoneNumber, type CountryCode } from "libphonenumber-js";

const DEFAULT_COUNTRY: CountryCode = "TR";

/**
 * Normalize a phone string to E.164 format. Returns null if it cannot
 * be parsed. Default country is Turkey (TR).
 */
export function toE164(input: string | null | undefined, defaultCountry: CountryCode = DEFAULT_COUNTRY): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  try {
    const parsed = parsePhoneNumberFromString(raw, defaultCountry);
    if (!parsed) return null;
    if (!parsed.isValid()) return null;
    return parsed.number;
  } catch {
    return null;
  }
}

export function isValidE164(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return isValidPhoneNumber(value);
  } catch {
    return false;
  }
}
