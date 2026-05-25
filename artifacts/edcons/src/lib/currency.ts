export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "TRY", "AED"] as const;
export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number];

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  TRY: "₺",
  AED: "د.إ",
};

export function isSupportedCurrency(c: string | null | undefined): c is CurrencyCode {
  return !!c && (SUPPORTED_CURRENCIES as readonly string[]).includes(c);
}

export function normalizeCurrency(c: string | null | undefined): CurrencyCode {
  return isSupportedCurrency(c) ? c : "USD";
}

export function toNum(v: any): number {
  const n = parseFloat(String(v ?? 0));
  return isNaN(n) ? 0 : n;
}

export function formatMoney(amount: number | string | null | undefined, currency: string | null | undefined = "USD", opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number }): string {
  const c = normalizeCurrency(currency);
  const n = toNum(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      minimumFractionDigits: opts?.minimumFractionDigits ?? 0,
      maximumFractionDigits: opts?.maximumFractionDigits ?? 0,
    }).format(n);
  } catch {
    const sym = CURRENCY_SYMBOLS[c] || c;
    return `${sym}${n.toLocaleString("en-US")}`;
  }
}

export type ByCurrency = Record<string, number>;

export function pickDefaultCurrency(byCurrency: ByCurrency | undefined | null, fallback: CurrencyCode = "USD"): CurrencyCode {
  if (!byCurrency) return fallback;
  let best: CurrencyCode = fallback;
  let bestVal = -Infinity;
  for (const [c, v] of Object.entries(byCurrency)) {
    if (!isSupportedCurrency(c)) continue;
    if (v > bestVal) { bestVal = v; best = c; }
  }
  return bestVal > 0 ? best : fallback;
}

export function listNonZeroCurrencies(byCurrency: ByCurrency | undefined | null): CurrencyCode[] {
  if (!byCurrency) return [];
  const entries = Object.entries(byCurrency)
    .filter(([c, v]) => isSupportedCurrency(c) && v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return entries.map(([c]) => c as CurrencyCode);
}
