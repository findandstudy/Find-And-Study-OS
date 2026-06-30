import { fold } from "../../programMatch.js";

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

// ---------------------------------------------------------------------------
// CRM education level → Topkapı program-level label (the level of the program
// being APPLIED to). Used for Step 4's program-level radio. Thesis vs non-thesis
// is encoded in the CRM program NAME, not the level, so both are folded together.
// ---------------------------------------------------------------------------
export function mapEduLevel(level: string, programName = ""): string {
  const f = level.toLowerCase();
  if (/associate|önlisans|onlisans|foundation/.test(f)) return "Associate";
  if (/master|yüksek|yuksek/.test(f)) {
    const combined = fold(`${level} ${programName}`);
    if (/non[- ]?thesis|tezsiz/.test(combined)) return "Masters (Non Thesis)";
    return "Masters (Thesis)";
  }
  if (/phd|doctor|doktora/.test(f)) return "Doctorate";
  return "Bachelor";
}

// ---------------------------------------------------------------------------
// Step 3's education-history dropdown asks for the applicant's COMPLETED (prior)
// schooling — NOT the level of the program being applied to. Derive the prior
// level from the applied level and return an ordered list of label candidates
// (Turkish + English) to match against the portal's real option texts:
//
//   apply Bachelor / Associate / Foundation  → prior = High School (Lise)
//   apply Masters                            → prior = Bachelor (Lisans)
//   apply Doctorate                          → prior = Masters (Yüksek Lisans)
//
// The applied-level label is appended LAST as a defensive fallback for portals
// whose history dropdown only lists program levels (avoids a regression where
// no prior-level option exists).
// ---------------------------------------------------------------------------
export function eduLevelCandidates(level: string, programName = ""): string[] {
  const f = fold(`${level} ${programName}`);
  const applied = mapEduLevel(level, programName);
  let prior: string[];
  if (/doktora|doctor|phd/.test(f)) {
    prior = ["Yüksek Lisans", "Master", "Masters", "Graduate"];
  } else if (/yukseklisans|master/.test(f)) {
    prior = ["Lisans", "Bachelor", "Undergraduate", "Licence"];
  } else {
    prior = ["Lise", "High School", "Highschool", "Secondary", "Ortaöğretim", "Ortaogretim"];
  }
  const out: string[] = [];
  for (const c of [...prior, applied]) {
    if (!out.some((x) => fold(x) === fold(c))) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// True when a <select>'s current value/text is a non-selection placeholder
// (e.g. "Seçim Yapın", "Seçiniz", "Please Select", "0", empty). Prevents the
// Step-3 verify from accepting an unselected dropdown as a real choice — the
// root cause of "educationLevel=Seçim Yapın" followed by missing dependent
// fields.
// ---------------------------------------------------------------------------
export function isPlaceholderChoice(value: string, text: string): boolean {
  const v = (value || "").trim();
  if (!v || v === "0") return true;
  const t = fold(text || "");
  if (!t || t === "-") return true;
  return /^(secim yapin|seciniz|secin|lutfen secim yapin|lutfen seciniz|please select|select one|select|choose)$/.test(
    t,
  );
}
