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
// SIT portal allowlist — EXACTLY 11 universities (do not add/remove)
// Credentials: SIT_USER + SIT_PASSWORD (or inject via opts.credentials)
// ---------------------------------------------------------------------------
export const SIT_ALLOWLIST: readonly string[] = [
  "Haliç Üniversitesi",
  "Atlas Üniversitesi",
  "Ankara Medipol Üniversitesi",
  "Galata Üniversitesi",
  "İstanbul Yeni Yüzyıl Üniversitesi",
  "İstinye Üniversitesi",
  "İstanbul Aydın Üniversitesi",
  "İstanbul Kent Üniversitesi",
  "Fenerbahçe Üniversitesi",
  "İstanbul Kültür Üniversitesi",
  "TED Üniversitesi",
] as const;

/** Pre-folded entries for fast matches() lookup. */
const SIT_ALLOWLIST_FOLDED: readonly string[] = SIT_ALLOWLIST.map(fold);

const PORTAL_URL = "https://partners.sitconnect.net"; // TODO: confirm URL

export const sitAdapter: UniversityAdapter = {
  key:       "sit",
  label:     "SIT Portal",
  allowlist: [...SIT_ALLOWLIST],

  matches(name: string): boolean {
    const f = fold(name);
    return SIT_ALLOWLIST_FOLDED.some(entry => f.includes(entry) || entry.includes(f));
  },

  async login(opts?: LoginOpts): Promise<AdapterSession> {
    const { user, password } = opts?.credentials ?? portalCreds("sit");
    const session = await launchPortal({ headless: opts?.headless ?? true });
    logger.info("[sit] login — navigating to portal");

      const page: any = session.page;
      try {
        await page.goto(PORTAL_URL + "/auth/login", { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3500);
        await page.locator("input[type=email], input[name*=email i], input[placeholder*=mail i]").first().fill(user);
        await page.locator("input[type=password]").first().fill(password);
        await page.getByRole("button", { name: /sign in|log ?in|giris/i }).first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(6000);
        if (await page.locator("input[type=password]").first().isVisible().catch(() => false)) throw new Error("[sit] login failed - wrong creds or captcha");
        logger.info("[sit] login successful -> " + page.url());
      } catch (err) { await session.close().catch(() => {}); throw err; }
      return session;
  },

  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    _files: SubmitFiles,
  ): Promise<SubmitResult> {
    logger.info("[sit] submit — program:", profile.programName);

      const page: any = session.page;
      const dryRun = process.env.PORTAL_DRYRUN === "1";
      const result: any = { alreadyExists: false, submitted: false, programMissing: false };
      const esc = (s: string) => s.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pick = async (placeholderRe: RegExp, value?: string) => {
        if (!value) return;
        try {
          const btn = page.getByRole("button", { name: placeholderRe }).first();
          if (!(await btn.count())) return;
          await btn.click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(900);
          const re = new RegExp(esc(value), "i");
          let opt = page.getByRole("option", { name: re }).first();
          if (!(await opt.count())) opt = page.locator("[role=option],li,[class*=option i]").filter({ hasText: re }).first();
          if (await opt.count()) await opt.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(1300);
        } catch (e) {}
      };
      try {
        await page.goto(PORTAL_URL + "/students", { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(4000);
        const q = profile.passportNumber || ((profile.firstName || "") + " " + (profile.lastName || "")).trim();
        const search = page.getByPlaceholder(/search by name|name or email|search/i).first();
        if ((await search.count()) && q) { await search.fill(q).catch(() => {}); await page.waitForTimeout(3000); }
        const row = page.locator("table tbody tr, [role=row]").first();
        if (!(await row.count())) { result.studentNotFound = true; logger.warn("[sit] student not found: " + q); return result; }
        await row.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(3000);
        if (!/\/students\//.test(page.url())) { result.studentNotFound = true; return result; }
        const addBtn = page.getByRole("button", { name: /add application/i }).first();
        if (!(await addBtn.count())) { result.error = "no Add Application button"; return result; }
        await addBtn.click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(2500);
        await pick(/select country/i, "Turk");
        await pick(/select university/i, profile.universityName);
        await pick(/select degree/i, profile.level);
        await pick(/select program/i, profile.programName);
        const createBtn = page.getByRole("button", { name: /create application/i }).first();
        if (!(await createBtn.count())) { result.error = "no Create Application button"; return result; }
        if (dryRun) { result.dryReachedFinal = true; logger.warn("[sit] DRY: stopping before Create Application"); return result; }
        await createBtn.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(6000);
        result.submitted = true;
      } catch (e: any) { result.error = e.message; }
      logger.info("[sit] submit " + JSON.stringify(result));
      return result;
  },
};
