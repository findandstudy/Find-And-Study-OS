import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
} from "../../types.js";
import type { Page } from "playwright-core";
import { launchPortal, saveState, logger } from "../../browser.js";
import { portalCreds } from "../../portalCreds.js";
import { matchProgram } from "../../programMatch.js";
import type { ProgramCandidate } from "../../programMatch.js";
import { existsSync } from "node:fs";

const PORTAL_URL   = "https://apply.topkapi.edu.tr";
const STORAGE_PATH = "/tmp/topkapi-portal-state.json";

/**
 * Manual override map: CRM programId → portal <option> value.
 * Populated when the automatic Jaccard match is not confident enough.
 */
const PROGRAM_MAP: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Country resolution — nationality text → portal dropdown label
// ---------------------------------------------------------------------------
const COUNTRY_MAP: Record<string, string> = {
  afghan:         "Afghanistan",
  algerian:       "Algeria",
  azerbaijani:    "Azerbaijan",
  azerbaijanian:  "Azerbaijan",
  bahraini:       "Bahrain",
  bangladeshi:    "Bangladesh",
  british:        "United Kingdom",
  chinese:        "China",
  egyptian:       "Egypt",
  emirati:        "United Arab Emirates",
  french:         "France",
  german:         "Germany",
  iranian:        "Iran",
  iraqi:          "Iraq",
  jordanian:      "Jordan",
  kazakh:         "Kazakhstan",
  kuwaiti:        "Kuwait",
  kyrgyz:         "Kyrgyzstan",
  lebanese:       "Lebanon",
  libyan:         "Libya",
  moroccan:       "Morocco",
  nigerian:       "Nigeria",
  omani:          "Oman",
  pakistani:      "Pakistan",
  palestinian:    "Palestine",
  qatari:         "Qatar",
  russian:        "Russia",
  saudi:          "Saudi Arabia",
  somali:         "Somalia",
  sudanese:       "Sudan",
  syrian:         "Syria",
  tajik:          "Tajikistan",
  tunisian:       "Tunisia",
  turk:           "Turkey",
  turkish:        "Turkey",
  turkmen:        "Turkmenistan",
  ukrainian:      "Ukraine",
  uzbek:          "Uzbekistan",
  yemeni:         "Yemen",
};

function resolveCountry(nationality: string): string {
  const lower = nationality.toLowerCase();
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
// Click the visible "Sonraki Adım" button
// ---------------------------------------------------------------------------
async function clickNext(page: Page): Promise<void> {
  const btn = page.getByRole("button", { name: /Sonraki Adım/i });
  await btn.waitFor({ state: "visible", timeout: 8000 });
  await btn.click();
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

  // 3. Partial label (case-insensitive) — $eval<R, Arg> returns R=string
  const optVal = await page.$eval<string, string>(
    selector,
    (el, v) => {
      const sel = el as HTMLSelectElement;
      const opt = Array.from(sel.options).find(
        (o) => o.text.toLowerCase().includes(v.toLowerCase()),
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
  async login(opts?: { headless?: boolean }): Promise<AdapterSession> {
    const { user, password } = portalCreds("topkapi");

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

    logger.info(
      "[topkapi] submit — program:", profile.programName,
      "level:", eduLevel,
      "doSubmit:", doSubmit,
    );

    await page.goto(`${PORTAL_URL}/panel/applications/add`, {
      waitUntil: "networkidle",
    });

    // ── STEP 1: email + passport ─────────────────────────────────────────────
    logger.info("[topkapi] Step 1: email + passport");
    await page.fill("input[name=email]",          profile.email);
    await page.fill("input[name=passportNumber]", profile.passportNumber);

    const checkResp = page.waitForResponse(
      (r) => r.url().includes("application-check-student-exists.php"),
    );
    await clickNext(page);
    await checkResp;

    try {
      await page.waitForSelector("input[name=studentName]", { timeout: 8000 });
    } catch {
      logger.warn("[topkapi] studentName not visible after AJAX — student already exists");
      return { alreadyExists: true, submitted: false, programMissing: false };
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

    await clickNext(page);

    // ── STEP 3: education background ─────────────────────────────────────────
    logger.info("[topkapi] Step 3: education background");
    await selectByBest(
      page,
      'select[name="applicationEducationInformationEducationLevel[]"]',
      eduLevel,
    );

    try {
      await page.fill('input[name="schoolName[]"]', profile.schoolName ?? "-");
    } catch {
      try { await page.fill("input[name=schoolName]", profile.schoolName ?? "-"); }
      catch { /* optional */ }
    }

    try {
      await page.fill(
        'input[name="GPA[]"]',
        profile.gpa != null ? String(profile.gpa) : "-",
      );
    } catch { /* optional */ }

    try {
      await page.fill(
        'input[name="GraduationDate[]"]',
        profile.graduationYear != null ? String(profile.graduationYear) : "-",
      );
    } catch { /* optional */ }

    try {
      await selectByBest(page, 'select[name="country[]"]', country);
    } catch { /* optional */ }

    await page.fill("input[name=mainLanguage]", "English");

    if (profile.languageScore != null) {
      try {
        await page.fill("input[name=toeflIbtScore]", String(profile.languageScore));
      } catch { /* optional */ }
    }

    await clickNext(page);

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
      return {
        programMissing: true,
        submitted: false,
        alreadyExists: false,
        detail: `Program "${profile.programName}" not found in dropdown (${programOptions.length} option(s) available)`,
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
      return {
        programMissing: true,
        submitted: false,
        alreadyExists: false,
        detail: `Program select verify failed — matched "${matchResult.match.name}" but selection value was empty`,
      };
    }

    await selectByBest(page, "select[name=needsScholarship]", "0");
    await clickNext(page);

    // ── STEP 5: document uploads ─────────────────────────────────────────────
    logger.info("[topkapi] Step 5: document uploads");
    await page.waitForSelector("input[name=filePassport]", { timeout: 10000 });

    if (files.photo)      { try { await page.setInputFiles("input[name=filePhoto]",      files.photo);      } catch { /* optional */ } }
    if (files.passport)   { try { await page.setInputFiles("input[name=filePassport]",   files.passport);   } catch { /* optional */ } }
    if (files.transcript) { try { await page.setInputFiles("input[name=fileTranscript]", files.transcript); } catch { /* optional */ } }
    if (files.diploma)    { try { await page.setInputFiles("input[name=fileDiploma]",    files.diploma);    } catch { /* optional */ } }

    if (!doSubmit) {
      logger.info("[topkapi] doSubmit=false — stopping before final submit (dry run)");
      return { submitted: false, alreadyExists: false, programMissing: false };
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
    if (saveResp.status() >= 200 && saveResp.status() < 400) {
      logger.info("[topkapi] application submitted ✓ (HTTP", saveResp.status(), ")");
      return { submitted: true, alreadyExists: false, programMissing: false };
    }

    logger.warn("[topkapi] application-save.php returned HTTP", saveResp.status());
    return {
      submitted: false,
      alreadyExists: false,
      programMissing: false,
      detail: `application-save.php returned HTTP ${saveResp.status()}`,
    };
  },
};
