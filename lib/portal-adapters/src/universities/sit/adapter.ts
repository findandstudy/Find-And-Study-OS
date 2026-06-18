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
