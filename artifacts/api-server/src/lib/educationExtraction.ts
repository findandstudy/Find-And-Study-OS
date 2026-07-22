/**
 * educationExtraction — FAZ 3 (AI Çıkarımı).
 *
 * Pure helpers that turn an AI document-extraction result into the
 * level-based `education: [...]` array consumed by the FAZ 2
 * PUT /students/:id/education endpoint.
 *
 * - Which levels get filled is decided by the applied study level
 *   (students.interestedLevel, falling back to the program's level key)
 *   via requiredEducationLevels() from @workspace/db:
 *     Group A → high_school, Group B → bachelor, Group C → bachelor+master.
 * - GPA guarantee: every record's gpa is normalized to a 0-100 percent
 *   (decimals kept), with the original kept in gpaRaw and gpaScale=100.
 * - No `any`: input is parsed with Zod (zod/v4).
 */
import { z } from "zod/v4";
import {
  requiredEducationLevels,
  academicFieldsForLevel,
  type EducationLevel,
} from "@workspace/db";
import { normalizeGpaTo100 } from "./gpaNormalize";

export const EDUCATION_LEVEL_VALUES = ["high_school", "bachelor", "master"] as const;

/** Loose shape the AI is asked to return per education record. */
export const aiEducationRecordSchema = z.object({
  level: z.enum(EDUCATION_LEVEL_VALUES),
  institution: z.string().nullish(),
  program: z.string().nullish(),
  graduationYear: z.union([z.number(), z.string()]).nullish(),
  gpa: z.union([z.number(), z.string()]).nullish(),
  languageScore: z.string().nullish(),
});
export type AiEducationRecord = z.infer<typeof aiEducationRecordSchema>;

export const aiEducationArraySchema = z.array(aiEducationRecordSchema);

/** Output shape — compatible with PutStudentEducationBody records[]. */
export interface EducationRecordOutput {
  level: EducationLevel;
  institution: string | null;
  program: string | null;
  graduationYear: number | null;
  gpa: string | null;
  gpaRaw: string | null;
  gpaScale: number | null;
  languageScore: string | null;
}

/**
 * Build the prompt section instructing the AI which education records to
 * extract for the applied study level.
 */
export function buildEducationPromptSection(levelKey: string): string {
  const levels = requiredEducationLevels(levelKey);
  const recordSpecs = levels.map((lvl) => {
    const fields = academicFieldsForLevel(lvl);
    const fieldDesc = fields
      .map((f) => {
        switch (f) {
          case "institution":
            return lvl === "high_school"
              ? '"institution": high school name'
              : '"institution": university name';
          case "program":
            return '"program": department/major/program name';
          case "graduationYear":
            return '"graduationYear": 4-digit graduation year (number)';
          case "gpa":
            return '"gpa": the grade exactly as printed on the transcript/diploma, in its native scale (e.g. "3.42/4", "87.5", "15/20")';
          case "languageScore":
            return '"languageScore": language test score as free text (e.g. "IELTS 7.0", "TOEFL 95")';
        }
      })
      .join("; ");
    return `  - { "level": "${lvl}", ${fieldDesc} }`;
  });
  return [
    "",
    "EDUCATION RECORDS (level-based):",
    `The student is applying for study level "${levelKey}". Fill ONLY these education records from the provided documents:`,
    ...recordSpecs,
    'Return them as an "educationRecords" array in the JSON. Use null for anything you cannot confidently read — never guess.',
    "Take the grade (gpa) from the transcript or diploma; take the language score from a language certificate if present.",
  ].join("\n");
}

/**
 * Normalize a single AI record into the PUT body shape with the GPA
 * guarantee applied.
 */
function normalizeRecord(rec: AiEducationRecord): EducationRecordOutput {
  const gyNum = rec.graduationYear != null && rec.graduationYear !== ""
    ? parseInt(String(rec.graduationYear), 10)
    : NaN;

  let gpa: string | null = null;
  let gpaRaw: string | null = null;
  let gpaScale: number | null = null;
  if (rec.gpa != null && String(rec.gpa).trim() !== "") {
    const raw = String(rec.gpa).trim();
    const pct = normalizeGpaTo100(raw);
    if (!isNaN(pct)) {
      gpa = String(Math.round(pct * 10) / 10);
      gpaRaw = raw;
      gpaScale = 100;
    } else {
      // Unnormalizable grade: keep the raw text so nothing is lost.
      gpa = raw;
      gpaRaw = raw;
      gpaScale = null;
    }
  }

  const clean = (v: string | null | undefined): string | null =>
    v != null && String(v).trim() !== "" ? String(v).trim().slice(0, 300) : null;

  return {
    level: rec.level,
    institution: clean(rec.institution),
    program: rec.level === "high_school" ? null : clean(rec.program),
    graduationYear: Number.isFinite(gyNum) ? gyNum : null,
    gpa,
    gpaRaw,
    gpaScale,
    languageScore: clean(rec.languageScore),
  };
}

/**
 * Map a raw AI extraction to the final `education` array for the applied
 * level: keep only the levels required by the level key, dedup levels
 * (first wins), normalize GPA, order as requiredEducationLevels() orders.
 */
export function mapExtractionToEducation(
  rawRecords: unknown,
  levelKey: string,
): EducationRecordOutput[] {
  const parsed = aiEducationArraySchema.safeParse(rawRecords);
  if (!parsed.success) return [];
  const allowed = requiredEducationLevels(levelKey);
  const byLevel = new Map<EducationLevel, AiEducationRecord>();
  for (const rec of parsed.data) {
    if (allowed.includes(rec.level) && !byLevel.has(rec.level)) {
      byLevel.set(rec.level, rec);
    }
  }
  const out: EducationRecordOutput[] = [];
  for (const lvl of allowed) {
    const rec = byLevel.get(lvl);
    if (rec) out.push(normalizeRecord(rec));
  }
  return out;
}
