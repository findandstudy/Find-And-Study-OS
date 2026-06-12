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

// Credentials read from: TOPKAPI_USER + TOPKAPI_PASSWORD
const PORTAL_URL = "https://apply.topkapi.edu.tr"; // TODO: confirm URL

export const topkapiAdapter: UniversityAdapter = {
  key:   "topkapi",
  label: "İstanbul Topkapı Üniversitesi",

  matches(name: string): boolean {
    const f = fold(name);
    return f.includes("topkapi") || f.includes("topkap");
  },

  async login(opts?: { headless?: boolean }): Promise<AdapterSession> {
    const { user, password } = portalCreds("topkapi");
    const session = await launchPortal({ headless: opts?.headless ?? true });
    logger.info("[topkapi] login — navigating to portal");

    // TODO: implement actual login flow
    //   await session.page.goto(PORTAL_URL);
    //   await session.page.fill("#username", user);
    //   await session.page.fill("#password", password);
    //   await session.page.click("button[type=submit]");
    //   await session.page.waitForNavigation();

    void PORTAL_URL; void user; void password;
    return session;
  },

  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    _files: SubmitFiles,
  ): Promise<SubmitResult> {
    logger.info("[topkapi] submit — program:", profile.programName);

    // TODO: implement form filling
    //   await session.page.goto(`${PORTAL_URL}/apply`);
    //   await session.page.fill("#firstName", profile.firstName);
    //   ...

    void session;
    return { alreadyExists: false, submitted: false, programMissing: true };
  },
};
