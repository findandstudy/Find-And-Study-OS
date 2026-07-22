/**
 * portalFieldSpec — pure, dependency-free portal compatibility matrix:
 * per-portal required fields, formats, and value rules.
 *
 * SIT (Study in Turkey / Zoho) is fully specified from production evidence;
 * other portals are skeletons (TODO: extend per-portal with the same schema).
 *
 * Imported by both backend and frontend via @workspace/db.
 */

import type { EducationLevel } from "../academicLevels";

export type PortalKey =
  | "sit"
  | "united"
  | "multico"
  | "topkapi"
  | "altinbas"
  | "emu"
  | "okan"
  | (string & {});

export type FieldRuleType =
  | "integer"
  | "text"
  | "date"
  | "enum"
  | "country"
  | "city"
  | "email"
  | "phone"
  | "document";

export interface FieldRule {
  key: string;
  required: boolean;
  type: FieldRuleType;
  min?: number;
  max?: number;
  /** allowed values for enum rules */
  values?: readonly string[];
  note?: string;
}

const SIT_PERSONAL: FieldRule[] = [
  { key: "dob", required: true, type: "date" },
  { key: "gender", required: true, type: "enum", values: ["male", "female"] },
  { key: "nationality", required: true, type: "country" },
  { key: "passportNo", required: true, type: "text" },
  { key: "passportIssueDate", required: true, type: "date" },
  { key: "passportExpiryDate", required: true, type: "date", note: "must be in the future" },
  { key: "email", required: true, type: "email" },
  { key: "mobile", required: true, type: "phone" },
];

const SIT_RESIDENCE: FieldRule[] = [
  { key: "countryOfResidence", required: true, type: "country", note: "must match SIT dropdown (canonical country name)" },
  { key: "city", required: true, type: "city", note: "real city name, never an address fragment" },
];

const SIT_FAMILY: FieldRule[] = [
  { key: "fatherName", required: true, type: "text" },
  { key: "fatherJob", required: true, type: "text" },
  { key: "motherName", required: true, type: "text" },
  { key: "motherJob", required: true, type: "text" },
];

const SIT_TOGGLES: FieldRule[] = [
  { key: "transferStudent", required: true, type: "enum", values: ["yes", "no"] },
  { key: "hasTcId", required: true, type: "enum", values: ["yes", "no"] },
  { key: "hasBlueCard", required: true, type: "enum", values: ["yes", "no"] },
];

const SIT_DOCUMENTS: FieldRule[] = [
  { key: "photo", required: true, type: "document" },
  { key: "passport", required: true, type: "document" },
  { key: "transcript", required: true, type: "document" },
  { key: "diploma", required: true, type: "document" },
];

const SIT_LANGUAGE: FieldRule[] = [
  { key: "languageScore", required: false, type: "text", note: 'free text, e.g. "IELTS 7.0"' },
];

const GPA_NOTE = "integer 0–100 (SIT/Zoho rejects decimals)";

function sitAcademic(level: EducationLevel): FieldRule[] {
  const hs: FieldRule[] = [
    { key: "hsCountry", required: true, type: "country" },
    { key: "hsName", required: true, type: "text" },
    { key: "hsGpa", required: true, type: "integer", min: 0, max: 100, note: GPA_NOTE },
  ];
  const bachelor: FieldRule[] = [
    { key: "bachelorCountry", required: true, type: "country" },
    { key: "bachelorSchool", required: true, type: "text" },
    { key: "bachelorGpa", required: true, type: "integer", min: 0, max: 100, note: GPA_NOTE },
  ];
  const master: FieldRule[] = [
    { key: "masterCountry", required: true, type: "country" },
    { key: "masterSchool", required: true, type: "text" },
    { key: "masterGpa", required: true, type: "integer", min: 0, max: 100, note: GPA_NOTE },
  ];
  // level = the applicant's TARGET study level:
  // high_school-based applicant (bachelor target group A) → prior = high school
  if (level === "high_school") return hs;
  if (level === "bachelor") return bachelor;
  return [...bachelor, ...master];
}

/**
 * Return the required-field matrix for a portal and the applicant's prior
 * education level requirement ("high_school" = bachelor applicant,
 * "bachelor" = master applicant, "master" = PhD applicant needs bachelor+master).
 *
 * Non-SIT portals currently return [] (skeleton — TODO extend per portal
 * using SIT as the reference schema).
 */
export function portalRequirements(portalKey: PortalKey, level: EducationLevel): FieldRule[] {
  if (portalKey === "sit") {
    return [
      ...SIT_PERSONAL,
      ...SIT_RESIDENCE,
      ...SIT_FAMILY,
      ...sitAcademic(level),
      ...SIT_LANGUAGE,
      ...SIT_TOGGLES,
      ...SIT_DOCUMENTS,
    ];
  }
  // TODO: united / multico / topkapi / altinbas / emu / okan — fill with the
  // same schema once their portal rules are consolidated (SIT is reference).
  return [];
}
