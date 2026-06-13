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

const PORTAL_URL = "https://portal.united.com.tr"; // TODO: confirm URL

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

    // TODO: implement United portal login flow
    //   await session.page.goto(PORTAL_URL);
    //   await session.page.fill("input[name=email]", user);
    //   await session.page.fill("input[name=password]", password);
    //   await session.page.click("button[type=submit]");
    //   await session.page.waitForSelector(".portal-home");

    void PORTAL_URL; void user; void password;
    return session;
  },

  async submit(
    session: AdapterSession,
    profile: SubmitProfile,
    _files: SubmitFiles,
  ): Promise<SubmitResult> {
    logger.info("[united] submit — program:", profile.programName);

    // NOTE: United portal expects the phone number WITHOUT country code.
    //   Use profile.phone directly (caller must strip the +90 prefix).
    //   Correct:   "5321234567"
    //   Incorrect: "+905321234567"

    // TODO: implement United form filling
    //   const page = session.page;
    //   await page.goto(`${PORTAL_URL}/apply/new`);
    //   await page.fill("#firstName", profile.firstName);
    //   await page.fill("#phone", profile.phone); // local number, no country code
    //   ...

    void session;
    return { alreadyExists: false, submitted: false, programMissing: false };
  },
};
