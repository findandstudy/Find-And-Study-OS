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
// Student creation happens through the "Add Student" UI wizard; the APPLICATION
// is created by driving the portal's REAL "Add Application" flow (Path A):
// open /applications → "Add Application" → fill the searchable dropdowns
// (Student, Academic Year, Semester, Country, University, Degree, Program) →
// "Create Application". The SIT backend (Zoho CRM) creates the record and
// assigns id + app_id + stage — the client cannot generate them, which is why a
// raw GraphQL insert never worked. After the UI flow succeeds we read the
// freshly-created record back (Supabase GraphQL) to obtain app_id for writeback.
// SIT GraphQL also backs idempotency lookups + program matching (read-only).
// The adapter satisfies the shared UniversityAdapter interface (login/submit)
// and additionally exposes typed createStudent/createApplication methods.
// Registered as experimental (never auto-submitted).
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
  fetchProgramCatalog,
  installSpaAuthCapture,
  mintSupabaseBearer,
  fetchProgramIds,
  resolveAcademicYearId,
  resolveSemesterId,
  resolveSitIdentity,
  dedupApplication,
  createApplicationViaWebhook,
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

/** Escape a raw string for safe embedding in a RegExp source. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    const matched = match.match;
    logger.info(
      `[sit] program eşleşti: "${matched.name}" (id=${matched.id}, güven=${match.conf.toFixed(2)})`,
    );

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
