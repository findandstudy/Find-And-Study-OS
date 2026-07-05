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
        detail: "öğrenci oluşturulamadı: mükerrer kontrolü doğrulanamadı",
      };
    }
    if (existing.status === "found") {
      logger.info(
        `[sit] mevcut öğrenci bulundu (id=${existing.ref.id}) — yeniden kullanılıyor`,
      );
      return { studentId: existing.ref.id, created: false, alreadyExists: true };
    }

    // --- DRY: student does not exist → stop before any write ---
    if (!doSubmit) {
      logger.info("[sit] DRY: öğrenci webhook create öncesi durduruldu");
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
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
    // Absolutize + validate a URL for the external fetcher, logging one clear
    // diagnostic (redacted). Warns when the result is still non-http(s) (no
    // public base configured) or points at localhost (not reachable externally).
    const prepareAssetUrl = (label: string, raw: string): string => {
      const abs = absolutizeAssetUrl(raw);
      let warn = "";
      if (!/^https?:\/\//i.test(abs)) {
        warn =
          " (UYARI: mutlak http(s) URL yapılamadı — SIT_PUBLIC_ASSET_BASE ayarlayın; webhook çekemez)";
      } else if (isLocalHostUrl(abs)) {
        warn =
          " (UYARI: localhost adresi — harici webhook erişemez; public base ayarlayın)";
      }
      logger.info(`[sit] ${label}: ${redactUrl(abs)}${warn}`);
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
      transfer_student: false,
      have_tc: false,
      tc_number: "",
      blue_card: false,
      education_level: degreeId ?? undefined,
      education_level_name: appliedLevel,
      ...priorSchool,
      // Photo + documents are fetched by URL by the create webhook. When the
      // student has no URL-bearing documents these are "" / [] and the create
      // still succeeds (files can be attached later).
      photo_url: photoUrl,
      documents: sitDocuments,
    };

    logger.info("[sit] öğrenci webhook create başlatılıyor");
    const result = await createStudentViaWebhook(page, payload);
    if (!result) {
      return {
        studentId: null,
        created: false,
        alreadyExists: false,
        detail: "öğrenci oluşturulamadı: webhook create başarısız",
      };
    }
    logger.info(`[sit] öğrenci webhook ile oluşturuldu (id=${result.id})`);
    return { studentId: result.id, created: true, alreadyExists: false };
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
