import { fold } from "./programMatch.js";
import type { SubmitProfile, SubmitFiles } from "./types.js";

// ---------------------------------------------------------------------------
// Document-type mapping
// ---------------------------------------------------------------------------
export type DocType = keyof SubmitFiles;

/**
 * Maps a free-form document label (from CRM, file name, etc.) to one of the
 * four canonical SubmitFiles keys, or null when unrecognised.
 *
 * transcript also matches: marks, marksheet, result, grade
 */
export function mapDocType(raw: string): DocType | null {
  const f = fold(raw);
  if (/photo|resim|fotograf|foto\b/.test(f))                                          return "photo";
  if (/passport|pasaport/.test(f))                                                    return "passport";
  // transcript: includes hsc (Higher Secondary Certificate) mark/result documents
  if (/transcript|marks|marksheet|result|grade|hsc/.test(f))                         return "transcript";
  // diploma: includes generic certificate types and translated copies of diplomas
  if (/diploma|degree|mezuniyet|certificate|translation/.test(f))                    return "diploma";
  return null;
}

// ---------------------------------------------------------------------------
// Required document types — used by workers to validate files before submit
// ---------------------------------------------------------------------------
export const REQUIRED_DOCS: DocType[] = ["photo", "passport", "transcript", "diploma"];

// ---------------------------------------------------------------------------
// buildProfile — construct a SubmitProfile from a plain CRM-agnostic record
// ---------------------------------------------------------------------------
const REQUIRED_FIELDS = [
  "email", "passportNumber", "firstName", "lastName",
  "dateOfBirth", "gender", "fatherName", "motherName",
  "nationality", "address", "phone", "level",
  "programName", "programId",
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

export function buildProfile(data: Record<string, unknown>): SubmitProfile {
  for (const key of REQUIRED_FIELDS) {
    if (data[key] == null || data[key] === "") {
      throw new Error(`buildProfile: missing required field "${key}"`);
    }
  }

  const str = (k: RequiredField) => String(data[k]);

  return {
    email:          str("email"),
    passportNumber: str("passportNumber"),
    firstName:      str("firstName"),
    lastName:       str("lastName"),
    dateOfBirth:    str("dateOfBirth"),
    gender:         str("gender"),
    fatherName:     str("fatherName"),
    motherName:     str("motherName"),
    nationality:    str("nationality"),
    address:        str("address"),
    phone:          str("phone"),
    level:          str("level"),
    programName:    str("programName"),
    programId:      str("programId"),

    universityName:  data.universityName  != null ? String(data.universityName)  : undefined,
    schoolName:      data.schoolName      != null ? String(data.schoolName)      : undefined,
    gpa:             data.gpa             != null ? Number(data.gpa)             : undefined,
    graduationYear:  data.graduationYear  != null ? Number(data.graduationYear)  : undefined,
    languageScore:   data.languageScore   != null ? Number(data.languageScore)   : undefined,
    passportIssueDate:  data.passportIssueDate  != null ? String(data.passportIssueDate)  : undefined,
    passportExpiryDate: data.passportExpiryDate != null ? String(data.passportExpiryDate) : undefined,
  };
}
