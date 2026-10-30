// Only the server-resolved owning agent profile may supply these claims.
const text = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.trim() && value.trim().length <= limit && !/[\x00-\x1f\x7f]/.test(value)
    ? value.trim() : null;

export function academyProfileClaims(profile: {companyName?: unknown; businessName?: unknown; country?: unknown} | null | undefined) {
  return {
    company: text(profile?.companyName, 180) ?? text(profile?.businessName, 180),
    // Academy normalizes ISO codes and historical English/Turkish country labels.
    country: text(profile?.country, 100),
  };
}
