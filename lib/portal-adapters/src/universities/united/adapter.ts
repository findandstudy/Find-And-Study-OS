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

const PORTAL_URL = "https://partner.unitededucation.com"; // TODO: confirm URL

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

    const page: any = session.page;
    try {
      await page.goto(PORTAL_URL + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
      await page.locator("input[name*=user i], input[placeholder*=user i], input[id*=user i], input[type=text]").first().fill(user);
      await page.locator("input[type=password]").first().fill(password);
      await page.getByRole("button", { name: /sign ?in|log ?in|giris/i }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(6000);
      if (await page.locator("input[type=password]").first().isVisible().catch(() => false)) throw new Error("[united] login failed - wrong creds or captcha");
      logger.info("[united] login successful -> " + page.url());
    } catch (err) { await session.close().catch(() => {}); throw err; }
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

    const page: any = session.page;
    const dryRun = process.env.PORTAL_DRYRUN === "1";
    const result: any = { alreadyExists: false, submitted: false, programMissing: false };
    const bodyText = async (): Promise<string> => { try { return (await page.evaluate("(() => document.body ? document.body.innerText : '')()")) as string; } catch (e) { return ""; } };
    const fillStep = async () => {
      try { const s = page.locator("select"); const n = await s.count(); for (let i = 0; i < n; i++) { if (await s.nth(i).isVisible().catch(() => false)) await s.nth(i).selectOption({ index: 1 }).catch(() => {}); } } catch (e) {}
      try { const t = page.locator("input[type=text],input[type=email],input[type=tel],input[type=number],input:not([type]),textarea"); const n = await t.count(); for (let i = 0; i < Math.min(n, 30); i++) { const el = t.nth(i); if (!(await el.isVisible().catch(() => false))) continue; if (await el.inputValue().catch(() => "x")) continue; const k = (((await el.getAttribute("name").catch(() => "")) || "") + ((await el.getAttribute("placeholder").catch(() => "")) || "") + ((await el.getAttribute("id").catch(() => "")) || "")).toLowerCase(); let v = "Test"; if (/mail/.test(k)) v = profile.email || "test@example.com"; else if (/phone|tel|gsm|mobil/.test(k)) v = (profile.phone || "5551112233").replace(/^0+/, ""); else if (/passport|pasaport/.test(k)) v = profile.passportNumber || "U1234567"; else if (/first|firstname|ad$|isim|name1/.test(k)) v = profile.firstName || "Test"; else if (/last|surname|soyad/.test(k)) v = profile.lastName || "Applicant"; else if (/birth|dogum|dob|date/.test(k)) v = "01/01/2000"; else if (/address|adres/.test(k)) v = profile.address || "Istanbul"; else if (/city|sehir/.test(k)) v = profile.address || "Istanbul"; await el.fill(v).catch(() => {}); } } catch (e) {}
      try { const r = page.locator("input[type=radio]"); if (await r.count()) { const el = r.first(); const id = await el.getAttribute("id").catch(() => null); if (id) { const lb = page.locator("label[for=\"" + id + "\"]").first(); if (await lb.count()) await lb.click({ timeout: 2500 }).catch(() => {}); } await el.check({ force: true }).catch(() => {}); } } catch (e) {}
      try { const card = page.locator("[class*=card i],[class*=option i],[role=radio]").first(); if (await card.count() && await card.isVisible().catch(() => false)) await card.click({ timeout: 2000 }).catch(() => {}); } catch (e) {}
      try { const fi = page.locator("input[type=file]"); const n = await fi.count(); const order = [files.diploma, files.transcript, files.passport, files.photo].filter(Boolean) as string[]; for (let i = 0; i < n; i++) { const fp = order[i] || files.passport || files.diploma; if (fp) await fi.nth(i).setInputFiles(fp).catch(() => {}); } } catch (e) {}
    };
    try {
      await page.goto(PORTAL_URL + "/Manage/newapplication", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(5000);
      for (let step = 0; step < 9; step++) {
        await page.waitForTimeout(2500);
        const txt = await bodyText();
        if (/already.*application|zaten.*basvuru/i.test(txt)) { result.alreadyExists = true; break; }
        if (/completed|application (submitted|created|received)|basvurunuz (alinmis|olusturuldu)/i.test(txt)) { result.submitted = true; break; }
        const finalBtn = page.getByRole("button", { name: /submit|finish|complete|tamamla|gönder|onayla/i }).first();
        const hasCont = await page.getByRole("button", { name: /continue|next|ileri|devam|kaydet/i }).count();
        if ((await finalBtn.count()) && !hasCont) { if (dryRun) { result.dryReachedFinal = true; break; } await finalBtn.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(6000); if (/completed|submitted|alinmis/i.test(await bodyText())) result.submitted = true; break; }
        const before = txt.slice(0, 140);
        await fillStep();
        const nb = page.getByRole("button", { name: /continue|next|ileri|devam|kaydet/i }).first();
        if (!(await nb.count())) { result.stoppedStep = step; result.body = txt.replace(/\s+/g, " ").slice(0, 200); break; }
        await nb.click({ timeout: 6000 }).catch(() => {});
        let moved = false;
        for (let t = 0; t < 10; t++) { await page.waitForTimeout(1000); if (((await bodyText()).slice(0, 140)) !== before) { moved = true; break; } }
        if (!moved) { result.stuckStep = step; result.body = (await bodyText()).replace(/\s+/g, " ").slice(0, 200); break; }
      }
    } catch (e: any) { result.error = e.message; }
    logger.info("[united] submit " + JSON.stringify(result));
    return result;
  },
};
