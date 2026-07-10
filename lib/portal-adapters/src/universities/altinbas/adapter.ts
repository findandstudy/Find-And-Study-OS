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
// Faz-2: wizard stage handlers (Term → Degree → Program → Personal →
// Educational → Questionnaire → Documents → Completed)
//
// Portal country dropdowns/typeaheads use plain ENGLISH names ("Pakistan",
// "United Kingdom") — profile.nationality is expected to already be an
// English adjective/name; this map only normalises common adjective forms
// to the noun the portal expects.
// ---------------------------------------------------------------------------
const COUNTRY_EN_MAP: Record<string, string> = {
  afghan: "Afghanistan", algerian: "Algeria", azerbaijani: "Azerbaijan",
  bahraini: "Bahrain", bangladeshi: "Bangladesh", british: "United Kingdom",
  chinese: "China", egyptian: "Egypt", emirati: "United Arab Emirates",
  french: "France", german: "Germany", indian: "India", iranian: "Iran",
  iraqi: "Iraq", jordanian: "Jordan", kazakh: "Kazakhstan", kenyan: "Kenya",
  kuwaiti: "Kuwait", kyrgyz: "Kyrgyzstan", lebanese: "Lebanon",
  libyan: "Libya", moroccan: "Morocco", nigerian: "Nigeria", omani: "Oman",
  pakistani: "Pakistan", palestinian: "Palestine", qatari: "Qatar",
  russian: "Russia", saudi: "Saudi Arabia", somali: "Somalia",
  sudanese: "Sudan", syrian: "Syria", tajik: "Tajikistan",
  tunisian: "Tunisia", turk: "Turkey", turkish: "Turkey",
  turkmen: "Turkmenistan", ukrainian: "Ukraine", uzbek: "Uzbekistan",
  yemeni: "Yemen",
};

/** Normalise a nationality string to the English country name the portal expects. */
function mapCountry(nationality?: string): string {
  if (!nationality) return "";
  const lower = nationality.trim().toLowerCase();
  return COUNTRY_EN_MAP[lower] || nationality.trim();
}

/**
 * Dial codes for the COUNTRY_EN_MAP countries — used to strip the country
 * code from profile.phone before typing the NATIONAL number (Faz-3 canlı
 * kanıt: portal telefon alanı ülke chip'i + trunk-0'sız ulusal numara ister;
 * "+930798546789" → chip(+93) + "798546789").
 */
const DIAL_CODES: Record<string, string> = {
  Afghanistan: "93", Algeria: "213", Azerbaijan: "994", Bahrain: "973",
  Bangladesh: "880", "United Kingdom": "44", China: "86", Egypt: "20",
  "United Arab Emirates": "971", France: "33", Germany: "49", India: "91",
  Iran: "98", Iraq: "964", Jordan: "962", Kazakhstan: "7", Kenya: "254",
  Kuwait: "965", Kyrgyzstan: "996", Lebanon: "961", Libya: "218",
  Morocco: "212", Nigeria: "234", Oman: "968", Pakistan: "92",
  Palestine: "970", Qatar: "974", Russia: "7", "Saudi Arabia": "966",
  Somalia: "252", Sudan: "249", Syria: "963", Tajikistan: "992",
  Tunisia: "216", Turkey: "90", Turkmenistan: "993", Ukraine: "380",
  Uzbekistan: "998", Yemen: "967",
};

/** "+930798546789" + "93" → "798546789" (ülke kodu + baştaki trunk 0'lar atılır — portal 0'lı numarayı REDDEDİYOR). */
function toNationalNoTrunk(phone: string, dialCode: string): string {
  let n = (phone || "").replace(/[^\d]/g, "");
  const dc = (dialCode || "").replace(/[^\d]/g, "");
  if (dc && n.startsWith(dc)) n = n.slice(dc.length);
  n = n.replace(/^0+/, "");
  return n;
}

/**
 * Shadow-nested native <select> setter (Faz-3 canlı kanıt: Educational "GPA
 * Type" ve telefon ülke chip'i AÇIK shadow içinde — getByLabel bazen
 * ulaşamıyor). Open-shadow walker ile option metnine göre SELECT'i bulur,
 * value set eder ve input+change dispatch eder. Birden çok aday select
 * varsa "+ işareti içeren option'lı" olan tercih edilir (telefon chip'i).
 * Returns the matched option's text, or null. Never throws.
 */
async function setShadowSelectByOption(page: any, optionPattern: string): Promise<string | null> {
  try {
    return (await page.evaluate((p: string) => {
      const re = new RegExp(p, "i");
      const all: any[] = [];
      (function walk(root: any) {
        let ns: any;
        try { ns = root.querySelectorAll("*"); } catch (e) { return; }
        for (const el of ns) { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); }
      })(document);
      const cands = all.filter((e: any) => e.tagName === "SELECT" &&
        Array.from(e.options || []).some((o: any) => re.test(((o.textContent || "") as string))));
      if (!cands.length) return null;
      const sel = cands.find((e: any) =>
        Array.from(e.options || []).some((o: any) => re.test(((o.textContent || "") as string)) && /\+/.test(((o.textContent || "") as string)))) || cands[0];
      const opt = Array.from((sel as any).options).find((o: any) => re.test(((o.textContent || "") as string)));
      if (!opt) return null;
      (sel as any).value = (opt as any).value;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return (((opt as any).textContent || "") as string).trim();
    }, optionPattern)) as string | null;
  } catch {
    return null;
  }
}

/** "1999-04-15" (ISO) → "15 Apr 1999" (Altınbaş lightning-date-picker format). */
function fmtAltDate(iso?: string): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(+dt)) return "";
  return `${String(dt.getDate()).padStart(2, "0")} ${dt.toLocaleString("en-US", { month: "short" })} ${dt.getFullYear()}`;
}

/** Type a value into a lightning date-picker text input found by label. Never throws. */
async function typeDate(page: any, labelPattern: RegExp, value: string): Promise<void> {
  if (!value) return;
  try {
    const el = page.getByLabel(labelPattern).first();
    if (!(await el.count().catch(() => 0))) return;
    await el.click().catch(() => {});
    await el.fill("").catch(() => {});
    await el.pressSequentially(value, { delay: 40 }).catch(() => {});
    await el.press("Escape").catch(() => {});
  } catch {
    /* never block the flow */
  }
}

/**
 * Fill a typeahead combobox found by label and pick the best-matching option.
 * Never throws.
 *
 * Faz-3 CANLI KANITLI (2026-07-10): the LWC country typeaheads (Country of
 * Birth / Citizenship / Passport Issuing / Address Country) only render
 * their listbox on REAL keystrokes — `fill()` never opens the dropdown.
 * Canlı reçete: alanı ÖNCE TEMİZLE (ControlOrMeta+A → Backspace), sonra
 * yalnızca İLK 3 HARFİ yaz ("Afg") → açılan dropdown'da TAM ülke adını
 * taşıyan option'a TIKLA (sadece yazmak YETMEZ, option seçilmeli); option
 * node'a ulaşılamazsa ArrowDown+Enter klavye fallback'i.
 */
async function typeahead(page: any, labelPattern: RegExp, value: string): Promise<boolean> {
  if (!value) return false;
  try {
    const cb = page.getByRole("combobox", { name: labelPattern }).first();
    const target = (await cb.count().catch(() => 0)) ? cb : page.getByLabel(labelPattern).first();
    if (!(await target.count().catch(() => 0))) return false;
    await target.click().catch(() => {}); // natural focus/open — NOT force
    await target.press("ControlOrMeta+A").catch(() => {}); // clear any carried value
    await target.press("Backspace").catch(() => {});
    await target.pressSequentially(value.slice(0, 3), { delay: 80 }).catch(() => {});
    await page.waitForTimeout(1200);
    const valueRe = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const opt = page.getByRole("option", { name: valueRe }).first()
      .or(page.locator('[role="option"]').filter({ hasText: valueRe }).first());
    if (await opt.count().catch(() => 0)) {
      await opt.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(400);
      logger.info(`[altinbas] typeahead: "${value}" seçildi (${labelPattern})`);
      return true;
    }
    // Keyboard fallback: highlight first suggestion and commit.
    await target.press("ArrowDown").catch(() => {});
    await target.press("Enter").catch(() => {});
    logger.info(`[altinbas] typeahead: option node bulunamadı, ArrowDown+Enter fallback ("${value}", ${labelPattern})`);
    return true;
  } catch {
    return false;
  }
}

/** typeahead(), but skipped when the field already carries a value (e.g. Citizenship copied from Basic Info). */
async function typeaheadIfEmpty(page: any, labelPattern: RegExp, value: string): Promise<boolean> {
  if (!value) return false;
  try {
    const cb = page.getByRole("combobox", { name: labelPattern }).first();
    const target = (await cb.count().catch(() => 0)) ? cb : page.getByLabel(labelPattern).first();
    if (!(await target.count().catch(() => 0))) return false;
    const existing = ((await target.inputValue().catch(() => "")) || "").trim();
    if (existing) {
      logger.info(`[altinbas] typeaheadIfEmpty: alan zaten dolu ("${existing.slice(0, 40)}"), atlanıyor (${labelPattern})`);
      return true;
    }
    return await typeahead(page, labelPattern, value);
  } catch {
    return false;
  }
}

/** Fill a plain text field by label if it has a value to set. Never throws. */
async function fillIfPresent(page: any, labelPattern: RegExp, value?: string): Promise<void> {
  if (!value) return;
  try {
    const el = page.getByLabel(labelPattern).first();
    if (await el.count().catch(() => 0)) await el.fill(value).catch(() => {});
  } catch {
    /* never block the flow */
  }
}

/**
 * LWC number/spinbutton field (GPA) — the critical Faz-2 risk. The native
 * input reports checkValidity()=true but the LWC's internal @change model
 * ignores synthetic `fill()`/dispatchEvent alone, leaving aria-invalid=true
 * and blocking Save. Use a real keystroke sequence (pressSequentially),
 * verify aria-invalid, then fall back to a native-setter dispatch.
 */
async function fillLwcNumber(page: any, locator: any, value: string): Promise<boolean> {
  try {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click();
    await locator.press("End").catch(() => {});
    for (let i = 0; i < 12; i++) await locator.press("Backspace").catch(() => {});
    await locator.pressSequentially(value, { delay: 60 }).catch(() => {});
    await locator.blur().catch(() => {});
    await page.waitForTimeout(300);
    let invalid = await locator.getAttribute("aria-invalid").catch(() => null);
    if (invalid === "true") {
      logger.info("[altinbas] GPA: pressSequentially left aria-invalid=true, trying native-setter fallback");
      await locator.evaluate((el: HTMLInputElement, v: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true }));
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      }, value).catch(() => {});
      await page.waitForTimeout(300);
      invalid = await locator.getAttribute("aria-invalid").catch(() => null);
    }
    logger.info(`[altinbas] GPA doldurma sonucu aria-invalid=${invalid}`);
    return invalid !== "true";
  } catch (e) {
    logger.warn("[altinbas] fillLwcNumber error:", e);
    return false;
  }
}

/**
 * GPA scale is not tracked on SubmitProfile — infer 4-point vs 100-point from
 * magnitude.
 *
 * Faz-2.4 KANITLANDI (canlı, gerçek klavye ile test edildi): this LWC GPA
 * spinbutton REJECTS decimals even from real keystrokes — "3.20" was refused,
 * only the decimal-free "3" was accepted and turned the Bachelor banner green.
 * Always send an INTEGER string (Math.round, min 1).
 */
function inferGpaTypeLabel(gpa?: number): { label: string; value: string } {
  const n = typeof gpa === "number" && Number.isFinite(gpa) ? gpa : undefined;
  if (n !== undefined && n > 4) {
    return { label: "GRADING SYSTEM OUT OF 100", value: String(Math.max(1, Math.round(n))) };
  }
  return { label: "GRADING SYSTEM OUT OF 4", value: String(Math.max(1, Math.round(n ?? 3))) };
}

function monthName(m?: number): string | undefined {
  if (!m || m < 1 || m > 12) return undefined;
  return new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" });
}

/**
 * Faz-2.1 (KANITLANDI headed dry-run): this SF Experience Cloud LWC portal
 * covers every real `<input>` radio/checkbox with an invisible SLDS
 * faux-control span, so Playwright's normal actionability check silently
 * fails on `.check()/.click()`. EVERY interactive control on this portal
 * must be force-clicked, with a faux-label fallback + verification.
 */
async function forceCheckRadio(page: any, locator: any): Promise<boolean> {
  await locator.check({ force: true, timeout: 5000 }).catch(async () => {
    await locator.click({ force: true, timeout: 5000 }).catch(() => {});
  });
  await locator.dispatchEvent("change").catch(() => {});
  let checked = await locator.isChecked().catch(() => false);
  if (!checked) {
    const faux = locator.locator(
      "xpath=ancestor::*[self::td or self::div or self::label][1]//*[contains(@class,'slds-radio_faux') or contains(@class,'slds-radio__label')]",
    ).first();
    if (await faux.count().catch(() => 0)) {
      await faux.click({ force: true, timeout: 4000 }).catch(() => {});
      checked = await locator.isChecked().catch(() => false);
    }
  }
  return checked;
}

/** Term Selection: only one active term is currently offered; select the first radio card. */
async function stageTerm(page: any): Promise<boolean> {
  const term = page.getByRole("radio").first();
  if (await term.count().catch(() => 0)) {
    const ok = await forceCheckRadio(page, term);
    logger.info(`[altinbas] Term radio checked=${ok}`);
  } else {
    logger.warn("[altinbas] stageTerm: no term radio found");
  }
  logger.info("[altinbas] Term seçildi");
  await clickNext(page);
  return true;
}

/** Degree Selection: Master vs PhD radio, driven by profile.level (Bachelor is guarded out upstream). */
async function stageDegree(page: any, profile: SubmitProfile): Promise<boolean> {
  const wantPhd = /phd|doctor|doktora/i.test(profile.level || "");
  const name = wantPhd ? /^phd$/i : /^master$/i;
  const label = wantPhd ? "PhD" : "Master";
  const r = page.getByRole("radio", { name }).first();
  if (await r.count().catch(() => 0)) {
    const ok = await forceCheckRadio(page, r);
    logger.info(`[altinbas] Degree radio "${label}" checked=${ok}`);
  } else {
    logger.warn(`[altinbas] stageDegree: radio "${label}" not found`);
  }
  logger.info(`[altinbas] Degree seçildi: ${label}`);
  await clickNext(page);
  return true;
}

/**
 * SLDS combobox (button-style dropdown): force-open, then force-click the
 * matching role=option. Returns false (non-throwing) when the combobox or
 * the option isn't present — callers treat that as "filter unavailable".
 */
async function setSfCombobox(page: any, labelPattern: RegExp, optionName: RegExp): Promise<boolean> {
  const combo = page.getByRole("combobox", { name: labelPattern }).first();
  if (!(await combo.count().catch(() => 0))) return false;
  await combo.click({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);
  const opt = page.getByRole("option", { name: optionName }).first();
  if (!(await opt.count().catch(() => 0))) {
    // close the dropdown so it doesn't block later interactions
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
  await opt.click({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);
  return true;
}

/**
 * Program Selection — Faz-3 CANLI KANITLI (2026-07-10, AU260143535).
 *
 * KÖK NEDEN (kesin): program kartları iframe + KAPALI LWC shadow-DOM içinde.
 * Üç DOM tekniği de canlıda başarısız: (a) Playwright locator, (b) frame'ler
 * arası getByText, (c) page.evaluate derin shadow+iframe yürüyücüsü (kapalı
 * shadow'a el.shadowRoot null döner). CANLI KANITLANAN TEK ÇÖZÜM:
 * koordinat-tabanlı GERÇEK fare tıklaması (page.mouse.click = trusted event).
 *
 * Reçete (Faz-3.1: worker viewport GERÇEKTE 1280x720 — dry-run ekran
 * görüntüsüyle doğrulandı, viewport DEĞİŞTİRİLMEZ; Faz-3.2: takılı boş
 * "Selected Programs" modalı kartları bloke eder → stage başında ve her
 * koordinat tıklamasından önce Escape/X ile kapat; Faz-3.3: Language/Thesis
 * filtreleri listeyi "0 items"a SIFIRLIYOR → filtre YOK, sadece tek-kelime
 * arama ile daralt + kart sayısını logla): TEK-KELİME arama →
 * "+ Select" 720 foldunun ALTINDA kaldığı için scroll (wheel 0,450) →
 * modal-kapalı TEMİZ "program-preclick" ekran görüntüsü → aday
 * koordinatlarla tıkla, HER denemeden sonra sepeti doğrula → sepet butonu →
 * modal → "Save and Next" (footer Next DEĞİL).
 */
async function stageProgram(page: any, profile: SubmitProfile): Promise<boolean> {
  await dismissSfError(page);
  // Faz-3.2 dry-run kanıtı: koordinat denemelerinden biri kartın "+ Select"i
  // yerine "Selected Programs" sepet butonuna denk gelip BOŞ modal açabiliyor
  // ve açık modal sonraki denemelerde kartları BLOKE ediyor. Escape + varsa
  // dialog kapatma (X) butonu ile temizle — stage başında VE her koordinat
  // tıklamasından önce çağrılır. Best-effort, asla throw etmez.
  const closeStuckModal = async (): Promise<void> => {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    const dlg = page.getByRole("dialog").first();
    if (await dlg.count().catch(() => 0)) {
      const closeBtn = dlg
        .getByRole("button", { name: /close|cancel|kapat|×/i })
        .first()
        .or(dlg.locator('button.slds-modal__close, button[title*="close" i]').first());
      if (await closeBtn.count().catch(() => 0)) {
        await closeBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  };
  await closeStuckModal();

  // Strip the CRM degree prefix + thesis/language suffixes so matching works
  // against the portal's bare catalog labels.
  const rawQuery = profile.programName || "";
  const coreQuery = rawQuery
    .replace(/^\s*(master of|master'?s in|master in|bachelor of|bachelor'?s in|phd in|ph\.?d\.?\s*in|doctorate in|doctor of)\s+/i, "")
    .replace(/\((with|without)\s+thesis\)/gi, "")
    .replace(/\(in\s+\w+\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = coreQuery.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

  // 1) Search with the SINGLE first significant word (Faz-2.6: multi-word
  //    queries return "0 items"; a single word filters correctly).
  const searchWord = words[0] || coreQuery.split(/\s+/)[0] || "";
  const searchBox = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
  if ((await searchBox.count().catch(() => 0)) && searchWord) {
    await searchBox.click().catch(() => {});
    await searchBox.fill("").catch(() => {});
    await searchBox.pressSequentially(searchWord, { delay: 60 }).catch(() => {});
    await page.waitForTimeout(1500);
    logger.info(`[altinbas] Program arama: tek kelime "${searchWord}"`);
  } else {
    logger.warn("[altinbas] stageProgram: arama kutusu bulunamadı — tam liste üzerinde eşleştirilecek");
  }

  const readCart = async (): Promise<string> =>
    (await page
      .getByRole("button", { name: /selected programs/i })
      .first()
      .innerText()
      .catch(() => "")) as string;

  const cartHasItem = async (): Promise<boolean> => /\(\s*[1-9]/.test(await readCart());

  // 2) Faz-3.3: Language/Thesis filtreleri KALDIRILDI — dry-run3 temiz
  //    preclick screenshot kanıtı: filtre uygulanınca liste "Available
  //    Programs 0 items Page 0/0"a SIFIRLANIYOR ve tıklanacak kart kalmıyor.
  //    SADECE tek-kelime arama ile daraltılır (arama tek başına 54 karttan
  //    aza düşürüyordu). Kart sayısı best-effort loglanır ("arama sonrasi
  //    kart: N"): sayaç metni ("N items") frame gövde metinlerinden regex
  //    ile okunur; kapalı LWC shadow içinde kalırsa "?" loglanır.
  const readCardCount = async (): Promise<string> => {
    try {
      for (const frame of page.frames() as Array<{ evaluate: (fn: () => string) => Promise<string> }>) {
        const text: string = await frame
          .evaluate(() => (document.body ? document.body.innerText : ""))
          .catch(() => "");
        const m = /(\d+)\s*items?\b/i.exec(text);
        if (m) return m[1];
      }
    } catch {
      /* best-effort */
    }
    return "?";
  };
  logger.info(`[altinbas] arama sonrasi kart: ${await readCardCount()}`);

  // Faz-3 CANLI TEŞHİS (kesin): kartlar iframe + KAPALI LWC shadow-DOM'da.
  // Playwright locator, frames-arası getByText VE page.evaluate derin
  // yürüyücüsü (kapalı shadow'a el.shadowRoot null döner) — üçü de canlıda
  // başarısız. CANLI KANITLANAN TEK ÇÖZÜM: koordinat-tabanlı GERÇEK fare
  // tıklaması (page.mouse.click = trusted event, kapalı shadow'a ulaşır).
  // Tek-kelime arama listeyi az karta indirdiği için "+ Select" ilk kart
  // satırında sağ tarafta; 1280x720 worker viewport'unda (Faz-3.1 dry-run
  // ekran görüntüsüyle doğrulandı) buton sağda ~x900-950 bandında ve 720
  // foldunun ALTINDA → tıklamadan önce scroll şart. Ampirik aday
  // koordinatlar sırayla denenir ve HER denemeden sonra sepet doğrulanır
  // (POZİTİF kanıt: "Selected Programs (N)", N>=1). Yanlış noktaya tıklama
  // istenmeyen panel açabilir → her deneme arasında dismissSfError.
  const coordCandidates: Array<[number, number]> = [
    [915, 250], [915, 290], [915, 330], [740, 260], [740, 300], // ilk kart "+ Select" bölgesi (scroll sonrası)
    [915, 210], [915, 370], [915, 450],                          // kenar/2. kart olası konumları
  ];
  const tryCoordinateSelect = async (): Promise<string | null> => {
    for (const [x, y] of coordCandidates) {
      // Faz-3.2: önceki deneme sepet butonuna denk gelip boş modal açtıysa
      // kartlar bloke — HER tıklamadan önce takılı modalı kapat.
      await closeStuckModal();
      await page.mouse.click(x, y).catch(() => {});
      await page.waitForTimeout(900);
      await dismissSfError(page);
      if (await cartHasItem()) return `(${x},${y})`;
    }
    return null;
  };

  // Faz-3.1: "+ Select" fold altında — koordinat click'ten ÖNCE scroll.
  await page.mouse.wheel(0, 450).catch(() => {});
  await page.waitForTimeout(600);
  // Faz-3.2: modal kapalıyken TEMİZ pre-click ekran görüntüsü (koordinat
  // kalibrasyonu için kanıt) — İLK koordinat tıklamasından hemen önce.
  await closeStuckModal();
  await captureScreen(page, "program-preclick");
  const selectedAt = await tryCoordinateSelect();
  if (selectedAt) {
    logger.info(`[altinbas] program secildi @ ${selectedAt} (arama: "${searchWord}")`);
  } else {
    logger.warn("[altinbas] Program: koordinat click sepete kaydolmadi (aday noktalar tukendi) — stage fail");
    await captureScreen(page, "program-coord-fail");
    return false;
  }
  logger.info(`[altinbas] Sepet doğrulandı ${selectedAt}: ${JSON.stringify((await readCart()).replace(/\s+/g, " ").slice(0, 60))}`);

  // 3) CART BUTTON → modal → "Save and Next" (footer Next is NOT used).
  const cartBtn = page.getByRole("button", { name: /selected programs/i }).first();
  await cartBtn.click().catch(() => {});
  await page.waitForTimeout(1500);

  // Faz-2.1/2.2: accessible-name diverges from visible text on this button —
  // keep the text-locator fallback. Faz-2.5 canlı kanıt: NORMAL click works;
  // keep the dismiss-error + retry loop as a safety net for hydration races.
  const saveNextLocator = () =>
    page.getByRole("button", { name: /save and next/i }).first()
      .or(page.locator('button:has-text("Save and Next")').first());

  // POSITIVE evidence required: the modal (its Save and Next button) must
  // actually appear after opening the cart. "Button absent" before any
  // click is a FAILURE (cart click missed / modal never opened), not
  // success — retry the cart click once, then fail visibly. (Canlı kanıt:
  // modal ve Save-and-Next STANDART DOM'da — locator çalışır; kapalı-shadow
  // sorunu yalnızca program kartlarındaydı.)
  let modalSeen = (await saveNextLocator().count().catch(() => 0)) > 0;
  if (!modalSeen) {
    logger.warn("[altinbas] Program: sepet tıklandı ama modal görünmedi — sepet bir kez daha tıklanıyor");
    await dismissSfError(page);
    await cartBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    modalSeen = (await saveNextLocator().count().catch(() => 0)) > 0;
  }
  if (!modalSeen) {
    logger.warn("[altinbas] Program: Selected Programs modalı açılamadı (Save and Next hiç görünmedi)");
    return false;
  }

  // Success = at least one Save-and-Next click AND the button subsequently
  // disappearing (modal closed).
  let clickedOnce = false;
  let saveNextDone = false;
  for (let k = 0; k < 4; k++) {
    await dismissSfError(page);
    const saveNext = saveNextLocator();
    if (!(await saveNext.count().catch(() => 0))) {
      saveNextDone = clickedOnce;
      break;
    }
    logger.info(`[altinbas] Save and Next denemesi ${k + 1}/4 (${k % 2 === 0 ? "normal" : "force"})`);
    await saveNext.click(k % 2 === 0 ? { timeout: 8000 } : { force: true, timeout: 8000 }).catch(() => {});
    clickedOnce = true;
    await page.waitForTimeout(SF_HYDRATION_MS);
    await dismissSfError(page);
  }
  if (!saveNextDone && clickedOnce) {
    saveNextDone = !(await saveNextLocator().count().catch(() => 0));
  }
  if (!saveNextDone) {
    logger.warn("[altinbas] Program: Save and Next modalı kapatmadı — stage yeniden okunacak");
    return false;
  }
  logger.info("[altinbas] Program: Save and Next -> Personal");
  return true;
}

/**
 * Personal Information — Faz-2.4 (canlı haritalandı). Required: First/Last
 * (carried), Gender, Date of Birth, Country of Birth, Citizenship (may be
 * carried from Basic Info → typeaheadIfEmpty), Passport Issuing Country,
 * Passport Issue/Expiry, EMAIL (was missing in earlier automation runs!),
 * Mobile, Address Country/City/Street/Zip. Never throws.
 */
async function stagePersonal(page: any, profile: SubmitProfile): Promise<boolean> {
  await page
    .getByLabel(/gender/i)
    .first()
    .selectOption({ label: /f/i.test((profile.gender || "").charAt(0)) ? "Female" : "Male" })
    .catch(() => {});

  const country = mapCountry(profile.nationality);
  await typeDate(page, /date of birth/i, fmtAltDate(profile.dateOfBirth));
  await typeahead(page, /country of birth/i, country);
  await typeaheadIfEmpty(page, /^citizenship/i, country);
  await typeahead(page, /passport issuing country/i, country);
  await typeDate(page, /passport date of issue/i, fmtAltDate(profile.passportIssueDate));
  await typeDate(page, /passport date of expiry/i, fmtAltDate(profile.passportExpiryDate));

  // Telefon — Faz-3 CANLI KANIT: portal ülke chip'i + trunk-0'sız ULUSAL
  // numara ister ("+930798546789" ham hali "0798..." olarak REDDEDİLDİ;
  // doğru giriş chip(+93) + "798546789"). Chip'i shadow-select walker ile
  // ülke adına göre set et; dial code'u chip metninden (+93) ya da
  // DIAL_CODES haritasından al, ulusal numarayı ondan türet.
  if (profile.phone) {
    const countryEsc = country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const chipText = country ? await setShadowSelectByOption(page, countryEsc) : null;
    if (chipText) logger.info(`[altinbas] Personal: telefon ülke chip'i set edildi: "${chipText.slice(0, 40)}"`);
    const chipDial = /\+\s*(\d{1,4})/.exec(chipText || "")?.[1] || DIAL_CODES[country] || "";
    const national = toNationalNoTrunk(profile.phone, chipDial);
    logger.info(`[altinbas] Personal: mobile ulusal numara="${national}" (dial=${chipDial || "?"})`);
    await fillIfPresent(page, /mobile/i, national || profile.phone);
  }
  await fillIfPresent(page, /father name/i, profile.fatherName);
  await fillIfPresent(page, /mother name/i, profile.motherName);

  // Address: SubmitProfile only carries a single free-text `address` field —
  // best-effort split, never blocking on missing structured data.
  const addrParts = (profile.address || "").split(",").map((s) => s.trim()).filter(Boolean);
  await typeahead(page, /address:?\s*country/i, country);
  await fillIfPresent(page, /address:?\s*city/i, addrParts[addrParts.length - 1] || "N/A");
  await fillIfPresent(page, /address:?\s*street/i, addrParts[0] || profile.address || "N/A");
  await fillIfPresent(page, /address:?\s*zip/i, "00000");

  // Email is REQUIRED and was the silent blocker. Faz-3.5 (app 2590 dry-run
  // kanıtı): email input, Program kartları gibi KAPALI shadow içinde
  // (Personal field inventory textboxes boş) — getByLabel VE open-shadow
  // walker ulaşamadı. Email "Contact Information" alt-bölümünde, sayfanın
  // ALTINDA: diğer alanlar dolduktan SONRA oraya scroll + kalibrasyon için
  // "personal-contact" ekran görüntüsü; sonra sağlam selector zinciri;
  // hiçbiri tutmazsa koordinat click + trusted keyboard.type fallback.
  {
    const contactHdr = page.getByText(/contact information/i).first();
    for (let i = 0; i < 6; i++) {
      if (await contactHdr.isVisible().catch(() => false)) break;
      await page.mouse.wheel(0, 500).catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(400);
    await captureScreen(page, "personal-contact");
  }
  const fillEmailBySelectors = async (): Promise<boolean> => {
    if (!profile.email) return false;
    const candidates = [
      page.getByLabel(/^e-?mail/i).first(),
      page.getByPlaceholder(/mail/i).first(),
      page.locator('input[type="email"]').first(),
      // "Email" yazan label'in hemen SONRASINDAKİ input (label-anchored).
      page.locator('label:has-text("Email")').first().locator("xpath=following::input[1]"),
    ];
    for (const box of candidates) {
      if (await box.count().catch(() => 0)) {
        const ok = await box.fill(profile.email).then(() => true).catch(() => false);
        if (ok) return true;
      }
    }
    return false;
  };
  let emailFilled = await fillEmailBySelectors();
  if (!emailFilled && profile.email) {
    // Koordinat fallback: "Email" metninin kutusu bulunabiliyorsa hemen
    // ALTINA (input bölgesi), bulunamıyorsa Contact Information'da olası
    // ilk alan bölgesine trusted click + keyboard.type (kapalı shadow'a
    // page.mouse/keyboard ulaşır — Program kartlarıyla kanıtlandı).
    const lblBox = await page.getByText(/^e-?mail\b/i).first().boundingBox().catch(() => null);
    const [cx, cy]: [number, number] = lblBox
      ? [lblBox.x + Math.max(20, lblBox.width / 2), lblBox.y + lblBox.height + 25]
      : [420, 380];
    await page.mouse.click(cx, cy).catch(() => {});
    await page.waitForTimeout(300);
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.type(profile.email, { delay: 40 }).catch(() => {});
    await page.waitForTimeout(300);
    // Kapalı shadow'da değer okunamaz → selector zincirini bir kez daha dene
    // (pozitif kanıt varsa yakala); yoksa yazım best-effort kabul edilir.
    emailFilled = await fillEmailBySelectors().catch(() => false) || false;
    logger.info(`[altinbas] Personal: email koordinat fallback @ (${Math.round(cx)},${Math.round(cy)})${lblBox ? " (label-anchored)" : " (sabit nokta)"}`);
  }
  if (emailFilled) {
    logger.info("[altinbas] Personal: email dolduruldu");
  } else {
    logger.warn("[altinbas] Personal: email bulunamadi — contact screenshot alindi (personal-contact, kalibrasyon icin)");
  }

  await clickNext(page);
  logger.info("[altinbas] Personal Information dolduruldu");
  return true;
}

/**
 * Educational Information — at least one Bachelor (prior-degree) record is
 * required. Opens the "Education" add-modal, fills native <select>s +
 * pressSequentially GPA spinbutton, Saves, then advances.
 */
async function stageEducational(page: any, profile: SubmitProfile): Promise<boolean> {
  const addBtn = page
    .getByText("Education", { exact: true })
    .locator("xpath=following::button[1]")
    .first();
  if (await addBtn.count().catch(() => 0)) {
    await addBtn.click({ timeout: 8000 }).catch(() => {});
  } else {
    logger.warn("[altinbas] stageEducational: Education add-button not found");
    return false;
  }
  await page.waitForTimeout(1500);

  await fillIfPresent(page, /name of school/i, profile.schoolName || "University");
  await page.getByLabel(/^country$/i).first().selectOption({ label: mapCountry(profile.nationality) }).catch(() => {});
  await page.getByLabel(/^degree$/i).first().selectOption({ label: "Bachelor" }).catch(() => {});
  await page.waitForTimeout(1000);
  await fillIfPresent(page, /field of study/i, profile.programName || "General");

  const gradYear = profile.graduationYear || new Date().getFullYear();
  await page.getByLabel(/begin month/i).first().selectOption({ label: "September" }).catch(() => {});
  await page.getByLabel(/begin year/i).first().selectOption({ label: String(gradYear - 4) }).catch(() => {});
  await page.getByLabel(/graduation month/i).first().selectOption({ label: "June" }).catch(() => {});
  await page.getByLabel(/graduation year/i).first().selectOption({ label: String(gradYear) }).catch(() => {});

  const { label: gpaType, value: gpaVal } = inferGpaTypeLabel(profile.gpa);
  await page.getByLabel(/gpa type/i).first().selectOption({ label: gpaType }).catch(() => {});
  // Faz-3 CANLI KANIT: GPA Type select'i shadow-nested — getByLabel bazen
  // ulaşamıyor; walker ile option metnine göre set + input/change dispatch
  // (aynı değeri tekrar set etmek idempotent, ilk yol çalıştıysa zararsız).
  const gpaTypePattern = gpaType.includes("100") ? "OUT OF 100" : "OUT OF 4\\s*$";
  const gpaTypeSet = await setShadowSelectByOption(page, gpaTypePattern);
  logger.info(`[altinbas] Educational: GPA Type walker sonucu: ${JSON.stringify(gpaTypeSet)}`);
  const gpaOk = await fillLwcNumber(page, page.getByLabel(/^gpa$/i).first(), gpaVal);
  if (!gpaOk) logger.warn("[altinbas] Educational: GPA aria-invalid kaldı — Save başarısız olabilir");

  await page.getByRole("button", { name: /^save$/i }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await dismissSfError(page);
  await clickNext(page);
  logger.info("[altinbas] Educational (Bachelor) kaydı eklendi + Next");
  return true;
}

/**
 * Questionnaire — Faz-2.4 (canlı haritalandı). Single question: "Do you need
 * Visa Support?" — the Answer control is an SLDS button-combobox that opens a
 * listbox with Yes / No. International applicants → "Yes". If more questions
 * appear in the future, every Answer combobox gets the same default.
 */
async function stageQuestionnaire(page: any): Promise<boolean> {
  try {
    const answers = page.getByRole("combobox", { name: /answer/i });
    let n = await answers.count().catch(() => 0);
    if (!n) {
      // Fallback: any open-able combobox on the stage.
      n = await page.getByRole("combobox").count().catch(() => 0);
    }
    for (let i = 0; i < n; i++) {
      const ans = (await answers.count().catch(() => 0))
        ? answers.nth(i)
        : page.getByRole("combobox").nth(i);
      await ans.click().catch(() => {});
      await page.waitForTimeout(800);
      const yes = page.getByRole("option", { name: /^yes$/i }).first();
      if (await yes.count().catch(() => 0)) {
        await yes.click({ timeout: 4000 }).catch(() => {});
        logger.info(`[altinbas] Questionnaire: soru ${i + 1} → Yes`);
      } else {
        const anyOpt = page.locator('[role="option"]').first();
        if (await anyOpt.count().catch(() => 0)) {
          await anyOpt.click({ timeout: 4000 }).catch(() => {});
          logger.info(`[altinbas] Questionnaire: soru ${i + 1} → ilk seçenek (Yes bulunamadı)`);
        }
      }
      await page.waitForTimeout(500);
    }

    // Legacy fallback: any unchecked radios (older questionnaire layouts).
    const radios = page.getByRole("radio");
    const rn = await radios.count().catch(() => 0);
    for (let i = 0; i < rn; i++) {
      const isChecked = await radios.nth(i).isChecked().catch(() => true);
      if (!isChecked) await forceCheckRadio(page, radios.nth(i));
    }
  } catch {
    /* best-effort only */
  }
  logger.info("[altinbas] Questionnaire tamamlandı (Visa Support=Yes)");
  await clickNext(page);
  await page.waitForTimeout(2500);
  await dismissSfError(page);
  // Faz-3 CANLI KANIT: seçim sonrası ekranda kalan "Complete this field."
  // yazısı BAYAT — Next'i engellemez. İlk Next validate eder, İKİNCİ Next
  // ilerletir. Hâlâ Questionnaire'deysek (Answer combobox görünüyorsa) bir
  // kez daha Next bas.
  const stillHere = await page.getByRole("combobox", { name: /answer/i }).count().catch(() => 0);
  if (stillHere) {
    logger.info("[altinbas] Questionnaire: ilk Next ilerletmedi (bayat validasyon) — ikinci Next");
    await clickNext(page);
  }
  return true;
}

/**
 * Wait for the "Upload Files" progress modal that appears after
 * setInputFiles, then click its Done button. Faz-2.4 KANITLANDI (canlı elle
 * test): setInputFiles(local) → modal (progress bar → yeşil tik → "1 of 1
 * file uploaded") → Done → row flips to "( Uploaded )" with Preview + chip.
 */
async function clickUploadDone(page: any): Promise<boolean> {
  const doneBtn = page.getByRole("button", { name: /^done$/i }).first()
    .or(page.locator('button:has-text("Done")').first());
  for (let k = 0; k < 6; k++) {
    const present = await doneBtn.count().catch(() => 0);
    const enabled = present ? await doneBtn.isEnabled().catch(() => false) : false;
    if (present && enabled) {
      await doneBtn.click({ force: true }).catch(() => {});
      return true;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

/**
 * Documents — Faz-2.4 (canlı ELLE test edildi, upload akışı doğrulandı).
 * 4 required rows, each with its own input[type=file]: Passport, Bachelor
 * Diploma, Bachelor Transcript, Personal Picture. Per row: locate the row
 * container by heading text → setInputFiles → "Upload Files" modal → Done.
 * Falls back to positional nth(index) when text-matching finds no row.
 *
 * This is the LAST stage before Submit Application (footer button — there is
 * no Next here). Returns "final_dry" (dry-run: stop before Submit) or
 * "final_submitted" (real run: Submit Application clicked).
 */
async function stageDocuments(
  page: any,
  files: SubmitFiles,
  dryRun: boolean,
): Promise<"final_dry" | "final_submitted" | "final_nosubmit" | boolean> {
  // Portal row order (live): Passport, Bachelor Diploma, Bachelor Transcript, Personal Picture.
  const docMap: Array<{ label: RegExp; file: string | undefined; tag: string }> = [
    { label: /passport/i,                          file: files.passport,   tag: "Passport" },
    { label: /diploma/i,                           file: files.diploma,    tag: "Bachelor Diploma" },
    { label: /transcript/i,                        file: files.transcript, tag: "Bachelor Transcript" },
    { label: /personal picture|photo|picture/i,    file: files.photo,      tag: "Personal Picture" },
  ];

  logger.info(
    `[altinbas] stageDocuments: ${await page.locator("input[type=file]").count().catch(() => 0)} file input(s) found on Documents stage`,
  );

  for (let idx = 0; idx < docMap.length; idx++) {
    const d = docMap[idx]!;
    if (!d.file) {
      logger.info(`[altinbas] belge yok, atlanıyor: ${d.tag}`);
      continue;
    }

    // Faz-3 CANLI KANIT: DOM her upload sonrası RE-RENDER oluyor — input
    // locator'ı ve sayısı HER belge için yeniden çözülmeli (stale ref
    // kullanma). Prefer the row container matched by heading text; fall
    // back to the positional input (portal row order is stable).
    const fileInputs = page.locator("input[type=file]");
    const n = await fileInputs.count().catch(() => 0);
    let input = page
      .locator("tr, li, .slds-grid, div")
      .filter({ hasText: d.label })
      .locator('input[type="file"]')
      .first();
    if (!(await input.count().catch(() => 0))) {
      input = fileInputs.nth(Math.min(idx, Math.max(0, n - 1)));
    }
    if (!(await input.count().catch(() => 0))) {
      logger.warn(`[altinbas] stageDocuments: input bulunamadı: ${d.tag}`);
      continue;
    }

    await input.setInputFiles(d.file).catch((e: unknown) =>
      logger.warn(`[altinbas] stageDocuments: setInputFiles hata (${d.tag}):`, e),
    );

    const done = await clickUploadDone(page);
    await page.waitForTimeout(1500);
    logger.info(`[altinbas] belge yüklendi: ${d.tag} (Done=${done})`);
  }

  await page.waitForTimeout(1500);

  // Faz-2.4: the Documents footer button is "Submit Application" (not Next).
  if (dryRun) {
    await captureScreen(page, "documents-ready");
    logger.info("[altinbas] Documents hazır — dry-run: Submit Application'a BASILMADI");
    return "final_dry";
  }

  const submitBtn = page.getByRole("button", { name: /submit application/i }).first()
    .or(page.locator('button:has-text("Submit Application")').first());
  if (!(await submitBtn.count().catch(() => 0))) {
    // Fail-visible terminal state: never let this degrade to a generic
    // "advanced" — the loop would keep walking with submitted:false and no
    // explanation. "final_nosubmit" surfaces the explicit detail message.
    logger.warn("[altinbas] stageDocuments: Submit Application butonu bulunamadı");
    await captureScreen(page, "documents-no-submit-button");
    return "final_nosubmit";
  }
  await submitBtn.click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(SF_HYDRATION_MS);
  await dismissSfError(page);
  await captureScreen(page, "after-submit");
  logger.info("[altinbas] Submit Application tıklandı (GERÇEK gönderim)");
  return "final_submitted";
}

/** Dispatch the recognised stage name to its handler; unrecognised stages fall back to generic capture+Next. */
async function handleStage(
  page: any,
  stageName: string,
  profile: SubmitProfile,
  files: SubmitFiles,
  dryRun: boolean,
): Promise<"final_dry" | "final_submitted" | "final_nosubmit" | boolean> {
  const s = stageName.toLowerCase();
  if (s.includes("term")) return stageTerm(page);
  if (s.includes("degree")) return stageDegree(page, profile);
  if (s.includes("program")) return stageProgram(page, profile);
  if (s.includes("personal")) return stagePersonal(page, profile);
  if (s.includes("educational")) return stageEducational(page, profile);
  if (s.includes("questionnaire")) return stageQuestionnaire(page);
  if (s.includes("document")) return stageDocuments(page, files, dryRun);
  return false;
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

  // Faz-2.1 KANITLANDI (headed dry-run): after Basic Info → Next, the screen
  // is often a student-search GRID (columns Full Name/Email/Passport, footer
  // "Go To Applicant Detail Page") rather than the student summary directly.
  // The row radio is an SLDS faux-control — plain check()/click() silently
  // no-ops (checked stays false) and "Go To Applicant Detail Page" is then a
  // no-op too. Force-select the first row and force-click through.
  const gotoDetail = page.getByRole("button", { name: /go to applicant detail page/i }).first();
  if (await gotoDetail.count().catch(() => 0)) {
    const row = page.locator('input[type="radio"]').first();
    if (await row.count().catch(() => 0)) {
      const checked = await forceCheckRadio(page, row);
      logger.info(`[altinbas] grid row radio checked=${checked}`);
    }
    await page.waitForTimeout(800);
    await gotoDetail.click({ force: true, timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(SF_HYDRATION_MS);
    await dismissSfError(page);
    logger.info("[altinbas] clicked Go To Applicant Detail Page");
  }

  // Create New Application can be below the fold on the detail page.
  await page.mouse.wheel(0, 4000).catch(() => {});
  await page.waitForTimeout(1200);

  const createBtn = page.getByRole("button", { name: /create new application/i }).first();
  if (!(await createBtn.count().catch(() => 0))) {
    logger.warn("[altinbas] Create New Application button not found on student summary screen");
    return false;
  }
  await createBtn.scrollIntoViewIfNeeded().catch(() => {});
  await createBtn.click({ force: true, timeout: 10000 }).catch(() => {});
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
  profile: SubmitProfile,
  files: SubmitFiles,
): Promise<"advanced" | "final_reached" | "stuck" | "submitted">{
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

  // Detect final Completed/Submit screen.
  // Faz-2.4: the DOCUMENTS footer contains "Submit Application" — that must
  // NOT trigger the final detector or documents would never be uploaded;
  // stageDocuments itself owns the Submit/dry-stop decision for that stage.
  // Guard by stage NAME and by DOM signal (file inputs present) — the stage
  // bar can fail to parse (stageName null), and misfiring here would skip
  // uploads entirely.
  const hasFileInputs = ((await page.locator("input[type=file]").count().catch(() => 0)) as number) > 0;
  const isDocumentsStage = /document/i.test(stageName || "") || (!stageName && hasFileInputs);
  if (
    !isDocumentsStage &&
    (/completed/i.test(stageName || "") ||
      /review and submit|not submitted yet|please review|submit application/i.test(txt))
  ) {
    logger.info(`[altinbas] Step ${stepIdx}: FINAL stage reached (${stageName ?? "Completed"})`);
    if (dryRun) {
      logger.info("[altinbas] FINAL stage reached (dry-run: stop before submit)");
    }
    // Real submit is intentionally NOT implemented yet (Faz-5) — handled by
    // the caller regardless of dryRun so a real run never reaches Completed.
    return "final_reached";
  }

  // Faz-2: dispatch to a stage-specific handler (Term/Degree/Program/
  // Personal/Educational/Questionnaire/Documents) when the stage name is
  // recognised — it fills the real fields and clicks Next/Save itself.
  // Unrecognised stages fall back to the generic capture+Next below.
  if (stageName) {
    const handled = await handleStage(page, stageName, profile, files, dryRun).catch((e) => {
      logger.warn(`[altinbas] handleStage error for "${stageName}":`, e);
      return false as const;
    });
    if (handled === "final_dry" || handled === "final_nosubmit") return "final_reached";
    if (handled === "final_submitted") return "submitted";
    if (handled) {
      await dismissSfError(page);
      return "advanced";
    }
  }

  // Try a generic Next click to advance (self-capture navigation). Some
  // stages (Term/Degree/Program selection) require a selection before Next
  // will actually advance — getting "stuck" here (after logging the
  // inventory + screenshot) is expected for genuinely unmapped stages.
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

      const outcome = await handleUnknownStep(page, step, dryRun, screenshots, profile, files);

      if (outcome === "final_reached") {
        finalReached = true;
        break;
      }
      if (outcome === "submitted") {
        // Faz-2.4: stageDocuments clicked "Submit Application" (real run).
        finalReached = true;
        result.submitted = true;
        result.detail = "Altınbaş: Submit Application tıklandı (Documents aşamasından)";
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

    // ── Final submit ────────────────────────────────────────────────────────
    // Faz-2.4: the REAL "Submit Application" click lives inside
    // stageDocuments (the button is on the Documents footer, there is no
    // separate Completed/Submit screen action). When it fires, the loop
    // already set result.submitted + detail via the "submitted" outcome.
    // Dry-run NEVER reaches that click — stageDocuments stops with
    // "final_dry" before touching Submit Application.
    if (finalReached && !result.submitted) {
      const msg = dryRun
        ? "Altınbaş: dry-run — FINAL stage reached, stopping before Submit"
        : "Altınbaş: final stage reached but Submit Application was not clicked (button not found or non-Documents final screen)";
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
