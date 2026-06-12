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

// ---------------------------------------------------------------------------
// SIT portal allowlist — EXACTLY 11 universities (do not add/remove)
// ---------------------------------------------------------------------------
const SIT_ALLOWLIST_FOLDED: readonly string[] = [
  "halic",
  "atlas",
  "ankara medipol",
  "galata",
  "istanbul yeni yuzyil",
  "istinye",
  "istanbul aydin",
  "istanbul kent",
  "fenerbahce",
  "istanbul kultur",
  "ted",
] as const;

const PORTAL_URL = "https://sit.universite-yonetim.com"; // TODO: confirm URL

export const sitAdapter: UniversityAdapter = {
  key:   "sit",
  label: "SIT Portal",

  matches(name: string): boolean {
    const f = fold(name);
    return SIT_ALLOWLIST_FOLDED.some(entry => f.includes(entry));
  },

  async login(opts: {
    headless?: boolean;
    credentials: PortalCredentials;
  }): Promise<AdapterSession> {
    // credentials are injected by the caller — NEVER read from process.env
    const session = await launchPortal({ headless: opts.headless ?? true });
    logger.info("[sit] login — navigating to portal");

    // TODO: implement SIT login flow
    //   await session.page.goto(PORTAL_URL);
    //   await session.page.fill("#email", opts.credentials.user);
    //   await session.page.fill("#password", opts.credentials.password);
    //   await session.page.click("button[type=submit]");
    //   await session.page.waitForSelector(".sit-dashboard");

    void PORTAL_URL; // suppress unused-var until TODO is implemented
    return session;
  },

  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    _files: SubmitFiles,
  ): Promise<SubmitResult> {
    logger.info("[sit] submit — program:", profile.programName);

    // TODO: implement SIT form filling
    //   const page = session.page;
    //   await page.goto(`${PORTAL_URL}/application/new`);
    //   await page.fill("#firstName", profile.firstName);
    //   await page.fill("#lastName", profile.lastName);
    //   await page.fill("#passport", profile.passportNumber);
    //   ...

    void session;
    return { alreadyExists: false, submitted: false, programMissing: false };
  },
};
