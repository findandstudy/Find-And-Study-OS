export const STUDENT_EDUCATION_LEVELS = [
  "high_school",
  "bachelor",
  "master",
] as const;

export type CleanStudentEducationRecord = {
  level: (typeof STUDENT_EDUCATION_LEVELS)[number];
  institution: string | null;
  program: string | null;
  country: string | null;
  graduationYear: number | null;
  gpa: string | null;
  gpaRaw: string | null;
  gpaScale: number | null;
  languageScore: string | null;
  sortOrder: number;
};

type CleanResult =
  | { ok: true; records: CleanStudentEducationRecord[] }
  | { ok: false; error: string };

function stringOrNull(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim().slice(0, max);
  return cleaned || null;
}

function integerOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cleanStudentEducationRecords(input: unknown): CleanResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: "educationRecords must be an array" };
  }
  if (input.length > STUDENT_EDUCATION_LEVELS.length) {
    return { ok: false, error: "educationRecords supports at most 3 records" };
  }

  const seen = new Set<string>();
  const records: CleanStudentEducationRecord[] = [];
  for (let index = 0; index < input.length; index++) {
    const raw = input[index] && typeof input[index] === "object"
      ? input[index] as Record<string, unknown>
      : {};
    const level = String(raw.level || "");
    if (!(STUDENT_EDUCATION_LEVELS as readonly string[]).includes(level)) {
      return {
        ok: false,
        error: `educationRecords[${index}].level must be one of: ${STUDENT_EDUCATION_LEVELS.join(", ")}`,
      };
    }
    if (seen.has(level)) {
      return {
        ok: false,
        error: `Duplicate education level "${level}" is not allowed`,
      };
    }
    seen.add(level);

    const graduationYear = integerOrNull(raw.graduationYear);
    if (
      graduationYear !== null &&
      (graduationYear < 1900 || graduationYear > 2200)
    ) {
      return {
        ok: false,
        error: `educationRecords[${index}].graduationYear is invalid`,
      };
    }

    const gpaScale = integerOrNull(raw.gpaScale);
    if (gpaScale !== null && gpaScale <= 0) {
      return {
        ok: false,
        error: `educationRecords[${index}].gpaScale is invalid`,
      };
    }

    records.push({
      level: level as CleanStudentEducationRecord["level"],
      institution: stringOrNull(raw.institution, 300),
      program: level === "high_school" ? null : stringOrNull(raw.program, 300),
      country: stringOrNull(raw.country, 100),
      graduationYear,
      gpa: stringOrNull(raw.gpa, 20),
      gpaRaw: stringOrNull(raw.gpaRaw, 50),
      gpaScale,
      languageScore: stringOrNull(raw.languageScore, 50),
      sortOrder: index,
    });
  }
  return { ok: true, records };
}

export function toLegacyEducationRecord(
  studentId: number,
  record: CleanStudentEducationRecord,
) {
  return {
    studentId,
    level: record.level,
    schoolName: record.institution,
    country: record.country,
    fieldOfStudy: record.program,
    endYear: record.graduationYear,
    languageScore: record.languageScore,
    gpa: record.gpa,
    gpaType:
      record.gpaScale === 100
        ? "percentage"
        : record.gpaScale
          ? `${record.gpaScale}.0`
          : null,
    source: "manual" as const,
  };
}
