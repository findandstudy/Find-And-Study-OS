import { launchPortal, logger } from "../../browser.js";
import { portalCreds } from "../../portalCreds.js";
import type {
  UniversityAdapter, LoginOpts, AdapterSession,
  SubmitProfile, SubmitFiles, SubmitResult,
} from "../../types.js";

const PORTAL_BASE = "https://apply.okan.edu.tr";
const LOGIN_URL = PORTAL_BASE + "/Agency/Login";
const WIZARD_URL = PORTAL_BASE + "/agency/ApplicationWizard";

// profile.level (TR/EN serbest metin) → Okan degree kartı data-value
function degreeValue(level: string): string {
  const l = (level || "").toLowerCase();
  if (/(önlisans|onlisans|associate)/.test(l)) return "1";
  if (/(yüksek|yuksek|master|graduate)/.test(l)) return "3"; // "lisans"tan ÖNCE
  if (/(phd|doktora|doctora|doctorate)/.test(l)) return "4";
  if (/(tömer|tomer|language|dil)/.test(l)) return "5";
  if (/(lisans|bachelor|undergrad)/.test(l)) return "2";
  return "2"; // makul varsayılan: Bachelor
}

export const okanAdapter: UniversityAdapter = {
  key: "okan",
  label: "Istanbul Okan University",
  allowlist: ["Istanbul Okan University", "Okan Üniversitesi", "Okan University", "İstanbul Okan"],

  matches(name: string): boolean {
    return /okan/i.test(name || "");
  },

  async login(opts?: LoginOpts): Promise<AdapterSession> {
    const { user, password } = opts?.credentials ?? portalCreds("okan");
    const session = await launchPortal({ headless: opts?.headless ?? true });
    const page: any = session.page;
    logger.info("[okan] login — navigating to portal");
    try {
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2000);
      await page.locator("#agencyEmail").first().fill(user);
      await page.locator("#agencyPassword").first().fill(password);
      await page.locator("#login").first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(5000);
      if (await page.locator("#agencyPassword").first().isVisible().catch(() => false)) {
        throw new Error("[okan] login failed — wrong creds or captcha");
      }
      logger.info("[okan] login successful -> " + page.url());
    } catch (err) {
      await session.close().catch(() => {});
      throw err;
    }
    return session;
  },

  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    _files: SubmitFiles,
    doSubmit: boolean = true,
  ): Promise<SubmitResult> {
    const page: any = session.page;
    const dryRun = doSubmit === false || process.env.PORTAL_DRYRUN === "1";
    const result: any = { alreadyExists: false, submitted: false, programMissing: false };
    const wait = (ms: number) => page.waitForTimeout(ms);
    logger.info("[okan] submit — level:", profile.level, "dry:", dryRun);

    const clickWizardBtn = async (lbl: string) => {
      const btns = page.locator(`button.k-button:has-text("${lbl}")`);
      const n = await btns.count();
      for (let i = 0; i < n; i++) {
        const b = btns.nth(i);
        if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 8000 }).catch(() => {}); return true; }
      }
      return false;
    };

    try {
      await page.goto(WIZARD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await wait(2500);

      // Step 1: Term — ilk uygun term kartını seç
      const termCard = page.locator(".image-container[data-value]").first();
      if (!(await termCard.count())) throw new Error("[okan] no term card on step 1");
      await termCard.click({ timeout: 8000 }).catch(() => {});
      await wait(800); await clickWizardBtn("Next"); await wait(1500);

      // Step 2: Degree — mapped data-value kartı
      const dv = degreeValue(profile.level);
      if (dv === "2" && !/lisans|bachelor|undergrad/i.test(profile.level || "")) {
        logger.warn("[okan] level '" + profile.level + "' unmatched → Bachelor(2)");
      }
      const degCard = page.locator(`.image-container[data-value="${dv}"]`).first();
      if (!(await degCard.count())) throw new Error("[okan] degree card data-value=" + dv + " not found");
      await degCard.click({ timeout: 8000 }).catch(() => {});
      await wait(800); await clickWizardBtn("Next"); await wait(1500);

      // Step 3: Personal Info
      const fill = async (id: string, v?: string) => {
        const l = page.locator("#" + id);
        if ((await l.count()) && v) await l.fill(String(v)).catch(() => {});
      };
      await fill("firstName", profile.firstName);
      await fill("lastName", profile.lastName);
      await fill("passportNumber", profile.passportNumber);
      await fill("email", profile.email);
      await wait(600);

      // DRY gate — Done'a basmadan dur
      if (dryRun) {
        const reached = (await page.locator("#firstName").isVisible().catch(() => false))
          && (await page.locator('button.k-button:has-text("Done")').first().isVisible().catch(() => false));
        result.dryReachedFinal = !!reached;
        if (!reached) {
          result.stuckStep = 3;
          result.stuckBody = ((await page.evaluate("(()=>document.body?document.body.innerText:'')()")) as string)
            .replace(/\s+/g, " ").slice(0, 220);
        }
        logger.warn("[okan] DRY: reached Personal/Done boundary (" + result.dryReachedFinal + ")");
        logger.info("[okan] submit " + JSON.stringify(result));
        return result as SubmitResult;
      }

      // REAL submit (worker gating: ilk-gerçek onay + gerçek öğrenci)
      await clickWizardBtn("Done");
      await wait(6000);
      const body = (await page.evaluate("(()=>document.body?document.body.innerText:'')()")) as string;
      if (/already|kayıtlı|duplicate|zaten/i.test(body)) result.alreadyExists = true;
      else if (/success|created|received|başvurunuz|application.*(created|received|submitted)/i.test(body)
        || /TrackApplications/i.test(page.url())) result.submitted = true;
      logger.info("[okan] submit " + JSON.stringify(result));
      return result as SubmitResult;
    } catch (e: any) {
      result.error = e?.message || String(e);
      logger.info("[okan] submit " + JSON.stringify(result));
      return result as SubmitResult;
    }
  },
};

export default okanAdapter;
