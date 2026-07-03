import type { Page } from "playwright-core";

// ---------------------------------------------------------------------------
// Session returned by adapter.login()
// ---------------------------------------------------------------------------
export interface AdapterSession {
  page: Page;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared portal <option> shape (used by both openPrograms and availablePrograms)
// ---------------------------------------------------------------------------
/**
 * A single portal programme <option>. `enabled` is true for selectable (open)
 * programmes and false for full/disabled ones. This is the common shape written
 * to `portal_submissions.meta.openPrograms` (quota-full) and
 * `portal_submissions.meta.availablePrograms` (program not in dropdown).
 */
export interface PortalProgramOption {
  value: string;
  name: string;
  enabled: boolean;
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
  /**
   * True when the matched programme exists in the portal but its quota is full
   * ("Kontenjan Dolu"). The submission did NOT proceed. Defaults to false/absent.
   * Set together with requestedProgram + openPrograms so downstream
   * orchestration can supersede the full programme structurally.
   */
  programFull?: boolean;
  /**
   * The CRM-resolved programme that the portal reports as full. Set together
   * with programFull. `value` is the portal <option> value when known.
   */
  requestedProgram?: { value?: string; name: string };
  /**
   * The full Step-4 programme list captured from the portal dropdown. `enabled`
   * is true for selectable (open) programmes and false for full ones. Set
   * together with programFull.
   */
  openPrograms?: PortalProgramOption[];
  /**
   * The full portal dropdown option list captured when the requested programme
   * was NOT found in the dropdown but the dropdown WAS reached. Same shape as
   * openPrograms. Set together with programMissing + resolution="not_in_dropdown"
   * so the orchestrator can supersede to a configured backup programme. MUST be
   * omitted when the dropdown was never reached (login/level/mapping failure) —
   * absence signals "alternatives unknown" and suppresses fallback.
   */
  availablePrograms?: PortalProgramOption[];
  /**
   * Why a programMissing result occurred. "not_in_dropdown" means the dropdown
   * was reached and its options are known (see availablePrograms) — eligible for
   * fallback. Absent for other programMissing causes.
   */
  resolution?: "not_in_dropdown";
  /**
   * True when the application is blocked for the student's nationality — it must
   * go through a specific agency ("exclusive region") instead of the portal.
   * Set either preventively by the runner (portal_university_exclusions lookup,
   * portal never run) or reactively by an adapter that detects an exclusive
   * response. Permanent skip — no retry.
   */
  exclusiveRegion?: boolean;
  /** The agency the application must go through, when known. */
  exclusiveAgency?: string;
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
  // ---------------------------------------------------------------------------
  // Panel-managed mapping data (sourced from portal_program_mapping by the
  // runner, keyed by universityKey). All optional — when absent the adapter
  // falls back to its built-in code defaults (zero behaviour change). When
  // present, these EXTEND/OVERRIDE the built-ins (DB wins). See programMatch.ts.
  // ---------------------------------------------------------------------------
  /**
   * { portal option label → CRM program name } — panel-managed Program Mappings
   * (General ∪ university, university wins). Name-based; consulted by the matcher
   * BEFORE fuzzy matching. Replaces the removed CRM-programId override path.
   */
  programNameMap?: Record<string, string>;
  /** EN↔TR synonym groups (folded single tokens). Extends built-in synonyms. */
  programSynonyms?: string[][];
  /** Country name/adjective (lowercase) → portal label. Merged over country maps. */
  countryOverrides?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// A single LIVE portal program option (dropdown value + visible text).
// Returned by adapter.listPrograms() for the admin "Program Eşleme" editor.
// ---------------------------------------------------------------------------
export interface ProgramOption {
  /** The portal <option> value attribute. */
  v: string;
  /** The portal <option> visible text/label. */
  t: string;
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

  /**
   * Optional — fetch the portal's LIVE program option list (value + text) for
   * a given education level WITHOUT submitting an application. Used by the
   * admin "Program Eşleme" editor to populate mapping dropdowns.
   *
   * The caller owns the session lifecycle (login + creds override + close),
   * mirroring submit(). Adapters that cannot enumerate programs omit this.
   *
   * @param level  CRM education level (e.g. "Bachelor", "Masters (Thesis)").
   *               Adapters map it to their own portal value; absent = default.
   */
  listPrograms?(
    session: AdapterSession,
    level?: string,
  ): Promise<ProgramOption[]>;
}
