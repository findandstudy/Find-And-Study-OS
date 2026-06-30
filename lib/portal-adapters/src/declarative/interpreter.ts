/**
 * declarative/interpreter.ts — executes an AdapterSpec against a Playwright
 * page and exposes it as a standard UniversityAdapter.
 *
 * The interpreter is deliberately split into PURE helpers (value resolution,
 * transform application, program selection, result classification) that take
 * plain data and can be unit-tested without a browser, plus the thin
 * `createSpecAdapter` factory that wires them to a live page.
 *
 * Security: `jsHook` steps run arbitrary `page.evaluate()` expressions. They
 * are executed ONLY when the adapter is built with `{ allowJsHook: true }`,
 * which the loader/endpoints set exclusively for trusted specs (builtin source
 * or a super_admin-approved upload). For untrusted specs jsHook steps are
 * skipped with a warning — the engine never silently runs unapproved script.
 */

import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
  LoginOpts,
  ProgramOption,
} from "../types.js";
import type { MinimalPage } from "../declarativeAdapter.js";
import { launchPortal, logger } from "../browser.js";
import { portalCreds } from "../portalCreds.js";
import { fold, matchProgram } from "../programMatch.js";
import type {
  AdapterSpec,
  SpecStep,
  Transform,
  SuccessSpec,
  FailureSpec,
  ProgramSelection,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Page interface — MinimalPage plus the optional capabilities a spec may use.
// All additions are optional so existing mock pages keep compiling.
// ---------------------------------------------------------------------------

export interface SpecPage extends MinimalPage {
  /** Current page URL (used for success/redirect detection). */
  url?(): string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Resolves a "profile.<field>" path to a string value. */
export function resolveProfileValue(profile: SubmitProfile, path: string): string {
  const field = path.startsWith("profile.") ? path.slice("profile.".length) : path;
  const v = (profile as unknown as Record<string, unknown>)[field];
  return v == null ? "" : String(v);
}

/**
 * Applies a step-level value transform. `override`/`map` are deterministic
 * table lookups (keep the original value when no mapping exists). `fuzzy` is a
 * passthrough here — fuzzy matching only makes sense against live option lists
 * and is handled in {@link resolveProgramValue}.
 */
export function applyTransform(value: string, transform?: Transform): string {
  if (!transform) return value;
  switch (transform.type) {
    case "override":
    case "map":
      return transform.table?.[value] ?? value;
    case "fuzzy":
      return value;
    default:
      return value;
  }
}

/**
 * Resolves the portal option value for the applicant's program. Priority:
 *   1. spec programSelection.overrides[programId]
 *   2. profile.programOverrides[programId]   (DB program-mapping, DB wins)
 *   3. exact option match (by value, then by folded label)
 *   4. fuzzy match via matchProgram() against the candidate option labels
 * Returns null when nothing meets the threshold.
 */
export function resolveProgramValue(
  options: ProgramOption[],
  profile: SubmitProfile,
  ps?: ProgramSelection,
): { value: string; conf: number } | null {
  const programId = profile.programId ?? "";
  const programName = profile.programName ?? "";

  const specOverride = ps?.overrides?.[programId];
  if (specOverride) return { value: specOverride, conf: 1 };

  const dbOverride = profile.programOverrides?.[programId];
  if (dbOverride) return { value: dbOverride, conf: 1 };

  // Exact match on option value, then on folded label.
  const byValue = options.find((o) => o.v === programName || o.v === programId);
  if (byValue) return { value: byValue.v, conf: 1 };
  const foldedName = fold(programName);
  const byLabel = options.find((o) => fold(o.t) === foldedName);
  if (byLabel) return { value: byLabel.v, conf: 1 };

  // Fuzzy fallback.
  const candidates = options.map((o) => ({ id: o.v, name: o.t }));
  const res = matchProgram(
    programName,
    candidates,
    programId,
    undefined,
    profile.programSynonyms,
  );
  if (!res) return null;
  const threshold = ps?.fuzzyThreshold ?? 0;
  if (threshold > 0 && res.conf < threshold) return null;
  return { value: res.match.id, conf: res.conf };
}

/**
 * Classifies the post-submit page state from the success/failure spec.
 * Reads the page HTML (and URL when available). Captures an externalRef from
 * the success.redirectPattern regex (first capture group) when present.
 */
export async function classifyResult(
  page: SpecPage,
  success: SuccessSpec,
  failure?: FailureSpec,
): Promise<SubmitResult> {
  const html = (await page.content()).toLowerCase();
  const currentUrl = typeof page.url === "function" ? page.url() : "";

  if (success.alreadyExistsText && html.includes(success.alreadyExistsText.toLowerCase())) {
    return { submitted: false, alreadyExists: true, programMissing: false };
  }
  if (success.programMissingText && html.includes(success.programMissingText.toLowerCase())) {
    return { submitted: false, alreadyExists: false, programMissing: true };
  }
  if (failure?.failureText && html.includes(failure.failureText.toLowerCase())) {
    return {
      submitted: false,
      alreadyExists: false,
      programMissing: false,
      detail: "failureText matched",
    };
  }

  let submitted = false;
  if (success.successText && html.includes(success.successText.toLowerCase())) submitted = true;
  if (!submitted && success.responseUrlIncludes && currentUrl.includes(success.responseUrlIncludes)) {
    submitted = true;
  }
  if (!submitted && success.successSelector) {
    const el = await page.$(success.successSelector);
    if (el !== null) submitted = true;
  }

  let externalRef: string | undefined;
  if (success.redirectPattern && currentUrl) {
    try {
      const m = currentUrl.match(new RegExp(success.redirectPattern));
      if (m) {
        externalRef = m[1] ?? m[0];
        submitted = true;
      }
    } catch (err) {
      logger.warn(`[spec] invalid redirectPattern regex: ${String(err)}`);
    }
  }

  const result: SubmitResult = {
    submitted,
    alreadyExists: false,
    programMissing: false,
  };
  if (externalRef) result.externalRef = externalRef;
  return result;
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

export interface StepContext {
  profile: SubmitProfile;
  files: SubmitFiles;
  documentSlots?: AdapterSpec["documents"];
  /** Whether jsHook steps may execute (trusted specs only). */
  allowJsHook: boolean;
}

/** Resolves an upload step's slot to a concrete file path. */
function resolveSlotFile(slot: string, ctx: StepContext): string | undefined {
  const slotDef = ctx.documentSlots?.slots?.[slot];
  const field = (slotDef?.fileField ?? slot) as keyof SubmitFiles;
  return ctx.files[field];
}

/** Executes a single spec step. Honors `optional` (errors are warned, not thrown). */
export async function executeSpecStep(
  page: SpecPage,
  step: SpecStep,
  ctx: StepContext,
): Promise<void> {
  try {
    switch (step.action) {
      case "navigate":
        await page.goto(step.url);
        break;

      case "fill": {
        const base = step.valueFrom != null
          ? resolveProfileValue(ctx.profile, step.valueFrom)
          : (step.value ?? "");
        await page.fill(step.selector, applyTransform(base, step.transform));
        break;
      }

      case "select": {
        const base = resolveProfileValue(ctx.profile, step.valueFrom);
        const value = applyTransform(base, step.transform);
        if (step.byLabel) await page.selectOption(step.selector, { label: value });
        else await page.selectOption(step.selector, value);
        break;
      }

      case "click":
        await page.click(step.selector);
        break;

      case "upload": {
        const filePath = resolveSlotFile(step.slot, ctx);
        if (filePath) await page.setInputFiles(step.selector, filePath);
        else logger.warn(`[spec] upload skipped — no file for slot "${step.slot}"`);
        break;
      }

      case "check": {
        const want = step.value ?? true;
        let current = false;
        try {
          current = page.isChecked ? await page.isChecked(step.selector) : false;
        } catch {
          current = false;
        }
        if (current !== want) await page.click(step.selector);
        break;
      }

      case "radio": {
        const raw = resolveProfileValue(ctx.profile, step.valueFrom).trim().toLowerCase();
        const sel =
          step.map[raw] ??
          Object.entries(step.map).find(
            ([k]) => raw && (raw === k || raw.startsWith(k) || raw.includes(k)),
          )?.[1] ??
          step.fallback;
        if (sel) await page.click(sel);
        else logger.warn(`[spec] radio: no match for "${raw}"`);
        break;
      }

      case "waitFor":
        await page.waitForSelector(step.selector);
        break;

      case "ajaxWait": {
        // Best-effort: MinimalPage has no response API. If the page exposes a
        // waitForResponse capability, the live wrapper handles it; otherwise we
        // fall back to a short selector-less settle and continue.
        const maybe = page as unknown as {
          waitForResponse?: (pred: (r: { url(): string }) => boolean, opts?: { timeout?: number }) => Promise<unknown>;
        };
        if (typeof maybe.waitForResponse === "function") {
          await maybe.waitForResponse(
            (r) => r.url().includes(step.urlContains),
            step.timeoutMs ? { timeout: step.timeoutMs } : undefined,
          );
        } else {
          logger.warn(`[spec] ajaxWait("${step.urlContains}") — page has no response API; continuing`);
        }
        break;
      }

      case "jsHook": {
        if (!ctx.allowJsHook) {
          logger.warn("[spec] jsHook skipped — spec is not trusted (allowJsHook=false)");
          break;
        }
        await page.evaluate(step.script);
        break;
      }

      default: {
        const _exhaustive: never = step;
        logger.warn(`[spec] unknown step: ${JSON.stringify(_exhaustive)}`);
      }
    }
  } catch (err) {
    if (step.action !== "jsHook" && "optional" in step && step.optional) {
      logger.warn(`[spec] optional step "${step.action}" failed (ignored): ${String(err)}`);
      return;
    }
    throw err;
  }
}

/** Runs a list of spec steps. In dry mode, terminal `click {final:true}` steps are skipped. */
export async function runSpecSteps(
  page: SpecPage,
  steps: SpecStep[],
  ctx: StepContext,
  skipFinal = false,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (skipFinal && step.action === "click" && step.final) {
      logger.warn(`[spec] DRY: skipping final step #${i + 1}`);
      continue;
    }
    try {
      await executeSpecStep(page, step, ctx);
    } catch (err) {
      throw new Error(`[spec] step #${i + 1} (action="${step.action}") failed: ${String(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SpecAdapterOpts {
  /** Allow jsHook steps to execute. Set only for trusted specs. */
  allowJsHook?: boolean;
}

/**
 * Builds a UniversityAdapter from a validated AdapterSpec. The login() and
 * submit() methods open a real browser; the pure helpers above are exercised
 * directly by unit tests with mock pages.
 */
export function createSpecAdapter(
  spec: AdapterSpec,
  opts: SpecAdapterOpts = {},
): UniversityAdapter {
  const allowJsHook = opts.allowJsHook ?? false;

  return {
    key: spec.meta.key,
    label: spec.meta.name,

    matches(name: string): boolean {
      const f = fold(name);
      return spec.meta.matches.some((p) => f.includes(fold(p)));
    },

    async login(loginOpts?: LoginOpts): Promise<AdapterSession> {
      const { user, password } = loginOpts?.credentials ?? portalCreds(spec.meta.key);
      const session = await launchPortal({ headless: loginOpts?.headless ?? true });
      const page = session.page as unknown as SpecPage;

      logger.info(`[${spec.meta.key}] login — ${spec.auth.loginUrl}`);
      await page.goto(spec.auth.loginUrl);
      // The login steps reference credentials via a synthetic profile so the
      // same step machinery (fill/click/waitFor) drives the login form.
      const credProfile = { ...emptyProfile(), email: user, passportNumber: password } as SubmitProfile;
      await runSpecSteps(
        page,
        spec.auth.loginSteps,
        { profile: credProfile, files: {}, allowJsHook },
        false,
      );
      if (spec.auth.successUrlContains && typeof page.url === "function") {
        const u = page.url();
        if (!u.includes(spec.auth.successUrlContains)) {
          logger.warn(`[${spec.meta.key}] login — successUrlContains not found in "${u}"`);
        }
      }
      logger.info(`[${spec.meta.key}] login — done`);
      return session;
    },

    async submit(
      session: AdapterSession,
      profile: SubmitProfile,
      files: SubmitFiles,
      doSubmit = true,
    ): Promise<SubmitResult> {
      const page = session.page as unknown as SpecPage;
      const dry = doSubmit === false || process.env.PORTAL_DRYRUN === "1";
      logger.info(`[${spec.meta.key}] submit — program: ${profile.programName} (dry=${dry})`);

      await runSpecSteps(
        page,
        spec.steps,
        { profile, files, documentSlots: spec.documents, allowJsHook },
        dry,
      );

      if (dry) {
        logger.warn(`[${spec.meta.key}] DRY: final steps skipped — no application created`);
        return { submitted: false, alreadyExists: false, programMissing: false };
      }

      const result = await classifyResult(page, spec.success, spec.failure);
      logger.info(
        `[${spec.meta.key}] submit done — submitted=${result.submitted}` +
        ` alreadyExists=${result.alreadyExists} programMissing=${result.programMissing}`,
      );
      return result;
    },
  };
}

/** A zero-value SubmitProfile used to drive the login step machinery. */
function emptyProfile(): SubmitProfile {
  return {
    email: "", passportNumber: "", firstName: "", lastName: "", dateOfBirth: "",
    gender: "", fatherName: "", motherName: "", nationality: "", address: "",
    phone: "", level: "", programName: "", programId: "",
  };
}
