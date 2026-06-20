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
  /** Human-readable explanation for skips and failures (e.g. program not found detail). */
  detail?: string;
  /**
   * Local /tmp file paths of screenshots taken during the submission flow.
   * The runner uploads these to Object Storage and replaces them with
   * persistent /objects/... references in portal_submissions.screenshotUrls.
   * Optional — adapters that do not capture screenshots omit this field.
   */
  screenshots?: string[];
  /**
   * External reference assigned by the portal (e.g. application UUID from the
   * confirmation page). Optional — not all portals expose this.
   */
  externalRef?: string;
  /**
   * Document type slots that were required but not supplied to the adapter
   * (e.g. ["passport", "transcript"]). Optional — set by adapters when they
   * detect missing uploads.
   */
  missingDocuments?: string[];
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
  // Passport validity dates (ISO-8601 "YYYY-MM-DD"). Optional — only portals
  // that require them (e.g. Medipol) use these. Sourced from the CRM student record.
  passportIssueDate?: string;
  passportExpiryDate?: string;
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
// Login credentials (injected by the worker from DB / env)
// ---------------------------------------------------------------------------
export interface AdapterCredentials {
  user: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Login options
// ---------------------------------------------------------------------------
export interface LoginOpts {
  headless?: boolean;
  /**
   * Portal credentials.  The worker resolves these from the DB-backed
   * portal_credentials table (or process.env via portalCreds() fallback) and
   * passes them here.  Adapters MUST NOT hard-code credentials.
   */
  credentials?: AdapterCredentials;
}

// ---------------------------------------------------------------------------
// Adapter interface — one implementation per portal family
// ---------------------------------------------------------------------------
export interface UniversityAdapter {
  key: string;
  label: string;

  /**
   * Optional human-readable list of university names handled by this adapter.
   * Returned by adapterMetadata() for UI / API display.
   */
  allowlist?: string[];

  /** Returns true when this adapter handles the given university name. */
  matches(name: string): boolean;

  /**
   * Opens a browser session authenticated to the portal.
   *
   * Credentials are resolved (in priority order):
   *   1. opts.credentials  — injected by the worker from DB
   *   2. portalCreds(key)  — reads from process.env (legacy / dev fallback)
   */
  login(opts?: LoginOpts): Promise<AdapterSession>;

  /**
   * Fills and (optionally) submits the application form.
   *
   * @param doSubmit  true (default) = click the final submit button.
   *                  false = fill all steps but stop before submitting —
   *                  useful for dry-run smoke tests of the form flow.
   */
  submit(
    session: AdapterSession,
    profile: SubmitProfile,
    files: SubmitFiles,
    doSubmit?: boolean,
  ): Promise<SubmitResult>;
}
