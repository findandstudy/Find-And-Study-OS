import type * as XLSXType from "xlsx";

export type CanonicalProgramPriceRow = Record<string, string>;

const MERITO_SOURCE = "https://docs.google.com/spreadsheets/d/1e6m1PETuWNo23nVp5-XHcp5ephpQ8tlV/edit";

function parsePln(value: unknown): string {
  const text = String(value ?? "").replace(/\u00a0/g, " ");
  const match = text.match(/([\d\s]+(?:[.,]\d+)?)\s*PLN/i);
  return match ? match[1].replace(/\s/g, "").replace(",", ".") : "";
}

function parseUsShortDate(value: unknown): string {
  const match = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return "";
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function matrix(XLSX: typeof XLSXType, sheet: XLSXType.WorkSheet | undefined): unknown[][] {
  return sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false }) : [];
}

function meritoAdapter(XLSX: typeof XLSXType, workbook: XLSXType.WorkBook): CanonicalProgramPriceRow[] | null {
  if (!workbook.Sheets.Programs || !workbook.Sheets.Terms || !workbook.Sheets.Fees) return null;
  const programs = matrix(XLSX, workbook.Sheets.Programs);
  const terms = matrix(XLSX, workbook.Sheets.Terms);
  const fees = matrix(XLSX, workbook.Sheets.Fees);
  const campusNames = ["WSB Merito Gdańsk", "WSB Merito Gdynia"];
  if (!campusNames.every((name, index) => String(programs[3]?.[1 + index * 2] ?? "").trim() === name)) return null;

  const termByCampus = new Map(terms.slice(1).map(row => [String(row[0] ?? "").trim(), { open: String(row[1] ?? "").trim(), deadline: String(row[2] ?? "").trim() }]));
  const feeByCampus = new Map<string, { applicationFee: string; adaptationFee: string }>();
  for (let column = 0; column < fees[0].length; column += 2) {
    const campus = String(fees[0]?.[column] ?? "").trim();
    if (!campus) continue;
    feeByCampus.set(campus, {
      applicationFee: parsePln(fees[1]?.[column + 1]),
      adaptationFee: parsePln(fees[2]?.[column + 1]),
    });
  }

  const rows: CanonicalProgramPriceRow[] = [];
  for (const [campusIndex, campus] of campusNames.entries()) {
    const nameColumn = 1 + campusIndex * 2;
    const feeColumn = nameColumn + 1;
    let degree = "Bachelor";
    for (let rowIndex = 5; rowIndex < programs.length; rowIndex++) {
      const rawName = String(programs[rowIndex]?.[nameColumn] ?? "").trim();
      const rawPrice = programs[rowIndex]?.[feeColumn];
      if (!rawName) continue;
      if (/MASTER/i.test(rawName) && !parsePln(rawPrice)) { degree = "Master"; continue; }
      if (/BACHELOR|ENGINEERING PROGRAMS/i.test(rawName) && !parsePln(rawPrice)) { degree = "Bachelor"; continue; }
      const tuitionFee = parsePln(rawPrice);
      if (!tuitionFee) continue;
      const feesForCampus = feeByCampus.get(campus);
      const term = termByCampus.get(campus);
      const sourceMetadataJson = JSON.stringify(Object.fromEntries(
        ["tuitionFee", "currency", "applicationFee", "additionalFees", "intakes"].map(field => [field, {
          sourceName: "Merito March 2027 partner price list",
          sourceUrl: MERITO_SOURCE,
          notes: "Imported from the supplied partner workbook; unverified fields remain blank.",
        }]),
      ));
      rows.push({
        universityName: campus,
        country: "Poland",
        name: rawName,
        degree,
        field: rawName.split(" - ")[0].trim(),
        language: "English",
        tuitionFee,
        currency: "PLN",
        feeType: "Per Year",
        intakes: "March 2027",
        applicationFee: feesForCampus?.applicationFee ?? "",
        adaptationFee: feesForCampus?.adaptationFee ?? "",
        enrollmentFee: "",
        refundProcess: "",
        commissionRate: "11",
        financeNotes: "Temporary partner commission: 11%. Visa-refusal refund and enrolment fee are not confirmed.",
        requirements: "",
        sourceMetadataJson,
        applicationPeriodTermName: "March 2027",
        applicationPeriodAcademicYear: "2027",
        applicationPeriodCampusName: campus.replace(/^WSB Merito\s+/i, ""),
        applicationsOpenAt: parseUsShortDate(term?.open),
        applicationDeadlineAt: parseUsShortDate(term?.deadline),
        applicationPeriodTimezone: "Europe/Warsaw",
        applicationPeriodSourceUrl: MERITO_SOURCE,
      });
    }
  }
  return rows;
}

export function parsePartnerProgramWorkbook(XLSX: typeof XLSXType, workbook: XLSXType.WorkBook): CanonicalProgramPriceRow[] {
  for (const adapter of [meritoAdapter]) {
    const rows = adapter(XLSX, workbook);
    if (rows) return rows;
  }
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" }).map(row =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), String(value).trim()])),
  );
}

export const MERITO_PILOT_EXPECTED = {
  programs: 13,
  currency: "PLN",
  applicationFee: "85",
  adaptationFee: "400",
  commissionRate: "11",
} as const;
