// ---------------------------------------------------------------------------
// Altınbaş University — Playwright browser adapter
//
// Portal: https://apply.altinbas.edu.tr/partner/s/
// Technology: Salesforce Experience Cloud (Screen Flow)
//
// SCOPE: Master (Yüksek Lisans) + PhD (Doktora) ONLY.
//   Associate / Bachelor gelirse → skipped (never silent-fail).
//
// Phase 1: login + level guard + Step 1 (Basic Info) filling.
// Phase 1 includes a self-capture mode: after Step 1, every subsequent
// screen is fully logged (labels, field types, select options, screenshot)
// so the remaining steps can be implemented from dry-run logs alone.
//
// Dry-run: doSubmit=false stops just before the final "Submit" click.
// ---------------------------------------------------------------------------

import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
  LoginOpts,
  ProgramOption,
} from "../../types.js";
import { launchPortal, logger } from "../../browser.js";
import { portalCreds } from "../../portalCreds.js";
import { fold } from "../../programMatch.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADAPTER_KEY   = "altinbas";
const PORTAL_URL    = "https://apply.altinbas.edu.tr/partner/s/";
const APP_FORM_URL  = PORTAL_URL + "application-form";
const SESSION_STATE = "/tmp/altinbas-portal-state.json";

/** Levels this adapter accepts. Everything else → skipped. */
const ACCEPTED_LEVELS = new Set(["master", "phd", "doctorate", "doktora", "yüksek lisans", "yuksek lisans"]);

// Salesforce LWC hydration is slow — never use networkidle on SF pages.
const SF_HYDRATION_MS = 8000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a level string for the guard check. */
function normLevel(level: string): string {
  return level.trim().toLowerCase();
}

/** True when this level is accepted by Altınbaş adapter. */
function isAcceptedLevel(level: string): boolean {
  return ACCEPTED_LEVELS.has(normLevel(level));
}

/** Snapshot the current screen for self-capture. Returns the /tmp path or null. */
async function captureScreen(
  page: any,
  tag: string,
): Promise<string | null> {
  try {
    const path = `/tmp/altinbas-capture-${tag}-${Date.now()}.png`;
    await page.screenshot({ path, fullPage: false });
    return path;
  } catch {
    return null;
  }
}

/**
 * Self-capture: log every visible label, input, select (+ its options), textarea,
 * and button on the current screen. Also takes a screenshot.
 * This is the Faz 1 "capture mode" — called after Step 1 so subsequent steps
 * can be implemented from logs without a manual capture session.
 */
async function captureCurrentStep(page: any, stepTag: string): Promise<string | null> {
  logger.info(`[altinbas] ── SELF-CAPTURE: ${stepTag} ──────────────────────────`);

  // Screenshot first (page state may change on subsequent interactions)
  const shot = await captureScreen(page, stepTag);
  if (shot) logger.info(`[altinbas] capture screenshot: ${shot}`);

  try {
    const data: unknown = await page.evaluate(() => {
      const out: Record<string, unknown> = {};

      // Page title / heading
      const headings: string[] = [];
      document.querySelectorAll("h1,h2,h3,legend,.slds-text-heading_large,.slds-text-heading_medium").forEach((h) => {
        const t = ((h as HTMLElement).innerText || "").trim();
        if (t) headings.push(t.slice(0, 80));
      });
      out.headings = headings;

      // All visible labels
      const labels: string[] = [];
      document.querySelectorAll("label").forEach((l) => {
        const t = ((l as HTMLLabelElement).innerText || "").trim();
        if (t) labels.push(t.slice(0, 60));
      });
      out.labels = [...new Set(labels)];

      // Input fields (visible)
      const inputs: Record<string, string>[] = [];
      document.querySelectorAll("input").forEach((el) => {
        const i = el as HTMLInputElement;
        if (!i.offsetParent && i.type !== "hidden") return;
        inputs.push({
          type: i.type || "text",
          name: i.name || "",
          placeholder: i.placeholder || "",
          required: String(i.required),
          value: i.value ? "[has value]" : "",
          ariaLabel: i.getAttribute("aria-label") || "",
          role: i.getAttribute("role") || "",
        });
      });
      out.inputs = inputs;

      // Select dropdowns + all options
      const selects: Record<string, unknown>[] = [];
      document.querySelectorAll("select").forEach((el) => {
        const s = el as HTMLSelectElement;
        const opts: string[] = [];
        for (const o of Array.from(s.options)) {
          opts.push(`[${o.value}] ${o.text}`);
        }
        selects.push({ name: s.name, required: String(s.required), options: opts });
      });
      out.selects = selects;

      // Combobox / lookup fields (Salesforce LWC)
      const combos: Record<string, string>[] = [];
      document.querySelectorAll("[role=combobox],[aria-autocomplete=list],[aria-autocomplete=both]").forEach((el) => {
        const e = el as HTMLElement;
        if (!e.offsetParent) return;
        combos.push({
          tagName: e.tagName,
          name: (el as HTMLInputElement).name || "",
          ariaLabel: e.getAttribute("aria-label") || "",
          placeholder: (el as HTMLInputElement).placeholder || "",
        });
      });
      out.combos = combos;

      // Textareas
      const txts: Record<string, string>[] = [];
      document.querySelectorAll("textarea").forEach((el) => {
        const t = el as HTMLTextAreaElement;
        txts.push({ name: t.name, placeholder: t.placeholder, required: String(t.required) });
      });
      out.textareas = txts;

      // Visible buttons
      const btns: string[] = [];
      document.querySelectorAll("button").forEach((b) => {
        if (!b.offsetParent) return;
        const t = (b.innerText || "").trim().replace(/\s+/g, " ");
        if (t && !btns.includes(t)) btns.push(t.slice(0, 40));
      });
      out.buttons = btns;

      // File inputs
      const files: Record<string, string>[] = [];
      document.querySelectorAll("input[type=file]").forEach((el) => {
        const f = el as HTMLInputElement;
        files.push({ name: f.name, accept: f.accept || "", multiple: String(f.multiple) });
      });
      out.fileInputs = files;

      // Body text excerpt (first 800 chars)
      out.bodyExcerpt = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 800);

      return out;
    });

    logger.info(`[altinbas] capture data (${stepTag}):`, JSON.stringify(data, null, 2).slice(0, 4000));
  } catch (e) {
    logger.warn(`[altinbas] capture evaluate failed (${stepTag}):`, e);
  }

  return shot;
}

// ---------------------------------------------------------------------------
// Salesforce LWC field helpers
// ---------------------------------------------------------------------------

/** Click the Next / Continue button. Returns true if found + clicked. */
async function clickNext(page: any): Promise<boolean> {
  const btn = page.getByRole("button", {
    name: /^\s*(next|continue|ileri|sonraki|devam)\s*$/i,
  }).first();
  if (await btn.count()) {
    await btn.click({ timeout: 30000 }).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Salesforce Experience Cloud occasionally shows a "Sorry to interrupt" /
 * "CSS Error" dialog (static-resource hiccup). Dismiss it without ever
 * blocking the flow: prefer "Refresh" (reloads application-form?nocache=…),
 * else "Cancel and close". Always wrapped so callers can fire-and-forget.
 */
async function dismissSfError(page: any): Promise<void> {
  try {
    const dialog = page.getByRole("dialog").filter({
      hasText: /sorry to interrupt|css error/i,
    });
    if (!(await dialog.count().catch(() => 0))) return;

    logger.info("[altinbas] dismissSfError: Salesforce error dialog detected");
    const refreshBtn = dialog.getByRole("button", { name: /refresh/i }).first();
    if (await refreshBtn.count().catch(() => 0)) {
      await refreshBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(3000);
      return;
    }

    const closeBtn = dialog
      .getByRole("button", { name: /cancel and close|close/i })
      .first();
    if (await closeBtn.count().catch(() => 0)) {
      await closeBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  } catch {
    /* never block the flow on this */
  }
}

/**
 * Fill a Salesforce Experience Cloud combobox/typeahead field by visible
 * label, then pick the best-matching option from the resulting listbox.
 * Used for Citizenship on the Basic Info step.
 */
async function pickCombobox(
  page: any,
  labelPattern: RegExp,
  searchTerm: string,
): Promise<boolean> {
  if (!searchTerm) return false;
  try {
    let box = page.getByLabel(labelPattern).first();
    if (!(await box.count().catch(() => 0))) {
      // Fallback: nearby role=combobox / typeahead input
      box = page
        .locator("input[role=combobox], input[aria-autocomplete=list], input[aria-autocomplete=both]")
        .first();
    }
    if (!(await box.count().catch(() => 0))) {
      logger.warn(`[altinbas] pickCombobox: no input found for ${labelPattern}`);
      return false;
    }

    await box.click({ timeout: 8000 }).catch(() => {});
    await box.fill("").catch(() => {});
    await box.fill(searchTerm).catch(() => {});
    await page.waitForTimeout(1500);

    const optSel = "[role=option], lightning-base-combobox-item, .slds-listbox__option, li[role=option]";
    await page.waitForSelector(optSel, { timeout: 8000 }).catch(() => {});
    const opts = page.locator(optSel);
    const optCount = await opts.count().catch(() => 0);
    if (!optCount) {
      logger.warn(`[altinbas] pickCombobox: no options appeared for "${searchTerm}"`);
      return false;
    }

    const searchFold = fold(searchTerm);
    for (let i = 0; i < optCount; i++) {
      const txt = ((await opts.nth(i).innerText().catch(() => "")) || "").trim();
      const optFold = fold(txt);
      if (optFold === searchFold || optFold.startsWith(searchFold) || optFold.includes(searchFold)) {
        await opts.nth(i).click({ timeout: 5000 }).catch(() => {});
        logger.info(`[altinbas] pickCombobox: picked "${txt}" for "${searchTerm}"`);
        await page.waitForTimeout(500);
        return true;
      }
    }

    logger.warn(`[altinbas] pickCombobox: no matching option for "${searchTerm}" (options seen: ${optCount})`);
    return false;
  } catch (e) {
    logger.warn(`[altinbas] pickCombobox error for "${searchTerm}":`, e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Application-form navigation helper
//
// Salesforce Experience Cloud SPA: a cold goto(application-form) is
// redirected by the route-guard back to Home — hard-goto to the deep route
// must NEVER be used. The only reliable path is a click-through SPA
// navigation: Home → "APPLY NOW" (client nav) → Basic Info form.
// ---------------------------------------------------------------------------

/** True once the Basic Info ("Application Form") screen has hydrated. */
async function onWizard(page: any): Promise<boolean> {
  try {
    // "Applicant Email" is unique to the Basic Info form — the most
    // reliable anchor for this Salesforce Experience Cloud screen.
    const emailBox = page.getByLabel(/applicant email/i);
    return (await emailBox.count().catch(() => 0)) > 0;
  } catch {
    return false;
  }
}

async function tryGoto(page: any): Promise<void> {
  // Boot on portal Home first.
  await page
    .goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(SF_HYDRATION_MS);
  await dismissSfError(page);

  if (await onWizard(page)) return;

  // Click "APPLY NOW" (SPA nav) — try role=button, then role=link, then a
  // generic text-match fallback. Hard goto(APP_FORM_URL) is intentionally
  // NOT used here: it gets bounced back to Home by the route guard.
  const candidates = [
    page.getByRole("button", { name: /apply now/i }),
    page.getByRole("link", { name: /apply now/i }),
    page.locator("button, a, [role=button]").filter({ hasText: /apply now/i }),
  ];

  for (const cand of candidates) {
    const loc = cand.first();
    if (await loc.count().catch(() => 0)) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(4000);
      await dismissSfError(page);
      break;
    }
  }

  // Poll up to 30s for the Basic Info form to appear.
  for (let t = 0; t < 30 && !(await onWizard(page)); t++) {
    await page.waitForTimeout(1000);
  }
}

async function navigateToAppForm(page: any): Promise<void> {
  // With a valid session the wizard loads directly; APPLY NOW is absent on Home in automated sessions. direct goto to the wizard.
  for (let d = 0; d < 3 && !(await onWizard(page)); d++) {
    await page.goto(APP_FORM_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(SF_HYDRATION_MS);
    await dismissSfError(page);
  }
  if (await onWizard(page)) return;
  for (let attempt = 0; attempt < 3 && !(await onWizard(page)); attempt++) {
    logger.info(`[altinbas] navigateToAppForm: attempt ${attempt + 1}/3`);
    await tryGoto(page);
  }
  logger.info(`[altinbas] navigateToAppForm: onWizard=${await onWizard(page)}`);
}

// ---------------------------------------------------------------------------
// Step 1: Basic Information (the only step fully known from the plan)
//
// Fields seen: First Name*, Last Name*, Citizenship* (lookup), Passport Number*, Applicant Email*
// ---------------------------------------------------------------------------
async function fillStep1(page: any, profile: SubmitProfile): Promise<void> {
  logger.info("[altinbas] Step 1 (Basic Info): filling label-based fields");
  await dismissSfError(page);

  // Wait for the Basic Info anchor field to hydrate.
  await page.getByLabel(/applicant email/i).first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // First Name
  const firstNameBox = page.getByLabel(/first name/i).first();
  if (await firstNameBox.count().catch(() => 0)) {
    await firstNameBox.fill(profile.firstName).catch(() => {});
  } else {
    logger.warn("[altinbas] Step 1: First Name field not found");
  }

  // Last Name
  const lastNameBox = page.getByLabel(/last name/i).first();
  if (await lastNameBox.count().catch(() => 0)) {
    await lastNameBox.fill(profile.lastName).catch(() => {});
  } else {
    logger.warn("[altinbas] Step 1: Last Name field not found");
  }

  // Passport Number
  const passportBox = page.getByLabel(/passport number/i).first();
  if (await passportBox.count().catch(() => 0)) {
    await passportBox.fill(profile.passportNumber).catch(() => {});
  } else {
    logger.warn("[altinbas] Step 1: Passport Number field not found");
  }

  // Applicant Email
  const emailBox = page.getByLabel(/applicant email/i).first();
  if (await emailBox.count().catch(() => 0)) {
    await emailBox.fill(profile.email).catch(() => {});
  } else {
    logger.warn("[altinbas] Step 1: Applicant Email field not found");
  }

  // Citizenship combobox (Salesforce typeahead)
  const citizenshipOk = await pickCombobox(
    page,
    /citizenship/i,
    profile.nationality || "Turkey",
  );
  if (!citizenshipOk) {
    logger.warn("[altinbas] Step 1: Citizenship combobox did not resolve a match — required field may block Next");
  }

  await page.waitForTimeout(800);
  logger.info(
    "[altinbas] Step1 filled: first/last/passport/email/citizenship",
    {
      firstName: await firstNameBox.inputValue().catch(() => "?"),
      lastName:  await lastNameBox.inputValue().catch(() => "?"),
      passport:  await passportBox.inputValue().catch(() => "?"),
      email:     await emailBox.inputValue().catch(() => "?"),
      citizenshipOk,
    },
  );

  logger.info("[altinbas] Step 1: clicking Next");
  const nextBtn = page.getByRole("button", { name: /^next$/i }).first();
  if (await nextBtn.count().catch(() => 0)) {
    await nextBtn.click({ timeout: 10000 }).catch(() => {});
  } else {
    await clickNext(page);
  }
  await page.waitForTimeout(3000);
}

/**
 * Student summary screen (post Step-1 Next): click "Create New Application"
 * to enter the multi-stage wizard. Returns true on success.
 */
async function clickCreateNewApplication(page: any): Promise<boolean> {
  await dismissSfError(page);
  const createBtn = page.getByRole("button", { name: /create new application/i }).first();
  if (!(await createBtn.count().catch(() => 0))) {
    logger.warn("[altinbas] Create New Application button not found on student summary screen");
    return false;
  }
  await createBtn.scrollIntoViewIfNeeded().catch(() => {});
  await createBtn.click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(3000);
  logger.info("[altinbas] clicked Create New Application — wizard should be starting");
  return true;
}

/**
 * Read the currently active wizard stage name from the stage bar. Options
 * are rendered with text like "<Stage> - Current Stage" / "Stage Complete" /
 * "Stage Not Started".
 */
async function readActiveStageName(page: any): Promise<string | null> {
  try {
    const cur = page.locator("[role=option]").filter({ hasText: /current stage/i }).first();
    if (await cur.count().catch(() => 0)) {
      const txt = ((await cur.innerText().catch(() => "")) || "").trim();
      return txt.replace(/-\s*current stage.*/i, "").trim() || txt;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Unknown-step handler (Faz 1 self-capture)
//
// After Step 1, every unrecognised screen is captured and we attempt a
// generic Next click to advance. This lets dry-run logs expose all steps.
// ---------------------------------------------------------------------------
async function handleUnknownStep(
  page: any,
  stepIdx: number,
  dryRun: boolean,
  screenshots: string[],
): Promise<"advanced" | "final_reached" | "stuck">{
  await dismissSfError(page);

  const stageName = await readActiveStageName(page);
  logger.info(`[altinbas] STAGE: ${stageName ?? "(unknown — stage bar not detected)"} (step ${stepIdx})`);

  const tag = `step${stepIdx}-${(stageName || "unknown").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const shot = await captureScreen(page, tag);
  if (shot) {
    screenshots.push(shot);
    logger.info(`[altinbas] stage screenshot: ${shot}`);
  }

  // Role-based field inventory of the current stage (labels + interactive
  // elements — combos/radios/checkboxes/cards/buttons need role-based
  // enumeration since Salesforce LWC controls carry no name attribute).
  try {
    const [textboxes, radios, checkboxes, comboboxes, buttons] = await Promise.all([
      page.getByRole("textbox").evaluateAll((els: Element[]) =>
        els.map((e) => (e as HTMLElement).getAttribute("aria-label") || (e as HTMLElement).textContent || "").filter(Boolean).slice(0, 40),
      ).catch(() => [] as string[]),
      page.getByRole("radio").evaluateAll((els: Element[]) =>
        els.map((e) => (e as HTMLElement).getAttribute("aria-label") || (e as HTMLElement).textContent || "").filter(Boolean).slice(0, 40),
      ).catch(() => [] as string[]),
      page.getByRole("checkbox").evaluateAll((els: Element[]) =>
        els.map((e) => (e as HTMLElement).getAttribute("aria-label") || (e as HTMLElement).textContent || "").filter(Boolean).slice(0, 40),
      ).catch(() => [] as string[]),
      page.getByRole("combobox").evaluateAll((els: Element[]) =>
        els.map((e) => (e as HTMLElement).getAttribute("aria-label") || (e as HTMLElement).textContent || "").filter(Boolean).slice(0, 40),
      ).catch(() => [] as string[]),
      page.getByRole("button").evaluateAll((els: Element[]) =>
        els.map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 40),
      ).catch(() => [] as string[]),
    ]);

    logger.info(`[altinbas] STAGE field inventory (${stageName ?? "unknown"}):`, {
      textboxes,
      radios,
      checkboxes,
      comboboxes,
      buttons: [...new Set(buttons)],
    });
  } catch (e) {
    logger.warn(`[altinbas] STAGE field inventory failed (${stageName ?? "unknown"}):`, e);
  }

  const txt: string = await page
    .evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 800))
    .catch(() => "");

  // Detect final Completed/Submit screen
  if (/review and submit|not submitted yet|please review|submit application/i.test(txt)) {
    logger.info(`[altinbas] Step ${stepIdx}: FINAL stage reached (${stageName ?? "Completed"})`);
    if (dryRun) {
      logger.info("[altinbas] FINAL stage reached (dry-run: stop before submit)");
    }
    // Real submit is intentionally NOT implemented yet (Faz-5) — handled by
    // the caller regardless of dryRun so a real run never reaches Completed.
    return "final_reached";
  }

  // Try a generic Next click to advance (self-capture navigation). Some
  // stages (Term/Degree/Program selection) require a selection before Next
  // will actually advance — Faz-1 intentionally does not select anything,
  // so getting "stuck" here (after logging the inventory + screenshot) is
  // expected and acceptable for this phase.
  const advanced = await clickNext(page);
  logger.info(`[altinbas] Step ${stepIdx} (${stageName ?? "unknown"}): clickNext → advanced=${advanced}`);
  await dismissSfError(page);
  return advanced ? "advanced" : "stuck";
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------
async function checkAlreadyExists(page: any): Promise<boolean> {
  try {
    const txt: string = await page.evaluate(
      () => (document.body?.innerText || "").replace(/\s+/g, " "),
    );
    const DUP = /already an application for this (passport|email)|already exists|duplicate/i;
    const APP_NUM = /\b[A-Z]{2,3}\d{6,}\b/;
    if (DUP.test(txt)) return true;
    if (/application\s*number/i.test(txt) && APP_NUM.test(txt)) return true;
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main adapter export
// ---------------------------------------------------------------------------
export const altinbasAdapter: UniversityAdapter = {
  key:   ADAPTER_KEY,
  label: "Altınbaş Üniversitesi",

  allowlist: ["altinbas", "altınbaş"],

  matches(name: string): boolean {
    const f = fold(name);
    return f.includes("altinbas") || f.includes("altinbas universitesi");
  },

  // -------------------------------------------------------------------------
  // login — Salesforce Experience Cloud partner community
  // -------------------------------------------------------------------------
  async login(opts?: LoginOpts): Promise<AdapterSession> {
    const { user, password } = opts?.credentials ?? portalCreds(ADAPTER_KEY);
    logger.info(`[altinbas] login → ${PORTAL_URL}`);

    const session = await launchPortal({
      headless: opts?.headless ?? true,
      storagePath: SESSION_STATE,
    });

    const page: any = session.page;
    page.setDefaultTimeout(30000);

    try {
      await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(4000);

      // Already logged in?
      const url: string = page.url();
      if (url.includes("/partner/s/") && !url.includes("/login") && !url.includes("/Login")) {
        await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(SF_HYDRATION_MS);
      const _stale = page.url().toLowerCase().includes("login") || (await page.locator("input[type=password]").first().isVisible().catch(() => false));
      if (!_stale) { logger.info("[altinbas] login: session reused (already authenticated)"); return session; }
      logger.info("[altinbas] login: stored session stale - re-authenticating via form");
      }

      // Fill email
      for (const sel of [
        "input[type=email]",
        "input[name*=email i]",
        "input[id*=email i]",
        "input[type=text]",
      ]) {
        const el = page.locator(sel).first();
        if ((await el.count()) && (await el.isVisible().catch(() => false))) {
          await el.fill(user).catch(() => {});
          break;
        }
      }

      // Fill password
      await page.locator("input[type=password]").first().fill(password);

      // Click login button
      await page
        .getByRole("button", { name: /log\s*in|sign\s*in|giris|giriş/i })
        .first()
        .click({ timeout: 10000 })
        .catch(() => {});

      // Wait up to 30s for redirect away from login
      for (let t = 0; t < 30; t++) {
        await page.waitForTimeout(1000);
        const u: string = page.url();
        if (!u.includes("/login") && !u.includes("/Login")) break;
      }

      const stillLogin = await page
        .locator("input[type=password]")
        .first()
        .isVisible()
        .catch(() => false);
      if (stillLogin) {
        throw new Error("[altinbas] login failed — password field still visible (wrong credentials or captcha)");
      }

      logger.info(`[altinbas] login successful → ${page.url()}`);

      // Save session for reuse
      try {
        await page.context().storageState({ path: SESSION_STATE });
      } catch {/* non-fatal */}
    } catch (err) {
      await session.close().catch(() => {});
      throw err;
    }

    return session;
  },

  // -------------------------------------------------------------------------
  // submit
  // -------------------------------------------------------------------------
  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    files: SubmitFiles,
    doSubmit: boolean = true,
  ): Promise<SubmitResult> {
    const page: any = session.page;
    page.setDefaultTimeout(30000);

    const dryRun =
      doSubmit === false ||
      process.env.PORTAL_DRYRUN === "1" ||
      process.env.ALTINBAS_DRYRUN === "1";

    logger.info("[altinbas] submit start", {
      student:     `${profile.firstName} ${profile.lastName}`,
      level:       profile.level,
      programName: profile.programName,
      dryRun,
    });

    // ── Level guard ─────────────────────────────────────────────────────────
    if (!isAcceptedLevel(profile.level || "")) {
      const msg = `Altınbaş: level "${profile.level}" kapalı (yalnız Master/PhD)`;
      logger.info(`[altinbas] ${msg}`);
      return {
        alreadyExists:  false,
        submitted:      false,
        programMissing: false,
        detail:         msg,
      };
    }

    const result: SubmitResult = {
      alreadyExists:  false,
      submitted:      false,
      programMissing: false,
    };
    const screenshots: string[] = [];

    // ── Navigate to application form ─────────────────────────────────────
    logger.info("[altinbas] navigating to application form");
    await navigateToAppForm(page);
    await page.waitForTimeout(2000);

    // Early duplicate check (Students/Applications list page)
    if (await checkAlreadyExists(page)) {
      logger.info("[altinbas] duplicate detected before form");
      result.alreadyExists = true;
      return { ...result, screenshots };
    }

    // ── Initial screenshot (pre-Step 1) ──────────────────────────────────
    const initShot = await captureScreen(page, "pre-step1");
    if (initShot) screenshots.push(initShot);

    // ── Step 1: Basic Information ─────────────────────────────────────────
    await fillStep1(page, profile);
    await page.waitForTimeout(3000);

    if (await checkAlreadyExists(page)) {
      logger.info("[altinbas] duplicate detected after Step 1");
      result.alreadyExists = true;
      return { ...result, screenshots };
    }

    // ── Student summary → Create New Application ───────────────────────────
    const createdApp = await clickCreateNewApplication(page);
    if (!createdApp) {
      logger.warn("[altinbas] could not click Create New Application — capturing student summary screen and aborting");
      const stuckShot = await captureScreen(page, "student-summary-stuck");
      if (stuckShot) screenshots.push(stuckShot);
      (result as any).stuckStep = 1;
      return { ...result, screenshots };
    }
    await page.waitForTimeout(2000);

    // ── Steps 2-N: self-capture loop (Application Type → Term → Degree →
    //    Program → Personal → Educational → Questionnaire → Documents) ──────
    // Each iteration: capture the current screen, try to advance.
    // The loop exits when:
    //   - Final review/submit screen is reached (handle real submit or stop for dryRun)
    //   - A duplicate is detected
    //   - The page stops advancing (stuck)
    //   - MAX_STEPS safety ceiling is hit
    const MAX_STEPS = 12;
    let finalReached = false;

    for (let step = 2; step <= MAX_STEPS; step++) {
      await page.waitForTimeout(2500);

      if (await checkAlreadyExists(page)) {
        logger.info(`[altinbas] duplicate at step ${step}`);
        result.alreadyExists = true;
        break;
      }

      const outcome = await handleUnknownStep(page, step, dryRun, screenshots);

      if (outcome === "final_reached") {
        finalReached = true;
        break;
      }
      if (outcome === "stuck") {
        logger.warn(`[altinbas] stuck at step ${step}, aborting`);
        (result as any).stuckStep = step;
        break;
      }

      // Wait for page to change before next iteration
      await page.waitForTimeout(2500);
    }

    // ── Final submit — NOT IMPLEMENTED YET (Faz-5) ──────────────────────────
    // Faz-1 scope stops at self-capturing every wizard stage. Real Submit
    // (Completed screen) is deliberately unimplemented in BOTH dry-run and
    // real (doSubmit=true) modes so a live run can never accidentally
    // submit an application before Faz-5 lands the reviewed submit logic.
    if (finalReached) {
      const msg = dryRun
        ? "Altınbaş: dry-run — FINAL stage reached, stopping before Submit"
        : "Altınbaş: final Submit not implemented yet (Faz-5) — stopping before Completed/Submit";
      logger.info(`[altinbas] ${msg}`);
      result.detail = msg;
    }

    if (screenshots.length) result.screenshots = screenshots;
    logger.info("[altinbas] submit complete", result);
    return result;
  },

  // -------------------------------------------------------------------------
  // listPrograms — Phase 2 placeholder
  // TODO: implement after Phase 0 capture reveals the program selection step.
  // -------------------------------------------------------------------------
  async listPrograms(
    session: AdapterSession,
    level?: string,
  ): Promise<ProgramOption[]> {
    logger.warn("[altinbas] listPrograms: not yet implemented (Phase 2)");
    return [];
  },
};
