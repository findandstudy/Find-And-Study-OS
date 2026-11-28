/**
 * programImportHeaders — header-alias normalization for the program bulk
 * importer (/programs/bulk).
 *
 * WHY: the program-list "Export" button writes human-friendly headers
 * (`Program`, `University`, `Fee Type`, …) while the importer's row schema
 * uses internal camelCase keys (`name`, `universityName`, `feeType`, …).
 * The importer must accept the system's OWN export format unchanged
 * (round-trip guarantee), so we remap known friendly headers to internal
 * keys before validation. Unknown headers (e.g. document columns like
 * `passport`) pass through untouched.
 *
 * Matching is case-insensitive and trims whitespace.
 */

/** lowercase(trimmed header) → internal row key */
const HEADER_ALIASES: Record<string, string> = {
  // program name
  "program": "name",
  "program name": "name",
  "name": "name",
  "description": "description",
  "program description": "description",
  // university (name-based resolution is primary; users never type IDs)
  "university": "universityName",
  "university name": "universityName",
  "universityname": "universityName",
  "universityid": "universityId",
  "university id": "universityId",
  // simple passthrough fields (friendly header == internal key, case aside)
  "degree": "degree",
  "field": "field",
  "language": "language",
  "duration": "duration",
  "currency": "currency",
  "scholarship": "scholarship",
  "intakes": "intakes",
  "requirements": "requirements",
  "quota": "quota",
  // multi-word / symbol headers from the exporter
  "fee type": "feeType",
  "feetype": "feeType",
  "tuition fee": "tuitionFee",
  "tuitionfee": "tuitionFee",
  "commission %": "commissionRate",
  "commission": "commissionRate",
  "commission rate": "commissionRate",
  "commissionrate": "commissionRate",
  "application fee": "applicationFee",
  "applicationfee": "applicationFee",
  "enrolment fee": "enrollmentFee",
  "enrolmentfee": "enrollmentFee",
  "enrollment fee": "enrollmentFee",
  "enrollmentfee": "enrollmentFee",
  "adaptation fee": "adaptationFee",
  "adaptationfee": "adaptationFee",
  "advance fee": "advancedFee",
  "advanced fee": "advancedFee",
  "advancedfee": "advancedFee",
  "deposit fee": "depositFee",
  "depositfee": "depositFee",
  "service fee": "serviceFeeAmount",
  "servicefeeamount": "serviceFeeAmount",
  "discounted fee": "discountedFee",
  "discountedfee": "discountedFee",
  "language fee": "languageFee",
  "languagefee": "languageFee",
  "refund process": "refundProcess",
  "refundprocess": "refundProcess",
  "price valid from": "priceValidFrom",
  "pricevalidfrom": "priceValidFrom",
  "price valid until": "priceValidUntil",
  "pricevaliduntil": "priceValidUntil",
  "finance notes": "financeNotes",
  "financenotes": "financeNotes",
  "school period id": "universityApplicationPeriodId",
  "universityapplicationperiodid": "universityApplicationPeriodId",
  "application period": "applicationPeriodTermName",
  "application period name": "applicationPeriodTermName",
  "applicationperiodtermname": "applicationPeriodTermName",
  "application period academic year": "applicationPeriodAcademicYear",
  "applicationperiodacademicyear": "applicationPeriodAcademicYear",
  "application period campus": "applicationPeriodCampusName",
  "applicationperiodcampusname": "applicationPeriodCampusName",
  "applications open": "applicationsOpenAt",
  "applicationsopenat": "applicationsOpenAt",
  "application deadline": "applicationDeadlineAt",
  "applicationdeadlineat": "applicationDeadlineAt",
  "application period timezone": "applicationPeriodTimezone",
  "applicationperiodtimezone": "applicationPeriodTimezone",
  "application period source url": "applicationPeriodSourceUrl",
  "applicationperiodsourceurl": "applicationPeriodSourceUrl",
  "applications open override": "applicationsOpenOverrideAt",
  "applicationsopenoverrideat": "applicationsOpenOverrideAt",
  "application deadline override": "applicationDeadlineOverrideAt",
  "applicationdeadlineoverrideat": "applicationDeadlineOverrideAt",
  "classes start override": "classesStartOverrideOn",
  "classesstartoverrideon": "classesStartOverrideOn",
  "classes end override": "classesEndOverrideOn",
  "classesendoverrideon": "classesEndOverrideOn",
  "min gpa": "minGpa",
  "mingpa": "minGpa",
  "min language score": "minLanguageScore",
  "minlanguagescore": "minLanguageScore",
  "active": "isActive",
  "is active": "isActive",
  "isactive": "isActive",
  // optional country column — used only when auto-creating a university
  "country": "country",
};

/**
 * Remap one raw Excel row's headers to internal keys.
 * - Known aliases are renamed; everything else (doc columns, unknown
 *   extras) is kept verbatim.
 * - If BOTH an alias and the internal key are present (e.g. `University`
 *   and `universityName`), the internal key wins — never overwrite an
 *   already-set internal key with an aliased duplicate.
 */
export function normalizeProgramImportRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const explicit = new Set<string>();
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const trimmed = rawKey.trim();
    const lower = trimmed.toLowerCase();
    const value = typeof rawValue === "string" && rawValue.trim() === "" ? "" : rawValue;
    const alias = Object.hasOwn(HEADER_ALIASES, lower) ? HEADER_ALIASES[lower] : undefined;
    if (!alias) {
      // Unknown header — keep as-is (doc columns are matched verbatim later).
      if (!(trimmed in out)) out[trimmed] = value;
      continue;
    }
    const isExplicit = trimmed === alias;
    if (isExplicit) {
      // Explicit internal key always wins over an aliased duplicate —
      // but a BLANK explicit cell doesn't block an alias from filling in.
      out[alias] = value;
      if (value !== undefined && value !== null && value !== "") explicit.add(alias);
    } else if (
      !explicit.has(alias) &&
      (out[alias] === undefined || out[alias] === "" || out[alias] === null)
    ) {
      out[alias] = value;
    }
  }
  return out;
}

export function normalizeProgramImportRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map(normalizeProgramImportRow);
}

/**
 * Collect universities that must be auto-created for an import batch.
 *
 * Only rows that would otherwise be VALID program rows (non-empty program
 * `name`, no explicit `universityId`, `universityName` not already in the
 * DB map) contribute — a failed/garbage import must not pollute the
 * universities catalog. Dedup is case-insensitive + trimmed so 50 programs
 * of one new university create it once. `country` comes from the optional
 * Country column, defaulting to "Unknown".
 */
export function collectUniversitiesToCreate(
  normalizedRows: Record<string, unknown>[],
  existingNameMap: Record<string, number>,
): { name: string; country: string }[] {
  const toCreate = new Map<string, { name: string; country: string }>();
  for (const r of normalizedRows) {
    const rawId = r.universityId === "" || r.universityId === null ? undefined : r.universityId;
    const rawName = typeof r.universityName === "string" && r.universityName.trim() ? r.universityName.trim() : undefined;
    const programName = typeof r.name === "string" ? r.name.trim() : r.name;
    if (rawId || !rawName || !programName) continue;
    const key = rawName.toLowerCase();
    if (existingNameMap[key] !== undefined || toCreate.has(key)) continue;
    const country = typeof r.country === "string" && r.country.trim() ? r.country.trim() : "Unknown";
    toCreate.set(key, { name: rawName, country });
  }
  return [...toCreate.values()];
}
