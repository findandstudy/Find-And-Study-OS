/** Public-page price projection. Catalogue values remain a labelled, unverified fallback. */
export type PublicTuition = {
  amount: number;
  currency: string;
  verified: boolean;
  source: "verified" | "legacy";
  frequency: string | null;
  isFrom: boolean;
};

const currencies = new Set(Intl.supportedValuesOf("currency"));
export function publicCurrency(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return currencies.has(code) ? code : null;
}

export function publicMinorAmount(value: unknown, currency: unknown): number | null {
  const code = publicCurrency(currency);
  if (!code || value === null || value === undefined || String(value).trim() === "") return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  return amount / 10 ** digits;
}

type Price = { componentType: string; amountMinor: unknown; currencyCode: string; frequency: string; intakeId?: string | null };
type Legacy = { tuitionFee?: number | null; discountedFee?: number | null; currency?: string | null };

/** verifiedPrices MUST come from the current, verified, date/intake-bound read-model. */
export function projectPublicTuition(legacy: Legacy, verifiedPrices: readonly Price[]): PublicTuition | null {
  if ((verifiedPrices as readonly Price[] & { truncated?: boolean }).truncated) return null;
  const candidates = verifiedPrices.filter(price => price.componentType === "TUITION");
  if (candidates.length) {
    // Different currencies/periods cannot be compared as one advertised price.
    const valid = candidates.map(price => ({ price, currency: publicCurrency(price.currencyCode), amount: publicMinorAmount(price.amountMinor, price.currencyCode) }));
    if (valid.some(item => item.currency === null || item.amount === null) ||
        new Set(valid.map(item => item.currency)).size !== 1 ||
        new Set(valid.map(item => item.price.frequency)).size !== 1) return null;
    const first = valid.reduce((best, item) => item.amount! < best.amount! ? item : best);
    return { amount: first.amount!, currency: first.currency!, verified: true, source: "verified",
      frequency: first.price.frequency, isFrom: new Set(valid.map(item => item.amount)).size > 1 };
  }
  const currency = publicCurrency(legacy.currency);
  const amount = legacy.discountedFee ?? legacy.tuitionFee;
  if (!currency || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null;
  return { amount, currency, verified: false, source: "legacy", frequency: null, isFrom: false };
}
