import { db, aiDefaultConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { ExtractorFieldDef } from "@workspace/db";

export const HARDCODED_EXTRACTOR_FIELDS: ExtractorFieldDef[] = [
  { key: "firstName", label: "First name", type: "string", description: "Exactly as printed on the document" },
  { key: "lastName", label: "Last name", type: "string", description: "Exactly as printed on the document" },
  { key: "dateOfBirth", label: "Date of birth", type: "date", normalize: "dateYmd", format: "YYYY-MM-DD" },
  { key: "nationality", label: "Nationality", type: "string", description: "Full country name (e.g. 'Turkey' not 'Turkish')" },
  { key: "passportNumber", label: "Passport number", type: "string" },
  { key: "passportIssueDate", label: "Passport issue date", type: "date", normalize: "dateYmd", format: "YYYY-MM-DD" },
  { key: "passportExpiry", label: "Passport expiry", type: "date", normalize: "dateYmd", format: "YYYY-MM-DD" },
  { key: "passportExpired", label: "Passport expired", type: "boolean" },
  { key: "motherName", label: "Mother's name", type: "string" },
  { key: "fatherName", label: "Father's name", type: "string" },
  { key: "email", label: "Email", type: "string" },
  { key: "phone", label: "Phone", type: "string" },
  { key: "address", label: "Address", type: "string" },
  { key: "highSchool", label: "High school", type: "string" },
  { key: "graduationYear", label: "Graduation year", type: "number" },
  { key: "gpa", label: "GPA", type: "string", normalize: "gpa100" },
  { key: "languageScore", label: "Language score", type: "string" },
  { key: "documentType", label: "Document type", type: "enum", enumValues: ["passport", "diploma", "transcript", "photo", "other"] },
  { key: "confidence", label: "Confidence", type: "enum", enumValues: ["high", "medium", "low"] },
  { key: "extractedNotes", label: "Notes", type: "string" },
];

export const HARDCODED_EXTRACTOR_RULES: string[] = [
  "CRITICAL - Names: Extract names EXACTLY as they appear on the passport or official document. The passport is the authoritative source. Do NOT modify, translate, or reformat names.",
  "CRITICAL - Date format awareness: Different countries use different date formats. Most countries use DD/MM/YYYY; USA uses MM/DD/YYYY; East Asia uses YYYY/MM/DD. Use the issuing country's convention; always output YYYY-MM-DD.",
  "CRITICAL - Passport expiry: Compare expiry date to today; set passportExpired true if past.",
  "For nationality: always return the full official country name. Convert any demonym or adjective form to the country name (e.g. 'Afghan' → 'Afghanistan', 'Turkish' → 'Turkey').",
  "Always normalize dates to YYYY-MM-DD format.",
  "Return ONLY the JSON object, no other text.",
  "Set null for fields you cannot find or are not sure about.",
];

export type AiDefaultKey =
  | "extractor.builtin.systemPrompt"
  | "extractor.builtin.fields"
  | "extractor.builtin.rules"
  | "persona.builtin.systemPrompt"
  | "persona.builtin.guidelines";

export type AiDefaultValueMap = {
  "extractor.builtin.systemPrompt": { text: string };
  "extractor.builtin.fields": { fields: ExtractorFieldDef[] };
  "extractor.builtin.rules": { globalRules: string[] };
  "persona.builtin.systemPrompt": { text: string };
  "persona.builtin.guidelines": { text: string };
};

export const HARDCODED_DEFAULTS: AiDefaultValueMap = {
  "extractor.builtin.systemPrompt": { text: "" },
  "extractor.builtin.fields": { fields: HARDCODED_EXTRACTOR_FIELDS },
  "extractor.builtin.rules": { globalRules: HARDCODED_EXTRACTOR_RULES },
  "persona.builtin.systemPrompt": { text: "" },
  "persona.builtin.guidelines": { text: "" },
};

export const ALL_DEFAULT_KEYS: AiDefaultKey[] = Object.keys(HARDCODED_DEFAULTS) as AiDefaultKey[];

export async function readDefaultConfig<K extends AiDefaultKey>(
  key: K
): Promise<AiDefaultValueMap[K]> {
  try {
    const [row] = await db
      .select()
      .from(aiDefaultConfigsTable)
      .where(eq(aiDefaultConfigsTable.key, key));
    if (row?.value != null) {
      return row.value as AiDefaultValueMap[K];
    }
  } catch {
    // DB unavailable — fall back to hardcoded
  }
  return HARDCODED_DEFAULTS[key];
}
