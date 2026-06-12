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

// ---------------------------------------------------------------------------
// SIT portal allowlist — EXACTLY 11 universities (do not add/remove)
// Credentials: SIT_USER + SIT_PASSWORD
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

  async login(opts?: { headless?: boolean }): Promise<AdapterSession> {
    const { user, password } = portalCreds("sit");
    const session = await launchPortal({ headless: opts?.headless ?? true });
    logger.info("[sit] login — navigating to portal");

    // TODO: implement SIT login flow
    //   await session.page.goto(PORTAL_URL);
    //   await session.page.fill("#email", user);
    //   await session.page.fill("#password", password);
    //   await session.page.click("button[type=submit]");
    //   await session.page.waitForSelector(".sit-dashboard");

    void PORTAL_URL; void user; void password;
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
    //   ...

    void session;
    return { alreadyExists: false, submitted: false, programMissing: false };
  },
};
