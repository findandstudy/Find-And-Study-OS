// ---------------------------------------------------------------------------
// SIT portal adapter (partners.sitconnect.net)
//
// Production-grade Playwright adapter covering the 11 agreed universities.
// Capabilities:
//   - login + ensureLoggedIn (re-auth on /auth/login redirect)
//   - createStudent via the 6-step "Add Student" wizard (idempotent, filechooser
//     uploads, GPA normalization, Zoho validation recovery)
//   - createApplication (idempotent dedup, exact program match per university)
//
// Writes happen ONLY through the UI; SIT GraphQL is read-only (idempotency +
// catalog). The adapter satisfies the shared UniversityAdapter interface
// (login/submit) and additionally exposes typed createStudent/createApplication
// methods. Registered as experimental (never auto-submitted).
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
import { portalCreds, type ResolvedCreds } from "../../portalCreds.js";
import { fold, matchProgram, type ProgramCandidate } from "../../programMatch.js";
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
  listStudentApplications,
  fetchProgramCatalog,
  installSpaAuthCapture,
  mintSupabaseBearer,
} from "./graphql.js";

export { SIT_ALLOWLIST } from "./helpers.js";

// ---------------------------------------------------------------------------
// Result shapes for the extra typed methods.
// ---------------------------------------------------------------------------
export interface SitStudentResult {
  /** SIT student id when known (created or reused); null when unresolved. */
  studentId: string | null;
  created: boolean;
  alreadyExists: boolean;
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

// ---------------------------------------------------------------------------
// Small typed locator utilities (no `any`).
// ---------------------------------------------------------------------------
const sleep = (page: Page, ms: number): Promise<void> => page.waitForTimeout(ms);

async function bodyText(page: Page): Promise<string> {
  try {
    const txt = (await page.evaluate(
      "(() => document.body ? document.body.innerText : '')()",
    )) as string;
    return txt;
  } catch {
    return "";
  }
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

/** Fill a field located by accessible label, placeholder, or name fallback. */
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

/** Click a button by accessible name. Returns true when a click was issued. */
async function clickButton(page: Page, nameRe: RegExp): Promise<boolean> {
  const btn = page.getByRole("button", { name: nameRe }).first();
  if (await btn.count()) {
    await btn.click({ timeout: 8000 }).catch(() => {});
    return true;
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
 * Open a SIT custom combobox and click the option whose Turkish-FOLDED text
 * contains ALL of `wantTokens`. Unlike selectCombo (raw regex against raw
 * option text), this folds both sides so Turkish characters (İ/ı/ş/ç/ö/ğ/ü)
 * match reliably — e.g. target tokens [istanbul, aydin] pick the SIT option
 * "İstanbul Aydın Üniversitesi". Requiring FULL token coverage avoids
 * selecting a look-alike university. Returns true when an option was clicked.
 */
async function selectComboByTokens(
  page: Page,
  triggerRe: RegExp,
  wantTokens: readonly string[],
): Promise<boolean> {
  if (wantTokens.length === 0) return false;
  const trigger = page.getByRole("button", { name: triggerRe }).first();
  if (!(await trigger.count())) return false;
  await trigger.click({ timeout: 6000 }).catch(() => {});
  await sleep(page, 1000);

  const options = page.locator("[role=option], li[role=option]");

  // Collect every option that covers ALL wanted tokens on a TOKEN-BOUNDARY
  // basis (exact folded-token membership, not substring) so a distinctive
  // token like "kent" never matches inside "beykent".
  const collectMatches = async (): Promise<number[]> => {
    const n = await options.count().catch(() => 0);
    const matches: number[] = [];
    for (let i = 0; i < Math.min(n, 500); i++) {
      const raw = ((await options.nth(i).innerText().catch(() => "")) || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!raw) continue;
      const optTokens = new Set(fold(raw).split(" ").filter(Boolean));
      if (wantTokens.every((tok) => optTokens.has(tok))) {
        matches.push(i);
      }
    }
    return matches;
  };

  let fullMatches = await collectMatches();

  // Searchable-select support: SIT's university combo lazily renders its options
  // as you type. When nothing matched up front, type the most distinctive
  // (longest) token into the focused search box to load/filter the list, then
  // re-read. Best-effort — harmless if the combo isn't a typeahead.
  if (fullMatches.length === 0) {
    const search = [...wantTokens].sort((a, b) => b.length - a.length)[0];
    await page.keyboard.type(search, { delay: 25 }).catch(() => {});
    await sleep(page, 1300);
    fullMatches = await collectMatches();
  }

  // Exactly one option must cover every distinctive token. Zero = not in list;
  // more than one = genuinely ambiguous, so fail loud rather than risk picking
  // the wrong university.
  if (fullMatches.length === 1) {
    await options.nth(fullMatches[0]).click({ timeout: 3000 }).catch(() => {});
    await sleep(page, 1100);
    return true;
  }
  if (fullMatches.length > 1) {
    logger.warn(
      `[sit] ambiguous university options (${fullMatches.length}) for tokens: ${wantTokens.join(" ")}`,
    );
  } else {
    // Diagnostic: dump the option texts the UI actually offers so a name/spelling
    // mismatch (English vs Turkish, with/without "University") is visible in the
    // dry log and directly actionable.
    const n = await options.count().catch(() => 0);
    const avail: string[] = [];
    for (let i = 0; i < Math.min(n, 60); i++) {
      const t = ((await options.nth(i).innerText().catch(() => "")) || "")
        .replace(/\s+/g, " ")
        .trim();
      if (t) avail.push(t);
    }
    logger.warn(
      `[sit] university combo options (${avail.length}) for tokens [${wantTokens.join(
        " ",
      )}]: ${avail.join(" | ") || "(none)"}`,
    );
  }
  // Close the dropdown to avoid blocking later interactions.
  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

/** Read all visible option texts from an open combobox. */
async function readComboOptions(
  page: Page,
  triggerRe: RegExp,
): Promise<ProgramCandidate[]> {
  const trigger = page.getByRole("button", { name: triggerRe }).first();
  if (!(await trigger.count())) return [];
  await trigger.click({ timeout: 6000 }).catch(() => {});
  await sleep(page, 1000);

  const options = page.locator("[role=option], li[role=option]");
  const n = await options.count().catch(() => 0);
  const out: ProgramCandidate[] = [];
  for (let i = 0; i < Math.min(n, 500); i++) {
    const text = ((await options.nth(i).innerText().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push({ id: text, name: text });
  }
  await page.keyboard.press("Escape").catch(() => {});
  return out;
}

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

// ---------------------------------------------------------------------------
// Login internals.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Navigate to the student detail page for a known/looked-up student, or null.
// ---------------------------------------------------------------------------
async function openStudentDetail(
  page: Page,
  profile: SubmitProfile,
  studentId: string | null,
): Promise<boolean> {
  // --- Preferred path: direct navigation by the SIT student id. ---
  // This is the only way to GUARANTEE we operate on the intended student
  // (search + first-row click can land on the wrong record when the panel
  // returns multiple/stale matches).
  if (studentId) {
    await page.goto(
      `${SIT_URLS.base}${SIT_URLS.studentsPath}/${encodeURIComponent(studentId)}`,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    await sleep(page, 3000);
    if (SIT_NAV.studentDetailUrl.test(page.url())) return true;
    // Direct nav failed (id stale / route changed) — fall through to search,
    // but identity is then verified below before any click.
  }

  await page.goto(SIT_URLS.base + SIT_URLS.studentsPath, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await sleep(page, 4000);

  const email = (profile.email ?? "").trim();
  const passport = (profile.passportNumber ?? "").trim();
  const query = (
    email || `${profile.firstName ?? ""} ${profile.lastName ?? ""}`
  ).trim();
  const search = page.getByPlaceholder(SIT_NAV.searchPlaceholder).first();
  if ((await search.count()) && query) {
    await search.fill(query).catch(() => {});
    await sleep(page, 3000);
  }

  const row = page.locator("table tbody tr, [role=row]").first();
  if (!(await row.count())) return false;

  // Identity guard: only click when the row demonstrably belongs to this
  // student (its text contains the email or passport). Without a verifiable
  // identifier we refuse to click rather than risk the wrong student.
  const rowText = ((await row.innerText().catch(() => "")) || "").toLowerCase();
  const identifiable = Boolean(email) || Boolean(passport);
  const rowMatches =
    (email !== "" && rowText.includes(email.toLowerCase())) ||
    (passport !== "" && rowText.includes(passport.toLowerCase()));
  if (identifiable && !rowMatches) {
    logger.warn(
      "[sit] öğrenci satırı kimlik doğrulaması başarısız — yanlış öğrenci riskine karşı atlanıyor",
    );
    return false;
  }

  const info = row.locator(SIT_NAV.rowInfoSelector).first();
  if (await info.count()) {
    await info.click({ timeout: 5000 }).catch(() => {});
  } else {
    await row.click({ timeout: 3000 }).catch(() => {});
  }
  await sleep(page, 3000);
  return SIT_NAV.studentDetailUrl.test(page.url());
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
    // Start capturing the SPA's own Authorization header BEFORE login so it is
    // observed during the natural post-login navigation (used as the primary
    // GraphQL auth source — headless storage reads proved unreliable).
    installSpaAuthCapture(session.page);
    logger.info("[sit] login — navigating to portal");
    try {
      await performLogin(session.page, creds);
    } catch (err) {
      await session.close().catch(() => {});
      throw err;
    }
    // The headless SPA login does not reliably establish a Supabase session, so
    // mint an access_token directly from the SIT credentials (password grant).
    // This is the primary GraphQL auth source; non-fatal (falls back to passive
    // capture / storage read / UI scan on failure).
    await mintSupabaseBearer(session.page, creds).catch(() => false);
    return session;
  },

  /**
   * Re-authenticate if the session dropped (redirected to /auth/login). Safe to
   * call before every operation. Uses portalCreds(PORTAL_KEY), which returns the
   * runner-injected override during a submission.
   */
  async ensureLoggedIn(session: AdapterSession): Promise<void> {
    const page = session.page;
    installSpaAuthCapture(page); // idempotent — safe if login() already armed it
    if (!SIT_LOGIN.loginUrlMarker.test(page.url())) {
      // Probe the students route — a redirect back to login means expired.
      await page
        .goto(SIT_URLS.base + SIT_URLS.studentsPath, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        })
        .catch(() => {});
      await sleep(page, 2000);
    }
    if (SIT_LOGIN.loginUrlMarker.test(page.url())) {
      logger.warn("[sit] session expired — re-authenticating");
      await performLogin(page, portalCreds(PORTAL_KEY));
    }
    // Guarantee a Supabase Bearer for GraphQL before the first read-only call.
    // Idempotent (skips if already held) + non-fatal.
    await mintSupabaseBearer(page, portalCreds(PORTAL_KEY)).catch(() => false);
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

    // --- Idempotency: read-only GraphQL lookup ---
    const existing = await findStudent(page, {
      email: profile.email,
      passportNumber: profile.passportNumber,
    });
    if (existing) {
      logger.info(`[sit] mevcut öğrenci bulundu (id=${existing.id}) — yeniden kullanılıyor`);
      return { studentId: existing.id, created: false, alreadyExists: true };
    }

    // --- Open the Add Student wizard ---
    await page.goto(SIT_URLS.base + SIT_URLS.studentsPath, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await sleep(page, 3500);
    if (!(await clickButton(page, SIT_NAV.addStudentName))) {
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
        detail: "Add Student düğmesi bulunamadı",
      };
    }
    await sleep(page, 2000);

    const gpa = normalizeGpa(profile.gpa);
    const dob = formatSitDate(profile.dateOfBirth);
    const genderLabel = /^f|kad|woman|kız|kiz/i.test(profile.gender || "")
      ? /female|kad/i
      : /male|erkek/i;

    // --- Walk up to 6 wizard steps, filling whatever is on screen ---
    for (let step = 0; step < 6; step++) {
      await sleep(page, 1500);

      // Step 1 — Personal
      await fillField(page, SIT_STUDENT_FIELDS.firstName, profile.firstName);
      await fillField(page, SIT_STUDENT_FIELDS.lastName, profile.lastName);
      if (dob) await fillField(page, SIT_STUDENT_FIELDS.dateOfBirth, dob);
      await selectCombo(page, SIT_STUDENT_FIELDS.gender, genderLabel).catch(() => {});

      // Step 2 — Contact
      await fillField(page, SIT_STUDENT_FIELDS.email, profile.email);
      await fillField(page, SIT_STUDENT_FIELDS.phone, profile.phone);
      await fillField(page, SIT_STUDENT_FIELDS.address, profile.address);

      // Step 3 — Family
      await fillField(page, SIT_STUDENT_FIELDS.fatherName, profile.fatherName);
      await fillField(page, SIT_STUDENT_FIELDS.motherName, profile.motherName);

      // Step 4 — Identity
      if (profile.nationality) {
        await selectCombo(
          page,
          SIT_STUDENT_FIELDS.nationality,
          new RegExp(fold(profile.nationality).slice(0, 12), "i"),
        ).catch(() => {});
      }
      await fillField(page, SIT_STUDENT_FIELDS.nationality, profile.nationality);
      await fillField(page, SIT_STUDENT_FIELDS.passportNumber, profile.passportNumber);

      // Step 5 — Academics
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

      // Step 6 — Documents (filechooser uploads)
      if (files.photo) {
        await uploadViaChooser(page, SIT_UPLOAD.photoTrigger, files.photo);
      }
      for (const doc of [files.passport, files.transcript, files.diploma]) {
        if (doc) await uploadViaChooser(page, SIT_UPLOAD.attachmentTrigger, doc);
      }

      // Advance — try Next first; on the last step the Save button appears.
      const hasNext = await page
        .getByRole("button", { name: SIT_BUTTONS.next })
        .first()
        .count();
      if (hasNext) {
        await clickButton(page, SIT_BUTTONS.next);
        await sleep(page, 1800);
        // Zoho validation recovery: if a validation banner appears, the step did
        // not advance — re-fill happens on the next loop iteration.
        if (SIT_ERRORS.validation.test(await bodyText(page))) {
          logger.warn("[sit] doğrulama hatası — adım yeniden denenecek");
        }
        continue;
      }
      break;
    }

    if (!doSubmit) {
      logger.info("[sit] DRY: öğrenci kaydedilmeden önce durduruldu");
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
        detail: "dry-run: öğrenci kaydedilmedi",
      };
    }

    // --- Final save (with one Zoho-validation retry) ---
    let saved = false;
    for (let attempt = 0; attempt < 2 && !saved; attempt++) {
      await clickButton(page, SIT_BUTTONS.saveStudent);
      await sleep(page, 5000);
      const txt = await bodyText(page);
      if (SIT_ERRORS.duplicate.test(txt)) {
        logger.info("[sit] kayıt sırasında mükerrer tespit edildi");
        break;
      }
      if (SIT_ERRORS.validation.test(txt)) {
        logger.warn(`[sit] kayıt doğrulama hatası (deneme ${attempt + 1})`);
        continue;
      }
      saved = true;
    }

    // --- Resolve the new student id via read-only lookup ---
    const created = await findStudent(page, {
      email: profile.email,
      passportNumber: profile.passportNumber,
    });
    if (created) {
      logger.info(`[sit] öğrenci oluşturuldu (id=${created.id})`);
      return { studentId: created.id, created: saved, alreadyExists: !saved };
    }
    // Could not confirm via GraphQL — surface a soft result.
    const onDetail = SIT_NAV.studentDetailUrl.test(page.url());
    return {
      studentId: null,
      created: saved && onDetail,
      alreadyExists: false,
      detail: saved
        ? "öğrenci kaydedildi ancak id doğrulanamadı"
        : "öğrenci kaydedilemedi",
    };
  },

  /**
   * Create an application for a student at an allowed university + program.
   * Idempotent: skips when a matching (university, program) application already
   * exists. Program is matched exactly against the university-scoped catalog.
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

    // --- Dedup via read-only GraphQL ---
    if (studentId) {
      const apps = await listStudentApplications(page, studentId);
      const dup = apps.find(
        (a) =>
          a.universityName &&
          matchAllowedUniversity(a.universityName) === allowedUni &&
          a.programName &&
          fold(a.programName) === fold(profile.programName),
      );
      if (dup) {
        logger.info(
          `[sit] mevcut başvuru bulundu (id=${dup.id}) — mükerrer oluşturulmayacak`,
        );
        return { ...base, alreadyExists: true, externalRef: dup.id };
      }
    }

    // --- Resolve the exact program from the university-scoped catalog ---
    const level = mapEducationLevel(profile.level);
    let catalog = await fetchProgramCatalog(page, allowedUni, level);

    // --- Open the student detail + Add Application dialog ---
    if (!(await openStudentDetail(page, profile, studentId))) {
      return { ...base, detail: "öğrenci detay sayfası açılamadı" };
    }
    if (!(await clickButton(page, SIT_NAV.addApplicationName))) {
      return { ...base, detail: "Add Application düğmesi bulunamadı" };
    }
    await sleep(page, 2500);

    // Year / semester (best-effort first option).
    for (const re of [SIT_APP_FIELDS.academicYear, SIT_APP_FIELDS.semester]) {
      const trigger = page.getByRole("button", { name: re }).first();
      if (await trigger.count()) {
        await trigger.click({ timeout: 4000 }).catch(() => {});
        await sleep(page, 800);
        const opt = page.getByRole("option").first();
        if (await opt.count()) await opt.click({ timeout: 3000 }).catch(() => {});
        await sleep(page, 900);
      }
    }

    // Country + university (university constrained to the allowlist entry).
    // Match SIT's live option list Turkish-aware (folded token coverage) so the
    // canonical name "İstanbul Aydın Üniversitesi" selects the right option even
    // when its text carries Turkish characters.
    await selectCombo(page, SIT_APP_FIELDS.country, /turk/i);
    const uniTokens = distinctiveTokens(allowedUni);
    const uniSelected = await selectComboByTokens(
      page,
      SIT_APP_FIELDS.university,
      uniTokens,
    );
    if (!uniSelected) {
      logger.warn(
        `[sit] university not found in SIT list: "${allowedUni}" (tried: ${uniTokens.join(" ")})`,
      );
      // Failing to select the university in the live combobox is a university
      // error, not a missing program — keep programMissing=false (from `base`).
      return {
        ...base,
        detail: `SIT üniversite listesinde bulunamadı: ${allowedUni}`,
      };
    }
    await selectCombo(page, SIT_APP_FIELDS.degree, new RegExp(level, "i"));

    // If GraphQL catalog was empty, scan the program combobox options instead.
    if (catalog.length === 0) {
      catalog = await readComboOptions(page, SIT_APP_FIELDS.program);
    }

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
    if (catalog.length > 0 && langFiltered.length === 0) {
      logger.warn(
        `[sit] program dil uyumsuz: "${profile.programName}" — ${catalog.length} adayın hiçbiri dil uyumlu değil`,
      );
      return {
        ...base,
        programMissing: true,
        detail: `Program bulunamadı: "${profile.programName}" — dil uyumlu aday yok (${catalog.length} aday farklı dilde)`,
      };
    }
    const pool = langFiltered;
    const match = matchProgram(profile.programName, pool, {
      nameMap: profile.programNameMap,
      nameMapGeneral: profile.programNameMapGeneral,
      synonyms: profile.programSynonyms,
    });

    if (!match) {
      logger.warn(
        `[sit] program eşleşmedi: "${profile.programName}" (${pool.length} aday)`,
      );
      return {
        ...base,
        programMissing: true,
        detail: `Program bulunamadı: "${profile.programName}" — ${pool.length} aday arasında güvenli eşleşme yok`,
      };
    }
    logger.info(
      `[sit] program eşleşti: "${match.match.name}" (güven=${match.conf.toFixed(2)})`,
    );

    const picked = await selectCombo(
      page,
      SIT_APP_FIELDS.program,
      new RegExp(
        match.match.name.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      ),
    );
    if (!picked) {
      return {
        ...base,
        programMissing: true,
        detail: `Program seçilemedi: "${match.match.name}"`,
      };
    }

    if (!doSubmit) {
      logger.info("[sit] DRY: Create Application öncesi durduruldu");
      return { ...base, detail: "dry-run: başvuru oluşturulmadı" };
    }

    if (!(await clickButton(page, SIT_BUTTONS.createApplication))) {
      return { ...base, detail: "Create Application düğmesi bulunamadı" };
    }
    await sleep(page, 6000);

    const after = await bodyText(page);
    if (SIT_ERRORS.duplicate.test(after)) {
      return { ...base, alreadyExists: true };
    }
    return { ...base, submitted: true };
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
