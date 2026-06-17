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
import { SALESFORCE_SCHOOLS, type SalesforceSchoolConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Factory — one UniversityAdapter per SALESFORCE_SCHOOLS entry
//
// Credentials priority:
//   1. opts.credentials (injected by worker from DB)
//   2. portalCreds(cfg.key) (reads from process.env — legacy / dev fallback)
// ---------------------------------------------------------------------------
function makeSalesforceAdapter(cfg: SalesforceSchoolConfig): UniversityAdapter {
  return {
    key:   cfg.key,
    label: cfg.label,

    matches(name: string): boolean {
      const f = fold(name);
      return cfg.namePatterns.some(p => f.includes(p));
    },

    async login(opts?: LoginOpts): Promise<AdapterSession> {
      const { user, password } = opts?.credentials ?? portalCreds(cfg.key);
      const session = await launchPortal({ headless: opts?.headless ?? true });
      logger.info(`[salesforce:${cfg.key}] login → ${cfg.portalUrl}`);

      const page: any = session.page;
      try {
        await page.goto(cfg.portalUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3500);
        await page.locator("input[type=email], input[name*=email i], input[id*=email i]").first().fill(user);
        await page.locator("input[type=password]").first().fill(password);
        await page.getByRole("button", { name: /login|giris|sign in/i }).first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(6000);
        const stillLogin = await page.locator("input[type=password]").first().isVisible().catch(() => false);
        if (stillLogin) throw new Error(`[salesforce:${cfg.key}] login failed - password field still visible (wrong creds or captcha)`);
        logger.info(`[salesforce:${cfg.key}] login successful -> ${page.url()}`);
      } catch (err) {
        await session.close().catch(() => {});
        throw err;
      }
      return session;
    },

    async submit(
      session: AdapterSession,
      profile: SubmitProfile,
      files: SubmitFiles,
    ): Promise<SubmitResult> {
      logger.info(`[salesforce:${cfg.key}] submit — program: ${profile.programName}`);

      for (const doc of cfg.requiredDocs) {
        if (!files[doc]) {
          logger.warn(`[salesforce:${cfg.key}] missing required doc: ${doc}`);
        }
      }

      // TODO: Salesforce OmniStudio form filling
      //   await session.page.goto(`${cfg.portalUrl}/apply`);
      //   await session.page.fill("[data-field='firstName']", profile.firstName);
      //   ...

      void session;
      return { alreadyExists: false, submitted: false, programMissing: false };
    },
  };
}

export const salesforceAdapters: UniversityAdapter[] = SALESFORCE_SCHOOLS.map(makeSalesforceAdapter);
