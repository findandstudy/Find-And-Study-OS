import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
  LoginOpts,
  ProgramOption,
} from "../../types.js";
import type { Page } from "playwright-core";
import { launchPortal, saveState, logger } from "../../browser.js";
import { portalCreds } from "../../portalCreds.js";
import { matchProgram, fold } from "../../programMatch.js";
import type { ProgramCandidate } from "../../programMatch.js";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const PORTAL_URL   = "https://apply.topkapi.edu.tr";
const STORAGE_PATH = "/tmp/topkapi-portal-state.json";

/**
 * Manual override map: CRM programId → portal <option> value OR option text.
 *
 * matchProgram() resolves the override as:
 *   1. candidates.find(c => c.id === override)       — by numeric option value
 *   2. candidates.find(c => fold(c.name) === fold(override)) — by option text
 *
 * Values here are the Turkish portal option texts (best-effort).
 * After running `dump-program-options` script against the live portal, replace
 * each value with the exact numeric <option value="..."> string for conf=1.0
 * matching that is immune to portal wording changes.
 *
 * HOW TO UPDATE:
 *   pnpm --filter @workspace/portal-automation-worker dump-program-options
 *   # Then copy the numeric IDs from /tmp/topkapi-program-options.json here.
 */
const PROGRAM_MAP: Record<string, string> = {
  // ── Bachelor programmes ──────────────────────────────────────────────────
  "9303":  "Bilgisayar Mühendisliği (İngilizce)",
  "9298":  "İşletme (İngilizce)",
  "9299":  "İşletme (Türkçe)",
  "9316":  "Uluslararası Ticaret ve İşletme (İngilizce)",
  "9325":  "Psikoloji (İngilizce)",
  // ── Master programmes ────────────────────────────────────────────────────
  "9339":  "İşletme Yüksek Lisans (Tezsiz) (Türkçe)",
  "13583": "Elektrik-Elektronik Mühendisliği Yüksek Lisans (Tezsiz) (İngilizce)",
  "13588": "İşletme Yüksek Lisans (Tezli) (İngilizce)",
  "13589": "İşletme Yüksek Lisans (Tezsiz) (İngilizce)",
  "13607": "Yönetim Bilişim Sistemleri Yüksek Lisans (Tezsiz) (İngilizce)",
  // ── Bachelor (EEE) ───────────────────────────────────────────────────────
  "13610": "Elektrik-Elektronik Mühendisliği (İngilizce)",
};

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
  "united kingdom": "Birleşik Krallık",
  "united states": "Amerika Birleşik Devletleri",
  "united states of america": "Amerika Birleşik Devletleri",
  "germany": "Almanya",
  "france": "Fransa",
  "india": "Hindistan",
  "pakistan": "Pakistan",
  "nigeria": "Nijerya",
  "saudi arabia": "Suudi Arabistan",
  "kuwait": "Kuveyt",
  "qatar": "Katar",
  "oman": "Umman",
  "palestine": "Filistin",
  "russia": "Rusya",
  "ukraine": "Ukrayna",
  "ghana": "Gana",
  "kenya": "Kenya",
  "tanzania": "Tanzanya",
  "cameroon": "Kamerun",
  "indonesia": "Endonezya",
  "kazakhstan": "Kazakistan",
  "uzbekistan": "Özbekistan",
  "morocco": "Fas",
  "jordan": "Ürdün",
  "iran": "İran",
  "iraq": "Irak",
  "syria": "Suriye",
  "lebanon": "Lübnan",
  "tunisia": "Tunus",
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

function resolveCountry(
  nationality: string,
  overrides?: Record<string, string>,
): string {
  const lower = nationality.toLowerCase().trim();
  // 0. Panel-managed override (DB wins) — exact key first, then adjective substring.
  if (overrides) {
    if (overrides[lower]) return overrides[lower];
    for (const [key, value] of Object.entries(overrides)) {
      if (key && lower.includes(key)) return value;
    }
  }
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
function mapEduLevel(level: string, programName = ""): string {
  const f = level.toLowerCase();
  if (/associate|önlisans|onlisans|foundation/.test(f)) return "Associate";
  if (/master|yüksek|yuksek/.test(f)) {
    // Thesis vs non-thesis is encoded in the CRM PROGRAM NAME (e.g. "İşletme
    // Yüksek Lisans (Tezsiz)"), not the degree level — read both. fold()
    // (not toLowerCase) so ALL-CAPS Turkish dotted-İ in "TEZSİZ" normalises
    // correctly. Handles Turkish (tezli/tezsiz) and English (thesis/non-thesis).
    const combined = fold(`${level} ${programName}`);
    if (/non[- ]?thesis|tezsiz/.test(combined)) return "Masters (Non Thesis)";
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
async function dismissJconfirm(page: Page, logger: typeof import("../../browser.js").logger): Promise<boolean> {
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
async function clickNext(page: Page, logger: typeof import("../../browser.js").logger): Promise<void> {
  // Pre-dismiss any leftover modal before attempting the click (loop)
  for (let i = 0; i < 5; i++) {
    if ((await page.locator(".jconfirm.jconfirm-open").count()) === 0) break;
    await dismissJconfirm(page, logger);
    await page.waitForTimeout(400);
  }

  const btn = page.getByRole("button", { name: /Sonraki Adım/i });
  await btn.waitFor({ state: "visible", timeout: 8000 });
  await btn.click({ force: true });

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
// Select the first "real" option of a <select> (non-empty, non-"0" value).
// Used by listPrograms() to satisfy required country dropdowns with any valid
// value when probing the program list (the actual value is irrelevant there).
// ---------------------------------------------------------------------------
async function selectFirstRealOption(
  page: Page,
  selector: string,
): Promise<boolean> {
  const val = await page
    .$eval(selector, (el) => {
      const sel = el as HTMLSelectElement;
      const opt = Array.from(sel.options).find(
        (o) => o.value && o.value !== "0" && o.value !== "",
      );
      return opt?.value ?? "";
    })
    .catch(() => "");
  if (!val) return false;
  await page.selectOption(selector, { value: val }).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Fire native + jQuery "change" so select2 / jQuery-bound widgets sync to a
// value that was set programmatically. Playwright's selectOption()/fill() sets
// the underlying native control, but the select2 (twopulse-select2) rendered
// widget only updates when jQuery's change handler runs — without this the
// portal keeps the field visually/server-side EMPTY. Mirrors the proven Step 2
// country pattern used elsewhere in this adapter.
// ---------------------------------------------------------------------------
async function syncChange(page: Page, selector: string): Promise<void> {
  await page
    .evaluate((sel) => {
      const e = document.querySelector(sel);
      if (!e) return;
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
      const w = window as unknown as {
        jQuery?: (el: Element) => { trigger: (ev: string) => void };
      };
      if (w.jQuery) w.jQuery(e).trigger("change");
    }, selector)
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Read the current .value of an input/select (trimmed; "" on miss).
// ---------------------------------------------------------------------------
async function readValue(page: Page, selector: string): Promise<string> {
  return page
    .$eval(selector, (el) =>
      ((el as HTMLInputElement | HTMLSelectElement).value ?? "").trim(),
    )
    .catch(() => "");
}

// ---------------------------------------------------------------------------
// Select a select2/<select> value, fire change, read it back; retry once.
// Logs "Step 3 verified: <label>=<value>". Returns the final value ("" if it
// never stuck) so the caller can hard-fail instead of submitting blanks.
// ---------------------------------------------------------------------------
async function selectVerified(
  page: Page,
  selector: string,
  value: string,
  logger: typeof import("../../browser.js").logger,
  label: string,
): Promise<string> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await selectByBest(page, selector, value).catch(() => false);
    await syncChange(page, selector);
    const v = await readValue(page, selector);
    if (v && v !== "0") {
      logger.info(`[topkapi] Step 3 verified: ${label}=${v}`);
      return v;
    }
    logger.warn(
      `[topkapi] Step 3 ${label} empty after attempt ${attempt} — retrying`,
    );
  }
  logger.warn(`[topkapi] Step 3 verified: ${label}=(empty)`);
  return "";
}

// ---------------------------------------------------------------------------
// Fill the first present text input among `selectors`, fire change, read back;
// retry once. Logs "Step 3 verified: <label>=<value>". Returns final value.
// ---------------------------------------------------------------------------
async function fillVerified(
  page: Page,
  selectors: string[],
  value: string,
  logger: typeof import("../../browser.js").logger,
  label: string,
): Promise<string> {
  let sel = "";
  for (const s of selectors) {
    if (await page.locator(s).count()) {
      sel = s;
      break;
    }
  }
  if (!sel) {
    logger.warn(`[topkapi] Step 3 ${label}: no input found`);
    return "";
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.fill(sel, value).catch(() => {});
    await syncChange(page, sel);
    const v = await readValue(page, sel);
    if (v) {
      logger.info(`[topkapi] Step 3 verified: ${label}=${v}`);
      return v;
    }
    logger.warn(
      `[topkapi] Step 3 ${label} empty after attempt ${attempt} — retrying`,
    );
  }
  logger.warn(`[topkapi] Step 3 verified: ${label}=(empty)`);
  return "";
}

// ---------------------------------------------------------------------------
// Ensure at least one education-history row exists. Some portal configs start
// with zero rows and require clicking the green "Eğitim Geçmişi Ekle" button
// before the row's fields exist. No-op when a row is already present (the
// common case — the wizard renders one by default).
// ---------------------------------------------------------------------------
async function ensureEducationRow(
  page: Page,
  logger: typeof import("../../browser.js").logger,
): Promise<void> {
  const rowSel =
    'select[name="applicationEducationInformationEducationLevel[]"], input[name="schoolName[]"], input[name=schoolName]';
  if (await page.locator(rowSel).count()) return;
  logger.info(
    "[topkapi] Step 3: no education row present — clicking add-row button",
  );
  const addBtn = page
    .getByRole("button", { name: /E[ğg]itim Ge[çc]mi[şs]i.*Ekle|Ge[çc]mi[şs]i Ekle/i })
    .first();
  if (await addBtn.count()) {
    await addBtn.click({ force: true }).catch(() => {});
    await page.waitForSelector(rowSel, { timeout: 5000 }).catch(() => {});
  } else {
    logger.warn("[topkapi] Step 3: add-row button not found");
  }
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
    const country  = resolveCountry(profile.nationality, profile.countryOverrides);
    const eduLevel = mapEduLevel(profile.level, profile.programName);
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

    await page.waitForFunction(() => { const s = document.querySelector("select[name=countryOfBirth]"); return !!s && s.options.length > 1; }, { timeout: 8000 }).catch(() => {});
    await selectByBest(page, "select[name=countryOfBirth]", country);
    await selectByBest(page, "select[name=nationality]",    country);
    await selectByBest(page, "select[name=addressCountry]", country);
    await page.evaluate(() => { ["countryOfBirth","nationality","addressCountry"].forEach((n) => { const e = document.querySelector("select[name=" + n + "]"); if (e) { e.dispatchEvent(new Event("change", { bubbles: true })); const w = window; if (w.jQuery) { w.jQuery(e).trigger("change"); } } }); });

    logger.info("[topkapi] DBG country=" + country + " natl=" + (profile.nationality || ""));
    logger.info("[topkapi] DBG cob=" + JSON.stringify(await page.evaluate(() => { const s = document.querySelector("select[name=countryOfBirth]"); return s ? { n: s.options.length, sel: s.value, sample: Array.from(s.options).slice(0, 6).map((o) => o.value + "::" + o.text) } : "NO"; })));
    await page.fill("input[name=address]", profile.address || "-");
    try { await page.fill("input[name=addressCity]", "-"); } catch { /* field optional */ }
    await page.fill("input[name=mobilePhone]", profile.phone);
    const _dump = await page.evaluate(() => { const names = ["studentName","studentSurname","dateOfBirth","gender","fathersName","mothersName","countryOfBirth","nationality","addressCountry","address","addressCity","mobilePhone"]; const out = {}; for (const n of names) { const el = document.querySelector("[name=" + n + "]"); out[n] = el ? el.value : "MISSING"; } return out; });
    logger.info("[topkapi] Step 2 field values:", JSON.stringify(_dump));

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
    // Every field is set THEN read back (with one retry). select2 dropdowns
    // (education level, country) need a native+jQuery change to actually stick —
    // see syncChange(). If school/GPA/graduation/level are still empty after the
    // retry we throw "education fill failed" instead of submitting blanks.
    logger.info("[topkapi] Step 3: education background");

    // Some configs start with zero education-history rows — add one if needed.
    await ensureEducationRow(page, logger);

    logger.info("[topkapi] Step 3a: selecting education level");
    const v_level = await selectVerified(
      page,
      'select[name="applicationEducationInformationEducationLevel[]"]',
      eduLevel,
      logger,
      "educationLevel",
    );

    logger.info("[topkapi] Step 3b: filling school name");
    const v_school = await fillVerified(
      page,
      ['input[name="schoolName[]"]', "input[name=schoolName]"],
      profile.schoolName ?? "-",
      logger,
      "schoolName",
    );

    logger.info("[topkapi] Step 3c: filling GPA");
    const v_gpa = await fillVerified(
      page,
      ['input[name="GPA[]"]', "input[name=GPA]"],
      profile.gpa != null ? String(profile.gpa) : "-",
      logger,
      "gpa",
    );

    logger.info("[topkapi] Step 3d: filling graduation date");
    const v_grad = await fillVerified(
      page,
      ['input[name="GraduationDate[]"]', "input[name=GraduationDate]"],
      profile.graduationYear != null ? String(profile.graduationYear) : "-",
      logger,
      "graduationDate",
    );

    logger.info("[topkapi] Step 3e: selecting country");
    await selectVerified(page, 'select[name="country[]"]', country, logger, "country");

    logger.info("[topkapi] Step 3f: filling main language");
    try {
      const ml = page.locator("input[name=mainLanguage], select[name=mainLanguage]").first();
      if (await ml.count()) {
        const tag = await ml.evaluate((e) => e.tagName).catch(() => "");
        if (tag === "SELECT") {
          await selectVerified(page, "select[name=mainLanguage]", "English", logger, "mainLanguage");
        } else {
          await ml.fill("English");
          await syncChange(page, "input[name=mainLanguage]");
        }
      }
    } catch (e) { /* main language not shown for this program */ }

    if (profile.languageScore != null) {
      logger.info("[topkapi] Step 3g: filling language score");
      try {
        await page.fill("input[name=toeflIbtScore]", String(profile.languageScore));
        await syncChange(page, "input[name=toeflIbtScore]");
      } catch { /* optional */ }
    }

    // Hard gate: never advance with a silently-empty education section. Education
    // level drives the Step 4 program list; school+GPA+graduation are portal-
    // required. Fail loudly (and screenshot) instead of a blank submission.
    const eduMissing: string[] = [];
    if (!v_level) eduMissing.push("educationLevel");
    if (!v_school) eduMissing.push("schoolName");
    if (!v_gpa) eduMissing.push("gpa");
    if (!v_grad) eduMissing.push("graduationDate");
    if (eduMissing.length > 0) {
      { const s = await takeShot(page, "step3-education-fail"); if (s) screenshots.push(s); }
      throw new Error(
        `Topkapı Step 3: education fill failed — empty after retry: ${eduMissing.join(", ")}`,
      );
    }

    logger.info("[topkapi] Step 3: clicking Next");
    await clickNext(page, logger);
    logger.info("[topkapi] Step 3 clickNext done");

    { const s = await takeShot(page, "step3-education"); if (s) screenshots.push(s); }

    // ── STEP 4: program selection (AJAX) ─────────────────────────────────────
    logger.info("[topkapi] Step 4: program selection (AJAX)");
    await page.waitForSelector("input[name=educationLevel]", { timeout: 15000 }).catch(async () => { const d = await page.evaluate(() => { const r=[...document.querySelectorAll("input[type=radio]")].map(x=>x.name); const se=[...document.querySelectorAll("select")].map(x=>x.name); return { radios:[...new Set(r)], selects:[...new Set(se)] }; }); logger.warn("[topkapi] STEP4 DBG " + JSON.stringify(d)); });

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

    // Panel-managed mapping data merges OVER the built-in code defaults (DB wins):
    //   - programOverrides: built-in PROGRAM_MAP first, then DB overrides.
    //   - programSynonyms:  passed through to EXTEND the matcher's dictionary.
    // When the table is empty both are undefined → identical to prior behaviour.
    const mergedProgramMap = profile.programOverrides
      ? { ...PROGRAM_MAP, ...profile.programOverrides }
      : PROGRAM_MAP;

    // ── Explicit override resolution (DB program_overrides) ──────────────────
    // The panel maps CRM programId → portal option value (or label). When an
    // override exists for this application's programId, resolve it directly
    // against the LIVE dropdown options BEFORE any fuzzy matching: by option
    // value first, then exact folded label, then partial folded label. A hit
    // wins with conf 1.0. A miss (stale/typo'd override) logs all options and
    // falls back to fuzzy so a bad override never silently blocks a submission.
    let matchResult: ReturnType<typeof matchProgram> = null;
    const overrideValue = profile.programOverrides?.[String(profile.programId)];
    if (overrideValue) {
      const ovFolded = fold(overrideValue);
      const found =
        programOptions.find((o) => o.id === overrideValue) ??
        programOptions.find((o) => fold(o.name) === ovFolded) ??
        programOptions.find((o) => fold(o.name).includes(ovFolded));
      if (found) {
        logger.info(
          `[topkapi] program override hit — programId=${profile.programId} → "${found.id}: ${found.name}" (override="${overrideValue}")`,
        );
        matchResult = { match: found, conf: 1.0 };
      } else {
        logger.warn(
          `[topkapi] program override "${overrideValue}" (programId=${profile.programId}) matched no option — falling back to fuzzy. All ${programOptions.length} options:`,
          programOptions.map((o) => `${o.id}: ${o.name}`),
        );
      }
    }

    if (!matchResult) {
      matchResult = matchProgram(
        profile.programName,
        programOptions,
        profile.programId,
        mergedProgramMap,
        profile.programSynonyms,
      );
    }

    if (!matchResult) {
      logger.warn(
        `[topkapi] No program match for "${profile.programName}" (programId=${profile.programId}). All ${programOptions.length} options (value: label):`,
        programOptions.map((o) => `${o.id}: ${o.name}`),
      );
      // Full, NON-truncated dump (logger array args can be clipped by the log
      // transport) — every option as {v,t} so missing program values are visible.
      console.log(
        "[topkapi] ALL OPTIONS:",
        JSON.stringify(programOptions.map((o) => ({ v: o.id, t: o.name }))),
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
    { force: true },
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
    await page.waitForSelector("input[name=filePassport]", { state: "attached", timeout: 10000 });

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
    // Success criterion mirrors the proven fas-automation engine: a 2xx/3xx
    // response from application-save.php IS the submission proof (submitted=true).
    // The /applications/success/<uuid> redirect is best-effort — used only to
    // capture externalRef when present; it is NOT required for success. The
    // captured <uuid> is returned as externalRef so the runner persists it to
    // portal_submissions.external_ref.
    logger.info("[topkapi] clicking Başvuruyu Tamamla");

    // Clear any leftover modal, then make sure the final-submit button is reachable.
    for (let i = 0; i < 5; i++) { if ((await page.locator(".jconfirm.jconfirm-open").count()) === 0) break; await dismissJconfirm(page, logger); await page.waitForTimeout(400); }
    for (let i = 0; i < 5; i++) {
      const finBtn = page.getByRole("button", { name: /Başvuruyu Tamamla/i });
      if (await finBtn.isVisible().catch(() => false)) { logger.warn("[topkapi] final-submit visible after " + i + " advance(s)"); break; }
      logger.warn("[topkapi] advancing to final step (Sonraki Adım) #" + (i + 1));
      await clickNext(page, logger).catch(() => {});
      await page.waitForTimeout(1800).catch(() => {});
    }

    // Arm the application-save.php response wait BEFORE clicking submit so we
    // never miss a fast response.
    const savePromise = page
      .waitForResponse((r) => r.url().includes("application-save.php"), { timeout: 45_000 })
      .catch(() => null);

    await page.getByRole("button", { name: /Başvuruyu Tamamla/i }).click().catch(async () => { await page.getByRole("button", { name: /Başvuruyu Tamamla/i }).click({ force: true }).catch(() => {}); });

    // (a) Confirm the optional .jconfirm summary modal if it appears.
    const modalAppeared = await page
      .waitForSelector(".jconfirm", { timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (modalAppeared) {
      let confirmed = await page
        .locator(".jconfirm")
        .getByRole("button", { name: /Tamamla|Onayla|Evet|Gönder|Confirm/i })
        .first()
        .click({ timeout: 2000 })
        .then(() => true)
        .catch(() => false);
      if (!confirmed) {
        confirmed = await page
          .locator(".jconfirm .btn-blue, .jconfirm .btn-primary, .jconfirm button")
          .first()
          .click({ timeout: 2000 })
          .then(() => true)
          .catch(() => false);
      }
      logger.info("[topkapi] summary modal " + (confirmed ? "confirmed" : "appeared but confirm click failed"));
    } else {
      logger.info("[topkapi] no summary modal — direct submit");
    }

    // (b) Read the application-save.php RESPONSE BODY — the body, not the bare
    // HTTP status, decides success. Always log status + first 600 chars so a
    // rejection reason is visible (HTTP 200 alone is never treated as success).
    const resp = await savePromise;
    const saveStatus = resp ? resp.status() : 0;
    let bodyText = "";
    try { bodyText = resp ? await resp.text() : ""; } catch { /* body unreadable */ }
    logger.info("[topkapi] application-save.php " + saveStatus + " BODY: " + bodyText.slice(0, 600));

    let saved = false;
    let externalRef: string | undefined;
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (parsed !== null && typeof parsed === "object") {
        const j = parsed as Record<string, unknown>;
        saved = j.status === "success" || j.success === true || !!j.redirect || !!j.applicationId;
        const rid = typeof j.redirect === "string" ? j.redirect : typeof j.url === "string" ? j.url : "";
        const mm = rid.match(/success\/([0-9a-f-]{8,})/i);
        if (mm) externalRef = mm[1];
        if (!saved && (j.message || j.error)) {
          logger.warn("[topkapi] SAVE REJECTED: " + String(j.message ?? j.error));
        }
      }
    } catch { /* body is not JSON */ }

    // (c) Best-effort: success URL redirect (captures external_ref AND confirms
    // saved when the body wasn't conclusive JSON). Not required once saved.
    if (!externalRef) {
      try {
        await page.waitForURL(/\/applications\/success\//i, { timeout: 10000 });
        const m = page.url().match(/\/applications\/success\/([0-9a-f-]{8,})/i);
        if (m) { externalRef = m[1]; saved = true; }
      } catch { /* no redirect */ }
    }

    { const s2 = await takeShot(page, "final").catch(() => null); if (s2) screenshots.push(s2); }

    // Submission proof = body success/redirect/applicationId (or the success-url
    // redirect). HTTP 200 alone is NOT success.
    const submitted = saved;

    if (submitted) {
      if (externalRef !== undefined) {
        logger.info("[topkapi] success url " + externalRef);
      } else {
        logger.warn("[topkapi] saved but success-url not captured — save=" + saveStatus + " url=" + page.url());
      }
      return { submitted: true, alreadyExists: false, programMissing: false, externalRef, screenshots };
    }

    logger.warn(
      "[topkapi] submit not saved — save=" + saveStatus + " modal=" + modalAppeared + " url=" + page.url(),
    );
    return {
      submitted: false,
      alreadyExists: false,
      programMissing: false,
      detail:
        "submit not confirmed — application-save.php body not success (status " + saveStatus + ")",
      screenshots,
    };
  },

  // -------------------------------------------------------------------------
  // listPrograms — fetch the LIVE program option list WITHOUT submitting.
  //
  // Reuses the same Step 1-4 wizard navigation as submit() but with synthetic
  // throwaway applicant data, stopping at the Step 4 AJAX program dropdown.
  // Nothing is persisted on the portal — the final submit click is never made.
  // The caller owns the session lifecycle (login + creds + close).
  // -------------------------------------------------------------------------
  async listPrograms(
    session: AdapterSession,
    level?: string,
  ): Promise<ProgramOption[]> {
    const { page } = session;
    const eduLevel = mapEduLevel(level ?? "Bachelor", "");
    logger.info("[topkapi] listPrograms — level:", level ?? "(default)", "→", eduLevel);

    page.setDefaultTimeout(8000);
    await page.goto(`${PORTAL_URL}/panel/applications/add`, {
      waitUntil: "networkidle",
    });

    // ── STEP 1: synthetic new-student check ──────────────────────────────────
    const stamp = Date.now();
    await page.fill("input[name=email]", `program-probe-${stamp}@example.invalid`);
    await page.fill("input[name=passportNumber]", `PROBE${stamp}`);

    const checkRespPromise = page
      .waitForResponse((r) =>
        r.url().includes("application-check-student-exists.php"),
      )
      .catch(() => null);
    await clickNext(page, logger);
    await checkRespPromise;

    try {
      await page.waitForSelector("input[name=studentName]", { timeout: 20000 });
    } catch {
      throw new Error(
        "Topkapı: yeni öğrenci formu açılmadı — program listesi çekilemedi",
      );
    }

    // ── STEP 2: minimal personal info (throwaway values) ─────────────────────
    await page.fill("input[name=studentName]", "Program");
    await page.fill("input[name=studentSurname]", "Probe");
    await page.fill("input[name=dateOfBirth]", "01.01.2000");
    await selectByBest(page, "select[name=gender]", "Male");
    await page.fill("input[name=fathersName]", "-");
    await page.fill("input[name=mothersName]", "-");

    await page
      .waitForFunction(
        () => {
          const s = document.querySelector("select[name=countryOfBirth]");
          return !!s && (s as HTMLSelectElement).options.length > 1;
        },
        { timeout: 8000 },
      )
      .catch(() => {});
    await selectFirstRealOption(page, "select[name=countryOfBirth]");
    await selectFirstRealOption(page, "select[name=nationality]");
    await selectFirstRealOption(page, "select[name=addressCountry]");
    await page.evaluate(() => {
      ["countryOfBirth", "nationality", "addressCountry"].forEach((n) => {
        const e = document.querySelector("select[name=" + n + "]");
        if (e) {
          e.dispatchEvent(new Event("change", { bubbles: true }));
          const w = window as unknown as { jQuery?: (el: Element) => { trigger: (ev: string) => void } };
          if (w.jQuery) w.jQuery(e).trigger("change");
        }
      });
    });
    await page.fill("input[name=address]", "-");
    try { await page.fill("input[name=addressCity]", "-"); } catch { /* optional */ }
    await page.fill("input[name=mobilePhone]", "5000000000");

    await clickNext(page, logger);

    try {
      await page.waitForSelector(
        'select[name="applicationEducationInformationEducationLevel[]"]',
        { timeout: 20000 },
      );
    } catch {
      throw new Error("Topkapı: eğitim adımı açılmadı — program listesi çekilemedi");
    }

    // ── STEP 3: education level (drives the Step 4 program list) ──────────────
    await selectByBest(
      page,
      'select[name="applicationEducationInformationEducationLevel[]"]',
      eduLevel,
    );
    try { await page.fill('input[name="schoolName[]"]', "-"); }
    catch { try { await page.fill("input[name=schoolName]", "-"); } catch { /* optional */ } }
    try { await page.fill('input[name="GPA[]"]', "-"); } catch { /* optional */ }
    try { await page.fill('input[name="GraduationDate[]"]', "-"); } catch { /* optional */ }
    try { await selectFirstRealOption(page, 'select[name="country[]"]'); } catch { /* optional */ }

    await clickNext(page, logger);

    // ── STEP 4: trigger AJAX + extract the program dropdown options ───────────
    await page.waitForSelector("input[name=educationLevel]", { timeout: 15000 });
    await page.evaluate((lv: string) => {
      const radios = document.querySelectorAll<HTMLInputElement>(
        "input[name=educationLevel]",
      );
      for (const r of Array.from(radios)) {
        if (r.value === lv) {
          r.checked = true;
          r.dispatchEvent(new Event("change", { bubbles: true }));
          r.dispatchEvent(new Event("click", { bubbles: true }));
          break;
        }
      }
    }, eduLevel);

    await page.waitForFunction(
      () => {
        const sel = document.querySelector<HTMLSelectElement>(
          "select[name=programFirstPreference]",
        );
        return sel !== null && sel.options.length > 1;
      },
      { timeout: 12000 },
    );

    const options: ProgramOption[] = await page.$$eval(
      "select[name=programFirstPreference] option",
      (opts) =>
        (opts as HTMLOptionElement[])
          .filter((o) => o.value && o.value !== "0" && o.value !== "")
          .map((o) => ({ v: o.value, t: o.textContent?.trim() ?? "" })),
    );

    logger.info(
      `[topkapi] listPrograms — ${options.length} option(s) for level=${eduLevel}`,
    );
    return options;
  },
};

