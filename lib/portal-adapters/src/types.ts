import type { Page } from "playwright-core";

// ---------------------------------------------------------------------------
// Session returned by adapter.login()
// ---------------------------------------------------------------------------
export interface AdapterSession {
  page: Page;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Result returned by adapter.submit()
// ---------------------------------------------------------------------------
export interface SubmitResult {
  alreadyExists: boolean;
  submitted: boolean;
  programMissing: boolean;
}

// ---------------------------------------------------------------------------
// Applicant profile — CRM-agnostic flat structure
// ---------------------------------------------------------------------------
export interface SubmitProfile {
  email: string;
  passportNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;       // ISO-8601 date, e.g. "1999-04-15"
  gender: string;
  fatherName: string;
  motherName: string;
  nationality: string;
  address: string;
  phone: string;             // local format, no country code where required
  level: string;
  programName: string;
  programId: string;
  universityName?: string;
  schoolName?: string;
  gpa?: number;
  graduationYear?: number;
  languageScore?: number;
}

// ---------------------------------------------------------------------------
// Document file paths (absolute or resolvable by the calling worker)
// ---------------------------------------------------------------------------
export interface SubmitFiles {
  photo?: string;
  passport?: string;
  transcript?: string;
  diploma?: string;
}

// ---------------------------------------------------------------------------
// Adapter interface — one implementation per portal family
// ---------------------------------------------------------------------------
export interface UniversityAdapter {
  key: string;
  label: string;

  /** Returns true when this adapter handles the given university name. */
  matches(name: string): boolean;

  /**
   * Opens a browser session authenticated to the portal.
   * Credentials are read from process.env inside the adapter via portalCreds().
   */
  login(opts?: { headless?: boolean }): Promise<AdapterSession>;

  /** Fills and submits the application form. */
  submit(
    session: AdapterSession,
    profile: SubmitProfile,
    files: SubmitFiles,
  ): Promise<SubmitResult>;
}
