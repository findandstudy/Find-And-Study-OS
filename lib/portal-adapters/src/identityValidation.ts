/**
 * identityValidation — shared pure validation for student identity fields.
 *
 * Used in TWO enforcement points:
 *  1. Portal automation enqueue gate (api-server, mode=real only):
 *     invalid identity → submission never enters the queue.
 *  2. Worker browser-fill guard (real mode only):
 *     if invalid data somehow reached the worker, abort before touching
 *     the portal form — never submit silently wrong data.
 *
 * All functions are pure (no DB, no I/O) so they are trivially testable.
 * parseFlexibleDate is inlined here to avoid a cross-package dependency on
 * passportValidity.ts (api-server lib). The api-server may continue using
 * its own copy for the existing expiry check.
 */

// ---------------------------------------------------------------------------
// Internal date parser (subset of passportValidity.parseFlexibleDate)
// ---------------------------------------------------------------------------

/** Parse "YYYY-MM-DD", "DD.MM.YYYY" or "DD/MM/YYYY" → UTC Date or null. */
function parseDate(s: string | null | undefined): Date | null {
  const v = String(s || "").trim();
  if (!v) return null;
  let year: number, month: number, day: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) {
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
  } else {
    m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v);
    if (!m) return null;
    day = Number(m[1]); month = Number(m[2]); year = Number(m[3]);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------

export interface IdentityValidationError {
  field: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Passport number validation
// ---------------------------------------------------------------------------

/**
 * Common placeholder / test / non-passport strings that should never reach a
 * university portal.  Checked case-insensitively after stripping whitespace.
 */
const PASSPORT_PLACEHOLDER_RE = /^(?:pending|n\/a|na|applying|applied|tbd|none|unknown|waiting|hesapta|yok|belirtilmemi[sş]|-)$|fixture|placeholder/i;

/** All characters are the same (e.g. "111111111" or "AAAAAAA"). */
function isAllSameChar(s: string): boolean {
  return s.length > 0 && [...s].every((c) => c === s[0]);
}

/**
 * Validate a passport number.
 *
 * Rules (in order):
 *  1. Required — must be non-empty.
 *  2. No known placeholder text.
 *  3. Length: 5 – 20 characters after stripping whitespace.
 *  4. Characters: only letters, digits, spaces, or a single hyphen allowed
 *     (no slashes, underscores, etc.).
 *  5. Not all same character.
 *  6. Pure-digit strings longer than 13 characters are rejected
 *     (no real passport uses 14+ all-digit numbers).
 *  7. Pakistan CNIC pattern (XX-XXXXXXX-X, 13 digits with hyphens) is
 *     rejected — this is a national ID, not a passport number.
 */
export function validatePassportNumber(
  value: string | null | undefined,
): IdentityValidationError | null {
  const raw = String(value || "").trim();

  if (!raw) {
    return { field: "passportNumber", reason: "Passport number is required" };
  }

  if (PASSPORT_PLACEHOLDER_RE.test(raw)) {
    return {
      field: "passportNumber",
      reason: `Passport number "${raw}" is a placeholder or test value`,
    };
  }

  if (raw.length < 5) {
    return {
      field: "passportNumber",
      reason: `Passport number too short (${raw.length} chars; minimum 5)`,
    };
  }

  if (raw.length > 20) {
    return {
      field: "passportNumber",
      reason: `Passport number too long (${raw.length} chars; maximum 20)`,
    };
  }

  // Only letters, digits, spaces, or a single embedded hyphen are allowed.
  if (!/^[A-Za-z0-9 -]+$/.test(raw)) {
    return {
      field: "passportNumber",
      reason: `Passport number contains invalid characters: "${raw}"`,
    };
  }

  if (isAllSameChar(raw.replace(/[\s-]/g, ""))) {
    return {
      field: "passportNumber",
      reason: `Passport number is all the same character: "${raw}"`,
    };
  }

  // Pakistan CNIC pattern checked BEFORE the pure-digit cap so it gets the
  // specific error message (DDDDD-DDDDDDD-D format, 13 digits with hyphens).
  if (/^\d{5}-\d{7}-\d{1}$/.test(raw)) {
    return {
      field: "passportNumber",
      reason: `Value "${raw}" matches Pakistan CNIC pattern (DDDDD-DDDDDDD-D) — this is a national ID, not a passport number`,
    };
  }

  // Pure digits with 11+ characters → not a real passport number.
  // Real passports with all-numeric formats (Iran, some older) top out at
  // 9–10 digits. Strings of 11+ digits indicate a national ID, a fabricated
  // number, or a data-entry error (e.g. phone number pasted into the field).
  const stripped = raw.replace(/[\s-]/g, "");
  const digitsOnly = stripped.replace(/\D/g, "");
  if (digitsOnly === stripped && digitsOnly.length > 10) {
    return {
      field: "passportNumber",
      reason: `Passport number is a ${digitsOnly.length}-digit all-numeric string — too long for any real passport (max 10 digits for all-numeric passports)`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

const NAME_PLACEHOLDER_RE = /^(?:n\/a|na|none|unknown|pending|tbd|-+|test)$/i;

/**
 * Validate a required person name (firstName or lastName).
 * Allows multi-word names and names with hyphens (e.g. "MARY-ANNE", "AL SAYED").
 */
export function validatePersonName(
  value: string | null | undefined,
  field: string,
): IdentityValidationError | null {
  const raw = String(value || "").trim();

  if (!raw) {
    return { field, reason: `${field} is required` };
  }

  if (NAME_PLACEHOLDER_RE.test(raw)) {
    return { field, reason: `${field} contains a placeholder value: "${raw}"` };
  }

  if (raw.length < 2) {
    return { field, reason: `${field} too short (${raw.length} char; minimum 2)` };
  }

  if (raw.length > 100) {
    return { field, reason: `${field} too long (${raw.length} chars; maximum 100)` };
  }

  if (isAllSameChar(raw.replace(/[\s-]/g, ""))) {
    return { field, reason: `${field} is all the same character: "${raw}"` };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Date consistency validation
// ---------------------------------------------------------------------------

export interface DateConsistencyInput {
  dateOfBirth?: string | null;
  passportIssueDate?: string | null;
  passportExpiryDate?: string | null;
  /** Reference point for "today"; defaults to new Date(). */
  now?: Date;
}

/**
 * Validate the logical relationship between the three identity dates.
 * All fields are optional — only present+parseable dates participate.
 *
 * Rules (only applied when the relevant dates are both present AND parseable):
 *  - dateOfBirth must be in the past (≥ 1 day ago).
 *  - dateOfBirth year: 1900 – (today − 10 years).
 *  - passportIssueDate must not be in the future.
 *  - passportIssueDate must be after dateOfBirth (a person can't have a
 *    passport before being born).
 *  - passportExpiryDate must be after passportIssueDate.
 */
export function validateDateConsistency(
  input: DateConsistencyInput,
): IdentityValidationError[] {
  const errors: IdentityValidationError[] = [];
  const now = input.now ?? new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const dob = parseDate(input.dateOfBirth);
  const issueDate = parseDate(input.passportIssueDate);
  const expiryDate = parseDate(input.passportExpiryDate);

  if (input.dateOfBirth && !dob) {
    errors.push({
      field: "dateOfBirth",
      reason: `Cannot parse date of birth: "${input.dateOfBirth}"`,
    });
  }
  if (input.passportIssueDate && !issueDate) {
    errors.push({
      field: "passportIssueDate",
      reason: `Cannot parse passport issue date: "${input.passportIssueDate}"`,
    });
  }
  if (input.passportExpiryDate && !expiryDate) {
    errors.push({
      field: "passportExpiryDate",
      reason: `Cannot parse passport expiry date: "${input.passportExpiryDate}"`,
    });
  }

  if (dob) {
    if (dob.getTime() >= todayUtc) {
      errors.push({
        field: "dateOfBirth",
        reason: "Date of birth cannot be today or in the future",
      });
    } else if (dob.getUTCFullYear() < 1900) {
      errors.push({
        field: "dateOfBirth",
        reason: `Date of birth year ${dob.getUTCFullYear()} is before 1900 — likely a data error`,
      });
    } else {
      const ageYears = (todayUtc - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (ageYears < 10) {
        errors.push({
          field: "dateOfBirth",
          reason: `Date of birth implies age ${ageYears.toFixed(1)} — too young for a university applicant`,
        });
      } else if (ageYears > 100) {
        errors.push({
          field: "dateOfBirth",
          reason: `Date of birth implies age ${ageYears.toFixed(1)} — likely a data error`,
        });
      }
    }
  }

  if (issueDate) {
    if (issueDate.getTime() > todayUtc) {
      errors.push({
        field: "passportIssueDate",
        reason: "Passport issue date is in the future — not yet a valid passport",
      });
    }
    if (dob && issueDate.getTime() <= dob.getTime()) {
      errors.push({
        field: "passportIssueDate",
        reason: "Passport issue date must be after date of birth",
      });
    }
  }

  if (expiryDate && issueDate) {
    if (expiryDate.getTime() <= issueDate.getTime()) {
      errors.push({
        field: "passportExpiryDate",
        reason: "Passport expiry date must be after issue date",
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Combined entry point
// ---------------------------------------------------------------------------

export interface IdentityFieldsInput {
  passportNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  passportIssueDate?: string | null;
  passportExpiryDate?: string | null;
  /** Reference point for "today" (defaults to new Date()). */
  now?: Date;
}

/**
 * Run all identity field validations and return every error found.
 * An empty array means the identity data is valid.
 */
export function validateIdentityFields(
  input: IdentityFieldsInput,
): IdentityValidationError[] {
  const errors: IdentityValidationError[] = [];

  const ppError = validatePassportNumber(input.passportNumber);
  if (ppError) errors.push(ppError);

  const fnError = validatePersonName(input.firstName, "firstName");
  if (fnError) errors.push(fnError);

  const lnError = validatePersonName(input.lastName, "lastName");
  if (lnError) errors.push(lnError);

  errors.push(...validateDateConsistency({
    dateOfBirth:       input.dateOfBirth,
    passportIssueDate: input.passportIssueDate,
    passportExpiryDate: input.passportExpiryDate,
    now:               input.now,
  }));

  return errors;
}

/**
 * Format validation errors into a human-readable message string.
 * Suitable for portal submission result_json / error messages.
 */
export function formatIdentityErrors(errors: IdentityValidationError[]): string {
  return errors.map((e) => `[${e.field}] ${e.reason}`).join("; ");
}
