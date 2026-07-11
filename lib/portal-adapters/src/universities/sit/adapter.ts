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

import type { Page, Locator } from "playwright-core";
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

/** Fill a field located by accessible label or placeholder. */
async function fillField(
  page: Page,
  labelRe: RegExp,
  value: string | undefined,
): Promise<boolean> {
  if (!value) return false;
  const candidates: Locator[] = [
    page.getByLabel(labelRe).first(),
    page.getByPlaceholder(labelRe).first(),
  ];
  for (const loc of candidates) {
    if ((await loc.count()) && (await loc.isVisible().catch(() => false))) {
      await loc.fill(value).catch(() => {});
      await loc.press("Tab").catch(() => {});
      return true;
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
 * Set a Yes/No field to "No" (apply has no TC / transfer-student data). Handles
 * both a radio group and a custom combobox rendering. Best-effort, non-fatal.
 */
async function setToggleNo(page: Page, labelRe: RegExp): Promise<void> {
  try {
    // Radio group named by the field label → click the "No" radio inside it.
    const group = page.getByRole("group", { name: labelRe }).first();
    if (await group.count()) {
      const radio = group.getByRole("radio", { name: SIT_TOGGLES.noOption }).first();
      if (await radio.count()) {
        await radio.check({ timeout: 3000 }).catch(() => {});
        return;
      }
    }
    // A stand-alone "No" radio labelled directly.
    const labelledNo = page.getByLabel(SIT_TOGGLES.noOption).first();
    if ((await labelledNo.count()) && (await labelledNo.isVisible().catch(() => false))) {
      await labelledNo.check({ timeout: 3000 }).catch(() => {});
      return;
    }
    // Custom combobox rendering (role=button → role=option list).
    await selectCombo(page, labelRe, SIT_TOGGLES.noOption).catch(() => {});
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
  // ~1+2+3+3+4+5 = ~18s across 6 attempts — tolerant of Zoho indexing lag
  // without stalling the worker on the submission hot path.
  const backoffMs = [1000, 2000, 3000, 3000, 4000, 5000];
  const started = Date.now();
  for (let i = 0; i < backoffMs.length; i++) {
    await sleep(page, backoffMs[i]);
    const elapsedS = () => Math.round((Date.now() - started) / 1000);
    if (by.email) {
      const r = await findStudent(page, { email: by.email });
      if (r.status === "found") {
        logger.info(
          `[sit] id poll: email ile bulundu (deneme=${i + 1}, ~${elapsedS()}s, id=${r.ref.id})`,
        );
        return r.ref.id;
      }
    }
    if (by.passportNumber) {
      const r = await findStudent(page, { passportNumber: by.passportNumber });
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
    const genderLabel = isFemale ? /female|kad/i : /male|erkek/i;

    // Track which files actually landed so the completeness gate below can refuse
    // to save a partial record. Each file is attached once, even across re-fills.
    const uploadedDocs = new Set<string>();
    let photoUploaded = false;

    // --- Walk up to 6 wizard steps, filling whatever is on screen ---
    for (let step = 0; step < 6; step++) {
      await sleep(page, 1500);
      await dismissInactivityModal(page);

      // Personal
      await fillField(page, SIT_STUDENT_FIELDS.firstName, profile.firstName);
      await fillField(page, SIT_STUDENT_FIELDS.lastName, profile.lastName);
      if (dob) await fillField(page, SIT_STUDENT_FIELDS.dateOfBirth, dob);
      await selectCombo(page, SIT_STUDENT_FIELDS.gender, genderLabel).catch(() => {});

      // Contact
      await fillField(page, SIT_STUDENT_FIELDS.email, profile.email);
      await fillField(page, SIT_STUDENT_FIELDS.phone, profile.phone);
      await fillField(page, SIT_STUDENT_FIELDS.address, profile.address);

      // Family
      await fillField(page, SIT_STUDENT_FIELDS.fatherName, profile.fatherName);
      await fillField(page, SIT_STUDENT_FIELDS.motherName, profile.motherName);

      // Identity / passport
      if (profile.nationality) {
        await selectCombo(
          page,
          SIT_STUDENT_FIELDS.nationality,
          new RegExp(fold(profile.nationality).slice(0, 12), "i"),
        ).catch(() => {});
      }
      await fillField(page, SIT_STUDENT_FIELDS.nationality, profile.nationality);
      await fillField(page, SIT_STUDENT_FIELDS.passportNumber, profile.passportNumber);
      if (passportIssue) {
        await fillField(page, SIT_STUDENT_FIELDS.passportIssueDate, passportIssue);
      }
      if (passportExpiry) {
        await fillField(page, SIT_STUDENT_FIELDS.passportExpiryDate, passportExpiry);
      }

      // "Have TC?" / "Transfer student?" — apply has neither → default to "No".
      await setToggleNo(page, SIT_TOGGLES.haveTc);
      await setToggleNo(page, SIT_TOGGLES.transferStudent);

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

      // Documents — attach each local file once, into its own slot.
      if (files.photo && !photoUploaded) {
        if (await uploadViaChooser(page, SIT_UPLOAD.photoTrigger, files.photo)) {
          photoUploaded = true;
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
      for (const [key, trig, docPath] of docJobs) {
        if (uploadedDocs.has(key)) continue;
        if (await uploadDocByType(page, trig, docPath)) uploadedDocs.add(key);
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
        // Zoho validation recovery: a banner means the step did not advance —
        // the next loop iteration re-fills it.
        if (SIT_ERRORS.validation.test(await bodyText(page))) {
          logger.warn("[sit] doğrulama hatası — adım yeniden denenecek");
        }
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
    const missingUploads: string[] = [];
    if (files.photo && !photoUploaded) missingUploads.push("foto");
    if (files.passport && !uploadedDocs.has("passport")) missingUploads.push("pasaport");
    if (files.transcript && !uploadedDocs.has("transcript")) {
      missingUploads.push("transkript");
    }
    if (files.diploma && !uploadedDocs.has("diploma")) missingUploads.push("diploma");
    if (missingUploads.length > 0) {
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
      if (SIT_ERRORS.serverError.test(txt)) {
        logger.warn(`[sit] kayıt sunucu hatası (deneme ${attempt + 1})`);
        continue;
      }
      if (SIT_ERRORS.validation.test(txt)) {
        logger.warn(`[sit] kayıt doğrulama hatası (deneme ${attempt + 1})`);
        continue;
      }
      saved = true;
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
    // Require at least one digit and reject wizard route words so a stray
    // /students/new never masquerades as a created id. Left UNVERIFIED → logged.
    const urlMatch = page.url().match(/\/students\/([0-9a-z][0-9a-z-]{5,})/i);
    const urlId = urlMatch?.[1];
    if (
      saved &&
      urlId &&
      /[0-9]/.test(urlId) &&
      !/^(new|create|add|edit)$/i.test(urlId)
    ) {
      logger.warn(
        "[sit] öğrenci id GraphQL ile doğrulanamadı — detay URL'den alındı " +
          `(id=${urlId}, DOĞRULANMADI)`,
      );
      return {
        studentId: urlId,
        created: saved,
        alreadyExists: false,
        createdViaWebhook: false,
      };
    }

    logger.warn("[sit] öğrenci kaydedildi ancak id çözülemedi");
    return {
      studentId: null,
      created: false,
      alreadyExists: duplicateSeen,
      createdViaWebhook: false,
      detail: duplicateSeen
        ? "öğrenci zaten mevcut ancak id doğrulanamadı"
        : saved
          ? "öğrenci kaydedildi ancak id doğrulanamadı"
          : "öğrenci kaydedilemedi",
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
