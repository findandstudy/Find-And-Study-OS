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

/** Type text into a visible input (tries fill; falls back to pressSequentially on mismatch). */
async function sfFill(page: any, sel: string, value: string | undefined): Promise<void> {
  if (!value) return;
  try {
    const loc = page.locator(sel);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.fill(value).catch(() => {});
      const got = await el.inputValue().catch(() => "");
      if (got !== value) {
        await el.click().catch(() => {});
        await el.fill("").catch(() => {});
        await el.pressSequentially(value, { delay: 50 }).catch(() => {});
      }
      await el.press("Tab").catch(() => {});
      return;
    }
  } catch {/* ignore */}
}

/**
 * Fill a Salesforce lookup/combobox field:
 *   1. Find the visible input inside the lightning-input-field / c-lookup.
 *   2. Type the search term, wait for the dropdown, click the first option.
 *   3. Returns true on success.
 */
async function sfLookup(
  page: any,
  labelPattern: RegExp,
  searchTerm: string,
  timeoutMs = 30000,
): Promise<boolean> {
  logger.info(`[altinbas] sfLookup: label=${labelPattern} search="${searchTerm}"`);
  try {
    // Find label → nearest input/combobox
    const labelLoc = page.getByLabel(labelPattern).first();
    const comboLoc = page.locator(`[aria-label=${JSON.stringify(searchTerm)}], input[role=combobox], input[aria-autocomplete=list], input[aria-autocomplete=both]`);

    // Try getByLabel first (most reliable on standard LWC)
    if ((await labelLoc.count()) && (await labelLoc.isVisible().catch(() => false))) {
      await labelLoc.click().catch(() => {});
      await labelLoc.fill("").catch(() => {});
      await labelLoc.fill(searchTerm).catch(() => {});
    } else {
      // Fall back: find empty visible combobox inputs
      const inputs = page.locator("input[role=combobox], input[aria-autocomplete=list], input[aria-autocomplete=both]");
      const cnt = await inputs.count();
      let found = false;
      for (let i = 0; i < cnt; i++) {
        const el = inputs.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        if ((await el.inputValue().catch(() => "x")) !== "") continue;
        await el.click().catch(() => {});
        await el.fill(searchTerm).catch(() => {});
        found = true;
        break;
      }
      if (!found) {
        logger.warn(`[altinbas] sfLookup: no empty combobox found for "${searchTerm}"`);
        return false;
      }
    }

    // Wait for dropdown options to appear
    const optSel = "[role=option], lightning-base-combobox-item, .slds-listbox__option, li[role=option]";
    await page.waitForSelector(optSel, { timeout: timeoutMs }).catch(() => {});
    await page.waitForTimeout(600);

    // Pick the best matching option (or first)
    const opts = page.locator(optSel);
    const optCount = await opts.count();
    if (!optCount) {
      logger.warn(`[altinbas] sfLookup: no options appeared for "${searchTerm}"`);
      return false;
    }

    const searchFold = fold(searchTerm);
    let clicked = false;
    for (let i = 0; i < optCount; i++) {
      const txt = ((await opts.nth(i).innerText().catch(() => "")) || "").trim();
      if (fold(txt).includes(searchFold) || searchFold.includes(fold(txt))) {
        await opts.nth(i).click({ timeout: 5000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      // Fall back to first option
      await opts.first().click({ timeout: 5000 }).catch(() => {});
      clicked = true;
    }

    await page.waitForTimeout(700);
    logger.info(`[altinbas] sfLookup: picked option for "${searchTerm}" (clicked=${clicked})`);
    return clicked;
  } catch (e) {
    logger.warn(`[altinbas] sfLookup error for "${searchTerm}":`, e);
    return false;
  }
}

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

// ---------------------------------------------------------------------------
// Application-form navigation helper
//
// Salesforce Screen Flow SPA: a cold goto(application-form) is redirected
// by the route-guard to Home. We must boot on Home first, then follow the
// APPLY NOW link (or do a warmed goto). Retry up to 3×.
// ---------------------------------------------------------------------------
async function navigateToAppForm(page: any): Promise<void> {
  const FORM_FIELD_SEL = [
    "input[name='First_Name']",
    "input[name='Last_Name']",
    "input[name='Passport_Number']",
    "input[name*=Passport]",
    "input[type=email]",
    "input[role=combobox]",
    "lightning-input",
    "c-lookup",
  ].join(", ");

  const onWizard = async (): Promise<boolean> => {
    try {
      const loc = page.locator(FORM_FIELD_SEL);
      const n = await loc.count();
      for (let i = 0; i < Math.min(n, 12); i++) {
        if (await loc.nth(i).isVisible().catch(() => false)) return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const tryGoto = async (): Promise<void> => {
    // Boot on portal home first
    await page
      .goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch(() => {});
    await page.waitForTimeout(SF_HYDRATION_MS);

    // Try clicking APPLY NOW / application-form link
    const applyLink = page
      .locator('a[href*="application-form"], button:has-text("APPLY NOW"), a:has-text("APPLY NOW")')
      .first();
    if (await applyLink.count().catch(() => 0)) {
      await applyLink.scrollIntoViewIfNeeded().catch(() => {});
      await applyLink.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }

    // Fall back to direct goto
    if (!(await onWizard())) {
      await page
        .goto(APP_FORM_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
        .catch(() => {});
      // Poll up to 30s for wizard fields
      for (let t = 0; t < 30 && !(await onWizard()); t++) {
        await page.waitForTimeout(1000);
      }
    }
  };

  for (let attempt = 0; attempt < 3 && !(await onWizard()); attempt++) {
    await tryGoto();
  }
}

// ---------------------------------------------------------------------------
// Step 1: Basic Information (the only step fully known from the plan)
//
// Fields seen: First Name*, Last Name*, Citizenship* (lookup), Passport Number*, Applicant Email*
// ---------------------------------------------------------------------------
async function fillStep1(page: any, profile: SubmitProfile): Promise<void> {
  logger.info("[altinbas] Step 1: filling Basic Information");

  // Wait for a Step 1 anchor (passport or email or first name)
  await page
    .waitForSelector(
      "input[name='First_Name'], input[name='Passport_Number'], input[type=email], input[role=combobox]",
      { timeout: 30000 },
    )
    .catch(() => {});

  await page.waitForTimeout(1500);

  // First Name
  await sfFill(page, "input[name='First_Name']", profile.firstName);
  // Fallback: any visible input with label matching "first"
  if (!(await page.locator("input[name='First_Name']").first().inputValue().catch(() => ""))) {
    const lbl = page.getByLabel(/first\s*name/i).first();
    if (await lbl.count()) await lbl.fill(profile.firstName).catch(() => {});
  }

  // Last Name
  await sfFill(page, "input[name='Last_Name']", profile.lastName);
  if (!(await page.locator("input[name='Last_Name']").first().inputValue().catch(() => ""))) {
    const lbl = page.getByLabel(/last\s*name|surname/i).first();
    if (await lbl.count()) await lbl.fill(profile.lastName).catch(() => {});
  }

  // Citizenship lookup (Salesforce typeahead)
  await sfLookup(page, /citizenship|vatanda[sş]/i, profile.nationality || "Turkey");

  // Passport Number
  await sfFill(page, "input[name='Passport_Number']", profile.passportNumber);
  // Fallback by label
  if (!(await page.locator("input[name='Passport_Number']").first().inputValue().catch(() => ""))) {
    const lbl = page.getByLabel(/passport\s*(number)?/i).first();
    if (await lbl.count()) await lbl.fill(profile.passportNumber).catch(() => {});
  }

  // Applicant Email
  await sfFill(page, "input[type=email]", profile.email);
  // Fallback by label
  if (!(await page.locator("input[type=email]").first().inputValue().catch(() => ""))) {
    const lbl = page.getByLabel(/applicant\s*email|e-?mail/i).first();
    if (await lbl.count()) await lbl.fill(profile.email).catch(() => {});
  }

  // Verify fills
  logger.info("[altinbas] Step 1 field values (for verification):", {
    firstName: await page.locator("input[name='First_Name']").first().inputValue().catch(() => "?"),
    lastName:  await page.locator("input[name='Last_Name']").first().inputValue().catch(() => "?"),
    passport:  await page.locator("input[name='Passport_Number']").first().inputValue().catch(() => "?"),
    email:     await page.locator("input[type=email]").first().inputValue().catch(() => "?"),
  });

  logger.info("[altinbas] Step 1: clicking Next");
  await clickNext(page);
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
  const tag = `step${stepIdx}`;
  const shot = await captureCurrentStep(page, tag);
  if (shot) screenshots.push(shot);

  const txt: string = await page
    .evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 800))
    .catch(() => "");

  // Detect final review/submit screen
  if (/review and submit|not submitted yet|please review|submit application/i.test(txt)) {
    logger.info(`[altinbas] Step ${stepIdx}: FINAL REVIEW screen reached`);
    if (dryRun) {
      logger.info("[altinbas] dry-run: stopping before Submit (final review reached)");
      return "final_reached";
    }
    // Real submit — handled in main loop
    return "final_reached";
  }

  // Try a generic Next click to advance (self-capture navigation)
  const advanced = await clickNext(page);
  logger.info(`[altinbas] Step ${stepIdx}: clickNext → advanced=${advanced}`);
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
        logger.info("[altinbas] login: session reused (already authenticated)");
        return session;
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

    // ── Steps 2-N: self-capture loop ──────────────────────────────────────
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

    // ── Final submit (real run only) ──────────────────────────────────────
    if (finalReached && !dryRun) {
      logger.info("[altinbas] clicking final Submit");
      const submitBtn = page
        .getByRole("button", { name: /^\s*(submit|complete|tamamla|gönder|finish|onayla)\s*$/i })
        .first();
      const nextCnt = await page
        .getByRole("button", { name: /^\s*(next|continue|ileri|sonraki|devam)\s*$/i })
        .count();
      if ((await submitBtn.count()) && !nextCnt) {
        await submitBtn.click({ timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(8000);

        const afterTxt: string = await page
          .evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 600))
          .catch(() => "");
        logger.info("[altinbas] post-submit body:", afterTxt.slice(0, 300));

        if (/already an application|already exists|duplicate/i.test(afterTxt)) {
          result.alreadyExists = true;
        } else {
          result.submitted = true;

          // Try to capture external ref (application number)
          const appNumMatch = afterTxt.match(/\b[A-Z]{2,3}\d{6,}\b/);
          if (appNumMatch) result.externalRef = appNumMatch[0];
        }

        const finalShot = await captureScreen(page, "post-submit");
        if (finalShot) screenshots.push(finalShot);
      } else {
        logger.warn("[altinbas] submit button not found on final screen");
      }
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
