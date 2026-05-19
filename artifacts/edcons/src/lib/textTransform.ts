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

function transliterate(input: string): string {
  let out = "";
  for (const ch of input) {
    if (TR_TO_LATIN_MAP[ch] !== undefined) {
      out += TR_TO_LATIN_MAP[ch];
      continue;
    }
    const normalized = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    out += normalized;
  }
  return out;
}

export function toLatinUpper(input: string): string {
  if (!input) return "";
  return transliterate(input).toUpperCase();
}

export function digitsOnly(input: string): string {
  if (!input) return "";
  return input.replace(/\D+/g, "");
}
