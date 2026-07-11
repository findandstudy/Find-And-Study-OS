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
  SIT_APP_FIELDS,
  SIT_BUTTONS,
  SIT_UPLOAD,
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
 * Navigate to THIS student's detail page and prove we are on the right record
 * before any upload. Two strategies, both identity-verified:
 *   1. Deterministic — direct URL from the resolved studentId, then verify.
 *   2. Fallback — list search by email + row-info click, then verify.
 *
 * Identity verification is MANDATORY: we only return true when the detail page
 * demonstrably belongs to this student (its email or passport is present on the
 * page). Otherwise we return false so the caller ABORTS the upload — uploading
 * to the wrong row would cross-associate one student's personal documents with
 * another's, which is far worse than a missing document.
 */
async function openStudentDetail(
  page: Page,
  by: { email?: string; passportNumber?: string; studentId?: string },
): Promise<boolean> {
  const isOnDetailPage = (): boolean =>
    SIT_NAV.studentDetailUrl.test(page.url());

  const verifyIdentity = async (): Promise<boolean> => {
    if (!isOnDetailPage()) return false;
    let body = "";
    try {
      body = (await page.content()).toLowerCase();
    } catch {
      return false;
    }
    if (by.email && body.includes(by.email.toLowerCase())) return true;
    if (
      by.passportNumber &&
      body.includes(by.passportNumber.toLowerCase())
    ) {
      return true;
    }
    return false;
  };

  try {
    // 1) Deterministic: navigate directly by the resolved id, then verify.
    if (by.studentId) {
      await page
        .goto(
          `${SIT_URLS.base}${SIT_URLS.studentsPath}/${by.studentId}`,
          { waitUntil: "domcontentloaded", timeout: 30000 },
        )
        .catch(() => {});
      await sleep(page, 2000);
      if (await verifyIdentity()) return true;
      logger.warn(
        "[sit] wizard upload: doğrudan id ile detay doğrulanamadı — arama ile deneniyor",
      );
    }

    // 2) Fallback: search by email, open the row, then verify identity.
    await page.goto(SIT_URLS.base + SIT_URLS.studentsPath, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(page, 1500);

    if (by.email) {
      const search = page.getByPlaceholder(SIT_NAV.searchPlaceholder).first();
      if (await search.count()) {
        await search.fill(by.email).catch(() => {});
        await sleep(page, 2500);
      }
    }

    const info = page.locator(SIT_NAV.rowInfoSelector).first();
    if (await info.count()) {
      await info.click({ timeout: 6000 }).catch(() => {});
      await page
        .waitForURL(SIT_NAV.studentDetailUrl, { timeout: 8000 })
        .catch(() => {});
    }

    if (await verifyIdentity()) return true;

    logger.warn(
      "[sit] wizard upload: öğrenci kimliği doğrulanamadı (email/passport eşleşmedi) — " +
        "yükleme İPTAL edildi (yanlış karta belge yazma riski)",
    );
    return false;
  } catch (err) {
    logger.warn(
      `[sit] öğrenci detay açma hatası — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

/**
 * Best-effort: if the detail page hides uploads behind a "Documents" tab/section,
 * reveal it. Silent no-op when no such control exists.
 */
async function revealDocumentsSection(page: Page): Promise<void> {
  const sectionRe = /documents|belge|attachments|dosya|files/i;
  try {
    const tab = page.getByRole("tab", { name: sectionRe }).first();
    if (await tab.count()) {
      await tab.click({ timeout: 4000 }).catch(() => {});
      await sleep(page, 1000);
      return;
    }
    const btn = page.getByRole("button", { name: sectionRe }).first();
    if (await btn.count()) {
      await btn.click({ timeout: 4000 }).catch(() => {});
      await sleep(page, 1000);
    }
  } catch {
    /* best-effort — never fatal */
  }
}

/**
 * Upload the locally-downloaded photo + attachment files to a freshly-created
 * SIT student's detail page. Best-effort, non-fatal; logs a clear
 * `[sit] wizard upload: N/M belge ok, foto=…` summary.
 */
async function uploadStudentDocuments(
  page: Page,
  by: { email?: string; passportNumber?: string; studentId?: string },
  files: SubmitFiles,
): Promise<void> {
  const attachments = [
    files.passport ? { label: "passport", path: files.passport } : null,
    files.transcript ? { label: "transcript", path: files.transcript } : null,
    files.diploma ? { label: "diploma", path: files.diploma } : null,
  ].filter((a): a is { label: string; path: string } => a !== null);

  if (!files.photo && attachments.length === 0) {
    logger.info("[sit] wizard upload: yerel belge/foto yok — atlanıyor");
    return;
  }

  const opened = await openStudentDetail(page, by);
  if (!opened) {
    logger.warn(
      "[sit] wizard upload: öğrenci detay sayfası açılamadı — belge/foto YÜKLENEMEDİ " +
        "(öğrenci+başvuru oluştu, belgeler eksik kaldı)",
    );
    return;
  }

  await revealDocumentsSection(page);

  let ok = 0;
  for (const a of attachments) {
    try {
      const done = await uploadViaChooser(page, SIT_UPLOAD.attachmentTrigger, a.path);
      if (done) {
        ok++;
        logger.info(`[sit] wizard upload: ${a.label} yüklendi`);
      } else {
        logger.warn(
          `[sit] wizard upload: ${a.label} için yükleme alanı bulunamadı`,
        );
      }
      await sleep(page, 1200);
    } catch (err) {
      logger.warn(
        `[sit] wizard upload: ${a.label} HATA — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  let photoStr = "yok";
  if (files.photo) {
    try {
      const done = await uploadViaChooser(page, SIT_UPLOAD.photoTrigger, files.photo);
      photoStr = done ? "ok" : "HATA";
      await sleep(page, 1200);
    } catch (err) {
      photoStr = "HATA";
      logger.warn(
        `[sit] wizard upload: foto HATA — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Best-effort save if the detail page requires an explicit save after uploads.
  await clickButton(page, SIT_BUTTONS.saveStudent).catch(() => false);

  logger.info(
    `[sit] wizard upload: ${ok}/${attachments.length} belge ok, foto=${photoStr}`,
  );
}

// ---------------------------------------------------------------------------
// Login internals.
// ---------------------------------------------------------------------------
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
    if (await mintSupabaseBearer(page, creds).catch(() => false)) return;

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

    // --- DRY: student does not exist → stop before any write ---
    if (!doSubmit) {
      logger.info("[sit] DRY: öğrenci webhook create öncesi durduruldu");
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
        createdViaWebhook: false,
        detail: "dry-run: öğrenci oluşturulmadı",
      };
    }

    // --- REAL: create the student via the panel's true mechanism ---
    // The SIT "Add Student" 6-step wizard (dropdowns/date-picker/filechooser) is
    // automation-hostile; the panel's real student-create is a JSON POST to a
    // dedicated n8n webhook that returns the Zoho-assigned id. We resolve the
    // agency identity dynamically (never hardcoded) and POST the same fields the
    // wizard used to fill.
    const identity = await resolveSitIdentity(page);
    if (!identity || !identity.agencyId || !identity.crmId) {
      logger.warn("[sit] acente kimliği (user_id/agency_id/crm_id) çözülemedi");
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
        createdViaWebhook: false,
        detail:
          "öğrenci oluşturulamadı: acente kimliği (user_id/agency_id/crm_id) çözülemedi",
      };
    }

    const appliedLevel = mapEducationLevel(profile.level);
    const gpa = normalizeGpa(profile.gpa);
    const gpaStr = gpa !== undefined ? String(gpa) : undefined;

    // Nationality is a Zoho dropdown → the webhook expects the zoho_countries
    // ROW ID, not the plain name ("Pakistan" alone → INVALID_DATA: Nationality1).
    // Resolve name→id; if it can't be resolved we send it empty (undefined) and
    // still attempt the create, logging the miss clearly so it isn't silent.
    const nationalityId = await resolveCountryId(page, profile.nationality);
    logger.info(
      `[sit] nationality: ${
        profile.nationality ? `"${profile.nationality}"` : "(boş)"
      } → ${nationalityId ?? "NOT_FOUND"}`,
    );

    // education_level is the zoho_degrees ROW ID of the APPLIED-FOR degree — a
    // plain label makes the webhook reject the create with
    // `INVALID_DATA: Student_will_apply_for`. Resolve the id from the degree
    // label; on a miss we send it empty (never throw) and log clearly.
    const degreeId = await resolveDegreeId(page, appliedLevel);
    logger.info(
      `[sit] apply-for degree: "${appliedLevel}" → ${degreeId ?? "NOT_FOUND"}`,
    );

    // Previous-education fields are keyed by the APPLIED level: an applicant for
    // a Bachelor lists a high school, a Master applicant lists a bachelor, etc.
    // The prior-school *_country is a zoho_countries ROW ID; the CRM does not
    // capture where the prior school was, so we fall back to the student's
    // nationality country (best available signal), else leave it empty.
    const eduCountryId = nationalityId ?? undefined;
    const priorSchool: Pick<
      SitStudentWebhookPayload,
      | "high_school_name"
      | "high_school_gpa_percent"
      | "high_school_country"
      | "bachelor_school_name"
      | "bachelor_gpa_percent"
      | "bachelor_country"
      | "master_school_name"
      | "master_gpa_percent"
      | "master_country"
    > = {};
    if (appliedLevel === "Master") {
      priorSchool.bachelor_school_name = profile.schoolName;
      priorSchool.bachelor_gpa_percent = gpaStr;
      priorSchool.bachelor_country = eduCountryId;
    } else if (appliedLevel === "PhD") {
      priorSchool.master_school_name = profile.schoolName;
      priorSchool.master_gpa_percent = gpaStr;
      priorSchool.master_country = eduCountryId;
    } else {
      // Bachelor / Associate → the prior institution is a high school.
      priorSchool.high_school_name = profile.schoolName;
      priorSchool.high_school_gpa_percent = gpaStr;
      priorSchool.high_school_country = eduCountryId;
    }

    logger.info(
      `[sit] eğitim: level="${appliedLevel}" okul="${profile.schoolName ?? ""}"` +
      ` gpa=${gpaStr ?? "(yok)"} ülke=${eduCountryId ?? "(yok)"}`,
    );

    // Photo + documents: the SIT create webhook fetches these by URL, so we send
    // the student's CRM document URLs (carried on the profile by the profile
    // builder, which has DB access). Local SubmitFiles paths are NOT usable here.
    // Every source is logged (query string dropped so signed-URL tokens are never
    // logged); missing/unfetchable data is logged but never blocks the create.
    const redactUrl = (u: string): string => {
      try {
        const parsed = new URL(u);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return u.split("?")[0];
      }
    };
    // Our own session-gated asset routes: fetchable by an external, cookie-less
    // webhook ONLY when they carry a valid HMAC signature (?exp=&sig=). An
    // UNSIGNED such URL 401/403's for the webhook (the exact reason documents /
    // photo silently fail to land in SIT). We surface signed-ness explicitly so
    // the true failure mode is visible in the worker log (redactUrl hides the
    // sig value, so previously you could not tell signed from bare).
    const isSessionGatedAssetRoute = (u: string): boolean =>
      /\/api\/documents\/\d+\/file(?:$|[?#])/.test(u) ||
      /\/api\/students\/\d+\/photo(?:$|[?#])/.test(u);
    const isSignedAssetUrl = (u: string): boolean => /[?&]sig=/.test(u);
    // Absolutize + validate a URL for the external fetcher, logging one clear
    // diagnostic (redacted). Warns when the result is still non-http(s) (no
    // public base configured), points at localhost (not reachable externally),
    // or is an UNSIGNED session-gated route (webhook will 401/403).
    const prepareAssetUrl = (label: string, raw: string): string => {
      const abs = absolutizeAssetUrl(raw);
      const signed = isSignedAssetUrl(abs);
      let warn = "";
      if (!/^https?:\/\//i.test(abs)) {
        warn =
          " (UYARI: mutlak http(s) URL yapılamadı — SIT_PUBLIC_ASSET_BASE ayarlayın; webhook çekemez)";
      } else if (isLocalHostUrl(abs)) {
        warn =
          " (UYARI: localhost adresi — harici webhook erişemez; public base ayarlayın)";
      } else if (isSessionGatedAssetRoute(abs) && !signed) {
        warn =
          " (UYARI: oturum-korumalı asset yolu İMZASIZ — webhook 401/403 alır; ASSET_URL_SIGNING_SECRET worker ve api-server'da AYNI olmalı)";
      }
      logger.info(
        `[sit] ${label}: ${redactUrl(abs)} [imzalı=${signed ? "evet" : "hayır"}]${warn}`,
      );
      return abs;
    };

    const photoUrl = profile.photoUrl?.trim()
      ? prepareAssetUrl("photo_url", profile.photoUrl.trim())
      : "";
    if (!photoUrl) logger.info("[sit] photo_url: (yok)");

    const sitDocuments = (profile.studentDocuments ?? [])
      .filter((d) => !!d.url)
      .map((d) => {
        const url = prepareAssetUrl(`belge type=${d.type}`, d.url);
        const entry: Record<string, unknown> = {
          attachment_type: d.type,
          url,
          size: d.size ?? 0,
        };
        if (d.name) entry.name = d.name;
        if (d.mime) entry.mime_type = d.mime;
        return entry;
      });
    // Both the wizard and the create webhook require at least one Passport and at
    // least one HighSchool transcript. We cannot fabricate documents, so we log a
    // clear warning when either is absent (never block the create).
    const docTypesFolded = (profile.studentDocuments ?? []).map((d) =>
      fold(d.type),
    );
    const hasPassport = docTypesFolded.some((t) => /passport|pasaport/.test(t));
    const hasTranscript = docTypesFolded.some((t) =>
      /transcript|marks|marksheet|result|grade|hsc/.test(t),
    );
    logger.info(
      `[sit] documents: ${sitDocuments.length} adet` +
      (sitDocuments.length
        ? ` [${(profile.studentDocuments ?? []).map((d) => d.type).join(", ")}]`
        : "") +
      ` (passport=${hasPassport ? "var" : "YOK"}, transcript=${hasTranscript ? "var" : "YOK"})`,
    );
    if (!hasPassport)
      logger.warn(
        "[sit] UYARI: Passport belgesi yok — SIT create için gerekli (yine de denenecek)",
      );
    if (!hasTranscript)
      logger.warn(
        "[sit] UYARI: HighSchool transcript belgesi yok — SIT create için gerekli (yine de denenecek)",
      );

    // GUARD: never POST a create with zero fetchable assets. Historically an
    // unsigned/self-referential asset URL silently produced a student with no
    // photo/documents in Zoho (the webhook's URL fetch 401/403'd, but the
    // create itself still "succeeded"). Now that URLs are always genuine
    // public links or signed endpoint links (see profile.ts / prepareAssetUrl
    // above), zero assets means the student genuinely has nothing uploaded —
    // skip explicitly with a clear detail rather than create an empty record.
    if (!photoUrl && sitDocuments.length === 0) {
      logger.warn(
        "[sit] öğrenci ATLANDI: photo_url ve documents boş — sıfır belgeli SIT create engellendi",
      );
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
        createdViaWebhook: false,
        detail: "öğrenci oluşturulamadı: fotoğraf/belge yok (sıfır-belge koruması)",
      };
    }

    const payload: SitStudentWebhookPayload = {
      user_id: identity.userId,
      agency_id: identity.agencyId,
      crm_id: identity.crmId,
      first_name: profile.firstName,
      last_name: profile.lastName,
      gender: profile.gender || undefined,
      date_of_birth: isoDateOnly(profile.dateOfBirth),
      nationality: nationalityId ?? undefined,
      email: profile.email,
      mobile: profile.phone || undefined,
      passport_number: profile.passportNumber || undefined,
      passport_issue_date: isoDateOnly(profile.passportIssueDate),
      passport_expiry_date: isoDateOnly(profile.passportExpiryDate),
      father_name: profile.fatherName || undefined,
      mother_name: profile.motherName || undefined,
      // Webhook types these as String — send lowercase "no"/"yes" (a boolean
      // makes the panel read them as truthy "Yes"). apply has no such data → "no".
      transfer_student: "no",
      have_tc: "no",
      tc_number: "",
      blue_card: "no",
      // Residence country is a zoho_countries ROW ID (same dropdown contract as
      // nationality); apply has no explicit residence, so fall back to nationality.
      country_of_residence: nationalityId ?? undefined,
      education_level: degreeId ?? undefined,
      education_level_name: appliedLevel,
      ...priorSchool,
      // Photo + documents are fetched by URL by the create webhook. When the
      // student has no URL-bearing documents these are "" / "[]" and the create
      // still succeeds (files can be attached later). `documents` is a JSON STRING
      // ($documents: String) — a raw array can't be parsed by the webhook.
      photo_url: photoUrl,
      documents: JSON.stringify(sitDocuments),
    };

    // Gönderim öncesi TEK-satır özet: create'ten önce foto/belge/pasaport/bilgi
    // durumunu tek bakışta gör (canlı create doğrulaması — dry program adımında
    // durduğu için bu log yalnız canlı gönderimde çıkar). NOT: SIT webhook
    // payload'ında dil skoru alanı YOK; profile.languageScore yalnız teşhis için.
    // imza-secret: whether THIS (worker) process can HMAC-sign asset URLs. When
    // "YOK", session-gated documents are dropped by the profile builder and the
    // photo is left unsigned → SIT can't fetch them. When "var" but SIT still
    // shows 0 documents/photo, the worker and api-server secrets DIFFER (verify
    // fails) — align ASSET_URL_SIGNING_SECRET (or SESSION_SECRET) on both.
    const assetSecretConfigured = getAssetSigningSecret().length > 0;
    logger.info(
      `[sit] CREATE payload → documents=${sitDocuments.length} ` +
      `(passport=${hasPassport ? "var" : "YOK"}, transcript=${hasTranscript ? "var" : "YOK"}) ` +
      `photo=${photoUrl ? "var" : "YOK"} ` +
      `imza-secret=${assetSecretConfigured ? "var" : "YOK"} ` +
      `passportNo=${payload.passport_number ? "var" : "YOK"} ` +
      `issue=${payload.passport_issue_date || "-"} expiry=${payload.passport_expiry_date || "-"} ` +
      `lang=${profile.languageScore ?? "-"}`,
    );
    logger.info("[sit] öğrenci webhook create başlatılıyor");
    const result = await createStudentViaWebhook(page, payload);
    if (result?.id) {
      logger.info(`[sit] öğrenci webhook ile oluşturuldu (id=${result.id})`);
      return {
        studentId: result.id,
        created: true,
        alreadyExists: false,
        createdViaWebhook: true,
      };
    }

    // The create webhook persists the student ASYNCHRONOUSLY in Zoho and its
    // synchronous response frequently returns before the new id is queryable (or
    // with a non-{status:true,id} body → createStudentViaWebhook returns null).
    // Without the id the application step aborts ("öğrenci id çözümlenemedi") and
    // the record is left half-created (student exists, no application, docs not
    // attached). Poll GraphQL with an increasing backoff (same lookup used for
    // pre-create dedup) to resolve the async-assigned id before giving up; on a
    // match we continue as a successful create.
    logger.warn(
      "[sit] webhook create yanıtında id yok — Zoho async olabilir, id poll ediliyor",
    );
    const polledId = await resolveCreatedStudentId(page, {
      email: profile.email,
      passportNumber: profile.passportNumber,
    });
    if (polledId) {
      logger.info(`[sit] öğrenci create sonrası id çözüldü (id=${polledId})`);
      // The create webhook DID fire for a brand-new record this run; the id was
      // just resolved via the async post-create poll rather than the webhook's
      // synchronous body. This is still a fresh create → createdViaWebhook=true
      // so the document/photo upload runs (the whole point of the poll fix).
      return {
        studentId: polledId,
        created: true,
        alreadyExists: false,
        createdViaWebhook: true,
      };
    }
    // The webhook fired but we never resolved an id (Zoho indexing lag beyond
    // the poll budget). Without an id neither upload nor the application step
    // can proceed → treat as a failed create. createdViaWebhook stays false per
    // the contract (every failure path is false); the guard also requires a
    // non-null studentId, so this could never trigger an upload regardless.
    return {
      studentId: null,
      created: false,
      alreadyExists: false,
      createdViaWebhook: false,
      detail: "öğrenci oluşturulamadı: webhook create başarısız (id çözülemedi)",
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

    // Attach the locally-downloaded photo + documents to the SIT student card.
    // The create webhook does NOT ingest the `documents`/`photo_url` URL fields,
    // so the ONLY way files reach the card is the browser file-chooser upload
    // (restored from the removed wizard). Runs right after the student id is
    // resolved and BEFORE createApplication (which is webhook-driven and does not
    // depend on page URL). Fresh-create only (a just-created student has no docs,
    // so no duplicate risk) and never in DRY. Non-fatal: the student is already
    // created and the application step still runs; a failure is logged loudly.
    if (effectiveSubmit && student.createdViaWebhook && student.studentId) {
      try {
        await uploadStudentDocuments(
          session.page,
          {
            email: profile.email,
            passportNumber: profile.passportNumber,
            studentId: student.studentId,
          },
          files,
        );
      } catch (err) {
        logger.warn(
          `[sit] wizard upload: beklenmeyen hata — belge/foto YÜKLENEMEDİ: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } else if (effectiveSubmit && student.alreadyExists) {
      logger.info(
        "[sit] wizard upload: öğrenci zaten mevcut — belge/foto backfill atlandı " +
          "(mükerrer belge riskine karşı; SIT'te update webhook yok, gerekirse manuel eklenir)",
      );
    }

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
