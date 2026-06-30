// ---------------------------------------------------------------------------
// Topkapı Step 3 — graduation-date formatting.
//
// The CRM stores graduation as a year-only integer (e.g. 2025), but the portal
// field `GraduationDate[]` may render as a plain text/number input OR a native
// date/month/week picker. A native <input type="date"> silently rejects a bare
// "2025" (its .value stays empty), which the Step-3 verify/retry gate then
// reports as "empty after retry".
//
// We therefore detect the REAL DOM widget type at runtime and expand the
// year-only value into the format that widget accepts, instead of guessing.
// ---------------------------------------------------------------------------

/**
 * Expands a year-only graduation value into the string the portal's graduation
 * input accepts, based on the input's runtime `type` attribute.
 *
 *   type="date"  → "YYYY-01-01"   (HTML date value format)
 *   type="month" → "YYYY-01"
 *   type="week"  → "YYYY-W01"
 *   text/number/unknown → "YYYY"  (plain year)
 *
 * Returns "-" when no year is available so the caller's existing placeholder /
 * gate behaviour is unchanged.
 */
export function formatGraduationForInput(
  year: number | null | undefined,
  inputType: string,
): string {
  if (year == null || !Number.isFinite(Number(year))) return "-";
  const y = String(year);
  switch ((inputType || "").trim().toLowerCase()) {
    case "date":
      return `${y}-01-01`;
    case "month":
      return `${y}-01`;
    case "week":
      return `${y}-W01`;
    default:
      return y;
  }
}
