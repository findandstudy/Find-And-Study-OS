/**
 * declarativeAdapter.ts — generic UniversityAdapter factory driven by a
 * JSON-serialisable config object.
 *
 * A declarative adapter handles the login + step-based form-fill for any
 * portal that follows a predictable "fill-fields → click-submit" pattern,
 * without requiring a hand-written TypeScript adapter file.
 *
 * Usage
 * -----
 *   import { createDeclarativeAdapter } from "./declarativeAdapter.js";
 *
 *   const adapter = createDeclarativeAdapter({
 *     key:   "uskudar",
 *     label: "Üsküdar Üniversitesi",
 *     matches: ["uskudar", "üsküdar"],
 *     loginUrl: "https://apply.uskudar.edu.tr/login",
 *     credentials: {
 *       userSelector:   "#email",
 *       passSelector:   "#password",
 *       submitSelector: "button[type=submit]",
 *       afterSelector:  ".dashboard",   // optional — wait for this after login
 *     },
 *     steps: [
 *       { type: "navigate", url: "https://apply.uskudar.edu.tr/new" },
 *       { type: "fill",   selector: "#firstName", field: "firstName" },
 *       { type: "fill",   selector: "#lastName",  field: "lastName"  },
 *       { type: "fill",   selector: "#dob",       field: "dateOfBirth" },
 *       { type: "select", selector: "#gender",    field: "gender"    },
 *       { type: "upload", selector: "#passport",  fileField: "passport" },
 *       { type: "click",  selector: "#submitBtn" },
 *     ],
 *     submitCheck: {
 *       successText:        "başvurunuz alınmıştır",
 *       alreadyExistsText:  "kayıtlı öğrenci",
 *       programMissingText: "program bulunamadı",
 *     },
 *   });
 */

import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
} from "./types.js";
import { launchPortal, logger } from "./browser.js";
import { portalCreds } from "./portalCreds.js";
import { fold } from "./programMatch.js";

// ---------------------------------------------------------------------------
// Step types
// ---------------------------------------------------------------------------

/** Profile fields that a step can read from. */
export type ProfileField = keyof SubmitProfile;

/** Document file-path fields that a step can read from. */
export type FileField = keyof SubmitFiles;

/**
 * A single automation step executed against the browser page.
 *
 * - navigate  → page.goto(url)
 * - fill      → page.fill(selector, profile[field] | value)
 * - select    → page.selectOption(selector, profile[field])
 * - click     → page.click(selector)
 * - upload    → page.setInputFiles(selector, files[fileField])
 * - wait      → page.waitForSelector(selector)
 * - screenshot → no-op in dry mode; captures PNG in real mode
 */
export type DeclarativeStep =
  | { type: "navigate";   url: string }
  | { type: "fill";       selector: string; field: ProfileField; value?: never }
  | { type: "fill";       selector: string; value: string;       field?: never }
  | { type: "select";     selector: string; field: ProfileField }
  | { type: "click";      selector: string }
  | { type: "upload";     selector: string; fileField: FileField }
  | { type: "wait";       selector: string }
  | { type: "screenshot" };

// ---------------------------------------------------------------------------
// Declarative config
// ---------------------------------------------------------------------------

export interface DeclarativeCredentials {
  /** CSS selector for the username / e-mail input. */
  userSelector: string;
  /** CSS selector for the password input. */
  passSelector: string;
  /** CSS selector for the login submit button. */
  submitSelector: string;
  /**
   * Optional selector to wait for after clicking submit to confirm the
   * session is authenticated (e.g. ".dashboard", "#mainMenu").
   */
  afterSelector?: string;
}

export interface SubmitCheck {
  /** CSS selector that must exist in the DOM for a "submitted" outcome. */
  successSelector?: string;
  /** Case-insensitive substring that must appear in page HTML for "submitted". */
  successText?: string;
  /** Case-insensitive substring indicating the student is already registered. */
  alreadyExistsText?: string;
  /** Case-insensitive substring indicating the programme was not found. */
  programMissingText?: string;
}

export interface DeclarativeConfig {
  /** Unique adapter key (snake_case). Must match the env-var prefix used by portalCreds(). */
  key: string;
  /** Human-readable adapter label (displayed in UI / logs). */
  label: string;
  /**
   * Lowercase patterns checked against the case-folded university name.
   * The adapter matches when ANY pattern is found as a substring.
   */
  matches: string[];
  /** Full URL of the portal login page. */
  loginUrl: string;
  /** Login form selectors + credentials. */
  credentials: DeclarativeCredentials;
  /**
   * Ordered list of steps executed after a successful login.
   * Steps run sequentially; any step failure aborts the submission.
   */
  steps: DeclarativeStep[];
  /** Heuristics used to classify the post-submit page state. */
  submitCheck: SubmitCheck;
}

// ---------------------------------------------------------------------------
// Minimal page interface — subset of Playwright Page used by this engine.
// Using a structural interface makes it easy to inject mock pages in tests.
// ---------------------------------------------------------------------------

export interface MinimalPage {
  goto(url: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<unknown>;
  setInputFiles(selector: string, path: string): Promise<void>;
  waitForSelector(selector: string): Promise<unknown>;
  content(): Promise<string>;
  $(selector: string): Promise<unknown | null>;
}

// ---------------------------------------------------------------------------
// executeStep — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Executes a single declarative step against the given page.
 *
 * Exported so tests can drive it with a mock page (no real browser needed).
 */
export async function executeStep(
  page: MinimalPage,
  step: DeclarativeStep,
  profile: SubmitProfile,
  files: SubmitFiles,
): Promise<void> {
  switch (step.type) {
    case "navigate":
      await page.goto(step.url);
      break;

    case "fill": {
      const value =
        step.field != null
          ? String(profile[step.field] ?? "")
          : (step.value ?? "");
      await page.fill(step.selector, value);
      break;
    }

    case "select": {
      const value = String(profile[step.field] ?? "");
      await page.selectOption(step.selector, value);
      break;
    }

    case "click":
      await page.click(step.selector);
      break;

    case "upload": {
      const filePath = files[step.fileField];
      if (filePath) {
        await page.setInputFiles(step.selector, filePath);
      } else {
        logger.warn(`[declarative] upload step skipped — no file for "${step.fileField}"`);
      }
      break;
    }

    case "wait":
      await page.waitForSelector(step.selector);
      break;

    case "screenshot":
      // No-op at this layer; the worker captures screenshots separately.
      break;

    default:
      logger.warn("[declarative] Unknown step type:", (step as { type: string }).type);
  }
}

// ---------------------------------------------------------------------------
// runSteps — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Executes all declarative steps in order.
 * On any step error the function throws (aborting the submission).
 */
export async function runSteps(
  page: MinimalPage,
  steps: DeclarativeStep[],
  profile: SubmitProfile,
  files: SubmitFiles,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      await executeStep(page, step, profile, files);
    } catch (err) {
      throw new Error(
        `[declarative] Step #${i + 1} (type="${step.type}") failed: ${String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// checkResult — classify the post-submit page state
// ---------------------------------------------------------------------------

export async function checkResult(
  page: MinimalPage,
  check: SubmitCheck,
): Promise<SubmitResult> {
  const html = (await page.content()).toLowerCase();

  // Priority: alreadyExists > programMissing > submitted > default-false
  if (check.alreadyExistsText && html.includes(check.alreadyExistsText.toLowerCase())) {
    return { submitted: false, alreadyExists: true, programMissing: false };
  }

  if (check.programMissingText && html.includes(check.programMissingText.toLowerCase())) {
    return { submitted: false, alreadyExists: false, programMissing: true };
  }

  if (check.successText && html.includes(check.successText.toLowerCase())) {
    return { submitted: true, alreadyExists: false, programMissing: false };
  }

  if (check.successSelector) {
    const el = await page.$(check.successSelector);
    if (el !== null) {
      return { submitted: true, alreadyExists: false, programMissing: false };
    }
  }

  // Nothing matched — conservative: not submitted
  return { submitted: false, alreadyExists: false, programMissing: false };
}

// ---------------------------------------------------------------------------
// createDeclarativeAdapter — factory function
// ---------------------------------------------------------------------------

/**
 * Creates a fully functional UniversityAdapter from a declarative config.
 * The login() and submit() methods open a real browser; they are never
 * invoked during unit tests (the step helpers are tested in isolation).
 */
export function createDeclarativeAdapter(
  config: DeclarativeConfig,
): UniversityAdapter {
  return {
    key:   config.key,
    label: config.label,

    matches(name: string): boolean {
      const f = fold(name);
      return config.matches.some((pattern) => f.includes(fold(pattern)));
    },

    async login(opts?: { headless?: boolean }): Promise<AdapterSession> {
      const { user, password } = portalCreds(config.key);
      const session = await launchPortal({ headless: opts?.headless ?? true });
      const page = session.page as unknown as MinimalPage;

      logger.info(`[${config.key}] login — navigating to ${config.loginUrl}`);
      await page.goto(config.loginUrl);
      await page.fill(config.credentials.userSelector, user);
      await page.fill(config.credentials.passSelector, password);
      await page.click(config.credentials.submitSelector);

      if (config.credentials.afterSelector) {
        await page.waitForSelector(config.credentials.afterSelector);
      }

      logger.info(`[${config.key}] login — authenticated`);
      return session;
    },

    async submit(
      session: AdapterSession,
      profile: SubmitProfile,
      files: SubmitFiles,
    ): Promise<SubmitResult> {
      logger.info(`[${config.key}] submit — program: ${profile.programName}`);
      const page = session.page as unknown as MinimalPage;

      await runSteps(page, config.steps, profile, files);
      const result = await checkResult(page, config.submitCheck);

      logger.info(
        `[${config.key}] submit done —` +
        ` submitted=${result.submitted}` +
        ` alreadyExists=${result.alreadyExists}` +
        ` programMissing=${result.programMissing}`,
      );

      return result;
    },
  };
}
