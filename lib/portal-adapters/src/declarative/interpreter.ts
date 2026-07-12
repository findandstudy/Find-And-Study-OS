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
import type { InterpolateCtx } from "./interpolate.js";
import { executeHttpLikeStep } from "./httpRunner.js";

// ---------------------------------------------------------------------------
// Page interface — MinimalPage plus the optional capabilities a spec may use.
// All additions are optional so existing mock pages keep compiling.
// ---------------------------------------------------------------------------

export interface SpecPage extends MinimalPage {
  /** Current page URL (used for success/redirect detection). */
  url?(): string;
  /**
   * Playwright `getByRole` — used by `lookup` and `phone` steps for blur-race-
   * free option selection. Optional so existing mock pages compile unchanged.
   * Returns a Locator-like object; only `click()` and `fill()` are consumed.
   */
  getByRole?(
    role: string,
    opts?: { name?: string | RegExp },
  ): { click(): Promise<void>; fill?(value: string): Promise<void> };
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
 * and is handled in {@link resolveProgramValue}. `toDMY` converts an ISO date
 * string "YYYY-MM-DD" to "DD.MM.YYYY" (passes non-matching strings through).
 */
export function applyTransform(value: string, transform?: Transform): string {
  if (!transform) return value;
  switch (transform.type) {
    case "override":
    case "map":
      return transform.table?.[value] ?? value;
    case "fuzzy":
      return value;
    case "toDMY": {
      const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
    }
    default:
      return value;
  }
}

/**
 * Resolves the portal option value for the applicant's program. Priority:
 *   1. exact option match (by value, then by folded label)
 *   2. name mapping + fuzzy match via matchProgram() (fully name-based)
 * Returns null when nothing meets the threshold. Matching is fully NAME-based —
 * CRM program IDs are never consulted (neither the removed DB override column
 * nor a spec-authored programId override).
 */
export function resolveProgramValue(
  options: ProgramOption[],
  profile: SubmitProfile,
  ps?: ProgramSelection,
): { value: string; conf: number } | null {
  const programName = profile.programName ?? "";

  // Exact match on option value, then on folded label.
  const byValue = options.find((o) => o.v === programName);
  if (byValue) return { value: byValue.v, conf: 1 };
  const foldedName = fold(programName);
  const byLabel = options.find((o) => fold(o.t) === foldedName);
  if (byLabel) return { value: byLabel.v, conf: 1 };

  // Name mapping + fuzzy fallback.
  const candidates = options.map((o) => ({ id: o.v, name: o.t }));
  const res = matchProgram(programName, candidates, {
    nameMap: profile.programNameMap,
    nameMapGeneral: profile.programNameMapGeneral,
    synonyms: profile.programSynonyms,
  });
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
  /** Mutable interpolation context — updated in place by http/graphql/capture/setVar steps. */
  vars: Record<string, unknown>;
  captured: Record<string, unknown>;
  /** Origins allowed for http/graphql steps (from spec.meta.allowedOrigins). */
  allowedOrigins: string[];
  /** Whether we are in dry-run mode (mutation steps are skipped). */
  dryRun: boolean;
}

/**
 * Resolves the effective CSS selector for a step that supports the
 * `name`/`ariaLabel` locator hints. Priority: `name` → `ariaLabel` → `selector`.
 * Converting name/ariaLabel to CSS attribute selectors lets Playwright pierce
 * open shadow DOM automatically (Chromium pierces for attribute selectors).
 */
function resolveStepSelector(step: {
  selector?: string;
  name?: string;
  ariaLabel?: string;
}): string {
  if (step.name) return `[name="${step.name}"]`;
  if (step.ariaLabel) return `[aria-label="${step.ariaLabel}"]`;
  if (step.selector) return step.selector;
  throw new Error("step requires at least one locator: selector, name, or ariaLabel");
}

/**
 * Clicks a ARIA option element by name, using `getByRole("option", {name})`
 * when the page supports it (Playwright Locator API), or falling back to a
 * `:has-text()` CSS click so mock pages and simple wrappers still work.
 */
async function clickOption(page: SpecPage, label: string): Promise<void> {
  if (typeof page.getByRole === "function") {
    await page.getByRole("option", { name: label }).click();
  } else {
    await page.click(`[role="option"]:has-text("${label}")`);
  }
}

/** Resolves an upload step's slot to a concrete file path. */
function resolveSlotFile(slot: string, ctx: StepContext): string | undefined {
  const slotDef = ctx.documentSlots?.slots?.[slot];
  const field = (slotDef?.fileField ?? slot) as keyof SubmitFiles;
  return ctx.files[field];
}

/** Builds an InterpolateCtx from the mutable StepContext fields. */
function toInterpolateCtx(ctx: StepContext): InterpolateCtx {
  return {
    profile: ctx.profile as unknown as Record<string, unknown>,
    vars: ctx.vars,
    captured: ctx.captured,
  };
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
        const sel = resolveStepSelector(step);
        const base = step.valueFrom != null
          ? resolveProfileValue(ctx.profile, step.valueFrom)
          : (step.value ?? "");
        await page.fill(sel, applyTransform(base, step.transform));
        break;
      }

      case "select": {
        const sel = resolveStepSelector(step);
        const base = resolveProfileValue(ctx.profile, step.valueFrom);
        const value = applyTransform(base, step.transform);
        if (step.byLabel) await page.selectOption(sel, { label: value });
        else await page.selectOption(sel, value);
        break;
      }

      case "click":
        await page.click(resolveStepSelector(step));
        break;

      case "upload": {
        const sel = resolveStepSelector(step);
        const filePath = resolveSlotFile(step.slot, ctx);
        if (filePath) await page.setInputFiles(sel, filePath);
        else logger.warn(`[spec] upload skipped — no file for slot "${step.slot}"`);
        break;
      }

      case "check": {
        const sel = resolveStepSelector(step);
        const want = step.value ?? true;
        let current = false;
        try {
          current = page.isChecked ? await page.isChecked(sel) : false;
        } catch {
          current = false;
        }
        if (current !== want) await page.click(sel);
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
        await page.waitForSelector(resolveStepSelector(step));
        break;

      case "lookup": {
        const sel = resolveStepSelector(step);
        const typed = resolveProfileValue(ctx.profile, step.valueFrom);
        await page.fill(sel, typed);
        await clickOption(page, step.optionText ?? typed);
        break;
      }

      case "selectLabel": {
        const sel = resolveStepSelector(step);
        const raw = resolveProfileValue(ctx.profile, step.valueFrom);
        const label = step.map ? (step.map[raw] ?? raw) : raw;
        await page.selectOption(sel, { label });
        break;
      }

      case "clickCardByText": {
        const text = step.textFrom != null
          ? resolveProfileValue(ctx.profile, step.textFrom)
          : (step.text ?? "");
        const cssSel = step.containerHint
          ? `${step.containerHint} :has-text("${text}")`
          : `:is(button,li,[role="option"],[role="button"]):has-text("${text}")`;
        await page.click(cssSel);
        break;
      }

      case "phone": {
        const country = resolveProfileValue(ctx.profile, step.countryFrom);
        const number = resolveProfileValue(ctx.profile, step.numberFrom);
        const countrySel = step.countrySelector ?? '[aria-label*="ountry" i],[name*="ountry" i]';
        const numberSel = step.numberSelector ?? '[aria-label*="hone" i],[name*="hone" i]';
        await page.fill(countrySel, country);
        await clickOption(page, country);
        await page.fill(numberSel, number);
        break;
      }

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

      case "http":
      case "graphql":
      case "capture":
      case "setVar": {
        await executeHttpLikeStep(
          step,
          toInterpolateCtx(ctx),
          page as unknown as Parameters<typeof executeHttpLikeStep>[2],
          { dryRun: ctx.dryRun, allowedOrigins: ctx.allowedOrigins },
        );
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
    // http/graphql mutation steps are also skipped in dry-run (handled inside
    // executeHttpLikeStep via ctx.dryRun, but log here for tracing).
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
      const loginVars: Record<string, unknown> = {};
      const loginCaptured: Record<string, unknown> = {};
      await runSpecSteps(
        page,
        spec.auth.loginSteps,
        {
          profile: credProfile,
          files: {},
          allowJsHook,
          vars: loginVars,
          captured: loginCaptured,
          allowedOrigins: spec.meta.allowedOrigins ?? [],
          dryRun: false,
        },
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

      const submitVars: Record<string, unknown> = {};
      const submitCaptured: Record<string, unknown> = {};
      await runSpecSteps(
        page,
        spec.steps,
        {
          profile,
          files,
          documentSlots: spec.documents,
          allowJsHook,
          vars: submitVars,
          captured: submitCaptured,
          allowedOrigins: spec.meta.allowedOrigins ?? [],
          dryRun: dry,
        },
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
