import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
  LoginOpts,
} from "../../types.js";
import type { Page } from "playwright-core";
import { launchPortal, saveState, logger } from "../../browser.js";
import { portalCreds } from "../../portalCreds.js";
import { matchProgram } from "../../programMatch.js";
import type { ProgramCandidate } from "../../programMatch.js";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const PORTAL_URL   = "https://apply.topkapi.edu.tr";
const STORAGE_PATH = "/tmp/topkapi-portal-state.json";

/**
 * Manual override map: CRM programId → portal <option> value.
 * Populated when the automatic Jaccard match is not confident enough.
 */
const PROGRAM_MAP: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Country resolution — nationality text → Topkapi portal dropdown label (Turkish)
//
// The Topkapi portal uses Turkish country names in all dropdowns.
// Values here must match the portal's <option> text exactly (or a substring of it)
// so that selectByBest's partial-label match finds the right option.
// ---------------------------------------------------------------------------
const COUNTRY_MAP: Record<string, string> = {
  afghan:         "Afganistan",
  algerian:       "Cezayir",
  azerbaijani:    "Azerbaycan",
  azerbaijanian:  "Azerbaycan",
  bahraini:       "Bahreyn",
  bangladeshi:    "Bangladeş",
  british:        "Birleşik Krallık",
  chinese:        "Çin",
  egyptian:       "Mısır",
  emirati:        "Birleşik Arap Emirlikleri",
  french:         "Fransa",
  german:         "Almanya",
  indian:         "Hindistan",
  iranian:        "İran",
  iraqi:          "Irak",
  jordanian:      "Ürdün",
  kazakh:         "Kazakistan",
  kuwaiti:        "Kuveyt",
  kyrgyz:         "Kırgızistan",
  lebanese:       "Lübnan",
  libyan:         "Libya",
  moroccan:       "Fas",
  nigerian:       "Nijerya",
  omani:          "Umman",
  pakistani:      "Pakistan",
  palestinian:    "Filistin",
  qatari:         "Katar",
  russian:        "Rusya",
  saudi:          "Suudi Arabistan",
  somali:         "Somali",
  sudanese:       "Sudan",
  syrian:         "Suriye",
  tajik:          "Tacikistan",
  tunisian:       "Tunus",
  turk:           "Türkiye",
  turkish:        "Türkiye",
  turkmen:        "Türkmenistan",
  ukrainian:      "Ukrayna",
  uzbek:          "Özbekistan",
  yemeni:         "Yemen",
};

// Also map commonly-seen raw country-name values (not adjectives) to Turkish.
// Handles cases where student.nationality stores "Uzbekistan" instead of "Uzbek".
const COUNTRY_NAME_MAP: Record<string, string> = {
  afghanistan:              "Afganistan",
  algeria:                  "Cezayir",
  azerbaijan:               "Azerbaycan",
  bahrain:                  "Bahreyn",
  bangladesh:               "Bangladeş",
  china:                    "Çin",
  egypt:                    "Mısır",
  "united arab emirates":   "Birleşik Arap Emirlikleri",
  france:                   "Fransa",
  germany:                  "Almanya",
  india:                    "Hindistan",
  iran:                     "İran",
  iraq:                     "Irak",
  jordan:                   "Ürdün",
  kazakhstan:               "Kazakistan",
  kuwait:                   "Kuveyt",
  kyrgyzstan:               "Kırgızistan",
  lebanon:                  "Lübnan",
  libya:                    "Libya",
  morocco:                  "Fas",
  nigeria:                  "Nijerya",
  oman:                     "Umman",
  pakistan:                 "Pakistan",
  palestine:                "Filistin",
  qatar:                    "Katar",
  russia:                   "Rusya",
  "saudi arabia":           "Suudi Arabistan",
  somalia:                  "Somali",
  sudan:                    "Sudan",
  syria:                    "Suriye",
  tajikistan:               "Tacikistan",
  tunisia:                  "Tunus",
  turkey:                   "Türkiye",
  turkmenistan:             "Türkmenistan",
  ukraine:                  "Ukrayna",
  uzbekistan:               "Özbekistan",
  yemen:                    "Yemen",
};

function resolveCountry(nationality: string): string {
  const lower = nationality.toLowerCase().trim();
  // 1. Exact country-name match (e.g. "Uzbekistan" → "Özbekistan")
  if (COUNTRY_NAME_MAP[lower]) return COUNTRY_NAME_MAP[lower];
  // 2. Nationality-adjective substring match (e.g. "uzbek" in "Uzbekistani" → "Özbekistan")
  for (const [key, value] of Object.entries(COUNTRY_MAP)) {
    if (lower.includes(key)) return value;
  }
  return nationality; // fallback: pass raw to portal (label-match will try)
}

// ---------------------------------------------------------------------------
// Education level → Topkapi portal value
// ---------------------------------------------------------------------------
function mapEduLevel(level: string): string {
  const f = level.toLowerCase();
  if (/associate|önlisans|onlisans|foundation/.test(f)) return "Associate";
  if (/master|yüksek|yuksek/.test(f)) {
    if (/non[- ]?thesis|tezsiz/.test(f)) return "Masters (Non Thesis)";
    return "Masters (Thesis)";
  }
  if (/phd|doctor|doktora/.test(f)) return "Doctorate";
  return "Bachelor";
}

// ---------------------------------------------------------------------------
// ISO-8601 date → Turkish dd.mm.yyyy
// ---------------------------------------------------------------------------
function toTrDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}.${m}.${y}`;
}

// ---------------------------------------------------------------------------
// Dismiss any open jconfirm dialog via direct DOM click (bypasses overlay).
// Logs the dialog text + all button labels for debugging.
// ---------------------------------------------------------------------------
async function dismissJconfirm(page: Page, logger: ReturnType<typeof getLogger>): Promise<boolean> {
  try {
    const info = await page.evaluate(() => {
      const dlg = document.querySelector(".jconfirm.jconfirm-open") as HTMLElement | null;
      if (!dlg) return null;
      const msg = (dlg.querySelector(".jconfirm-content, .jconfirm-message") as HTMLElement | null)?.innerText ?? "";
      const btns = Array.from(dlg.querySelectorAll("button")).map((b) => ({
        text: (b as HTMLElement).innerText.trim(),
        cls: (b as HTMLElement).className,
      }));
      // Click the first button (usually the confirm/OK button)
      const first = dlg.querySelector("button") as HTMLElement | null;
      if (first) first.click();
      return { msg, btns, clicked: !!first };
    });
    if (!info) return false;
    logger.info("[topkapi] jconfirm dismissed — msg:", info.msg.slice(0, 200), "btns:", JSON.stringify(info.btns), "clicked:", info.clicked);
    // Give the dialog animation time to close
    await page.waitForSelector(".jconfirm.jconfirm-open", { state: "hidden", timeout: 2000 }).catch(() => {});
    return info.clicked;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Click the visible "Sonraki Adım" button.
// Pre-dismisses any open jconfirm before clicking (e.g. lingering from prev
// step), then post-dismisses one that may open as a result (e.g. new-student
// confirmation). DOM-click used to bypass Playwright overlay detection.
// ---------------------------------------------------------------------------
async function clickNext(page: Page, logger: ReturnType<typeof getLogger>): Promise<void> {
  // Pre-dismiss any leftover modal before attempting the click
  await dismissJconfirm(page, logger);

  const btn = page.getByRole("button", { name: /Sonraki Adım/i });
  await btn.waitFor({ state: "visible", timeout: 8000 });
  await btn.click();

  // Post-dismiss any modal that opened as a result of the click
  try {
    await page.waitForSelector(".jconfirm.jconfirm-open", { timeout: 3000 });
    await dismissJconfirm(page, logger);
  } catch { /* no modal — continue */ }
}

// ---------------------------------------------------------------------------
// Select <option> by value first, then exact label, then partial label
// ---------------------------------------------------------------------------
async function selectByBest(
  page: Page,
  selector: string,
  value: string,
): Promise<boolean> {
  // 1. By value
  try {
    await page.selectOption(selector, { value });
    const v = await page.$eval(selector, (el) => (el as HTMLSelectElement).value);
    if (v && v !== "0" && v !== "") return true;
  } catch { /* try label */ }

  // 2. By exact label
  try {
    await page.selectOption(selector, { label: value });
    const v = await page.$eval(selector, (el) => (el as HTMLSelectElement).value);
    if (v && v !== "0" && v !== "") return true;
  } catch { /* try partial */ }

  // 3. Partial label — Unicode-normalised, diacritic-stripped, case-insensitive.
  //    Handles Turkish ALL-CAPS option texts like "ÖZBEKİSTAN" where
  //    "İ" (U+0130) decomposes to "i" + combining dot via plain toLowerCase().
  //    IMPORTANT: no named inner functions — esbuild wraps them with __name()
  //    which does not exist inside page.$eval's browser sandbox.
  const optVal = await page.$eval<string, string>(
    selector,
    (el, v) => {
      // Inline normaliser: Turkish İ → i, NFD decompose, strip combining diacritics, lowercase
      const nv = v.replace(/\u0130/gi, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const sel = el as HTMLSelectElement;
      const opt = Array.from(sel.options).find(
        (o) => o.text.replace(/\u0130/gi, "i").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(nv),
      );
      return opt?.value ?? "";
    },
    value,
  );
  if (optVal && optVal !== "0") {
    await page.selectOption(selector, { value: optVal });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Screenshot helper — writes a viewport PNG to /tmp and returns the path.
// Returns null and logs a warning on any failure (non-fatal).
// ---------------------------------------------------------------------------
async function takeShot(page: Page, step: string): Promise<string | null> {
  try {
    const p = path.join(
      os.tmpdir(),
      `portal-shot-na-${step}-${Date.now()}.png`,
    );
    await page.screenshot({ path: p, fullPage: false });
    return p;
  } catch (err) {
    logger.warn(`[topkapi] screenshot failed at step=${step}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export const topkapiAdapter: UniversityAdapter = {
  key:   "topkapi",
  label: "İstanbul Topkapı Üniversitesi",

  matches(name: string): boolean {
    const f = name
      .replace(/İ/g, "i")
      .replace(/I/g, "i")
      .replace(/ı/g, "i")
      .toLowerCase();
    return f.includes("topkapi") || f.includes("topkap");
  },

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------
  async login(opts?: LoginOpts): Promise<AdapterSession> {
    const { user, password } = opts?.credentials ?? portalCreds("topkapi");

    const storagePath = existsSync(STORAGE_PATH) ? STORAGE_PATH : undefined;
    const session = await launchPortal({
      headless: opts?.headless ?? true,
      storagePath,
    });
    const { page } = session;

    logger.info("[topkapi] login — navigating to panel");
    await page.goto(`${PORTAL_URL}/panel`, { waitUntil: "networkidle" });

    if (page.url().includes("/login")) {
      logger.info("[topkapi] login redirect — filling credentials");
      await page.goto(`${PORTAL_URL}/panel/login`, { waitUntil: "networkidle" });
      await page.fill("input[name=email]",    user);
      await page.fill("input[name=password]", password);
      await page.click("button[type=submit]");

      // Wait until redirected to /panel but NOT /login
      await page.waitForURL(
        (url) => url.href.includes("/panel") && !url.href.includes("/login"),
        { timeout: 15000 },
      );
    }

    await saveState(page, STORAGE_PATH);
    logger.info("[topkapi] login successful — URL:", page.url());
    return session;
  },

  // -------------------------------------------------------------------------
  // submit
  //
  // doSubmit=true  (default) — full flow including final submit click
  // doSubmit=false           — fill all steps, stop before clicking submit
  //                            (dry-run smoke test of the form flow)
  // -------------------------------------------------------------------------
  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    files: SubmitFiles,
    doSubmit = true,
  ): Promise<SubmitResult> {
    const { page } = session;
    const country  = resolveCountry(profile.nationality);
    const eduLevel = mapEduLevel(profile.level);
    const screenshots: string[] = [];

    logger.info(
      "[topkapi] submit — program:", profile.programName,
      "level:", eduLevel,
      "doSubmit:", doSubmit,
    );

    // Reduce default action timeout so missing/invisible elements fail fast
    // (default Playwright timeout is 30 s — we want ~8 s to avoid long hangs).
    page.setDefaultTimeout(8000);

    await page.goto(`${PORTAL_URL}/panel/applications/add`, {
      waitUntil: "networkidle",
    });

    // ── STEP 0: form loaded ──────────────────────────────────────────────────
    { const s = await takeShot(page, "step0-form"); if (s) screenshots.push(s); }

    // Debug: log semester / intake dropdown options
    const semesterOpts = await page.evaluate(() => {
      const sel = document.querySelector<HTMLSelectElement>("select[name=semesterId], select[name=semester], select[name=intake], #semesterId, #semester");
      if (!sel) return null;
      return Array.from(sel.options).map((o) => ({ value: o.value, text: o.text.trim(), selected: o.defaultSelected || o.selected }));
    });
    if (semesterOpts) {
      logger.info("[topkapi] semester options:", JSON.stringify(semesterOpts));
    } else {
      // Fallback: log all selects on the page
      const allSelects = await page.evaluate(() =>
        Array.from(document.querySelectorAll("select")).map((s) => ({
          name: s.name, id: s.id,
          opts: Array.from(s.options).map((o) => ({ v: o.value, t: o.text.trim(), sel: o.selected })).slice(0, 10),
        })),
      );
      logger.info("[topkapi] all selects on form:", JSON.stringify(allSelects));
    }

    // ── STEP 1: email + passport ─────────────────────────────────────────────
    logger.info("[topkapi] Step 1: email + passport");
    await page.fill("input[name=email]",          profile.email);
    await page.fill("input[name=passportNumber]", profile.passportNumber);

    // Debug: verify actual field values after fill
    const filledEmail = await page.$eval("input[name=email]", (el) => (el as HTMLInputElement).value).catch(() => "NOT_FOUND");
    const filledPP    = await page.$eval("input[name=passportNumber]", (el) => (el as HTMLInputElement).value).catch(() => "NOT_FOUND");
    logger.info("[topkapi] Step 1 field values — email:", filledEmail || "(empty)", "passport:", filledPP || "(empty)");

    // Intercept the outgoing check request to log its POST body
    let checkRequestBody = "";
    const reqHandler = (req: import("playwright-core").Request) => {
      if (req.url().includes("application-check-student-exists.php")) {
        checkRequestBody = req.postData() ?? "(no body)";
      }
    };
    page.on("request", reqHandler);

    const checkRespPromise = page.waitForResponse(
      (r) => r.url().includes("application-check-student-exists.php"),
    );
    await clickNext(page, logger);
    const checkRespObj = await checkRespPromise;
    page.off("request", reqHandler);
    logger.info("[topkapi] check-student-exists request body:", checkRequestBody.slice(0, 300));

    // Read response body to detect existing-student status directly
    let checkBody = "";
    try { checkBody = await checkRespObj.text(); } catch { /**/ }
    // Log first 300 chars (no personal data — this is just a status response)
    logger.info("[topkapi] check-student-exists response:", checkBody.slice(0, 300));

    { const s = await takeShot(page, "step1-email"); if (s) screenshots.push(s); }

    // Detect existing student from response body.
    // Topkapi returns {"status":"exists","message":"..."} for known students,
    // or {"status":"new"} (or empty/null) for first-time applicants.
    const bodyLc = checkBody.toLowerCase();
    // Topkapi returns {"status":"exists"} for known students.
    // For new students it returns {"status":"new"}, {"status":"success"}, or an empty/null body.
    const existsByBody = bodyLc.includes('"status":"exists"') || bodyLc.includes('"status": "exists"');
    const newByBody   = bodyLc.includes('"status":"new"')     || bodyLc.includes('"status": "new"')
                     || bodyLc.includes('"status":"success"') || bodyLc.includes('"status": "success"')
                     || checkBody.trim() === "" || checkBody.trim() === "null"
                     || checkBody.trim() === "{}" || checkBody.trim() === "[]";

    if (existsByBody) {
      logger.warn("[topkapi] check-student-exists: student already registered");
      return { alreadyExists: true, submitted: false, programMissing: false, screenshots };
    }

    if (!newByBody) {
      // Unknown response format — log and treat as alreadyExists to be safe
      logger.warn("[topkapi] check-student-exists: unknown response format, treating as exists");
      return { alreadyExists: true, submitted: false, programMissing: false, screenshots };
    }

    // Student is new — wait for name input field to appear
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    try {
      await page.waitForSelector("input[name=studentName]", { timeout: 20000 });
    } catch {
      logger.warn("[topkapi] studentName not visible after 20s — treating as already exists");
      return { alreadyExists: true, submitted: false, programMissing: false, screenshots };
    }

    // ── STEP 2: personal info ────────────────────────────────────────────────
    logger.info("[topkapi] Step 2: personal info");
    await page.fill("input[name=studentName]",    profile.firstName);
    await page.fill("input[name=studentSurname]", profile.lastName);
    await page.fill("input[name=dateOfBirth]",    toTrDate(profile.dateOfBirth));

    const genderVal = /^f|kad|woman|kız|kiz/i.test(profile.gender) ? "Female" : "Male";
    await selectByBest(page, "select[name=gender]", genderVal);

    await page.fill("input[name=fathersName]", profile.fatherName);
    await page.fill("input[name=mothersName]", profile.motherName);

    await selectByBest(page, "select[name=countryOfBirth]", country);
    await selectByBest(page, "select[name=nationality]",    country);
    await selectByBest(page, "select[name=addressCountry]", country);

    await page.fill("input[name=address]", profile.address || "-");
    try { await page.fill("input[name=addressCity]", "-"); } catch { /* field optional */ }
    await page.fill("input[name=mobilePhone]", profile.phone);

    await clickNext(page, logger);
    logger.info("[topkapi] Step 2 clickNext done — waiting for Step 3 form");

    // Wait for Step 3 education section to appear before filling it.
    // Without this, the wizard AJAX transition may not have rendered the fields yet.
    try {
      await page.waitForSelector(
        'select[name="applicationEducationInformationEducationLevel[]"]',
        { timeout: 20000 },
      );
      logger.info("[topkapi] Step 3 education level select is visible");
    } catch {
      logger.warn("[topkapi] Step 3 education level select not visible after 20s — form may not have advanced");
    }

    { const s = await takeShot(page, "step2-personal"); if (s) screenshots.push(s); }

    // ── STEP 3: education background ─────────────────────────────────────────
    logger.info("[topkapi] Step 3: education background");
    logger.info("[topkapi] Step 3a: selecting education level");
    await selectByBest(
      page,
      'select[name="applicationEducationInformationEducationLevel[]"]',
      eduLevel,
    );

    logger.info("[topkapi] Step 3b: filling school name");
    try {
      await page.fill('input[name="schoolName[]"]', profile.schoolName ?? "-");
    } catch {
      try { await page.fill("input[name=schoolName]", profile.schoolName ?? "-"); }
      catch { /* optional */ }
    }

    logger.info("[topkapi] Step 3c: filling GPA");
    try {
      await page.fill(
        'input[name="GPA[]"]',
        profile.gpa != null ? String(profile.gpa) : "-",
      );
    } catch { /* optional */ }

    logger.info("[topkapi] Step 3d: filling graduation date");
    try {
      await page.fill(
        'input[name="GraduationDate[]"]',
        profile.graduationYear != null ? String(profile.graduationYear) : "-",
      );
    } catch { /* optional */ }

    logger.info("[topkapi] Step 3e: selecting country");
    try {
      await selectByBest(page, 'select[name="country[]"]', country);
    } catch { /* optional */ }

    logger.info("[topkapi] Step 3f: filling main language");
    await page.fill("input[name=mainLanguage]", "English");

    if (profile.languageScore != null) {
      logger.info("[topkapi] Step 3g: filling language score");
      try {
        await page.fill("input[name=toeflIbtScore]", String(profile.languageScore));
      } catch { /* optional */ }
    }

    logger.info("[topkapi] Step 3: clicking Next");
    await clickNext(page, logger);
    logger.info("[topkapi] Step 3 clickNext done");

    { const s = await takeShot(page, "step3-education"); if (s) screenshots.push(s); }

    // ── STEP 4: program selection (AJAX) ─────────────────────────────────────
    logger.info("[topkapi] Step 4: program selection (AJAX)");
    await page.waitForSelector("input[name=educationLevel]", { timeout: 10000 });

    // Trigger the AJAX call by programmatically checking the education-level radio
    await page.evaluate((lv: string) => {
      const radios = document.querySelectorAll<HTMLInputElement>(
        "input[name=educationLevel]",
      );
      for (const r of Array.from(radios)) {
        if (r.value === lv) {
          r.checked = true;
          r.dispatchEvent(new Event("change", { bubbles: true }));
          r.dispatchEvent(new Event("click",  { bubbles: true }));
          break;
        }
      }
    }, eduLevel);

    // Wait for the program dropdown to populate (>1 option = real options loaded)
    await page.waitForFunction(
      () => {
        const sel = document.querySelector<HTMLSelectElement>(
          "select[name=programFirstPreference]",
        );
        return sel !== null && sel.options.length > 1;
      },
      { timeout: 12000 },
    );

    const programOptions: ProgramCandidate[] = await page.$$eval(
      "select[name=programFirstPreference] option",
      (opts) =>
        (opts as HTMLOptionElement[])
          .filter((o) => o.value && o.value !== "0" && o.value !== "")
          .map((o) => ({ id: o.value, name: o.textContent?.trim() ?? "" })),
    );

    logger.info(
      `[topkapi] ${programOptions.length} program option(s). First 10:`,
      programOptions.slice(0, 10).map((o) => `${o.id}: ${o.name}`),
    );

    const matchResult = matchProgram(
      profile.programName,
      programOptions,
      profile.programId,
      PROGRAM_MAP,
    );

    if (!matchResult) {
      logger.warn(
        "[topkapi] No program match. Available options:",
        programOptions.map((o) => o.name),
      );
      { const s = await takeShot(page, "step4-no-program"); if (s) screenshots.push(s); }
      return {
        programMissing: true,
        submitted: false,
        alreadyExists: false,
        detail: `Program "${profile.programName}" not found in dropdown (${programOptions.length} option(s) available)`,
        screenshots,
      };
    }

    logger.info(
      `[topkapi] Matched: "${matchResult.match.name}" (conf=${matchResult.conf.toFixed(2)})`,
    );

    await page.selectOption(
      "select[name=programFirstPreference]",
      { value: matchResult.match.id },
    );

    const selVal = await page.$eval(
      "select[name=programFirstPreference]",
      (el) => (el as HTMLSelectElement).value,
    );
    if (!selVal || selVal === "0" || selVal === "") {
      logger.warn("[topkapi] Program select verify failed after selection");
      { const s = await takeShot(page, "step4-select-fail"); if (s) screenshots.push(s); }
      return {
        programMissing: true,
        submitted: false,
        alreadyExists: false,
        detail: `Program select verify failed — matched "${matchResult.match.name}" but selection value was empty`,
        screenshots,
      };
    }

    await selectByBest(page, "select[name=needsScholarship]", "0");
    await clickNext(page, logger);

    { const s = await takeShot(page, "step4-program"); if (s) screenshots.push(s); }

    // ── STEP 5: document uploads ─────────────────────────────────────────────
    logger.info("[topkapi] Step 5: document uploads");
    await page.waitForSelector("input[name=filePassport]", { timeout: 10000 });

    if (files.photo)      { try { await page.setInputFiles("input[name=filePhoto]",      files.photo);      } catch { /* optional */ } }
    if (files.passport)   { try { await page.setInputFiles("input[name=filePassport]",   files.passport);   } catch { /* optional */ } }
    if (files.transcript) { try { await page.setInputFiles("input[name=fileTranscript]", files.transcript); } catch { /* optional */ } }
    if (files.diploma)    { try { await page.setInputFiles("input[name=fileDiploma]",    files.diploma);    } catch { /* optional */ } }

    { const s = await takeShot(page, "step5-docs"); if (s) screenshots.push(s); }

    if (!doSubmit) {
      logger.info("[topkapi] doSubmit=false — stopping before final submit (dry run)");
      return { submitted: false, alreadyExists: false, programMissing: false, screenshots };
    }

    // ── FINAL SUBMIT ─────────────────────────────────────────────────────────
    logger.info("[topkapi] clicking Başvuruyu Tamamla");
    const saveRespPromise = page.waitForResponse(
      (r) => r.url().includes("application-save.php"),
      { timeout: 45000 },
    );

    await page.getByRole("button", { name: /Başvuruyu Tamamla/i }).click();

    // Handle optional jconfirm confirmation modal
    try {
      await page.waitForSelector(".jconfirm", { timeout: 6000 });
      try {
        await page
          .locator(".jconfirm")
          .getByRole("button", { name: /Tamamla|Onayla|Evet|Gönder|Confirm/i })
          .first()
          .click({ timeout: 2000 });
      } catch {
        await page
          .locator(".jconfirm .btn-blue, .jconfirm .btn-primary, .jconfirm button")
          .first()
          .click({ timeout: 2000 });
      }
    } catch { /* no modal — direct submit */ }

    const saveResp = await saveRespPromise;

    { const s = await takeShot(page, "final"); if (s) screenshots.push(s); }

    if (saveResp.status() >= 200 && saveResp.status() < 400) {
      logger.info("[topkapi] application submitted ✓ (HTTP", saveResp.status(), ")");
      return { submitted: true, alreadyExists: false, programMissing: false, screenshots };
    }

    logger.warn("[topkapi] application-save.php returned HTTP", saveResp.status());
    return {
      submitted: false,
      alreadyExists: false,
      programMissing: false,
      detail: `application-save.php returned HTTP ${saveResp.status()}`,
      screenshots,
    };
  },
};

