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
// EMU (Eastern Mediterranean University) — ASP.NET WebForms agency portal.
// NOT Salesforce. Flow: login -> Welcome.aspx -> Undergraduate Applications
// (__doPostBack lbtnUAppl) -> "Add New" -> Undergrad_Registration.aspx -> fill
// sections (btnKaydet / btnEekle / btnPEkle / btnBekle) -> btnGonder (submit).
// ---------------------------------------------------------------------------
export const EMU_ALLOWLIST: readonly string[] = [
  "Doğu Akdeniz Üniversitesi",
  "Eastern Mediterranean University",
  "EMU",
] as const;
const EMU_ALLOWLIST_FOLDED: readonly string[] = EMU_ALLOWLIST.map(fold);

const PORTAL_URL = "https://applyonline.emu.edu.tr/agency";

export const emuAdapter: UniversityAdapter = {
  key:   "emu",
  label: "EMU Portal",
  allowlist: [...EMU_ALLOWLIST],

  matches(name: string): boolean {
    const f = fold(name);
    if (f === "") return false;
    return EMU_ALLOWLIST_FOLDED.some((entry) => f === entry);
  },

  async login(opts?: LoginOpts): Promise<AdapterSession> {
    const { user, password } = opts?.credentials ?? portalCreds("emu");
    const session = await launchPortal({ headless: opts?.headless ?? true });
    logger.info("[emu] login - navigating to portal");
    const page: any = session.page;
    try {
      await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
      for (const s of ["input[type=email]","input[name*=email i]","input[type=text]"]) { const l = page.locator(s).first(); if ((await l.count()) && (await l.isVisible().catch(() => false))) { await l.fill(user).catch(() => {}); break; } }
      await page.locator("input[type=password]").first().fill(password).catch(() => {});
      await page.getByRole("button", { name: /login|sign ?in|giris|gönder|submit/i }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(6000);
      if (await page.locator("input[type=password]").first().isVisible().catch(() => false)) throw new Error("[emu] login failed - wrong creds or captcha");
      logger.info("[emu] login successful -> " + page.url());
    } catch (err) { await session.close().catch(() => {}); throw err; }
    return session;
  },

  async submit(
    _session: AdapterSession,
    _profile: SubmitProfile,
    _files: SubmitFiles,
    _doSubmit: boolean = true,
  ): Promise<SubmitResult> {
    // The previous prototype guessed select options by index, fabricated
    // missing identity values and swallowed failed field/document operations.
    // Keeping that path reachable could create a wrong real application. EMU
    // remains registered for credential/UI work, but submission is deliberately
    // blocked until a captured live-form contract and readback tests exist.
    throw new Error(
      "EMU_ADAPTER_NOT_PRODUCTION_READY: live form selectors, exact program mapping, document-slot proof and final application reference are not verified",
    );
  },
};
