import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
} from "../../types.js";
import { launchPortal, logger } from "../../browser.js";
import { portalCreds } from "../../portalCreds.js";
import { fold } from "../../programMatch.js";
import { SALESFORCE_SCHOOLS, type SalesforceSchoolConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Factory — one UniversityAdapter per SALESFORCE_SCHOOLS entry
//
// Credentials are read from process.env by portalCreds(cfg.key).
// Convention: ${KEY}_EMAIL  +  ${KEY}_PASSWORD  (e.g. USKUDAR_EMAIL)
// ---------------------------------------------------------------------------
function makeSalesforceAdapter(cfg: SalesforceSchoolConfig): UniversityAdapter {
  return {
    key:   cfg.key,
    label: cfg.label,

    matches(name: string): boolean {
      const f = fold(name);
      return cfg.namePatterns.some(p => f.includes(p));
    },

    async login(opts?: { headless?: boolean }): Promise<AdapterSession> {
      const { user, password } = portalCreds(cfg.key);
      const session = await launchPortal({ headless: opts?.headless ?? true });
      logger.info(`[salesforce:${cfg.key}] login → ${cfg.portalUrl}`);

      // TODO: Salesforce OmniStudio login flow
      //   await session.page.goto(cfg.portalUrl);
      //   await session.page.fill("input[name='username']", user);
      //   await session.page.fill("input[name='password']", password);
      //   await session.page.click("button[type='submit']");
      //   await session.page.waitForSelector(".omni-application-form");

      void user; void password;
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
