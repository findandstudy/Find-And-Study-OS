/**
 * passportValidity — pure helpers for passport expiry checks (FAZ 2).
 *
 * Policy (user decision): threshold is TODAY (00:00 UTC), no buffer.
 * Unparseable dates are NOT blocked (fail-open) — we only hard-block
 * when we can positively determine the passport has expired.
 */

/** Parse "YYYY-MM-DD", "DD.MM.YYYY" or "DD/MM/YYYY" → Date (UTC midnight) or null. */
export function parseFlexibleDate(s: string): Date | null {
  const v = String(s || "").trim();
  if (!v) return null;

  let year: number, month: number, day: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) {
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
  } else {
    m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v);
    if (!m) return null;
    day = Number(m[1]); month = Number(m[2]); year = Number(m[3]);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject overflow dates like 31.02.2030
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

/** true only when expiry parses AND is strictly before today (00:00 UTC). */
export function isPassportExpired(expiry: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiry) return false;
  const d = parseFlexibleDate(String(expiry));
  if (!d) return false; // unparseable → do not block
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return d.getTime() < todayUtc;
}
