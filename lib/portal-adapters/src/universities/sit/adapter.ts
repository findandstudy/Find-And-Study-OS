// ---------------------------------------------------------------------------
// SIT portal adapter (partners.sitconnect.net)
//
// Production-grade Playwright adapter covering the 11 agreed universities.
// Capabilities:
//   - login + ensureLoggedIn (re-auth on /auth/login redirect)
//   - createStudent (idempotent; GraphQL email/passport precheck, then create)
//   - createApplication (idempotent dedup, exact program match per university)
//
// Both STUDENT and APPLICATION creation bypass the automation-hostile SIT UI
// (the "Add Student" 6-step wizard and the "Add Application" searchable-dropdown
// modal). The panel's REAL create for each is a JSON POST to a dedicated n8n
// webhook (student = da599eaf-…, application = 4615d5ae-…); the SIT backend
// (Zoho CRM) creates the record and assigns id + app_id + stage. The adapter
// derives every id from Supabase GraphQL (read-only), runs the same dedup the
// panel does (fail-closed on an unconfirmed precheck), then POSTs. GraphQL also
// backs idempotency lookups + program matching. The adapter satisfies the shared
// UniversityAdapter interface (login/submit) and additionally exposes typed
// createStudent/createApplication methods. Registered as experimental (never
// auto-submitted).
// ---------------------------------------------------------------------------

import type { Page, Locator, ElementHandle } from "playwright-core";
import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
  LoginOpts,
} from "../../types.js";
import { launchPortal, logger } from "../../browser.js";
import { getAssetSigningSecret } from "../../assetSigningSecret.js";
import { portalCreds, type ResolvedCreds } from "../../portalCreds.js";
import { fold, matchProgram, type ProgramCandidate } from "../../programMatch.js";
import { deriveAddressParts } from "../../profile.js";
import { db, portalProgramCacheTable } from "@workspace/db";
import {
  SIT_URLS,
  SIT_LOGIN,
  SIT_NAV,
  SIT_STUDENT_FIELDS,
  SIT_TOGGLES,
  SIT_APP_FIELDS,
  SIT_BUTTONS,
  SIT_UPLOAD,
  SIT_MODAL,
  SIT_ERRORS,
} from "./selectors.js";
import {
  SIT_ALLOWLIST,
  normalizeGpa,
  mapEducationLevel,
  formatSitDate,
  matchAllowedUniversity,
  isAllowedUniversity,
  isLanguageCompatible,
  distinctiveTokens,
  toEnglishCountryName,
} from "./helpers.js";
import {
  findStudent,
  fetchProgramCatalog,
  installSpaAuthCapture,
  mintSupabaseBearer,
  seedSpaSession,
  sitCanAuthWithoutPage,
  fetchProgramIds,
  resolveAcademicYearId,
  resolveSemesterId,
  resolveSitIdentity,
  dedupApplication,
  createApplicationViaWebhook,
  createStudentViaWebhook,
  resolveCountryId,
  resolveDegreeId,
  type SitStudentWebhookPayload,
} from "./graphql.js";

export { SIT_ALLOWLIST } from "./helpers.js";

// ---------------------------------------------------------------------------
// Public asset base for absolutizing photo/document URLs.
//
// The SIT create webhook (n8n, external) fetches photo_url + documents[].url by
// URL, so those must be ABSOLUTE and reachable from the public internet. CRM
// document URLs are commonly stored relative (e.g. "/objects/uploads/…"), which
// an external fetcher cannot resolve. We prefix relative URLs with a configured
// public base (SIT_PUBLIC_ASSET_BASE → PUBLIC_APP_BASE → OBJECT_BASE_URL). If no
// public https base is configured (or it points at localhost), we still send the
// best URL we have but WARN loudly — the fix is env config, not code.
// ---------------------------------------------------------------------------
function sitPublicAssetBase(): string | null {
  for (const cand of [
    process.env.SIT_PUBLIC_ASSET_BASE,
    process.env.PUBLIC_APP_BASE,
    process.env.OBJECT_BASE_URL,
  ]) {
    const v = cand?.trim();
    if (v && /^https?:\/\//i.test(v)) return v.replace(/\/+$/, "");
  }
  // Durable production fallback: the canonical public app origin. Keeps external
  // create webhooks working even if PUBLIC_APP_BASE is ever unset in prod. In
  // non-production we return null so localhost/dev never leaks a prod URL.
  if (process.env.NODE_ENV === "production") return "https://apply.findandstudy.com";
  return null;
}

/** True when the URL's host is a loopback/unspecified address (not public). */
function isLocalHostUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h === "::1" ||
      h.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

/**
 * Absolutize a possibly-relative asset URL for the external create webhook.
 * Already-absolute http(s) URLs pass through unchanged. Relative "/path" URLs are
 * prefixed with the configured public base. Returns the input unchanged when it
 * cannot be absolutized (no base) so the caller can log the miss. Never throws.
 */
function absolutizeAssetUrl(url: string): string {
  const u = url.trim();
  if (u === "" || /^https?:\/\//i.test(u)) return u;
  const base = sitPublicAssetBase();
  if (!base) return u; // no base → leave relative; caller logs the warning
  return u.startsWith("/") ? `${base}${u}` : `${base}/${u}`;
}

// ---------------------------------------------------------------------------
// Result shapes for the extra typed methods.
// ---------------------------------------------------------------------------
export interface SitStudentResult {
  /** SIT student id when known (created or reused); null when unresolved. */
  studentId: string | null;
  created: boolean;
  alreadyExists: boolean;
  /**
   * True ONLY when the create webhook was actually fired for a NEW record in
   * THIS run (precheck said "missing", we POSTed createStudentViaWebhook), even
   * if the id was resolved afterwards via the async post-create poll. False on
   * precheck-reuse ("found"), dry-run, and every failure path.
   *
   * This is the sole signal the document/photo upload guard should use — it is
   * intentionally SEPARATE from `created` (which also drives the user-facing
   * detail message) so a future change to `created`'s wording/semantics cannot
   * silently disable the upload. Upload runs only on a fresh webhook create;
   * reused/existing students are never re-uploaded (idempotency; SIT has no
   * update webhook).
   */
  createdViaWebhook: boolean;
  detail?: string;
}

export interface SitApplicationResult extends SubmitResult {
  studentId: string | null;
}

/** Extended adapter type — UniversityAdapter plus SIT-specific operations. */
export interface SitAdapter extends UniversityAdapter {
  ensureLoggedIn(session: AdapterSession): Promise<void>;
  createStudent(
    session: AdapterSession,
    profile: SubmitProfile,
    files: SubmitFiles,
    doSubmit?: boolean,
  ): Promise<SitStudentResult>;
  createApplication(
    session: AdapterSession,
    profile: SubmitProfile,
    studentId: string | null,
    doSubmit?: boolean,
  ): Promise<SitApplicationResult>;
}

const PORTAL_KEY = "sit";
const SIT_ALLOWLIST_FOLDED: readonly string[] = SIT_ALLOWLIST.map(fold);

// Backoff for the UI-login LAST RESORT: once a UI login fails (typically
// captcha / rate-limit), skip further UI-login attempts for this window so a
// batch does not repeatedly hammer the login form. The token path is unaffected
// — only the (rare) UI fallback is gated. Process-scoped, in-memory.
const SIT_UI_LOGIN_COOLDOWN_MS = 10 * 60_000;
let sitUiLoginCooldownUntil = 0;

// Dropdown defaults selected in the "Add Application" UI flow. The new-record
// stage is assigned by the SIT backend ("Pending Review"), so it is NOT sent
// here. Academic year rolls forward via defaultAcademicYear().
const SIT_DEFAULT_SEMESTER = "Fall";

/**
 * Upcoming Turkish academic year as "YYYY-YYYY". From June onward we target the
 * autumn intake of the coming academic year; before that, the current one.
 */
function defaultAcademicYear(now: Date = new Date()): string {
  const y = now.getFullYear();
  const start = now.getMonth() >= 5 ? y : y - 1;
  return `${start}-${start + 1}`;
}

// ---------------------------------------------------------------------------
// Small typed locator utilities (no `any`).
// ---------------------------------------------------------------------------
const sleep = (page: Page, ms: number): Promise<void> => page.waitForTimeout(ms);

/** Extract a YYYY-MM-DD date from an ISO-8601 string; undefined if unparseable. */
function isoDateOnly(v: string | undefined | null): string | undefined {
  const m = String(v ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

async function firstVisible(
  page: Page,
  selectors: readonly string[],
): Promise<Locator | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) && (await loc.isVisible().catch(() => false))) {
      return loc;
    }
  }
  return null;
}

/** Click a button by accessible name. Returns true when a click was issued. */
async function clickButton(page: Page, nameRe: RegExp): Promise<boolean> {
  const btn = page.getByRole("button", { name: nameRe }).first();
  if (await btn.count()) {
    await btn.click({ timeout: 8000 }).catch(() => {});
    return true;
  }
  return false;
}

/** Read document.body.innerText (best-effort; "" on failure). */
async function bodyText(page: Page): Promise<string> {
  try {
    return (await page.evaluate(
      "(() => document.body ? document.body.innerText : '')()",
    )) as string;
  } catch {
    return "";
  }
}

/** Escape a user string for safe use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a visible form control matching `labelRe` by scanning its associated
 * <label> text, name, id, placeholder and aria-label. SIT's Personal Details
 * inputs are not reliably reachable via getByLabel/getByPlaceholder (the live
 * diagnostics showed every text/date/select field as BULUNAMADI), so this
 * attribute/label scan is the multi-strategy fallback. Best-effort; null on
 * miss. `tags` narrows to inputs/textareas (default) or "select".
 */
async function resolveControl(
  page: Page,
  labelRe: RegExp,
  tags = "input, textarea",
): Promise<ElementHandle<HTMLElement> | null> {
  try {
    const handles = (await page.$$(tags)) as ElementHandle<HTMLElement>[];
    for (const h of handles) {
      const meta = await h.evaluate((el) => {
        const forLabel = el.id
          ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
          : null;
        // Only trust an explicit association (wrapping <label> or label[for=id]);
        // a loose sibling-label lookup can bind a neighbouring field's label in
        // dense form groups and mis-fill the wrong control.
        const label = (el.closest("label")?.textContent || forLabel?.textContent || "")
          .trim()
          .replace(/\s+/g, " ");
        const input = el as HTMLInputElement;
        const hay = [
          label,
          el.getAttribute("name"),
          el.id,
          input.placeholder,
          el.getAttribute("aria-label"),
        ]
          .filter(Boolean)
          .join(" ");
        const visible = !!(el.offsetParent !== null || el.getClientRects().length);
        return { hay, visible };
      });
      if (meta.visible && labelRe.test(meta.hay)) return h;
    }
  } catch {
    /* best-effort */
  }
  return null;
}

/**
 * Fill a text/email input matching `labelRe`. Tries (in order) getByLabel,
 * getByPlaceholder, any caller-supplied CSS selectors, then the attribute/label
 * scan. Verifies the value actually landed (reads it back) before reporting
 * success, so a no-op fill is not counted as set.
 */
async function fillField(
  page: Page,
  labelRe: RegExp,
  value: string | undefined,
  css: string[] = [],
): Promise<boolean> {
  if (!value) return false;
  const candidates: Locator[] = [
    page.getByLabel(labelRe).first(),
    page.getByPlaceholder(labelRe).first(),
    ...css.map((sel) => page.locator(sel).first()),
  ];
  for (const loc of candidates) {
    if ((await loc.count()) && (await loc.isVisible().catch(() => false))) {
      await loc.fill(value).catch(() => {});
      const got = await loc.inputValue().catch(() => "");
      if (got) {
        await loc.press("Tab").catch(() => {});
        return true;
      }
    }
  }
  // Fallback: attribute/label scan over raw handles.
  const h = await resolveControl(page, labelRe);
  if (h) {
    try {
      await h.fill(value);
      const got = await h.evaluate((el) => (el as HTMLInputElement).value || "");
      await h.press("Tab").catch(() => {});
      return !!got;
    } catch {
      /* best-effort */
    }
  }
  // Final fallback: scope by the shadcn form-item wrapper. SIT controls carry NO
  // id and no label[for=]/wrapping-label association (same reason the selects use
  // formItemByLabel), so getByLabel/getByPlaceholder/resolveControl all miss —
  // e.g. the Step-3 "Mobile" is an intl phone widget whose visible input has a
  // format-example placeholder ("+90 5xx …"), not one matching /mobile|phone/.
  // Prefer a tel input (phone widgets), then the first visible text-like input,
  // then a textarea; .type() covers widgets that ignore .fill().
  const item = formItemByLabel(page, labelRe);
  if (await item.count().catch(() => 0)) {
    const scoped: Locator[] = [
      item.locator('input[type="tel"]').first(),
      item
        .locator(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"])',
        )
        .first(),
      item.locator("textarea").first(),
    ];
    for (const inp of scoped) {
      if (
        (await inp.count().catch(() => 0)) &&
        (await inp.isVisible().catch(() => false))
      ) {
        await inp.click().catch(() => {});
        await inp.fill(value).catch(() => {});
        let got = await inp.inputValue().catch(() => "");
        if (!got) {
          await inp.type(value, { delay: 20 }).catch(() => {});
          got = await inp.inputValue().catch(() => "");
        }
        if (got) {
          await inp.press("Tab").catch(() => {});
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * The SIT shadcn form-item wrapper for a field: a
 * `div[data-slot="form-item"]` containing a `label[data-slot="form-label"]`
 * whose text matches the question. Controls (select/date/input) live inside it,
 * so scoping by the form-item works even when the control carries no id and
 * label[for=] association is unavailable.
 */
function formItemByLabel(page: Page, labelRe: RegExp) {
  return page
    .locator('div[data-slot="form-item"]')
    .filter({
      has: page.locator('label[data-slot="form-label"]', { hasText: labelRe }),
    })
    .first();
}

/**
 * Select a value in a dropdown matching `labelRe`. Handles (in order) a native
 * <select> (selectOption by option text matching `optionRe`), SIT's custom
 * role=button combobox (open + click matching option), and a searchable
 * combobox input (type `query`, then click the matching option). Verifies where
 * possible. Best-effort; false on miss.
 */
async function selectField(
  page: Page,
  labelRe: RegExp,
  optionRe: RegExp,
  query?: string,
): Promise<boolean> {
  // 0. Form-item-scoped native <select>. SIT's shadcn <select>s (Gender,
  //    Nationality) carry NO id, so label[for=id]/wrapping-label association
  //    fails and resolveControl can't find them — scope by the labelled
  //    div[data-slot="form-item"] instead (same pattern the Radix toggles use).
  const scopedSel = formItemByLabel(page, labelRe).locator("select").first();
  if (await scopedSel.count().catch(() => 0)) {
    try {
      const value = await scopedSel.evaluate((el, reSrc) => {
        const s = el as unknown as HTMLSelectElement;
        const re = new RegExp(reSrc, "i");
        const opt = Array.from(s.options).find((o) => {
          if (o.disabled) return false;
          const txt = (o.textContent || "").trim();
          if (!o.value && !txt) return false; // skip empty placeholder
          return re.test(txt) || re.test(o.value);
        });
        return opt ? opt.value : null;
      }, optionRe.source);
      if (value != null) {
        await scopedSel.selectOption(value).catch(() => {});
        const ok = await scopedSel
          .evaluate(
            (el, v) => (el as unknown as HTMLSelectElement).value === v,
            value,
          )
          .catch(() => false);
        if (ok) return true;
      }
    } catch {
      /* best-effort — fall through to the other strategies */
    }
  }
  // 1. Native <select>
  const sel = await resolveControl(page, labelRe, "select");
  if (sel) {
    try {
      const value = await sel.evaluate((el, reSrc) => {
        const s = el as unknown as HTMLSelectElement;
        const re = new RegExp(reSrc, "i");
        const opt = Array.from(s.options).find((o) => {
          if (o.disabled) return false;
          const txt = (o.textContent || "").trim();
          // Skip empty/placeholder options ("", "Select...") that lack a value.
          if (!o.value && !txt) return false;
          return re.test(txt) || re.test(o.value);
        });
        return opt ? opt.value : null;
      }, optionRe.source);
      if (value != null) {
        await sel.selectOption(value).catch(() => {});
        // Assert the intended option is now selected (not merely non-empty).
        const ok = await sel.evaluate(
          (el, v) => (el as unknown as HTMLSelectElement).value === v,
          value,
        );
        if (ok) return true;
      }
    } catch {
      /* best-effort */
    }
  }
  // 2. Custom role=button combobox (existing behaviour).
  if (await selectCombo(page, labelRe, optionRe).catch(() => false)) return true;
  // 3. Searchable combobox: type the query into the input, then pick the option.
  if (query) {
    const inp = await resolveControl(page, labelRe, "input");
    if (inp) {
      try {
        await inp.click().catch(() => {});
        await inp.fill(query).catch(() => {});
        await sleep(page, 900);
        let opt = page.getByRole("option", { name: optionRe }).first();
        if (!(await opt.count())) {
          opt = page
            .locator("[role=option], li, [class*=option i]")
            .filter({ hasText: optionRe })
            .first();
        }
        if (await opt.count()) {
          await opt.click({ timeout: 3000 }).catch(() => {});
          await sleep(page, 900);
          return true;
        }
        await page.keyboard.press("Escape").catch(() => {});
      } catch {
        /* best-effort */
      }
    }
  }
  return false;
}

/**
 * Set a date field matching `labelRe` from an ISO date. A native
 * input[type=date] takes the ISO form (YYYY-MM-DD); a text-mask / datepicker
 * input takes the SIT display form (dd/mm/yyyy, with a dd.mm.yyyy retry).
 * Verifies the value landed. The FORM DUMP log reveals the real input type so
 * the format can be confirmed. Best-effort; false on miss.
 */
/**
 * Type an ISO date into a resolved <input> handle. Handles native type=date
 * (ISO) and text/masked inputs (DD/MM/YYYY then DD.MM.YYYY). Returns true only
 * when the value reads back non-empty.
 */
type DateHandle = {
  evaluate: (fn: (el: HTMLInputElement) => string) => Promise<string>;
  fill: (value: string) => Promise<void>;
  click: () => Promise<void>;
  type: (text: string, options?: { delay?: number }) => Promise<void>;
  press: (key: string) => Promise<void>;
};

async function fillDateInput(
  page: Page,
  handle: Locator | ElementHandle<HTMLElement>,
  isoForm: string,
  dmy: string,
): Promise<boolean> {
  const h = handle as unknown as DateHandle;
  try {
    const type = (
      await h.evaluate((el) => (el as HTMLInputElement).type || "")
    ).toLowerCase();
    const readBack = async (): Promise<string> =>
      h.evaluate((el) => (el as HTMLInputElement).value || "").catch(() => "");
    if (type === "date") {
      await h.fill(isoForm).catch(() => {});
      if (await readBack()) {
        await h.press("Tab").catch(() => {});
        return true;
      }
    }
    for (const v of [dmy, dmy.replace(/\//g, ".")]) {
      await h.click().catch(() => {});
      await h.fill("").catch(() => {});
      await h.type(v, { delay: 30 }).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      if (await readBack()) return true;
    }
  } catch {
    /* best-effort */
  }
  return false;
}

const MONTHS_EN = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Click the day-cell whose visible number equals `day` inside an open
 * react-day-picker calendar (for the given target month/year), skipping
 * adjacent-month "outside" days and disabled days. When a single-month view
 * shows the number once it is clicked directly; when several non-outside cells
 * carry the same number (multi-month view) the click is only made if a cell's
 * full-date metadata (aria-label / data-day) unambiguously names the target
 * month+year — otherwise it refuses to guess. Returns true only when clicked.
 */
async function clickCalendarDay(
  popover: Locator,
  day: number,
  monthIdx: number,
  year: number,
): Promise<boolean> {
  const dayStr = String(day);
  const loc = popover.locator(
    'button[name="day"], [role="gridcell"] button, .rdp-day, .rdp-day_button, td button, [role="gridcell"]',
  );
  const n = await loc.count().catch(() => 0);
  const matches: { idx: number; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const info = await loc
      .nth(i)
      .evaluate((el) => {
        const cls = el.className || "";
        const outside =
          el.getAttribute("data-outside") != null ||
          el.getAttribute("data-day-outside") != null ||
          /outside/i.test(cls);
        const disabled =
          (el as HTMLButtonElement).disabled ||
          el.getAttribute("aria-disabled") === "true" ||
          el.getAttribute("data-disabled") != null ||
          /disabled/i.test(cls);
        const label =
          (el.getAttribute("aria-label") || "") +
          " " +
          (el.getAttribute("data-day") || "");
        return { text: (el.textContent || "").trim(), outside, disabled, label };
      })
      .catch(() => null);
    if (!info || info.disabled || info.outside) continue;
    if (info.text === dayStr) matches.push({ idx: i, label: info.label });
  }
  if (matches.length === 0) return false;

  let pick = matches[0].idx;
  if (matches.length > 1) {
    // Ambiguous (multi-month view): only click a cell whose full-date metadata
    // names the target month + year; refuse to guess otherwise.
    const monthName = MONTHS_EN[monthIdx];
    const iso = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const better = matches.find(
      (m) =>
        m.label.includes(iso) ||
        (new RegExp(monthName, "i").test(m.label) && m.label.includes(String(year))),
    );
    if (better === undefined) return false;
    pick = better.idx;
  }
  await loc.nth(pick).click({ timeout: 2000 }).catch(() => {});
  return true;
}

/**
 * Read the currently displayed month/year from a react-day-picker caption.
 * Returns 0-indexed month + full year, or null when it can't be parsed.
 */
async function readCalendarCaption(
  popover: Locator,
): Promise<{ month: number; year: number } | null> {
  const cap = popover
    .locator('.rdp-caption_label, [class*="caption_label"], [class*="caption"]')
    .first();
  const raw = ((await cap.textContent().catch(() => "")) || "").toLowerCase();
  const yr = (raw.match(/(\d{4})/) || [])[1];
  const mi = MONTHS_EN.findIndex((mn) => raw.includes(mn));
  if (mi >= 0 && yr) return { month: mi, year: parseInt(yr, 10) };
  return null;
}

/**
 * Drive a shadcn Calendar / react-day-picker popover date field. Opens the
 * `button[data-slot="popover-trigger"]`, dumps the popover DOM once (DATEPOP —
 * so the real structure is diagnosable), then sets the date via, in order:
 *   a. a writable input inside the popover (fill),
 *   b. month/year <select> dropdowns (captionLayout="dropdown") + day click,
 *   c. chevron month-navigation to the target month + day click.
 * Verifies by re-reading the trigger label (changed and contains the year).
 * One retry. Best-effort; false on miss.
 */
async function fillPopoverDate(
  page: Page,
  item: Locator,
  labelSrc: string,
  isoForm: string,
  dmy: string,
): Promise<boolean> {
  const [y, mo, d] = isoForm.split("-");
  const year = y;
  const monthNum = parseInt(mo, 10);
  const day = parseInt(d, 10);

  const trigger = item
    .locator('button[data-slot="popover-trigger"], button, [role="button"], [role="combobox"]')
    .first();
  if (!(await trigger.count().catch(() => 0))) return false;

  const initialText = ((await trigger.textContent().catch(() => "")) || "").trim();
  const yearRe = new RegExp(`\\b${year}\\b`);
  const dayRe = new RegExp(`\\b0?${day}\\b`);
  const verify = async (): Promise<boolean> => {
    await sleep(page, 250);
    const t = ((await trigger.textContent().catch(() => "")) || "").trim();
    // Require the trigger label to have changed AND to now carry both the
    // target year and day, so a wrong-date click within the same year is
    // rejected (format-agnostic: works for DD/MM/YYYY, "5 Jul 2026", etc.).
    return t !== initialText && yearRe.test(t) && dayRe.test(t);
  };

  // Scope the popover to the one THIS trigger opened (Radix content is portaled
  // to <body>, so it can't be found inside the form-item): prefer aria-controls,
  // then the open-state popover, and only then a loose last() fallback.
  const resolvePopover = async (): Promise<Locator> => {
    const controls = await trigger.getAttribute("aria-controls").catch(() => null);
    if (controls) {
      const byId = page.locator(`[id="${controls}"]`);
      if (await byId.count().catch(() => 0)) return byId.first();
    }
    const open = page.locator(
      '[data-slot="popover-content"][data-state="open"], [role="dialog"][data-state="open"]',
    );
    if (await open.count().catch(() => 0)) return open.last();
    return page
      .locator(
        '[data-slot="popover-content"], [data-radix-popper-content-wrapper], [role="dialog"], .rdp',
      )
      .last();
  };

  let dumped = false;
  const attempt = async (): Promise<boolean> => {
    await trigger.click({ timeout: 4000 }).catch(() => {});
    await sleep(page, 500);
    const popover = await resolvePopover();
    await popover.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});

    // DISCOVERY (once) — dump the popover DOM so the real calendar structure
    // (writable input? month/year dropdowns? chevrons only?) is diagnosable.
    if (!dumped) {
      dumped = true;
      try {
        const html = await popover.evaluate((el) =>
          (el as HTMLElement).innerHTML.slice(0, 3000),
        );
        logger.info(`[sit] DATEPOP ${labelSrc}: ${html}`);
      } catch {
        /* best-effort */
      }
    }

    // a. Writable input inside the popover.
    const popInput = popover.locator("input").first();
    if (await popInput.count().catch(() => 0)) {
      for (const v of [dmy, isoForm, dmy.replace(/\//g, ".")]) {
        await popInput.click().catch(() => {});
        await popInput.fill("").catch(() => {});
        await popInput.type(v, { delay: 25 }).catch(() => {});
        await page.keyboard.press("Enter").catch(() => {});
        if (await verify()) return true;
      }
    }

    // b. Month/Year <select> dropdowns (captionLayout="dropdown").
    const selects = popover.locator("select");
    const selCount = await selects.count().catch(() => 0);
    if (selCount > 0) {
      for (let i = 0; i < selCount; i++) {
        const s = selects.nth(i);
        const opts = await s
          .evaluate((el) =>
            Array.from((el as HTMLSelectElement).options).map((o) => ({
              v: o.value,
              t: (o.textContent || "").trim(),
            })),
          )
          .catch(() => [] as { v: string; t: string }[]);
        if (opts.length === 0) continue;
        const hasYear = opts.some(
          (o) => /^\d{4}$/.test(o.t) || /^\d{4}$/.test(o.v),
        );
        if (hasYear) {
          const yo = opts.find((o) => o.t === year || o.v === year);
          if (yo) {
            await s.selectOption(yo.v).catch(() => {});
            await sleep(page, 200);
          }
        } else {
          // month select: value may be 0- or 1-indexed, or a month name.
          const name = MONTHS_EN[monthNum - 1];
          const mopt =
            opts.find((o) => o.v === String(monthNum - 1)) ||
            (opts.length <= 13 ? opts.find((o) => o.v === String(monthNum)) : undefined) ||
            opts.find((o) => new RegExp(`^${name}`, "i").test(o.t));
          if (mopt) {
            await s.selectOption(mopt.v).catch(() => {});
            await sleep(page, 200);
          }
        }
      }
      if (
        (await clickCalendarDay(popover, day, monthNum - 1, parseInt(year, 10))) &&
        (await verify())
      ) {
        return true;
      }
    }

    // c. Chevron navigation to the target month, then click the day.
    const target = parseInt(year, 10) * 12 + (monthNum - 1);
    for (let i = 0; i < 240; i++) {
      const cap = await readCalendarCaption(popover);
      if (!cap) break;
      const cur = cap.year * 12 + cap.month;
      if (cur === target) break;
      const btn =
        cur < target
          ? popover
              .locator(
                'button[name="next-month"], button[aria-label*="next" i], button[aria-label*="sonraki" i]',
              )
              .first()
          : popover
              .locator(
                'button[name="previous-month"], button[aria-label*="previous" i], button[aria-label*="önceki" i]',
              )
              .first();
      if (!(await btn.count().catch(() => 0))) break;
      await btn.click({ timeout: 1500 }).catch(() => {});
      await sleep(page, 120);
    }
    if (
      (await clickCalendarDay(popover, day, monthNum - 1, parseInt(year, 10))) &&
      (await verify())
    ) {
      return true;
    }

    await page.keyboard.press("Escape").catch(() => {});
    return false;
  };

  if (await attempt()) return true;
  if (await attempt()) return true; // one retry
  return false;
}

async function setDateField(
  page: Page,
  labelRe: RegExp,
  iso: string | undefined,
): Promise<boolean> {
  const m = String(iso ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const isoForm = `${m[1]}-${m[2]}-${m[3]}`;
  const dmy = `${m[3]}/${m[2]}/${m[1]}`;

  // 1. Label-associated <input> (works when the date field is a plain input).
  const h = await resolveControl(page, labelRe);
  if (h && (await fillDateInput(page, h, isoForm, dmy))) return true;

  // 2. Form-item-scoped <input>. SIT's date fields carry no id (like the
  //    Gender/Nationality selects), so label[for=] association fails; look for
  //    an input directly inside the labelled form-item. Also covers a masked
  //    input revealed only after clicking the field's trigger button.
  const item = formItemByLabel(page, labelRe);
  if (await item.count().catch(() => 0)) {
    const scopedInput = item.locator("input").first();
    if (
      (await scopedInput.count().catch(() => 0)) &&
      (await fillDateInput(page, scopedInput, isoForm, dmy))
    ) {
      return true;
    }
    // 3. Popover date-picker: the field is a
    //    button[data-slot="popover-trigger"] → shadcn Calendar (react-day-picker)
    //    (confirmed live via DATEHTML). Drive the calendar popover.
    if (await fillPopoverDate(page, item, labelRe.source, isoForm, dmy)) {
      return true;
    }

    // 4. DISCOVERY — nothing filled: dump the form-item DOM so the next live
    //    run reveals the custom date-picker structure (calendar trigger /
    //    react-day-picker grid / month-year selects) needed to drive it.
    try {
      const html = await item.evaluate((el) =>
        (el as HTMLElement).outerHTML.slice(0, 900),
      );
      logger.info(`[sit] DATEHTML ${labelRe.source}: ${html}`);
    } catch {
      /* discovery is best-effort */
    }
  }
  return false;
}

/**
 * Open a SIT custom combobox (role=button trigger) and click the option whose
 * text matches `valueRe`. Returns true when an option was clicked.
 */
async function selectCombo(
  page: Page,
  triggerRe: RegExp,
  valueRe: RegExp,
): Promise<boolean> {
  const trigger = page.getByRole("button", { name: triggerRe }).first();
  if (!(await trigger.count())) return false;
  await trigger.click({ timeout: 6000 }).catch(() => {});
  await sleep(page, 900);

  let opt = page.getByRole("option", { name: valueRe }).first();
  if (!(await opt.count())) {
    opt = page
      .locator("[role=option], li, [class*=option i]")
      .filter({ hasText: valueRe })
      .first();
  }
  if (await opt.count()) {
    await opt.click({ timeout: 3000 }).catch(() => {});
    await sleep(page, 1100);
    return true;
  }
  // Close the dropdown to avoid blocking later interactions.
  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

/**
 * If SIT's "Session Inactivity Warning" modal is showing, click "Stay Logged
 * In" so an idle wizard is not logged out mid-create. Best-effort, non-fatal.
 */
async function dismissInactivityModal(page: Page): Promise<void> {
  try {
    const stay = page.getByRole("button", { name: SIT_MODAL.stayLoggedIn }).first();
    if ((await stay.count()) && (await stay.isVisible().catch(() => false))) {
      await stay.click({ timeout: 4000 }).catch(() => {});
      await sleep(page, 800);
      logger.info("[sit] wizard: oturum uyarısı kapatıldı (Stay Logged In)");
    }
  } catch {
    /* best-effort — never fatal */
  }
}

/**
 * Set a Yes/No wizard toggle to a specific choice. The Step-1 questions are
 * Radix RadioGroups: a `div[data-slot="form-item"]` wrapping a
 * `label[data-slot="form-label"]` (the question, e.g. "Have T.C") and a
 * `div[role="radiogroup"]` of `button[role="radio"][value="yes"|"no"]` controls
 * (the visible "Yes"/"No" text lives in a SIBLING label, so the button itself
 * has no text — earlier text/geometry targeting missed it). We click the Radix
 * button by value, scoped to the labelled form-item, and verify via
 * aria-checked / data-state. Tiers: (1) button[value] in the form-item,
 * (2) stable id (#transfer-no / #tc-no / #bluecard-no), (3) the visible Yes/No
 * text label inside the form-item. Best-effort; never throws.
 */
async function setToggle(
  page: Page,
  headingRe: RegExp,
  value: "Yes" | "No",
  idPrefixes: string[] = [],
): Promise<boolean> {
  const v = value.toLowerCase(); // Radix `value` attr is lowercase: "yes"|"no".
  const valueRe =
    value === "No" ? /^\s*(no|hayır|hayir)\s*$/i : /^\s*(yes|evet)\s*$/i;
  const item = page
    .locator('div[data-slot="form-item"]')
    .filter({
      has: page.locator('label[data-slot="form-label"]', { hasText: headingRe }),
    })
    .first();

  // Confirm the choice took: the item's Radix button, or any id-matched button,
  // reports aria-checked="true" / data-state="checked".
  const isSet = async (): Promise<boolean> => {
    const cands = [
      item
        .locator(`div[role="radiogroup"] button[role="radio"][value="${v}"]`)
        .first(),
      ...idPrefixes.map((p) =>
        page.locator(`button#${p}-${v}[role="radio"]`).first(),
      ),
    ];
    for (const c of cands) {
      if (!(await c.count().catch(() => 0))) continue;
      const ac = await c.getAttribute("aria-checked").catch(() => null);
      const ds = await c.getAttribute("data-state").catch(() => null);
      if (ac === "true" || ds === "checked") return true;
    }
    return false;
  };

  const clickAndVerify = async (target: import("playwright-core").Locator) => {
    if (!(await target.count().catch(() => 0))) return false;
    await target.scrollIntoViewIfNeeded().catch(() => {});
    await target.click({ force: true, timeout: 3000 }).catch(() => {});
    return isSet();
  };

  try {
    // Tier 1: Radix button by value inside the labelled form-item's radiogroup
    // (2 attempts). Scoping to div[role="radiogroup"] keeps the click on the
    // real control and off any stray value-matching node.
    const btn = item
      .locator(`div[role="radiogroup"] button[role="radio"][value="${v}"]`)
      .first();
    if (await btn.count().catch(() => 0)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await clickAndVerify(btn)) return true;
        await page.waitForTimeout(300).catch(() => {});
      }
    }
    // Tier 2: stable ids (#transfer-no, #tc-no, #bluecard-no / #blue-card-no).
    // Constrain to the Radix button so the click matches isSet()'s semantics.
    for (const prefix of idPrefixes) {
      if (
        await clickAndVerify(
          page.locator(`button#${prefix}-${v}[role="radio"]`).first(),
        )
      )
        return true;
    }
    // Tier 3: click the visible Yes/No text label within the form-item.
    const textLbl = item
      .locator('label[data-slot="label"]')
      .filter({ hasText: valueRe })
      .first();
    if (await clickAndVerify(textLbl)) return true;

    return await isSet();
  } catch {
    /* best-effort — never fatal */
    return false;
  }
}

// ---------------------------------------------------------------------------
// Wizard diagnostics (VISIBILITY ONLY — these never change control flow).
//
// The Add Student wizard fails a step's Zoho validation silently: the generic
// "doğrulama hatası" log doesn't say WHICH step/field. These helpers surface the
// current step title, any inline error text, and a full-page screenshot so the
// stuck step is diagnosable from the worker log alone. All are best-effort and
// never throw (a diagnostic failure must not mask the real error).
// ---------------------------------------------------------------------------

/** Best-effort read of the wizard's current step title. "" when unknown. */
async function readStepHeading(page: Page): Promise<string> {
  try {
    return (await page.evaluate(
      "(() => {" +
        "  const sels = ['[aria-current=step]','.step.active','.step-active'," +
        "    '[class*=step i][class*=active i]','.wizard-step.active'," +
        "    '.MuiStepLabel-active','h1','h2','h3','legend'];" +
        "  for (const s of sels) {" +
        "    const el = document.querySelector(s);" +
        "    const t = el && el.textContent ? el.textContent.trim().replace(/\\s+/g,' ') : '';" +
        "    if (t) return t.slice(0, 60);" +
        "  }" +
        "  return '';" +
        "})()",
    )) as string;
  } catch {
    return "";
  }
}

/** Best-effort collection of visible inline validation error text(s). */
async function readInlineErrors(page: Page): Promise<string> {
  try {
    return (await page.evaluate(
      "(() => {" +
        "  const out = []; const seen = new Set();" +
        "  const sels = ['.error','[role=alert]','.invalid-feedback','.text-red-500'," +
        "    '.text-red-600','.text-danger','[class*=error i]','[aria-invalid=true]'];" +
        "  for (const s of sels) {" +
        "    for (const el of Array.from(document.querySelectorAll(s))) {" +
        "      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : {width:1,height:1};" +
        "      if (!r.width || !r.height) continue;" +
        "      let t = (el.textContent || '').trim().replace(/\\s+/g,' ');" +
        "      if (!t && el.getAttribute && el.getAttribute('aria-invalid') === 'true') {" +
        "        t = (el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('placeholder') || 'alan') + ': gecersiz';" +
        "      }" +
        "      if (t && t.length <= 160 && !seen.has(t)) { seen.add(t); out.push(t); }" +
        "      if (out.length >= 6) return out.join(' | ');" +
        "    }" +
        "  }" +
        "  return out.join(' | ');" +
        "})()",
    )) as string;
  } catch {
    return "";
  }
}

/**
 * Log a PII-free structural dump of every form control on the current wizard
 * step (tag/type/name/id/placeholder/aria-label/label + a sample of <select>
 * options). This reveals the REAL selectors + date input type + dropdown option
 * text so field mapping can be confirmed from the worker log. No field VALUES
 * are read — only control metadata. Best-effort; never throws.
 */
async function dumpWizardForm(
  page: Page,
  step: number,
  heading: string = "",
): Promise<void> {
  try {
    // File-input presence per step: reveals WHERE (if anywhere) the wizard
    // exposes a document/photo upload affordance.
    const fileInputs = await page
      .locator('input[type="file"]')
      .count()
      .catch(() => 0);
    // Traverse EVERY frame and (open) shadow root — the earlier top-document
    // querySelectorAll missed controls rendered inside shadow DOM / iframes
    // (the contact-step dump only ever saw a menu search box).
    const collected: any[] = [];
    for (const frame of page.frames()) {
      const frameName = frame === page.mainFrame() ? "" : (frame.url() || frame.name() || "sub").slice(0, 60);
      const dump = (await frame
        .evaluate(DEEP_CONTROL_DUMP_JS)
        .catch(() => [])) as any[];
      for (const d of dump) {
        if (frameName) d.frame = frameName;
        collected.push(d);
        if (collected.length >= 80) break;
      }
      if (collected.length >= 80) break;
    }
    logger.info(
      `[sit] wizard FORM DUMP adım=${step}${heading ? ` (${heading})` : ""} ` +
        `file-input=${fileInputs} frames=${page.frames().length}: ${JSON.stringify(collected)}`,
    );
  } catch {
    /* best-effort — never fatal */
  }
}

// In-page collector: walks the document INCLUDING open shadow roots and
// returns PII-free control metadata (no values). String form avoids esbuild
// __name injection issues inside evaluate.
const DEEP_CONTROL_DUMP_JS =
  "(() => {" +
  "  const out = [];" +
  "  const walk = (root, inShadow) => {" +
  "    let els = [];" +
  "    try { els = Array.from(root.querySelectorAll('input, select, textarea')); } catch {}" +
  "    for (const e of els) {" +
  "      if (out.length >= 80) return;" +
  "      const forLabel = e.id && root.querySelector ? root.querySelector('label[for=\"' + (window.CSS && CSS.escape ? CSS.escape(e.id) : e.id) + '\"]') : null;" +
  "      const label = ((e.closest && e.closest('label') ? e.closest('label').textContent : '') ||" +
  "        (forLabel ? forLabel.textContent : '') ||" +
  "        (e.parentElement && e.parentElement.querySelector('label') ? e.parentElement.querySelector('label').textContent : '') ||" +
  "        '').trim().replace(/\\s+/g, ' ').slice(0, 40);" +
  "      out.push({" +
  "        tag: e.tagName, type: e.type || '', name: e.getAttribute('name') || ''," +
  "        id: e.id || '', ph: e.placeholder || '', aria: e.getAttribute('aria-label') || ''," +
  "        label, shadow: inShadow || undefined," +
  "        vis: !!(e.offsetParent !== null || (e.getClientRects && e.getClientRects().length))," +
  "        opts: e.tagName === 'SELECT' ? Array.from(e.options).slice(0, 6).map((o) => (o.textContent || '').trim()) : undefined," +
  "      });" +
  "    }" +
  "    let all = [];" +
  "    try { all = Array.from(root.querySelectorAll('*')); } catch {}" +
  "    for (const el of all) {" +
  "      if (out.length >= 80) return;" +
  "      if (el.shadowRoot) walk(el.shadowRoot, true);" +
  "    }" +
  "  };" +
  "  walk(document, false);" +
  "  return out;" +
  "})()";

// In-page deep fill: finds a VISIBLE input matching {labelRe} by label text /
// aria-label / placeholder / name / type=tel (excluding {excludeRe} matches,
// e.g. country-code boxes), including open shadow roots. Sets the value via
// the native setter + input/change/blur, then reads the value BACK so the
// caller can verify the fill actually landed ("val=<readback>").
const DEEP_FILL_INPUT_JS =
  "(args) => {" +
  "  const labelRe = new RegExp(args.labelRe, 'i');" +
  "  const excludeRe = args.excludeRe ? new RegExp(args.excludeRe, 'i') : null;" +
  "  const cands = [];" +
  "  const textFor = (e, root) => {" +
  "    const forLabel = e.id && root.querySelector ? root.querySelector('label[for=\"' + (window.CSS && CSS.escape ? CSS.escape(e.id) : e.id) + '\"]') : null;" +
  "    const fi = e.closest ? e.closest('[data-slot=\"form-item\"], .form-item, .form-group, [class*=field]') : null;" +
  "    return [" +
  "      e.getAttribute('aria-label') || ''," +
  "      e.placeholder || ''," +
  "      e.getAttribute('name') || ''," +
  "      forLabel ? forLabel.textContent : ''," +
  "      e.closest && e.closest('label') ? e.closest('label').textContent : ''," +
  "      fi && fi.querySelector('label') ? fi.querySelector('label').textContent : ''," +
  "    ].join(' | ');" +
  "  };" +
  "  const walk = (root) => {" +
  "    let els = [];" +
  "    try { els = Array.from(root.querySelectorAll('input, textarea')); } catch {}" +
  "    for (const e of els) {" +
  "      if (e.type === 'hidden' || e.disabled || e.readOnly) continue;" +
  "      const isTel = e.type === 'tel';" +
  "      const visible = e.offsetParent !== null || !!(e.getClientRects && e.getClientRects().length);" +
  "      if (!visible && !isTel) continue;" +
  "      const t = textFor(e, root);" +
  "      if (!isTel && !labelRe.test(t)) continue;" +
  "      if (excludeRe && excludeRe.test(t)) continue;" +
  "      cands.push(e);" +
  "    }" +
  "    let all = [];" +
  "    try { all = Array.from(root.querySelectorAll('*')); } catch {}" +
  "    for (const el of all) { if (el.shadowRoot) walk(el.shadowRoot); }" +
  "  };" +
  "  walk(document);" +
  "  if (!cands.length) return 'no-el';" +
  "  const el = cands[0];" +
  "  el.focus();" +
  "  const proto = Object.getPrototypeOf(el);" +
  "  const d = Object.getOwnPropertyDescriptor(proto, 'value');" +
  "  if (d && d.set) d.set.call(el, args.val); else el.value = args.val;" +
  "  el.dispatchEvent(new Event('input', { bubbles: true }));" +
  "  el.dispatchEvent(new Event('change', { bubbles: true }));" +
  "  el.dispatchEvent(new Event('blur', { bubbles: true }));" +
  "  return 'val=' + el.value;" +
  "}";

// In-page deep select: finds a VISIBLE <select> whose label matches {labelRe}
// (incl. open shadow roots), picks the option whose text equals/contains
// {optionText} (case-insensitive), fires change, and returns the selected
// option's text as proof ("sel=<text>").
const DEEP_SELECT_JS =
  "(args) => {" +
  "  const labelRe = new RegExp(args.labelRe, 'i');" +
  "  const want = (args.optionText || '').toLowerCase();" +
  "  const found = [];" +
  "  const walk = (root) => {" +
  "    let els = [];" +
  "    try { els = Array.from(root.querySelectorAll('select')); } catch {}" +
  "    for (const e of els) {" +
  "      if (e.disabled) continue;" +
  "      const fi = e.closest ? e.closest('[data-slot=\"form-item\"], .form-item, .form-group, [class*=field]') : null;" +
  "      const t = [" +
  "        e.getAttribute('aria-label') || ''," +
  "        e.getAttribute('name') || ''," +
  "        fi && fi.querySelector('label') ? fi.querySelector('label').textContent : ''," +
  "        e.closest && e.closest('label') ? e.closest('label').textContent : ''," +
  "      ].join(' | ');" +
  "      if (labelRe.test(t)) found.push(e);" +
  "    }" +
  "    let all = [];" +
  "    try { all = Array.from(root.querySelectorAll('*')); } catch {}" +
  "    for (const el of all) { if (el.shadowRoot) walk(el.shadowRoot); }" +
  "  };" +
  "  walk(document);" +
  "  if (!found.length) return 'no-el';" +
  "  const sel = found[0];" +
  "  const opts = Array.from(sel.options);" +
  "  let hit = opts.find((o) => (o.textContent || '').trim().toLowerCase() === want);" +
  "  if (!hit) hit = opts.find((o) => (o.textContent || '').trim().toLowerCase().includes(want));" +
  "  if (!hit) return 'no-opt';" +
  "  sel.value = hit.value;" +
  "  sel.dispatchEvent(new Event('change', { bubbles: true }));" +
  "  const cur = sel.options[sel.selectedIndex];" +
  "  return 'sel=' + (cur ? (cur.textContent || '').trim() : '');" +
  "}";

/** Capture a full-page screenshot of the stuck/failed wizard to /tmp. */
async function captureWizardFail(
  page: Page,
  idToken: string,
  step: string,
): Promise<void> {
  try {
    const safe =
      (idToken || "na").replace(/[^a-z0-9]+/gi, "").slice(0, 24) || "na";
    const p = `/tmp/sit-wizard-fail-${safe}-${step}-${Date.now()}.png`;
    await page.screenshot({ path: p, fullPage: true });
    logger.warn(`[sit] wizard ekran görüntüsü alındı: ${p}`);
  } catch {
    /* best-effort — never fatal */
  }
}

// ---------------------------------------------------------------------------
// Post-create document/photo upload (restored file-chooser wizard step).
//
// The SIT student is created via an n8n "create" webhook, which does NOT ingest
// the `documents` / `photo_url` URL fields in its payload (only two webhooks
// exist: student-create + application-create; no document webhook). The ONLY
// mechanism that ever delivered files to the SIT student card is the browser
// file-chooser upload that lived in the removed 6-step "Add Student" wizard.
//
// Since create no longer drives a wizard, we re-run that upload AFTER the
// student id is resolved: navigate to the student's detail page and push the
// locally-downloaded SubmitFiles (passport / transcript / diploma + photo)
// through the same file-chooser affordance. This is best-effort and NEVER
// fatal — the student + application are already created; a failed upload is
// logged LOUDLY so it is never silently lost, but must not abort the flow.
// ---------------------------------------------------------------------------

/** Upload a file via the OS file chooser triggered by clicking `triggerRe`. */
async function uploadViaChooser(
  page: Page,
  triggerRe: RegExp,
  filePath: string,
): Promise<boolean> {
  const trigger = page.getByRole("button", { name: triggerRe }).first();
  if (!(await trigger.count())) {
    // Fallback: a hidden <input type=file>, set directly.
    const input = page.locator(SIT_UPLOAD.fileInput).first();
    if (await input.count()) {
      await input.setInputFiles(filePath).catch(() => {});
      return true;
    }
    return false;
  }
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 8000 }),
      trigger.click({ timeout: 6000 }),
    ]);
    await chooser.setFiles(filePath);
    await sleep(page, 1500);
    return true;
  } catch {
    const input = page.locator(SIT_UPLOAD.fileInput).first();
    if (await input.count()) {
      await input.setInputFiles(filePath).catch(() => {});
      return true;
    }
    return false;
  }
}

/**
 * Upload one document to its own slot: try the type-specific trigger first, then
 * fall back to the generic attachment trigger (uploadViaChooser also falls back
 * to the hidden <input type=file>). Returns true when the file was pushed.
 */
function cleanPhone(raw: string): string {
  if (!raw) return "";
  let s = String(raw).trim().replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) return s;
  // Ülke kodundan sonra yanlışlıkla kalan ulusal trunk hanesini düzelt.
  // Yalnızca ulusal kısım tam olarak 1 hane fazlaysa VE bilinen trunk
  // hanesiyle başlıyorsa devreye girer — geçerli bir numaraya asla dokunmaz.
  const trunkFix: Array<[string, number, string]> = [
    ["+998", 9, "8"], // Uzbekistan
    ["+7", 10, "8"],  // Russia / Kazakhstan
    ["+994", 9, "0"], // Azerbaijan
    ["+996", 9, "0"], // Kyrgyzstan
    ["+992", 9, "8"], // Tajikistan
    ["+993", 8, "8"], // Turkmenistan
    ["+380", 9, "0"], // Ukraine
    ["+375", 9, "8"], // Belarus
  ];
  for (const [cc, natLen, trunk] of trunkFix) {
    if (s.startsWith(cc)) {
      const nat = s.slice(cc.length);
      if (nat.length === natLen + 1 && nat.startsWith(trunk)) {
        s = cc + nat.slice(1);
      }
      break;
    }
  }
  return s;
}

async function uploadDocRow(
  page: any,
  key: string,
  keyword: string,
  docPath: string,
): Promise<boolean> {
  try {
    // Text-based discovery: getByRole with name= uses accessible name which may
    // differ from visible text in SIT's SPA. has-text filter on the raw button
    // text is more robust when aria labels are missing.
    let addBtn = page.locator("button").filter({ hasText: /add new document/i }).first();
    if (!(await addBtn.count())) addBtn = page.locator("button").filter({ hasText: /add.*document/i }).first();
    if (!(await addBtn.count())) addBtn = page.getByRole("button", { name: /add (new )?doc/i }).first();
    if (!(await addBtn.count())) {
      // Last resort: any button visible on screen whose text includes "Add"
      const allBtns = await page.locator("button").allTextContents();
      logger.warn(`[sit] uploadDocRow ${key}: 'Add New Document' butonu yok — görünür butonlar: ${JSON.stringify(allBtns.map((t: string) => t.trim()).filter(Boolean).slice(0, 15))}`);
      return false;
    }
    await addBtn.scrollIntoViewIfNeeded().catch(() => {});
    await addBtn.click().catch(() => {});
    await page.waitForTimeout(800);

    // The new row exposes a cmdk combobox labelled "Select document type".
    let combo = page
      .locator('button[role="combobox"]')
      .filter({ hasText: /document type/i })
      .last();
    if (!(await combo.count())) {
      combo = page.locator('button[role="combobox"]').last();
    }
    await combo.scrollIntoViewIfNeeded().catch(() => {});
    await combo.click().catch(() => {});
    await page.waitForTimeout(500);
    // cmdk palette: type keyword to filter
    await page.keyboard.type(keyword).catch(() => {});
    await page.waitForTimeout(450);

    const opts: string[] = await page
      .evaluate(() => {
        const els = Array.from(
          document.querySelectorAll(
            '[role="option"], [cmdk-item], [data-slot="command-item"]',
          ),
        );
        return els
          .map((e) => (e.textContent || "").trim())
          .filter(Boolean);
      })
      .catch(() => [] as string[]);
    logger.info(`[sit] DOCOPTS ${key} kw=${keyword} => ${JSON.stringify(opts)}`);

    let picked = false;
    try {
      await page
        .getByRole("option", { name: new RegExp(keyword, "i") })
        .first()
        .click({ timeout: 1500 });
      picked = true;
    } catch {}
    if (!picked) {
      try {
        await page
          .getByText(new RegExp(keyword, "i"))
          .first()
          .click({ timeout: 1500 });
        picked = true;
      } catch {}
    }
    if (!picked) {
      await page.keyboard.press("Enter").catch(() => {});
    }
    await page.waitForTimeout(800);

    // After selecting a type the row reveals a file input.
    const fileInputs = page.locator('input[type="file"]');
    const fc: number = await fileInputs.count();
    if (fc > 0) {
      await fileInputs
        .last()
        .setInputFiles(docPath)
        .catch(() => {});
      await page.waitForTimeout(900);
      logger.info(`[sit] DOCUP ${key} picked=${picked} via=setInputFiles fc=${fc}`);
      return true;
    }

    // Fallback: a browse/choose button that opens a native file chooser.
    try {
      const browseBtn = page
        .getByRole("button", { name: /choose|browse|upload|select file|dosya/i })
        .last();
      if (await browseBtn.count()) {
        const [chooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 2500 }),
          browseBtn.click().catch(() => {}),
        ]);
        await chooser.setFiles(docPath);
        await page.waitForTimeout(900);
        logger.info(`[sit] DOCUP ${key} picked=${picked} via=filechooser`);
        return true;
      }
    } catch {}

    logger.warn(`[sit] uploadDocRow ${key}: tip seçildi ama file input/chooser bulunamadı (picked=${picked})`);
    return false;
  } catch (e) {
    logger.warn(`[sit] uploadDocRow ${key} hata: ${(e as any)?.message}`);
    return false;
  }
}

async function uploadDocByType(
  page: Page,
  typeTriggerRe: RegExp,
  filePath: string,
): Promise<boolean> {
  if (await uploadViaChooser(page, typeTriggerRe, filePath)) return true;
  return uploadViaChooser(page, SIT_UPLOAD.attachmentTrigger, filePath);
}

// ---------------------------------------------------------------------------
// Diagnostic helper — closest-N scored candidates by simple token overlap.
//
// Used only to log WHY a match failed (name difference vs. threshold), never
// to decide a match. Independent of programMatch's internal scorer (which is
// not exported) so this stays a pure diagnostic with no behavioral coupling.
// ---------------------------------------------------------------------------
function simpleTokens(s: string): Set<string> {
  return new Set(fold(s).split(" ").filter(Boolean));
}

function simpleOverlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function closestCandidates(
  queryName: string,
  pool: ProgramCandidate[],
  topN: number = 5,
): { name: string; score: number }[] {
  const qt = simpleTokens(queryName);
  return pool
    .map((c) => ({ name: c.name, score: simpleOverlapScore(qt, simpleTokens(c.name)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

function logProgramPoolDiagnostic(
  contextLabel: string,
  queryName: string,
  pool: ProgramCandidate[],
): void {
  logger.warn(
    `[sit] program havuzu (${pool.length}) [${contextLabel}]: ` +
      pool.map((p) => p.name).join(" | "),
  );
  const closest = closestCandidates(queryName, pool, 5);
  logger.warn(
    `[sit] en yakın [${contextLabel}]: ` +
      closest.map((c) => `"${c.name}" score=${c.score.toFixed(2)}`).join(", "),
  );
}

// ---------------------------------------------------------------------------
// Diagnostic helper — persist the fetched (live) program pool to
// portal_program_cache for offline inspection (psql). Best-effort: never
// throws, never blocks the submission flow on a cache-write failure.
// ---------------------------------------------------------------------------
async function persistFetchedProgramPool(
  universityKey: string,
  level: string,
  catalog: ProgramCandidate[],
): Promise<void> {
  try {
    const options = catalog.map((c) => ({ v: c.id, t: c.name }));
    await db
      .insert(portalProgramCacheTable)
      .values({ universityKey, level, options })
      .onConflictDoUpdate({
        target: [
          portalProgramCacheTable.universityKey,
          portalProgramCacheTable.level,
        ],
        set: { options, fetchedAt: new Date() },
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[sit] program havuzu cache'e yazılamadı: ${msg}`);
  }
}

function resolveCreds(opts?: LoginOpts): ResolvedCreds {
  return opts?.credentials ?? portalCreds(PORTAL_KEY);
}

async function performLogin(page: Page, creds: ResolvedCreds): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 900 }).catch(() => {});
  await page.goto(SIT_URLS.base + SIT_URLS.loginPath, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await sleep(page, 3500);

  const emailInput = await firstVisible(page, SIT_LOGIN.emailCandidates);
  if (emailInput) await emailInput.fill(creds.user).catch(() => {});
  const passInput = await firstVisible(page, SIT_LOGIN.passwordCandidates);
  if (passInput) await passInput.fill(creds.password).catch(() => {});

  await clickButton(page, SIT_LOGIN.submitName);
  await sleep(page, 6000);

  const stillOnLogin =
    SIT_LOGIN.loginUrlMarker.test(page.url()) ||
    (await page
      .locator(SIT_LOGIN.passwordCandidates[0])
      .first()
      .isVisible()
      .catch(() => false));
  if (stillOnLogin) {
    throw new Error(
      "[sit] login failed — still on /auth/login (wrong credentials or captcha)",
    );
  }
  logger.info("[sit] login successful -> " + page.url());
}

/**
 * Resolve the id of a JUST-CREATED SIT student. The create webhook persists the
 * student ASYNCHRONOUSLY in Zoho and frequently responds before the record is
 * queryable (or without the id at all), so a single post-create lookup returns
 * nothing. Poll GraphQL with an increasing backoff (email-keyed search first,
 * then passport-keyed) until the record is indexed. Returns the id on the first
 * match, or null after all attempts (logged with attempt count + elapsed).
 * This reuses `findStudent` — the same read-only lookup used for pre-create
 * dedup — so it can never create a duplicate.
 */
async function resolveCreatedStudentId(
  page: Page,
  by: { email?: string; passportNumber?: string },
): Promise<string | null> {
  // ~1+2+3+4+5+5+5 = ~25s across 7 attempts — tolerant of Zoho/SIT indexing
  // lag (previously 18s which was too short on slow Zoho writes).
  const backoffMs = [1000, 2000, 3000, 4000, 5000, 5000, 5000];
  const started = Date.now();
  for (let i = 0; i < backoffMs.length; i++) {
    await sleep(page, backoffMs[i]);
    const elapsedS = () => Math.round((Date.now() - started) / 1000);
    if (by.email) {
      const r = await findStudent(page, { email: by.email });
      logger.info(
        `[sit] resolve poll attempt=${i + 1} field=email status=${r.status} ~${elapsedS()}s`,
      );
      if (r.status === "found") {
        logger.info(
          `[sit] id poll: email ile bulundu (deneme=${i + 1}, ~${elapsedS()}s, id=${r.ref.id})`,
        );
        return r.ref.id;
      }
    }
    if (by.passportNumber) {
      const r = await findStudent(page, { passportNumber: by.passportNumber });
      logger.info(
        `[sit] resolve poll attempt=${i + 1} field=passport status=${r.status} ~${elapsedS()}s`,
      );
      if (r.status === "found") {
        logger.info(
          `[sit] id poll: passport ile bulundu (deneme=${i + 1}, ~${elapsedS()}s, id=${r.ref.id})`,
        );
        return r.ref.id;
      }
    }
  }
  logger.warn(
    `[sit] id çözümlenemedi (${backoffMs.length} deneme, ~${Math.round(
      (Date.now() - started) / 1000,
    )}s) — email=${by.email ? "var" : "yok"} passport=${
      by.passportNumber ? "var" : "yok"
    }`,
  );
  return null;
}

// ---------------------------------------------------------------------------
// The adapter.
// ---------------------------------------------------------------------------
export const sitAdapter: SitAdapter = {
  key: PORTAL_KEY,
  label: "SIT Portal",
  allowlist: [...SIT_ALLOWLIST],

  matches(name: string): boolean {
    // IDOR-safe: token-subset allowlist match (see helpers.matchAllowedUniversity).
    // The folded-substring path is retained only as a permissive pre-check that
    // still defers to the strict matcher for the actual decision.
    if (isAllowedUniversity(name)) return true;
    const f = fold(name);
    return SIT_ALLOWLIST_FOLDED.some(
      (entry) => f === entry,
    );
  },

  async login(opts?: LoginOpts): Promise<AdapterSession> {
    const creds = resolveCreds(opts);
    const session = await launchPortal({ headless: opts?.headless ?? true });
    installSpaAuthCapture(session.page);

    // PRIMARY: obtain a Supabase token WITHOUT submitting the login form (which
    // is what tripped SIT's captcha / rate-limit). The token is minted at most
    // once per process and REUSED across every submission (single-session).
    //
    // We ALWAYS load the SPA ROOT (a plain GET, never a login attempt) so the
    // Laravel XSRF-TOKEN cookie is set on this fresh page — GraphQL reads need
    // XSRF + Bearer + apikey, and each submission gets a brand-new page. Loading
    // the root (not /auth/login) also lets the SPA fire its boot *.supabase.co
    // session check, which carries the public anon apikey we capture passively.
    // If capture still misses, getSitAccessToken has a deterministic JS-bundle
    // fallback, so login is never required to obtain the anon key.
    await session.page
      .goto(SIT_URLS.base + "/", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      })
      .catch(() => {});
    if (!sitCanAuthWithoutPage(creds)) {
      await sleep(session.page, 2500);
    }
    if (await mintSupabaseBearer(session.page, creds).catch(() => false)) {
      logger.info("[sit] auth: token hazır (UI login yok)");
      return session;
    }

    // LAST RESORT: no token could be obtained (e.g. anon apikey unobtainable).
    // Attempt the UI login ONCE — fail-fast on captcha, honoring a short cooldown
    // so a captcha'd batch does not hammer the login form (no tight-loop retry).
    if (Date.now() < sitUiLoginCooldownUntil) {
      await session.close().catch(() => {});
      throw new Error(
        "[sit] token alınamadı ve UI login cooldown aktif (captcha/rate-limit) — atlanıyor",
      );
    }
    logger.warn("[sit] token alınamadı — son çare UI login deneniyor");
    try {
      await performLogin(session.page, creds);
    } catch (err) {
      sitUiLoginCooldownUntil = Date.now() + SIT_UI_LOGIN_COOLDOWN_MS;
      await session.close().catch(() => {});
      throw err;
    }
    await mintSupabaseBearer(session.page, creds).catch(() => false);
    return session;
  },

  /**
   * Ensure a usable Supabase Bearer before an operation. Token-first: reuses or
   * refreshes the process-cached session (no UI login, no captcha). Uses
   * portalCreds(PORTAL_KEY), which returns the runner-injected override during a
   * submission. Falls back to the UI login only as a last resort.
   */
  async ensureLoggedIn(session: AdapterSession): Promise<void> {
    const page = session.page;
    installSpaAuthCapture(page); // idempotent — safe if login() already armed it
    const creds = portalCreds(PORTAL_KEY);

    // Token-first — reuse/refresh the cached session. Cache hit = no network.
    if (await mintSupabaseBearer(page, creds).catch(() => false)) {
      // Seed the minted Supabase session into the page's localStorage so the UI
      // wizard (student-detail / document upload) boots authenticated instead of
      // bouncing to the captcha'd /auth/login. This is the PRIMARY path to a
      // usable SPA session — no form login, no captcha. Non-fatal.
      await seedSpaSession(page, creds).catch(() => false);
      return;
    }

    // LAST RESORT — could not obtain a token; fall back to the UI login ONCE
    // (honoring the captcha cooldown), then re-mint.
    if (Date.now() < sitUiLoginCooldownUntil) {
      logger.warn(
        "[sit] ensureLoggedIn: token yok ve UI login cooldown aktif — atlanıyor",
      );
      return;
    }
    logger.warn("[sit] ensureLoggedIn: token alınamadı — son çare UI login");
    if (!SIT_LOGIN.loginUrlMarker.test(page.url())) {
      await page
        .goto(SIT_URLS.base + SIT_URLS.studentsPath, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        })
        .catch(() => {});
      await sleep(page, 2000);
    }
    if (SIT_LOGIN.loginUrlMarker.test(page.url())) {
      try {
        await performLogin(page, creds);
      } catch (err) {
        sitUiLoginCooldownUntil = Date.now() + SIT_UI_LOGIN_COOLDOWN_MS;
        throw err;
      }
    }
    await mintSupabaseBearer(page, creds).catch(() => false);
    // Seed the SPA session even on the last-resort UI-login path, so the wizard
    // boots authenticated on subsequent navigations.
    await seedSpaSession(page, creds).catch(() => false);
  },

  /**
   * Create a student via the 6-step wizard. Idempotent: if GraphQL finds an
   * existing student by email/passport, returns it without creating a duplicate.
   */
  async createStudent(
    session: AdapterSession,
    profile: SubmitProfile,
    files: SubmitFiles,
    doSubmit: boolean = true,
  ): Promise<SitStudentResult> {
    const page = session.page;
    await this.ensureLoggedIn(session);

    // --- Idempotency: read-only GraphQL lookup (tri-state, fail-closed) ---
    const existing = await findStudent(page, {
      email: profile.email,
      passportNumber: profile.passportNumber,
    });
    if (existing.status === "unknown") {
      // Fail closed: we could not confirm whether the student already exists, so
      // we must NOT POST the webhook (that would risk creating a duplicate).
      logger.warn(
        "[sit] öğrenci mükerrer kontrolü doğrulanamadı — mükerrer riski nedeniyle webhook atlanıyor",
      );
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
        createdViaWebhook: false,
        detail: "öğrenci oluşturulamadı: mükerrer kontrolü doğrulanamadı",
      };
    }
    if (existing.status === "found") {
      // Recovery for an already-existing Zoho student: we deliberately do NOT
      // resend createStudentViaWebhook here. It is a plain "create" webhook
      // with no documented upsert/idempotency contract on the Zoho side, so
      // resubmitting for an existing student risks creating a DUPLICATE
      // record rather than attaching the missing photo/documents to the
      // existing one. SIT exposes no "update student" / "attach document"
      // webhook we could call instead (checked graphql.ts — only
      // createStudentViaWebhook and createApplicationViaWebhook exist).
      // What we CAN and DO still do for a recovered student: proceed to
      // createApplication below via submit() when no application has been
      // submitted yet (idempotent, dedup-guarded) — that path already runs
      // unconditionally on `alreadyExists`. Photo/document backfill onto an
      // existing Zoho student is a known gap until SIT provides such a
      // webhook; logged clearly so it is never silently lost.
      const hasAssetsToBackfill =
        !!profile.photoUrl?.trim() || (profile.studentDocuments?.length ?? 0) > 0;
      logger.info(
        `[sit] mevcut öğrenci bulundu (id=${existing.ref.id}) — yeniden kullanılıyor` +
          (hasAssetsToBackfill
            ? " (NOT: foto/belge güncellemesi için SIT'te update webhook yok — sadece başvuru adımı denenecek)"
            : ""),
      );
      return {
        studentId: existing.ref.id,
        created: false,
        alreadyExists: true,
        createdViaWebhook: false,
      };
    }

    // --- Zero-doc guard (real submit only; mirrors the webhook-flow intent) ---
    // SIT's student-detail Documents tab is READ-ONLY, so every file MUST be
    // attached during create via the wizard's file-choosers (the whole reason
    // for this rewrite). Refuse to create a student that would carry no docs.
    const anyLocalFile = !!(
      files.photo || files.passport || files.transcript || files.diploma
    );
    const anyAssetIntent =
      !!profile.photoUrl?.trim() || (profile.studentDocuments?.length ?? 0) > 0;
    if (doSubmit && !anyLocalFile) {
      if (anyAssetIntent) {
        // The profile SHOULD carry documents but none were downloaded locally
        // (transient upstream download failure). Do NOT create a doc-less
        // student — throw so the submission is retried.
        throw new Error(
          "SIT: öğrenci belge/fotoğraf yerel dosyaları yok (indirilemedi) — " +
            "sıfır belgeli create engellendi, tekrar denenecek",
        );
      }
      // Genuinely no documents at all → preserve the zero-doc guard intent.
      logger.info(
        "[sit] öğrenci ATLANDI: yüklenecek yerel foto/belge yok — sıfır belgeli SIT create engellendi",
      );
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
        createdViaWebhook: false,
        detail: "öğrenci oluşturulamadı: fotoğraf/belge yok (sıfır-belge koruması)",
      };
    }

    // --- REAL: create the student via the "Add Student" wizard ---
    // SIT never ingested URL-based photo/documents through the create webhook, and
    // the detail Documents tab is read-only post-create — so the ONLY way files
    // reach the card is the wizard's browser file-choosers at create time. We walk
    // the multi-step wizard, fill every field on screen, upload each local file
    // into its own slot, then save. Session-seed auth is already live/verified.
    await page.goto(SIT_URLS.base + SIT_URLS.studentsPath, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await sleep(page, 3500);
    await dismissInactivityModal(page);
    if (!(await clickButton(page, SIT_NAV.addStudentName))) {
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
        createdViaWebhook: false,
        detail: "öğrenci oluşturulamadı: Add Student düğmesi bulunamadı",
      };
    }
    await sleep(page, 2000);

    const gpa = normalizeGpa(profile.gpa);
    const dob = formatSitDate(profile.dateOfBirth);
    const passportIssue = formatSitDate(profile.passportIssueDate);
    const passportExpiry = formatSitDate(profile.passportExpiryDate);
    const isFemale = /^f|kad|woman|kız|kiz/i.test(profile.gender || "");
    // Anchored so the male matcher does NOT substring-match "Female" (…male…).
    const genderLabel = isFemale
      ? /^\s*(female|kad[ıi]n?)\s*$/i
      : /^\s*(male|erkek)\s*$/i;

    // Track which files actually landed so the completeness gate below can refuse
    // to save a partial record. Each file is attached once, even across re-fills.
    const uploadedDocs = new Set<string>();
    let photoUploaded = false;

    // --- Diagnostics (visibility only; no behavioral coupling) -------------
    // Non-PII run nonce so a fail screenshot is traceable to this run without
    // leaking email/passport into filenames or logs. createStudent has no
    // submissionId in scope; a random+timestamp token is enough for triage.
    const idToken = `${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    // Critical fields (those with a value) that never got successfully entered on
    // ANY step — the most likely validation culprits; logged on failure.
    const everSet = new Set<string>();
    const critical: Record<string, boolean> = {
      // Step-1 Basic Info gate: all three Yes/No toggles are required.
      transferStudent: true,
      haveTc: true,
      blueCard: true,
      email: !!profile.email,
      gender: !!(profile.gender || "").trim(),
      dob: !!dob,
      nationality: !!profile.nationality,
      passportNo: !!profile.passportNumber,
      issueDate: !!passportIssue,
      expiryDate: !!passportExpiry,
      // Tracked so a never-filled phone yields the honest
      // "zorunlu alan doldurulamadı (telefon)" failure detail.
      phone: !!cleanPhone(
        (profile as any).phoneE164 ||
          (profile as any).phone_e164 ||
          profile.phone ||
          (profile as any).mobile ||
          (profile as any).whatsapp ||
          "",
      ),
    };
    let reachedDocuments = false;
    // Consecutive same-step validation failures → cap in-step retries (item 5:
    // 1-2 retries, then a clear FAIL + screenshot instead of 7× generic noise).
    let validationRetries = 0;

    // --- Walk up to 6 wizard steps, filling whatever is on screen ---
    for (let step = 0; step < 9; step++) {
      await sleep(page, 1500);
      await dismissInactivityModal(page);

      const heading = await readStepHeading(page);
      logger.info(
        `[sit] wizard adım=${step + 1}${heading ? ` (${heading})` : ""} — dolduruluyor`,
      );
      const stepLog: string[] = [];
      const mark = (name: string, ok: boolean): void => {
        if (ok) everSet.add(name);
        if (!critical[name]) return;
        // Fields are attempted on every iteration, so a field simply not present
        // on THIS step is not a failure — only report BULUNAMADI when it has
        // never been set on any step so far (avoids misleading repeat noise).
        if (ok) stepLog.push(`${name}=ok`);
        else if (!everSet.has(name)) stepLog.push(`${name}=BULUNAMADI`);
      };

      // FORM DUMP (diagnostics): on EVERY step, log the real control structure +
      // file-input presence so exact selectors / date input type / dropdown
      // options / where uploads live are all visible in the worker log.
      await dumpWizardForm(page, step + 1, heading);

      // Personal
      await fillField(page, SIT_STUDENT_FIELDS.firstName, profile.firstName);
      await fillField(page, SIT_STUDENT_FIELDS.lastName, profile.lastName);
      if (dob) {
        mark(
          "dob",
          await setDateField(page, SIT_STUDENT_FIELDS.dateOfBirth, profile.dateOfBirth),
        );
      }
      mark(
        "gender",
        await selectField(
          page,
          SIT_STUDENT_FIELDS.gender,
          genderLabel,
          isFemale ? "female" : "male",
        ),
      );

      // Contact
      mark(
        "email",
        await fillField(page, SIT_STUDENT_FIELDS.email, profile.email, [
          "input[type=email]",
          "input[name*=email i]",
          "input[id*=email i]",
        ]),
      );
      // Phone/mobile — fill ONCE. The phone label regex also matches a Family
      // step "Father's / Mother's Mobile", so re-running it on later steps would
      // leak the STUDENT's phone into a parent's mobile field. Fill only until it
      // first lands, then leave the parent-mobile fields (no CRM data) untouched.
      if (profile.phone && !everSet.has("phone")) {
        if (
          await fillField(page, SIT_STUDENT_FIELDS.phone, profile.phone, [
            'input[type="tel"]',
            'input[placeholder*="mobile" i]',
            'input[placeholder*="phone" i]',
          ])
        ) {
          everSet.add("phone");
        }
      }
      // STEP6 handler: Educational Background (High School Country/Name/GPA) for Bachelor applicants.
      try {
        const hasHS = await page.evaluate(
          () => !!Array.from(document.querySelectorAll("label")).find((l) => /high school/i.test(l.textContent || "")),
        );
        if (hasHS) {
          const selIdx = await page.evaluate(() => {
            const arr = Array.from(document.querySelectorAll("select"));
            for (let k = 0; k < arr.length; k++) {
              const fi = (arr[k] as HTMLElement).closest('[data-slot="form-item"]');
              const lab = fi ? (fi.querySelector("label")?.textContent || "").toLowerCase() : "";
              if (lab.includes("school") && lab.includes("country")) return k;
            }
            return -1;
          });
          const hsCountry =
            toEnglishCountryName(
              (profile as any).highSchoolCountry || (profile as any).schoolCountry || profile.nationality,
            ) ||
            profile.nationality ||
            "";
          let cOk = false;
          if (selIdx >= 0 && hsCountry) {
            const cs = page.locator("select").nth(selIdx);
            try {
              await cs.selectOption({ label: hsCountry });
              cOk = true;
            } catch {}
            if (!cOk) {
              const opts = (await cs.locator("option").allTextContents()).map((o) => o.trim());
              const hit =
                opts.find((o) => o.toLowerCase() === hsCountry.toLowerCase()) ||
                opts.find((o) => o.toLowerCase().includes(hsCountry.toLowerCase()));
              if (hit) {
                try {
                  await cs.selectOption({ label: hit });
                  cOk = true;
                } catch {}
              }
            }
          }
          const hsName =
            String(
              (profile as any).highSchoolName ||
                (profile as any).schoolName ||
                (profile as any).bachelorSchoolName ||
                "High School",
            ).trim() || "High School";
          const gpaRaw =
            (profile as any).highSchoolGpaPercent ??
            (profile as any).highSchoolGpa ??
            (profile as any).gpa ??
            (profile as any).gpaPercent;
          // Zoho, gpa_percent alanında yalnızca 0-100 arası TAM SAYI kabul
          // ediyor (86.6 / 4.33 / "3.0" → INVALID_DATA: High_School_GPA).
          // normalizeGpa yuvarlar + 0-100'e sıkıştırır; sayısal olmayan değerde
          // alanı HİÇ gönderme (fail-closed) ve nedenini logla — eski "3.0"
          // ondalık varsayılanı bizzat hatanın kaynağıydı.
          const hsGpaInt = normalizeGpa(gpaRaw as any);
          const hsGpa = hsGpaInt !== undefined ? String(hsGpaInt) : "";
          if (hsGpa === "") {
            logger.warn(
              `[sit] SCHOOLFIX gpa ATLANDI (fail-closed): sayısal olmayan/boş GPA değeri raw='${String(gpaRaw ?? "")}' — gpa_percent gönderilmeyecek`,
            );
          }
          const setByName = (nm: string, val: string) =>
            page.evaluate(
              (a: { nm: string; val: string }) => {
                const el = document.querySelector('input[name="' + a.nm + '"]') as HTMLInputElement | null;
                if (!el) return "no-el";
                el.focus();
                const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
                if (d && d.set) d.set.call(el, a.val);
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                el.dispatchEvent(new Event("blur", { bubbles: true }));
                return "val=" + el.value;
              },
              { nm, val },
            );
          const nR = await setByName("high_school_name", hsName);
          const gR = hsGpa !== "" ? await setByName("high_school_gpa_percent", hsGpa) : "skipped";
          logger.info(
            "[sit] SCHOOLFIX cOk=" + cOk + " hsCountry='" + hsCountry + "' name=" + nR + " gpa=" + gR,
          );
        }
      } catch (e) {
        logger.info("[sit] SCHOOLFIX err " + (e as any)?.message);
      }
      // STEP5 handler v5: cmdk education-level combobox (opts: Associate/Bachelor/Master/PhD).
      try {
        const cbIdx = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button[role="combobox"]'));
          for (let k = 0; k < btns.length; k++) {
            const fi = (btns[k] as HTMLElement).closest('[data-slot="form-item"]');
            const lab = fi ? (fi.querySelector("label")?.textContent || "").toLowerCase() : "";
            if (lab.includes("apply for")) return k;
          }
          return -1;
        });
        if (cbIdx >= 0) {
          const btn = page.locator('button[role="combobox"]').nth(cbIdx);
          const cur = ((await btn.textContent().catch(() => "")) || "").trim();
          if (!cur || /select education level/i.test(cur)) {
            const lvlRaw = String(
              (profile as any).applyingFor ||
                (profile as any).degreeLevel ||
                (profile as any).educationLevel ||
                (profile as any).degree ||
                (profile as any).level ||
                "",
            ).toLowerCase();
            let label = "Bachelor";
            if (/phd|doctor|doktora/.test(lvlRaw)) label = "PhD";
            else if (/master|graduate|yüksek/.test(lvlRaw)) label = "Master";
            else if (/associate|vocational|önlisans|onlisans/.test(lvlRaw)) label = "Associate";
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            await btn.click().catch(() => {});
            await page.waitForTimeout(350);
            let expanded = await btn.getAttribute("aria-expanded").catch(() => null);
            if (expanded !== "true") {
              await btn.focus().catch(() => {});
              await page.keyboard.press("Enter").catch(() => {});
              await page.waitForTimeout(300);
              expanded = await btn.getAttribute("aria-expanded").catch(() => null);
            }
            await page.waitForTimeout(400);
            // The open dropdown is a cmdk palette: type into its search to filter, then click the option.
            await page.keyboard.type(label, { delay: 45 }).catch(() => {});
            await page.waitForTimeout(500);
            let clicked = false;
            try {
              await page.getByText(label, { exact: true }).first().click({ timeout: 2500 });
              clicked = true;
            } catch {}
            if (!clicked) {
              await page.keyboard.press("Enter").catch(() => {});
            }
            await page.waitForTimeout(400);
            const after = ((await btn.textContent().catch(() => "")) || "").trim();
            logger.info(
              "[sit] APPLYPICK v5 label=" + label + " clicked=" + clicked + " after='" + after + "'",
            );
          }
        }
      } catch (e) {
        logger.info("[sit] APPLYFOR handler err " + (e as any)?.message);
      }
      // AGGRESSIVE Contact fixer v5 — Contact step only (residence select present); ignores everSet.
      try {
        await page.waitForTimeout(600);
        const selIdx = await page.evaluate(() => {
          const arr = Array.from(document.querySelectorAll("select"));
          for (let k = 0; k < arr.length; k++) {
            const fi = (arr[k] as HTMLElement).closest('[data-slot="form-item"]');
            const lab = fi ? (fi.querySelector("label")?.textContent || "").toLowerCase() : "";
            if (lab.includes("residence")) return k;
          }
          return -1;
        });
        const cval2 = toEnglishCountryName(profile.nationality) || profile.nationality || "";
        let cOk = false;
        let telOk = false;
        let telDbg = "not-contact";
        if (selIdx >= 0) {
          // Country of Residence — nameless <select>; must dispatch change manually
          // because React controlled selects ignore value assignments without events.
          if (cval2) {
            const cs = page.locator("select").nth(selIdx);
            try {
              await cs.selectOption({ label: cval2 });
              await cs.evaluate((el: Element) => el.dispatchEvent(new Event("change", { bubbles: true }))).catch(() => {});
              cOk = true;
            } catch {}
            if (!cOk) {
              const opts = (await cs.locator("option").allTextContents()).map((o) => o.trim());
              const hit =
                opts.find((o) => o.toLowerCase() === cval2.toLowerCase()) ||
                opts.find((o) => o.toLowerCase().includes(cval2.toLowerCase()));
              if (hit) {
                try {
                  await cs.selectOption({ label: hit });
                  await cs.evaluate((el: Element) => el.dispatchEvent(new Event("change", { bubbles: true }))).catch(() => {});
                  cOk = true;
                } catch {}
              }
            }
          }
        }
        // Deep fallback: the residence select may live in a shadow root /
        // frame (selIdx=-1 historically) — match it by label text instead.
        if (!cOk && cval2) {
          for (const frame of page.frames()) {
            const r = (await frame
              .evaluate(DEEP_SELECT_JS, {
                labelRe: "(residence|country)",
                optionText: cval2,
              })
              .catch(() => "eval-err")) as string;
            if (r && r.startsWith("sel=")) {
              cOk = true;
              logger.info("[sit] CONTACTFIX2 deep-select " + r);
              break;
            }
          }
        }
        // Mobile — student's number. Runs unconditionally (not gated by selIdx)
        // so the phone is filled even when the residence-country select is absent
        // or its label doesn't include "residence" (selIdx=-1 historically
        // caused this entire block to be skipped → studentId never resolved).
        {
          const phoneVal = cleanPhone(
            (profile as any).phoneE164 ||
              (profile as any).phone_e164 ||
              profile.phone ||
              (profile as any).mobile ||
              (profile as any).whatsapp ||
              "",
          );
          if (phoneVal) {
            telDbg = "no-el";
            // Strategy 1: Direct Playwright — input[type=tel] with placeholder
            // "Enter mobile number" or similar. DOM contract says the phone
            // widget has no id/name — target by type or placeholder.
            // Skip any input whose placeholder is just a dial-code ("+XX").
            try {
              const allTel = page.locator('input[type="tel"]');
              const telCount = await allTel.count();
              for (let ti = 0; ti < telCount; ti++) {
                const telEl = allTel.nth(ti);
                const ph = ((await telEl.getAttribute("placeholder").catch(() => "")) || "").trim();
                // Dial-code boxes have short placeholders like "+90", "+1", "+"; skip them.
                if (/^\+?\d{0,4}$/.test(ph)) continue;
                const r = await telEl.evaluate((el: Element, v: string) => {
                  const inp = el as HTMLInputElement;
                  const proto = Object.getPrototypeOf(inp);
                  const d = Object.getOwnPropertyDescriptor(proto, "value");
                  if (d?.set) d.set.call(inp, v); else inp.value = v;
                  inp.dispatchEvent(new Event("input", { bubbles: true }));
                  inp.dispatchEvent(new Event("change", { bubbles: true }));
                  inp.dispatchEvent(new Event("blur", { bubbles: true }));
                  return "val=" + inp.value;
                }, phoneVal).catch(() => "");
                if (r && r.startsWith("val=") && r.length > 4) {
                  telDbg = "pw-direct " + r;
                  telOk = true;
                  break;
                }
              }
            } catch {}
            // Strategy 2: DEEP_FILL across frames (label/aria/placeholder/type=tel).
            // Picks up inputs inside shadow roots or cross-origin subframes.
            if (!telOk) {
              for (const frame of page.frames()) {
                const r = (await frame
                  .evaluate(DEEP_FILL_INPUT_JS, {
                    val: phoneVal,
                    labelRe: "(mobile|phone|telefon|tel\\b|gsm|whatsapp|number)",
                    excludeRe: "(code|kod|dial|country)",
                  })
                  .catch(() => "eval-err")) as string;
                if (r && r.startsWith("val=")) {
                  telDbg = r;
                  telOk = true;
                  break;
                }
                if (r && r !== "no-el" && telDbg === "no-el") telDbg = r;
              }
            }
            if (telOk) everSet.add("phone");
          }
        }
        logger.info(
          "[sit] CONTACTFIX2 telOk=" + telOk + " telDbg=" + telDbg + " cval='" + cval2 + "' selIdx=" + selIdx + " cOk=" + cOk,
        );
      } catch (e) {
        logger.info("[sit] CONTACTFIX err " + (e as any)?.message);
      }
      await fillField(page, SIT_STUDENT_FIELDS.address, profile.address);
      // City (Contact & Location) — CRM'de ayrı şehir alanı yok; adresin ilk
      // virgül-öncesi parçasından türet (deriveAddressParts). Adres boş/işe
      // yaramazsa hiç doldurma (best-effort, adım engellemez).
      try {
        const cityVal = deriveAddressParts(profile.address || undefined).city.trim();
        if (cityVal && cityVal !== "-") {
          const cityOk = await fillField(page, SIT_STUDENT_FIELDS.city, cityVal);
          if (cityOk) everSet.add("city");
          logger.info(`[sit] CITYFILL city='${cityVal}' ok=${cityOk}`);
        }
      } catch (e) {
        logger.info("[sit] CITYFILL err " + (e as any)?.message);
      }
      // Robust residence-country: target the labelled select directly (independent of
      // the country label regex) and fuzzy-match the English nationality country name.
      try {
        const cval = toEnglishCountryName(profile.nationality) || profile.nationality || "";
        if (cval) {
          const csel = page
            .locator('div[data-slot="form-item"]:has(label:has-text("Country of Residence")) select')
            .first();
          if (await csel.count()) {
            const cur = await csel.inputValue().catch(() => "");
            if (!cur) {
              let done = false;
              try {
                await csel.selectOption({ label: cval });
                done = true;
              } catch {}
              if (!done) {
                const opts = (await csel.locator("option").allTextContents()).map((o) => o.trim());
                const hit =
                  opts.find((o) => o.toLowerCase() === cval.toLowerCase()) ||
                  opts.find((o) => cval && o.toLowerCase().includes(cval.toLowerCase()));
                if (hit) {
                  try {
                    await csel.selectOption({ label: hit });
                  } catch {}
                }
              }
            }
          }
        }
      } catch {}
      // Country (Contact & Location). The CRM has no residence-country field, so
      // default to the applicant's nationality country (EN). Best-effort: only
      // fills when a Country control is present on the current step. Mirrors the
      // nationality select→text fallback.
      if (profile.nationality) {
        const natEnCountry = toEnglishCountryName(profile.nationality);
        const countryOptionRe = new RegExp(
          `^\\s*(${escapeRe(natEnCountry)}|${escapeRe(profile.nationality)})`,
          "i",
        );
        const okCountrySelect = await selectField(
          page,
          SIT_STUDENT_FIELDS.country,
          countryOptionRe,
          natEnCountry,
        );
        const okCountryText = okCountrySelect
          ? true
          : await fillField(page, SIT_STUDENT_FIELDS.country, natEnCountry);
        if (!okCountrySelect && !okCountryText) {
          // Log live option texts so an unmapped residence country is diagnosable
          // from the run log instead of a silent miss (mirrors nationality).
          try {
            const opts = await formItemByLabel(page, SIT_STUDENT_FIELDS.country)
              .locator("select")
              .first()
              .evaluate((el) =>
                Array.from((el as unknown as HTMLSelectElement).options)
                  .map((o) => (o.textContent || "").trim())
                  .filter(Boolean)
                  .slice(0, 60)
                  .join(" | "),
              );
            if (opts) {
              logger.info(
                `[sit] country opt eşleşmedi: aranan="${natEnCountry}" | opsiyonlar=${opts}`,
              );
            }
          } catch {
            /* diagnostic only */
          }
        }
      }

      // Family
      await fillField(page, SIT_STUDENT_FIELDS.fatherName, profile.fatherName);
      await fillField(page, SIT_STUDENT_FIELDS.motherName, profile.motherName);

      // Identity / passport
      if (profile.nationality) {
        // The CRM stores nationality in Turkish ("Özbekistan"); the wizard's
        // Nationality <select> carries ONLY English option text ("Uzbekistan").
        // Match the English name first (anchored at option start so "Samoa"
        // never matches "American Samoa"), keeping the raw Turkish name as a
        // fallback candidate in case an option ever reverts to Turkish.
        const natEn = toEnglishCountryName(profile.nationality);
        const natOptionRe = new RegExp(
          `^\\s*(${escapeRe(natEn)}|${escapeRe(profile.nationality)})`,
          "i",
        );
        const okSelect = await selectField(
          page,
          SIT_STUDENT_FIELDS.nationality,
          natOptionRe,
          natEn,
        );
        const okText = okSelect
          ? true
          : await fillField(page, SIT_STUDENT_FIELDS.nationality, natEn, [
              "input[name*=nation i]",
              "input[id*=nation i]",
            ]);
        if (!okSelect && !okText) {
          // Log the live option texts so an unmapped nationality is diagnosable
          // from the run log instead of a silent BULUNAMADI.
          try {
            const opts = await formItemByLabel(page, SIT_STUDENT_FIELDS.nationality)
              .locator("select")
              .first()
              .evaluate((el) =>
                Array.from((el as unknown as HTMLSelectElement).options)
                  .map((o) => (o.textContent || "").trim())
                  .filter(Boolean)
                  .slice(0, 60)
                  .join(" | "),
              );
            logger.info(
              `[sit] nationality opt eşleşmedi: aranan="${natEn}" | opsiyonlar=${opts}`,
            );
          } catch {
            /* diagnostic only */
          }
        }
        mark("nationality", okSelect || okText);
      }
      mark(
        "passportNo",
        await fillField(
          page,
          SIT_STUDENT_FIELDS.passportNumber,
          profile.passportNumber,
          ["input[name*=passport i]", "input[id*=passport i]"],
        ),
      );
      if (passportIssue) {
        mark(
          "issueDate",
          await setDateField(
            page,
            SIT_STUDENT_FIELDS.passportIssueDate,
            profile.passportIssueDate,
          ),
        );
      }
      if (passportExpiry) {
        mark(
          "expiryDate",
          await setDateField(
            page,
            SIT_STUDENT_FIELDS.passportExpiryDate,
            profile.passportExpiryDate,
          ),
        );
      }

      // Step-1 Basic Info: THREE Yes/No questions must all be answered or the
      // step's "required" validation blocks Next. A foreign applicant defaults
      // all three to "No" (no transfer, not a T.C. citizen, no Blue Card).
      // Attempted on every step; the group simply isn't present on later steps.
      const setTog = async (
        name: string,
        headingRe: RegExp,
        value: "Yes" | "No",
        idPrefixes: string[],
      ): Promise<void> => {
        if (everSet.has(name)) return;
        if (await setToggle(page, headingRe, value, idPrefixes)) {
          everSet.add(name);
          stepLog.push(`${name}=${value}`);
        } else {
          stepLog.push(`${name}=BULUNAMADI`);
        }
      };
      await setTog("transferStudent", SIT_TOGGLES.transferStudent, "No", [
        "transfer",
      ]);
      await setTog("haveTc", SIT_TOGGLES.haveTc, "No", ["tc"]);
      await setTog("blueCard", SIT_TOGGLES.blueCard, "No", [
        "bluecard",
        "blue-card",
      ]);

      // Academics
      await fillField(page, SIT_STUDENT_FIELDS.schoolName, profile.schoolName);
      if (gpa !== undefined) {
        await fillField(page, SIT_STUDENT_FIELDS.gpa, String(gpa));
      }
      if (profile.graduationYear !== undefined) {
        await fillField(
          page,
          SIT_STUDENT_FIELDS.graduationYear,
          String(profile.graduationYear),
        );
      }

      if (stepLog.length) {
        logger.info(`[sit] wizard adım=${step + 1} alanlar: ${stepLog.join(", ")}`);
      }

      // Documents — attach each local file once, into its own slot. Track whether
      // this step actually EXPOSED an upload affordance so a failure before the
      // documents step is distinguishable from a failed upload.
      const wantUploads = !!(
        files.photo || files.passport || files.transcript || files.diploma
      );
      if (wantUploads && !reachedDocuments) {
        const trigCount =
          (await page
            .getByRole("button", { name: SIT_UPLOAD.photoTrigger })
            .first()
            .count()
            .catch(() => 0)) +
          (await page
            .getByRole("button", { name: SIT_UPLOAD.attachmentTrigger })
            .first()
            .count()
            .catch(() => 0)) +
          // A visible/hidden <input type=file> also counts as an upload step.
          (await page
            .locator('input[type="file"]')
            .count()
            .catch(() => 0));
        if (trigCount > 0) {
          reachedDocuments = true;
            try {
              const addBtn = page.getByRole("button", { name: /add (new )?doc/i }).first();
              if (await addBtn.count()) {
                await addBtn.click().catch(() => {});
                await page.waitForTimeout(900);
                await page
                  .screenshot({ path: "/var/www/apply.findandstudy.com/artifacts/edcons/dist/public/swf.png", fullPage: true })
                  .catch(() => {});
                const rowDump = await page.evaluate(() => {
                  const files = document.querySelectorAll('input[type="file"]').length;
                  const selects = Array.from(document.querySelectorAll("select")).map((se) => {
                    const fi = (se as HTMLElement).closest('[data-slot="form-item"]');
                    const lab = fi ? (fi.querySelector("label")?.textContent || "").trim() : "";
                    return lab + " [" + (se as HTMLSelectElement).options.length + "]";
                  });
                  const combos = Array.from(document.querySelectorAll('button[role="combobox"]')).map((b) => (b.textContent || "").trim());
                  const btns = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 20);
                  return { files, selects, combos, btns };
                });
                logger.info("[sit] DOCROW " + JSON.stringify(rowDump));
              }
            } catch (e) {
              logger.info("[sit] DOCROW err " + (e as any)?.message);
            }
          logger.info(`[sit] wizard adım=${step + 1}: belge yükleme adımına ulaşıldı`);
        }
      }
      if (files.photo && !photoUploaded) {
        if (await uploadViaChooser(page, SIT_UPLOAD.photoTrigger, files.photo)) {
          photoUploaded = true;
          logger.info(`[sit] wizard adım=${step + 1} yükleme: foto=ok`);
        }
      }
      const docJobs: Array<[string, RegExp, string]> = [];
      if (files.passport) {
        docJobs.push(["passport", SIT_UPLOAD.passportTrigger, files.passport]);
      }
      if (files.transcript) {
        docJobs.push(["transcript", SIT_UPLOAD.transcriptTrigger, files.transcript]);
      }
      if (files.diploma) {
        docJobs.push(["diploma", SIT_UPLOAD.diplomaTrigger, files.diploma]);
      }
      if (files.english) { docJobs.push(["english", SIT_UPLOAD.attachmentTrigger, files.english]); }
      if (files.motivation) { docJobs.push(["motivation", SIT_UPLOAD.attachmentTrigger, files.motivation]); }
      if (files.recommendation) { docJobs.push(["recommendation", SIT_UPLOAD.attachmentTrigger, files.recommendation]); }
      for (const [key, trig, docPath] of docJobs) {
        if (uploadedDocs.has(key)) continue;
        if (await uploadDocRow(page, key, key, docPath)) {
          uploadedDocs.add(key);
          logger.info(`[sit] wizard adım=${step + 1} yükleme: ${key}=ok`);
        }
      }

      // Advance — try Next first; on the last step the Save button appears.
      const hasNext = await page
        .getByRole("button", { name: SIT_BUTTONS.next })
        .first()
        .count();
      if (hasNext) {
        await dismissInactivityModal(page);
        await clickButton(page, SIT_BUTTONS.next);
        await sleep(page, 1800);
        // Zoho validation recovery: a banner means the step did not advance.
        if (SIT_ERRORS.validation.test(await bodyText(page))) {
          validationRetries++;
          // Dump the stuck step's real control structure once (first failure) so
          // the failing field's actual selector is visible even if it isn't step 1.
          if (validationRetries === 1) await dumpWizardForm(page, step + 1);
          const inline = await readInlineErrors(page);
          const curHeading = (await readStepHeading(page)) || heading;
          logger.warn(
            `[sit] wizard doğrulama hatası — adım=${step + 1}` +
              `${curHeading ? ` (${curHeading})` : ""} mesaj: ` +
              `"${inline || "(görünür inline hata bulunamadı)"}"`,
          );
          // Cap in-step retries: after 2 consecutive failures on a stuck step,
          // screenshot + FAIL retryably (same terminal "failed" status as before,
          // but earlier and with a clear cause) instead of re-looping silently.
          // Per-field: log which labels are still showing required-field markers
          // and attempt one targeted re-fill per empty field.
          try {
            const emptyLabels: string[] = await page.evaluate(() => {
              const results: string[] = [];
              // SIT marks required-but-empty fields with a red asterisk in the label
              // and a visible error message below the input.
              document.querySelectorAll('[data-slot="form-item"], .form-item, [class*=field]').forEach((fi) => {
                const lab = (fi.querySelector("label")?.textContent || "").trim();
                const hasError = !!fi.querySelector('[data-slot="form-message"], .error, [class*=error], [aria-invalid]');
                const inputEmpty = Array.from(fi.querySelectorAll("input, textarea, select")).some((el) => {
                  const inp = el as HTMLInputElement;
                  return !inp.disabled && !inp.readOnly && inp.type !== "hidden" && !inp.value;
                });
                if (lab && (hasError || inputEmpty)) results.push(lab);
              });
              return results;
            }).catch(() => [] as string[]);
            if (emptyLabels.length) {
              logger.warn(`[sit] boş alanlar (adım ${step + 1}): ${emptyLabels.join(" | ")}`);
              // Re-fill contact fields if we're on the Contact step
              const isContactStep = emptyLabels.some((l) => /email|mobile|phone|residence|country/i.test(l));
              if (isContactStep) {
                // Re-fill email
                if (emptyLabels.some((l) => /email/i.test(l)) && profile.email) {
                  await page.evaluate((v: string) => {
                    const el = document.querySelector('input[name="email"], input[type="email"]') as HTMLInputElement | null;
                    if (!el) return;
                    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
                    if (d?.set) d.set.call(el, v); else el.value = v;
                    ["input", "change", "blur"].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
                  }, profile.email).catch(() => {});
                }
                // Re-fill phone: direct input[type=tel]
                if (emptyLabels.some((l) => /mobile|phone/i.test(l))) {
                  const phoneVal2 = cleanPhone((profile as any).phoneE164 || profile.phone || "");
                  if (phoneVal2) {
                    await page.locator('input[type="tel"]').first().evaluate((el: Element, v: string) => {
                      const inp = el as HTMLInputElement;
                      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), "value");
                      if (d?.set) d.set.call(inp, v); else inp.value = v;
                      ["input", "change", "blur"].forEach((t) => inp.dispatchEvent(new Event(t, { bubbles: true })));
                    }, phoneVal2).catch(() => {});
                  }
                }
                // Re-fill Country of Residence: target by label-scoped select
                if (emptyLabels.some((l) => /residence|country/i.test(l))) {
                  const cvalR = toEnglishCountryName(profile.nationality) || profile.nationality || "";
                  if (cvalR) {
                    const cselR = page.locator('div[data-slot="form-item"]:has(label:has-text("Country of Residence")) select').first();
                    if (await cselR.count()) {
                      await cselR.selectOption({ label: cvalR }).catch(async () => {
                        const opts = (await cselR.locator("option").allTextContents()).map((o) => o.trim());
                        const hit = opts.find((o) => o.toLowerCase().includes(cvalR.toLowerCase()));
                        if (hit) await cselR.selectOption({ label: hit }).catch(() => {});
                      });
                      await cselR.evaluate((el: Element) => el.dispatchEvent(new Event("change", { bubbles: true }))).catch(() => {});
                    }
                  }
                }
                await page.waitForTimeout(400);
              }
            }
          } catch {}
          if (validationRetries >= 2) {
            await captureWizardFail(page, idToken, `step${step + 1}-validation`);
            const unset = Object.keys(critical).filter(
              (k) => critical[k] && !everSet.has(k),
            );
            throw new Error(
              `SIT: wizard adım=${step + 1} doğrulamadan geçemedi` +
                `${inline ? ` (${inline})` : ""}` +
                `${unset.length ? ` — ayarlanamayan alanlar: ${unset.join(", ")}` : ""}` +
                " — tekrar denenecek",
            );
          }
          continue;
        }
        // Step advanced cleanly → reset the in-step retry counter.
        validationRetries = 0;
        continue;
      }
      break;
    }

    // --- DRY: wizard filled + uploads attempted → stop before the final save ---
    if (!doSubmit) {
      logger.info("[sit] DRY: öğrenci wizard dolduruldu, kaydetmeden durduruldu");
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
        createdViaWebhook: false,
        detail: "dry-run: öğrenci kaydedilmedi",
      };
    }

    // --- Completeness gate: never save a student missing the docs it should
    //     carry. A present-but-unuploaded file means the file-chooser step did
    //     not take — fail retryably rather than create a partial record (the
    //     detail Documents tab is read-only, so there is no post-create fixup). ---
    // If the whole wizard was walked without ever exposing an upload affordance
    // (no file input / no attachment or photo button on any step), the create
    // form simply has no document step — documents/photo must be handled apart.
    if (
      (files.photo || files.passport || files.transcript || files.diploma) &&
      !reachedDocuments
    ) {
      logger.warn(
        "[sit] wizard: create formunda dosya-yükleme adımı YOK — belge/foto ayrı gerekiyor",
      );
    }
    await page
      .screenshot({ path: "/var/www/apply.findandstudy.com/artifacts/edcons/dist/public/swf.png", fullPage: true })
      .catch(() => {});
    try {
      const upDump = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 25);
        const files = document.querySelectorAll('input[type="file"]').length;
        const heading = (document.querySelector("h1,h2,h3")?.textContent || "").trim();
        return { heading, files, btns };
      });
      logger.info("[sit] UPLOADSTEP " + JSON.stringify(upDump));
    } catch {}
    const missingUploads: string[] = [];
    if (files.photo && !photoUploaded) missingUploads.push("foto");
    if (files.passport && !uploadedDocs.has("passport")) missingUploads.push("pasaport");
    if (files.transcript && !uploadedDocs.has("transcript")) {
      missingUploads.push("transkript");
    }
    if (files.diploma && !uploadedDocs.has("diploma")) missingUploads.push("diploma");
    if (missingUploads.length > 0) {
      await captureWizardFail(page, idToken, "documents-missing");
      logger.warn(
        `[sit] wizard belge yükleme eksik — belge adımına ulaşıldı=` +
          `${reachedDocuments ? "evet" : "HAYIR"}, eksik: ${missingUploads.join(", ")}`,
      );
      throw new Error(
        `SIT: belge/foto wizard'a yüklenemedi (${missingUploads.join(", ")}) — ` +
          "eksik belgeli create engellendi, tekrar denenecek",
      );
    }

    // --- Final save (with one retry). Only mark saved when the Save button was
    //     actually clicked AND no error banner appeared — never optimistically
    //     assume success, or the id-resolution below could report a phantom
    //     create. ---
    let saved = false;
    let duplicateSeen = false;
    let lastInlineErrors = "";
    const wizardUrlBefore = page.url();
    for (let attempt = 0; attempt < 2 && !saved; attempt++) {
      await dismissInactivityModal(page);
      const clicked = await clickButton(page, SIT_BUTTONS.saveStudent);
      if (!clicked) {
        // Save button not present (not on the final step / overlay / selector
        // drift) — this attempt did nothing, so do NOT treat it as a save.
        logger.warn(
          `[sit] Kaydet düğmesi bulunamadı (deneme ${attempt + 1})`,
        );
        await sleep(page, 1500);
        continue;
      }
      await sleep(page, 5000);
      const txt = await bodyText(page);
      if (SIT_ERRORS.duplicate.test(txt)) {
        logger.info("[sit] kayıt sırasında mükerrer tespit edildi");
        duplicateSeen = true;
        break;
      }
      // ALWAYS capture inline validation ([aria-invalid], .error,
      // [role=alert]) after a save click — the body-regex checks alone missed
      // component-level validation and produced phantom "saved" results.
      lastInlineErrors = await readInlineErrors(page).catch(() => "");
      if (lastInlineErrors) {
        logger.warn(
          `[sit] kayıt inline doğrulama hatası (deneme ${attempt + 1}): ${lastInlineErrors}`,
        );
        continue;
      }
      if (SIT_ERRORS.serverError.test(txt)) {
        logger.warn(`[sit] kayıt sunucu hatası (deneme ${attempt + 1})`);
        continue;
      }
      if (SIT_ERRORS.validation.test(txt)) {
        logger.warn(`[sit] kayıt doğrulama hatası (deneme ${attempt + 1})`);
        continue;
      }
      // POSITIVE proof required — never assume success just because no error
      // text matched. Proof = the wizard actually went away: navigated off the
      // create route, or the Save button/step heading disappeared.
      const urlNow = page.url();
      const navigatedAway =
        urlNow !== wizardUrlBefore &&
        !/\/(new|create|add)\b/i.test(urlNow);
      const saveBtnStillThere = await page
        .getByRole("button", { name: SIT_BUTTONS.saveStudent })
        .first()
        .isVisible()
        .catch(() => false);
      if (navigatedAway) {
        saved = true;
        logger.info(
          `[sit] kayıt kanıtı: yönlendirme (url=${urlNow})`,
        );
      } else {
        // Save button gone alone is NOT proof (it can be transiently hidden
        // by an overlay). Without a redirect, a quick identity lookup is the
        // final arbiter — the student must actually be findable.
        const quick = await resolveCreatedStudentId(page, {
          email: profile.email,
          passportNumber: profile.passportNumber,
        }).catch(() => null);
        if (quick) {
          saved = true;
          logger.info(
            `[sit] kayıt kanıtı: hızlı arama id=${quick} (saveBtnGone=${!saveBtnStillThere})`,
          );
        } else {
          logger.warn(
            `[sit] kayıt kanıtı YOK (deneme ${attempt + 1}) — yönlendirme yok, öğrenci bulunamadı (saveBtnGone=${!saveBtnStillThere})`,
          );
        }
      }
    }

    // Save neither succeeded nor hit a duplicate → capture the failed final
    // state and surface any critical fields that were never entered, so the
    // stuck field/step is diagnosable before the retry.
    const unsetCritical =
      !saved && !duplicateSeen
        ? Object.keys(critical).filter((k) => critical[k] && !everSet.has(k))
        : [];
    if (!saved && !duplicateSeen) {
      await captureWizardFail(page, idToken, "save-failed");
      if (unsetCritical.length) {
        logger.warn(
          `[sit] wizard kaydedilemedi — ayarlanamayan alanlar: ${unsetCritical.join(", ")}`,
        );
      }
    }

    // --- Resolve the new student id (identity-verified GraphQL poll first) ---
    const resolvedId = await resolveCreatedStudentId(page, {
      email: profile.email,
      passportNumber: profile.passportNumber,
    });
    if (resolvedId) {
      logger.info(`[sit] öğrenci wizard ile oluşturuldu (id=${resolvedId})`);
      return {
        studentId: resolvedId,
        created: saved,
        alreadyExists: !saved || duplicateSeen,
        createdViaWebhook: false,
      };
    }

    // Fallback: parse the id from the student-detail URL we landed on after save.
    // Trust any numeric /students/{id} path regardless of save-detection heuristic
    // — if the page navigated to a student detail, the student was created.
    // Require at least one digit and reject wizard route words so a stray
    // /students/new never masquerades as a created id. Left UNVERIFIED → logged.
    const urlMatch = page.url().match(/\/students\/([0-9a-z][0-9a-z-]{5,})/i);
    const urlId = urlMatch?.[1];
    if (
      urlId &&
      /[0-9]/.test(urlId) &&
      !/^(new|create|add|edit)$/i.test(urlId)
    ) {
      logger.warn(
        "[sit] öğrenci id GraphQL ile doğrulanamadı — detay URL'den alındı " +
          `(id=${urlId}, saved=${saved}, DOĞRULANMADI)`,
      );
      return {
        studentId: urlId,
        created: saved,
        alreadyExists: false,
        createdViaWebhook: false,
      };
    }

    // Surface the real SIT rejection reason before giving up — previously
    // only a screenshot was captured; now the inline error + current heading
    // are also logged and returned in `detail` so the board shows a useful message.
    const diagInline = await readInlineErrors(page).catch(() => "");
    const diagTitle = await page
      .evaluate(
        () =>
          (
            document.querySelector("h1,h2,[data-slot='heading']")?.textContent || ""
          )
            .trim()
            .slice(0, 120),
      )
      .catch(() => "");
    const diagUrl = page.url();
    logger.warn(
      `[sit] create-fail teşhis — url=${diagUrl} inline=${JSON.stringify(diagInline)} step="${diagTitle}" saved=${saved}`,
    );
    // Honest failure message: name the concrete blocker when known —
    // never-filled critical fields or the captured inline validation error.
    const TR_FIELD: Record<string, string> = {
      email: "e-posta",
      gender: "cinsiyet",
      dob: "doğum tarihi",
      nationality: "uyruk",
      passportNo: "pasaport no",
      issueDate: "pasaport veriliş tarihi",
      expiryDate: "pasaport bitiş tarihi",
      phone: "telefon",
      transferStudent: "transfer öğrenci seçimi",
      haveTc: "TC seçimi",
      blueCard: "mavi kart seçimi",
    };
    const unsetTr = unsetCritical.map((k) => TR_FIELD[k] || k);
    const inlineMsg = lastInlineErrors || diagInline;
    let diagDetail: string;
    if (unsetTr.length) {
      diagDetail = `öğrenci kaydedilemedi: zorunlu alan doldurulamadı (${unsetTr.join(", ")})`;
      if (inlineMsg) diagDetail += ` — portal hatası: ${inlineMsg}`;
    } else if (inlineMsg) {
      diagDetail = `öğrenci kaydedilemedi — portal doğrulama hatası: ${inlineMsg}`;
    } else {
      diagDetail = `SIT öğrenci oluşturulamadı — son adım: "${diagTitle}", url: ${diagUrl}`;
    }

    return {
      studentId: null,
      created: false,
      alreadyExists: duplicateSeen,
      createdViaWebhook: false,
      detail: duplicateSeen
        ? "öğrenci zaten mevcut ancak id doğrulanamadı"
        : diagDetail,
    };
  },

  /**
   * Create an application for a student at an allowed university + program.
   * Idempotent: skips when a matching (university, program) application already
   * exists. The program is matched in code against the read-only university-
   * scoped catalog, then the record is created by driving the portal's REAL
   * "Add Application" UI flow (REAL mode only; DRY stops after matching). The
   * SIT backend (Zoho) assigns id + app_id + stage; we read the new record back
   * to obtain app_id for writeback.
   */
  async createApplication(
    session: AdapterSession,
    profile: SubmitProfile,
    studentId: string | null,
    doSubmit: boolean = true,
  ): Promise<SitApplicationResult> {
    const page = session.page;
    await this.ensureLoggedIn(session);

    const base: SitApplicationResult = {
      alreadyExists: false,
      submitted: false,
      programMissing: false,
      studentId,
    };

    // --- Allowlist guard (IDOR-safe) ---
    const allowedUni = matchAllowedUniversity(profile.universityName ?? "");
    if (!allowedUni) {
      logger.warn(
        `[sit] üniversite izin listesinde değil: "${profile.universityName ?? ""}" — atlanıyor`,
      );
      // Diagnostic: log the permitted universities so the operator can see which
      // members this SIT account actually accepts (and whether the CRM name just
      // differs in spelling vs. genuinely not being on the list).
      logger.warn(`[sit] izinli üniversiteler: ${SIT_ALLOWLIST.join(" | ")}`);
      // A university that is not permitted is NOT a "program not found" problem —
      // keep programMissing=false (inherited from `base`) so the failure is
      // reported as a university error via `detail`, not misclassified as a
      // program_missing result that could trigger program fallback.
      return {
        ...base,
        detail: `İzin verilmeyen üniversite: ${profile.universityName ?? "(boş)"}`,
      };
    }

    // --- Resolve the exact program from the university-scoped catalog ---
    // Read-only GraphQL: the catalog now returns the university's active
    // programs (with degree/language metadata) so program matching happens
    // entirely in code — no UI "Add Application" dialog is involved.
    const level = mapEducationLevel(profile.level);
    const catalog = await fetchProgramCatalog(page, allowedUni, level);

    // Diagnostic: persist the freshly-fetched live catalog so it can be
    // inspected offline (psql) without re-triggering a login/scrape. Never
    // gates the flow — a cache-write failure is logged and swallowed.
    if (catalog.length > 0) {
      await persistFetchedProgramPool(`sit:${allowedUni}`, level, catalog);
    }

    if (catalog.length === 0) {
      logger.warn(
        `[sit] katalog boş: "${allowedUni}" için aktif program bulunamadı`,
      );
      return {
        ...base,
        programMissing: true,
        detail: `Program bulunamadı: "${allowedUni}" kataloğunda aktif program yok`,
      };
    }

    // --- Explicit admin override (BEFORE language filter / fuzzy matcher) ---
    // programIdOverrides maps a CRM programId directly to a SIT catalog
    // program id. This is a deliberate admin decision (e.g. routing an
    // English-applied student to a Turkish-medium program when no English
    // option exists) and must bypass isLanguageCompatible + matchProgram
    // entirely — it targets the FULL catalog, not the language-filtered pool.
    const overrideTargetId = profile.programIdOverrides?.[profile.programId];
    const overrideMatch = overrideTargetId
      ? catalog.find((c) => c.id === overrideTargetId)
      : undefined;
    if (overrideTargetId && !overrideMatch) {
      logger.warn(
        `[sit] açık override hedefi katalogda bulunamadı: programId=${profile.programId} → v=${overrideTargetId} — normal eşleşmeye devam ediliyor`,
      );
    }

    let matched: ProgramCandidate;
    let match: { match: ProgramCandidate; conf: number };

    if (overrideMatch) {
      matched = overrideMatch;
      match = { match: overrideMatch, conf: 1.0 };
      logger.info(
        `[sit] program açık override ile seçildi: "${overrideMatch.name}" (v=${overrideMatch.id}) — dil-filtresi atlandı`,
      );
    } else {
      // Exact program match (language-compatible, confidence-gated).
      const langFiltered = catalog.filter((c) =>
        isLanguageCompatible(profile.programName, c.name),
      );
      // NEVER fall back to the full catalog when language filtering removes every
      // candidate — that would let a language-mismatched program (e.g. desired
      // English while only Turkish is offered) be fuzzy-matched and submitted,
      // creating a wrong application. isLanguageCompatible only drops a candidate
      // when BOTH the desired and candidate languages are detected AND differ, so
      // a non-empty catalog with an empty compatible set means no safe match
      // exists — report programMissing instead of guessing.
      if (langFiltered.length === 0) {
        logger.warn(
          `[sit] program dil uyumsuz: "${profile.programName}" — ${catalog.length} adayın hiçbiri dil uyumlu değil`,
        );
        logProgramPoolDiagnostic("dil uyumsuz", profile.programName, catalog);
        return {
          ...base,
          programMissing: true,
          detail: `Program bulunamadı: "${profile.programName}" — dil uyumlu aday yok (${catalog.length} aday farklı dilde)`,
        };
      }
      const pool = langFiltered;
      const found = matchProgram(profile.programName, pool, {
        nameMap: profile.programNameMap,
        nameMapGeneral: profile.programNameMapGeneral,
        synonyms: profile.programSynonyms,
      });

      if (!found) {
        logger.warn(
          `[sit] program eşleşmedi: "${profile.programName}" (${pool.length} aday)`,
        );
        logProgramPoolDiagnostic("eşleşmedi", profile.programName, pool);
        return {
          ...base,
          programMissing: true,
          detail: `Program bulunamadı: "${profile.programName}" — ${pool.length} aday arasında güvenli eşleşme yok`,
        };
      }
      match = found;
      matched = found.match;
      logger.info(
        `[sit] program eşleşti: "${matched.name}" (id=${matched.id}, güven=${match.conf.toFixed(2)})`,
      );
    }

    // --- DRY: student + program resolved → stop before any write ---
    if (!doSubmit) {
      logger.info(
        "[sit] DRY: öğrenci+program bulundu — Add Application akışı çalıştırılmadan durduruldu",
      );
      return {
        ...base,
        detail: `öğrenci+program bulundu ("${matched.name}"), kaydedilmeden durduruldu`,
      };
    }

    // --- REAL: create the application via the panel's true mechanism ---
    // The SIT "Add Application" modal's dropdown UI is automation-hostile; the
    // panel's real create is a pg_graphql dedup precheck + a JSON POST to an
    // n8n webhook that returns the Zoho-assigned id. We derive every id from
    // GraphQL (never hardcoded), run the same dedup the panel does, and POST
    // only when no duplicate exists.
    if (!studentId) {
      return {
        ...base,
        detail: "başvuru oluşturulamadı: öğrenci id çözümlenemedi",
      };
    }

    // Program ids (university/degree/country + canonical name) — required by
    // both the dedup key and the webhook body.
    const progIds = await fetchProgramIds(page, matched.id);
    if (
      !progIds ||
      !progIds.universityId ||
      !progIds.degreeId ||
      !progIds.countryId
    ) {
      logger.warn(
        `[sit] program alanları (university/degree/country) çözülemedi (program=${matched.id})`,
      );
      return {
        ...base,
        detail: `başvuru oluşturulamadı: program alanları (university/degree/country) çözülemedi ("${matched.name}")`,
      };
    }

    // Academic year + semester ids (defaults "2026/2027" / "Fall"), resolved by
    // name from the read model — never hardcoded.
    const ay = await resolveAcademicYearId(page, defaultAcademicYear());
    if (!ay) {
      return {
        ...base,
        detail: `başvuru oluşturulamadı: akademik yıl id çözülemedi (${defaultAcademicYear()})`,
      };
    }
    const sem = await resolveSemesterId(page, SIT_DEFAULT_SEMESTER);
    if (!sem) {
      return {
        ...base,
        detail: `başvuru oluşturulamadı: dönem (semester) id çözülemedi (${SIT_DEFAULT_SEMESTER})`,
      };
    }

    // Agency identity — user_id (= auth uid), agency_id, crm_id (dynamic).
    const identity = await resolveSitIdentity(page);
    if (!identity || !identity.agencyId || !identity.crmId) {
      logger.warn("[sit] acente kimliği (user_id/agency_id/crm_id) çözülemedi");
      return {
        ...base,
        detail:
          "başvuru oluşturulamadı: acente kimliği (user_id/agency_id/crm_id) çözülemedi",
      };
    }

    // --- DEDUP precheck (student + university + degree + AY + semester) ---
    // Program/country are intentionally NOT part of the dedup key (matches the
    // panel). A hit is an idempotent success — do NOT POST the webhook.
    const dedup = await dedupApplication(page, {
      student: studentId,
      university: progIds.universityId,
      degree: progIds.degreeId,
      academicYear: ay.id,
      semester: sem.id,
    });
    if (dedup.status === "unknown") {
      // Fail closed: we could not confirm whether a duplicate exists, so we must
      // NOT POST the webhook (that would risk creating a duplicate application).
      logger.warn(
        "[sit] mükerrer kontrolü (dedup) doğrulanamadı — mükerrer riski nedeniyle webhook atlanıyor",
      );
      return {
        ...base,
        detail: `başvuru oluşturulamadı: mükerrer kontrolü (dedup) doğrulanamadı ("${matched.name}")`,
      };
    }
    if (dedup.status === "found") {
      logger.info(
        `[sit] mevcut başvuru bulundu (dedup, id=${dedup.id}) — webhook atlanıyor (idempotent başarı)`,
      );
      return {
        ...base,
        alreadyExists: true,
        externalRef: dedup.id,
      };
    }

    // --- CREATE via the n8n webhook (Zoho assigns the id) ---
    const studentName = `${profile.firstName} ${profile.lastName}`.trim();
    logger.info(`[sit] webhook create başlatılıyor (program="${matched.name}")`);
    const webhookResult = await createApplicationViaWebhook(page, {
      student: studentId,
      program: matched.id,
      acdamic_year: ay.id,
      semester: sem.id,
      country: progIds.countryId,
      university: progIds.universityId,
      degree: progIds.degreeId,
      student_name: studentName,
      program_name: progIds.name ?? matched.name,
      user_id: identity.userId,
      agency_id: identity.agencyId,
      crm_id: identity.crmId,
    });
    if (!webhookResult) {
      return {
        ...base,
        detail: `başvuru oluşturulamadı: webhook create başarısız ("${matched.name}")`,
      };
    }
    logger.info(`[sit] başvuru webhook ile oluşturuldu (id=${webhookResult.id})`);
    return {
      ...base,
      submitted: true,
      externalRef: webhookResult.id,
    };
  },

  /**
   * UniversityAdapter entry point. Orchestrates the full flow so the existing
   * runner path keeps working unchanged: ensure student → create application.
   */
  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    files: SubmitFiles,
    doSubmit: boolean = true,
  ): Promise<SubmitResult> {
    logger.info(`[sit] submit — program: ${profile.programName}`);
    const effectiveSubmit =
      doSubmit && process.env.PORTAL_DRYRUN !== "1";

    const student = await this.createStudent(
      session,
      profile,
      files,
      effectiveSubmit,
    );

    // NOTE: photo + document uploads now happen INSIDE createStudent, at create
    // time, via the "Add Student" wizard's file-choosers — SIT's detail Documents
    // tab is read-only, so post-create upload is impossible. There is therefore
    // no separate upload step here anymore.

    const app = await this.createApplication(
      session,
      profile,
      student.studentId,
      effectiveSubmit,
    );

    const detail = [
      student.alreadyExists
        ? "öğrenci mevcut"
        : student.created
          ? "öğrenci oluşturuldu"
          : "öğrenci oluşturulmadı",
      app.detail ??
        (app.submitted
          ? "başvuru oluşturuldu"
          : app.alreadyExists
            ? "başvuru mevcut"
            : "başvuru oluşturulmadı"),
    ].join(" · ");

    const result: SubmitResult = {
      alreadyExists: app.alreadyExists,
      submitted: app.submitted,
      programMissing: app.programMissing,
      detail,
    };
    if (app.externalRef) result.externalRef = app.externalRef;
    logger.info("[sit] submit " + JSON.stringify(result));
    return result;
  },
};
