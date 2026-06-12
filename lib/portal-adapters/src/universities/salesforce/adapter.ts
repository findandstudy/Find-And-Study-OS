import type {
  UniversityAdapter,
  AdapterSession,
  SubmitProfile,
  SubmitFiles,
  SubmitResult,
  PortalCredentials,
} from "../../types.js";
import { launchPortal, logger } from "../../browser.js";
import { fold } from "../../programMatch.js";
import { SALESFORCE_SCHOOLS, type SalesforceSchoolConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Factory — one UniversityAdapter per SALESFORCE_SCHOOLS entry
// ---------------------------------------------------------------------------
function makeSalesforceAdapter(cfg: SalesforceSchoolConfig): UniversityAdapter {
  return {
    key:   cfg.key,
    label: cfg.label,

    matches(name: string): boolean {
      const f = fold(name);
      return cfg.namePatterns.some(p => f.includes(p));
    },

    async login(opts: {
      headless?: boolean;
      credentials: PortalCredentials;
    }): Promise<AdapterSession> {
      // credentials are injected by the caller — NEVER read from process.env
      const session = await launchPortal({ headless: opts.headless ?? true });
      logger.info(`[salesforce:${cfg.key}] login → ${cfg.portalUrl}`);

      // TODO: Salesforce OmniStudio login flow
      //   await session.page.goto(cfg.portalUrl);
      //   await session.page.fill("input[name='username']", opts.credentials.user);
      //   await session.page.fill("input[name='password']", opts.credentials.password);
      //   await session.page.click("button[type='submit']");
      //   await session.page.waitForSelector(".omni-application-form");

      return session;
    },

    async submit(
      session: AdapterSession,
      profile: SubmitProfile,
      files: SubmitFiles,
    ): Promise<SubmitResult> {
      logger.info(`[salesforce:${cfg.key}] submit — program: ${profile.programName}`);

      // Verify required documents are present
      for (const doc of cfg.requiredDocs) {
        if (!files[doc]) {
          logger.warn(`[salesforce:${cfg.key}] missing required doc: ${doc}`);
        }
      }

      // TODO: Salesforce OmniStudio form filling
      //   await session.page.goto(`${cfg.portalUrl}/apply`);
      //   // Fill personal details
      //   await session.page.fill("[data-field='firstName']", profile.firstName);
      //   await session.page.fill("[data-field='lastName']", profile.lastName);
      //   ...
      //   // Upload documents
      //   if (files.diploma) await session.page.setInputFiles("#diploma-upload", files.diploma);
      //   ...

      void session; // suppress unused-var until TODO is implemented
      return { alreadyExists: false, submitted: false, programMissing: false };
    },
  };
}

// ---------------------------------------------------------------------------
// Exported adapters list — one entry per configured school
// ---------------------------------------------------------------------------
export const salesforceAdapters: UniversityAdapter[] = SALESFORCE_SCHOOLS.map(makeSalesforceAdapter);
