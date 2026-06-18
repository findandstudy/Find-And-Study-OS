import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
  LoginOpts,
} from "../../types.js";
import { launchPortal, logger } from "../../browser.js";
import { portalCreds } from "../../portalCreds.js";
import { fold } from "../../programMatch.js";

// ---------------------------------------------------------------------------
// United portal allowlist — EXACTLY 3 universities (do not add/remove)
// Credentials: UNITED_USER + UNITED_PASSWORD (or inject via opts.credentials)
// ---------------------------------------------------------------------------
export const UNITED_ALLOWLIST: readonly string[] = [
  "Biruni Üniversitesi",
  "Nişantaşı Üniversitesi",
  "Ankara Bilim Üniversitesi",
] as const;

/** Pre-folded entries for fast matches() lookup. */
const UNITED_ALLOWLIST_FOLDED: readonly string[] = UNITED_ALLOWLIST.map(fold);

const PORTAL_URL = "https://partner.unitededucation.com"; // TODO: confirm URL

export const unitedAdapter: UniversityAdapter = {
  key:       "united",
  label:     "United Portal",
  allowlist: [...UNITED_ALLOWLIST],

  matches(name: string): boolean {
    const f = fold(name);
    return UNITED_ALLOWLIST_FOLDED.some(entry => f.includes(entry) || entry.includes(f));
  },

  async login(opts?: LoginOpts): Promise<AdapterSession> {
    const { user, password } = opts?.credentials ?? portalCreds("united");
    const session = await launchPortal({ headless: opts?.headless ?? true });
    logger.info("[united] login — navigating to portal");

    const page: any = session.page;
    try {
      await page.goto(PORTAL_URL + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
      await page.locator("input[name*=user i], input[placeholder*=user i], input[id*=user i], input[type=text]").first().fill(user);
      await page.locator("input[type=password]").first().fill(password);
      await page.getByRole("button", { name: /sign ?in|log ?in|giris/i }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(6000);
      if (await page.locator("input[type=password]").first().isVisible().catch(() => false)) throw new Error("[united] login failed - wrong creds or captcha");
      logger.info("[united] login successful -> " + page.url());
    } catch (err) { await session.close().catch(() => {}); throw err; }
    return session;
  },

  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    _files: SubmitFiles,
  ): Promise<SubmitResult> {
    logger.info("[united] submit — program:", profile.programName);
    const page: any = session.page;
    const dryRun = process.env.PORTAL_DRYRUN === "1";
    const result: any = { alreadyExists: false, submitted: false, programMissing: false };
    const wait = (ms: number) => page.waitForTimeout(ms);
    // Select a native <select> by id, choosing the option whose text contains `want` (else first real option). Returns true if `want` matched.
    const selById = async (id: string, want?: string): Promise<boolean> => {
      try {
        const loc = page.locator("#" + id);
        if (!(await loc.count())) return false;
        const opts = (await loc.locator("option").allInnerTexts().catch(() => [])) as string[];
        const w = String(want || "").toLowerCase().trim();
        let idx = -1, matched = false;
        if (w) { idx = opts.findIndex((o) => o.toLowerCase().includes(w)); if (idx >= 0) matched = true; }
        if (idx < 0) idx = opts.findIndex((o) => o.trim() && !/^(please\s+)?select/i.test(o.trim()));
        if (idx >= 0) { await loc.selectOption({ index: idx }).catch(() => {}); await wait(800); }
        return matched;
      } catch (e) { return false; }
    };
    // Scan all selects, pick the one with an option matching `re`, select it.
    const selByOpt = async (re: RegExp): Promise<boolean> => {
      try {
        const sels = page.locator("select");
        const n = await sels.count();
        for (let i = 0; i < n; i++) {
          const sl = sels.nth(i);
          const opts = (await sl.locator("option").allInnerTexts().catch(() => [])) as string[];
          const idx = opts.findIndex((o) => re.test(o));
          if (idx >= 0) { await sl.selectOption({ index: idx }).catch(() => {}); await wait(800); return true; }
        }
      } catch (e) {}
      return false;
    };
    const clickContinue = async (): Promise<boolean> => {
      let b = page.getByRole("button", { name: /continue|next|ileri|devam/i }).first();
      if (await b.count()) { await b.click({ timeout: 8000 }).catch(() => {}); await wait(2800); return true; }
      b = page.locator("button:has-text('Continue'), a:has-text('Continue'), input[value*='Continue' i]").first();
      if (await b.count()) { await b.click({ timeout: 8000 }).catch(() => {}); await wait(2800); return true; }
      return false;
    };
    try {
      await page.goto(PORTAL_URL + "/Manage/newapplication", { waitUntil: "domcontentloaded", timeout: 60000 });
      await wait(5000);
      const txt0 = (await page.evaluate("(()=>document.body?document.body.innerText:'')()")) as string;
      if (/already.*application|zaten.*basvuru/i.test(txt0)) { result.alreadyExists = true; logger.warn("[united] already has application"); return result; }
      // Step 1 — Term Selection: student type + destination
      await selByOpt(/new student/i);
      await selByOpt(/t\u00fcrkiye|turkiye/i);
      await clickContinue();
      // Step 2 — Degree Selection
      await selById("selectdegree", profile.level || "Bachelor");
      await clickContinue();
      // Step 3 — Program Selection (cascading: university → program)
      await selById("selectuniversity", profile.universityName);
      await wait(1500);
      const progMatched = await selById("selectprogram", profile.programName);
      await selById("selectlang");
      await selById("selectcampus");
      result.programMissing = !!(profile.programName && !progMatched);
      await clickContinue();
      await wait(2500);
      // We should now be at Step 4 — Personal Information.
      const atPersonal = await page.locator("#firstname, #lastname").first().count().catch(() => 0);
      if (dryRun) {
        result.dryReachedFinal = !!atPersonal;
        if (!atPersonal) { result.stuckStep = 3; result.stuckBody = (await page.evaluate("(()=>document.body?document.body.innerText:'')()")).replace(/\s+/g, " ").slice(0, 220); }
        logger.warn("[united] DRY: reached Program→Personal boundary (atPersonal=" + atPersonal + "); stopping before Personal Information — no student created");
        return result;
      }
      // ===== REAL submission (requires explicit approval; first-real gating handled by worker) =====
      const fill = async (id: string, v?: string) => { const l = page.locator("#" + id); if ((await l.count()) && v) await l.fill(String(v)).catch(() => {}); };
      await fill("firstname", profile.firstName);
      await fill("lastname", profile.lastName);
      await fill("fathername", (profile as any).fatherName);
      await fill("mothername", (profile as any).motherName);
      await fill("passport", profile.passportNumber);
      await fill("kimlik", (profile as any).nationalId);
      await fill("phone11", String((profile as any).phone || "").replace(/^\+?90/, ""));
      await fill("SecondarySchoolName", (profile as any).lastSchool);
      await selById("gender", (profile as any).gender || "Male");
      await clickContinue();
      // Step 5 — Documents
      const fi = page.locator("input[type=file]"); const fn = await fi.count();
      const order = [(_files as any).passport, (_files as any).diploma, (_files as any).transcript, (_files as any).photo].filter(Boolean) as string[];
      for (let i = 0; i < fn; i++) { const fp = order[i] || (_files as any).passport; if (fp) await fi.nth(i).setInputFiles(fp).catch(() => {}); }
      await clickContinue();
      await wait(2500);
      // Step 6 — final submit
      const finalBtn = page.getByRole("button", { name: /submit|finish|complete application|tamamla|g\u00f6nder|onayla/i }).first();
      if (await finalBtn.count()) { await finalBtn.click({ timeout: 8000 }).catch(() => {}); await wait(6000); const done = (await page.evaluate("(()=>document.body?document.body.innerText:'')()")) as string; if (/successfully|application (submitted|created|completed)|ba\u015fvurunuz al\u0131nm/i.test(done)) result.submitted = true; }
    } catch (e: any) { result.error = e.message; }
    logger.info("[united] submit " + JSON.stringify(result));
    return result;
  },
};
