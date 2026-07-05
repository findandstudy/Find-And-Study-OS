import { fold } from "./programMatch.js";
import { buildSignedDocumentPath } from "./documentSigning.js";
import type { SubmitProfile, SubmitFiles, StudentDocumentRef } from "./types.js";

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
// Document URL extraction — for portals whose CREATE step is a URL-fetching
// webhook (e.g. SIT). Kept here (shared by both profile builders) so the two
// builders never drift on how photo_url / documents[] are derived.
// ---------------------------------------------------------------------------

/** A raw CRM `documents` row as read by the profile builders. */
export interface RawDocumentRow {
  /** Document row id — required to build a signed URL for base64-only rows. */
  id?: number | null;
  type: string | null;
  name?: string | null;
  fileUrl?: string | null;
  fileKey?: string | null;
  fileData?: string | null;
  sizeBytes?: number | null;
  mimeType?: string | null;
}

/** True for the CRM photo document types (mirrors the /students/:id/photo query). */
function isPhotoType(type: string): boolean {
  return /^(photo|photograph)$/i.test(type.trim());
}

/**
 * The "prior education" institution to report, keyed by the APPLIED level: a
 * Master applicant's completed education is their Bachelor school, a PhD
 * applicant's is their Master school, and everyone else (Bachelor/Associate)
 * reports a high school. Falls back down the chain when the level-specific field
 * is empty so we never report an empty prior school when SOME school is known.
 */
export function selectPriorSchoolName(
  level: string | null | undefined,
  schools: {
    highSchool?: string | null;
    universityBachelor?: string | null;
    universityMaster?: string | null;
  },
): string | undefined {
  const f = fold(level ?? "");
  const hs = schools.highSchool?.trim() || undefined;
  const ba = schools.universityBachelor?.trim() || undefined;
  const ma = schools.universityMaster?.trim() || undefined;
  if (/doktora|phd|doctora|doctoral/.test(f)) return ma || ba || hs;
  if (/yukseklisans|yuksek lisans|master|graduate/.test(f)) return ba || hs;
  return hs;
}

/** A row's PUBLIC url: fileUrl preferred, fileKey fallback, else undefined. */
function publicDocUrl(r: RawDocumentRow): string | undefined {
  const u = (r.fileUrl && r.fileUrl.trim()) || (r.fileKey && r.fileKey.trim());
  return u ? u : undefined;
}

/**
 * A row's fetchable URL for a URL-fetching create webhook.
 *
 * Order: public fileUrl → public fileKey → for base64 `fileData`-only rows, a
 * signed, auth-free document-endpoint path (`/api/documents/:id/file?exp=&sig=`)
 * the external webhook can fetch. Returns undefined only for empty stubs, or
 * when a base64 row cannot be signed (no id / no signing secret) — the caller
 * then skips the row (documents are best-effort).
 */
function docFetchUrl(r: RawDocumentRow): string | undefined {
  const direct = publicDocUrl(r);
  if (direct) return direct;
  if (r.fileData && String(r.fileData).trim() && r.id != null) {
    const signed = buildSignedDocumentPath(r.id);
    if (signed) return signed;
  }
  return undefined;
}

/**
 * Extracts a student's photo URL + document URLs from their raw CRM `documents`
 * rows, for portals whose create webhook fetches files by URL (e.g. SIT).
 *
 * - `photoUrl`: the FIRST content-bearing photo/photograph row that has a PUBLIC
 *   url (callers pass rows newest-first). Base64-only photos have no public url,
 *   so `hasPhotoDoc` is set instead and the caller falls back to a signed
 *   student-photo endpoint URL. The photo is excluded from `documents`.
 * - `documents`: every other non-deleted row that has a fetchable URL — public
 *   (fileUrl/fileKey) OR, for base64 `fileData`-only rows, a signed, auth-free
 *   document-endpoint URL the external webhook can fetch.
 *
 * Only empty stubs (no content in any field) are skipped. URLs are passed
 * through as stored (not validated here); the consuming adapter logs any
 * non-http(s) URL. Never throws.
 */
export function extractStudentDocumentRefs(rows: RawDocumentRow[]): {
  photoUrl?: string;
  hasPhotoDoc: boolean;
  documents: StudentDocumentRef[];
} {
  let photoUrl: string | undefined;
  let hasPhotoDoc = false;
  const documents: StudentDocumentRef[] = [];

  for (const r of rows) {
    const type = (r.type ?? "").trim();
    if (!type) continue;

    if (isPhotoType(type)) {
      // A photo row exists even when it has no fetchable URL (base64 fileData
      // only). Callers use hasPhotoDoc to fall back to a signed photo-endpoint
      // URL. Empty stubs (no content in any field) don't count.
      if (r.fileData || r.fileKey || r.fileUrl) hasPhotoDoc = true;
      const purl = publicDocUrl(r);
      if (purl && !photoUrl) photoUrl = purl; // first content-bearing photo wins
      continue;
    }

    const url = docFetchUrl(r);
    if (!url) continue;
    documents.push({
      type,
      name: r.name ?? undefined,
      url,
      size: r.sizeBytes ?? undefined,
      mime: r.mimeType ?? undefined,
    });
  }

  return { photoUrl, hasPhotoDoc, documents };
}

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

/**
 * Normalizes a raw CRM GPA value into a single numeric GPA.
 *
 * CRM GPA is free-form text and may arrive as:
 *   - a single value: "80.6", "3.5"                → passed through as-is
 *   - a range:        "2.8-3.0", "2,8 – 3,0", "3 to 3.5" → resolved to the
 *                     UPPER bound (the portal accepts a single number only)
 *   - decimal comma:  "2,8"                         → converted to "2.8"
 *   - noisy / suffixed: "91%", "%91", "3.5/4", "GPA 3.2" → FIRST numeric token
 *
 * Empty / null / undefined → undefined (legitimately missing; the adapter's
 * fail-visible Step-3 gate reports it). A non-empty value with NO numeric
 * content ("abc") also returns undefined — GPA is OPTIONAL and must NEVER block
 * a submission. (This used to throw "unparseable GPA", which dropped the whole
 * run for a harmless value like "91%".) NaN is never returned.
 */
export function normalizeGpaRange(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;

  const trimmed = String(raw).trim();
  if (trimmed === "") return undefined;

  // Decimal comma → dot (Turkish-locale CRM entries) before any parsing.
  const norm = trimmed.replace(/,/g, ".");

  // Range "a-b" / "a–b" / "a—b" / "a to b" → upper bound.
  const range = norm.match(
    /^(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)$/i,
  );
  if (range) {
    const upper = Number(range[2]);
    if (Number.isFinite(upper)) return upper;
  }

  // Otherwise take the FIRST numeric token so noisy CRM entries still parse:
  //   "91%" → 91 · "%91" → 91 · "3.5/4" → 3.5 · "GPA 3.2" → 3.2
  const token = norm.match(/\d+(?:\.\d+)?/);
  if (token) {
    const n = Number(token[0]);
    if (Number.isFinite(n)) return n;
  }

  // No numeric content at all → undefined (never throw; GPA is optional).
  return undefined;
}

/**
 * Parse the first finite number from a free-form value, returning undefined
 * instead of NaN/throwing. Used for optional numeric profile fields
 * (graduationYear, languageScore) so a noisy CRM value ("2025-06", "IELTS 6.5")
 * degrades gracefully to "missing" rather than crashing the whole profile build.
 */
function firstFiniteNumber(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  const m = String(raw).replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

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
    gpa:             normalizeGpaRange(data.gpa),
    graduationYear:  firstFiniteNumber(data.graduationYear),
    languageScore:   firstFiniteNumber(data.languageScore),
    passportIssueDate:  data.passportIssueDate  != null ? String(data.passportIssueDate)  : undefined,
    passportExpiryDate: data.passportExpiryDate != null ? String(data.passportExpiryDate) : undefined,
  };
}
