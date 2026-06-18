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

      const page: any = session.page;
      const dryRun = process.env.SF_DRYRUN === "1";
      const formUrl = cfg.portalUrl.replace(/\/$/, "") + "/application-form";
      await page.goto(formUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(6000);
      const DUP = /already an application for this passport|already exists|kayitli ogrenci/i;
      const bodyText = async (): Promise<string> => { try { return (await page.evaluate("(() => document.body ? document.body.innerText : '')()")) as string; } catch (e) { return ""; } };
      const sig = async (): Promise<string> => { try { return (await page.evaluate("(()=>{var a=[];function w(r){var e=[];try{e=[].slice.call(r.querySelectorAll('input,select,textarea,button'))}catch(x){}for(var i=0;i<e.length;i++){a.push((e[i].name||'')+'|'+(e[i].innerText||'').slice(0,10))}var al=[];try{al=[].slice.call(r.querySelectorAll('*'))}catch(x){}for(var j=0;j<al.length;j++){if(al[j].shadowRoot)w(al[j].shadowRoot)}}w(document);return a.join(',')})()")) as string; } catch (e) { return ""; } };
      const fill = async (sel: string, val?: string | number) => { if (val === undefined || val === null || val === "") return; try { const l = page.locator(sel).first(); if ((await l.count()) && (await l.isVisible().catch(() => false))) { await l.fill(String(val)).catch(() => {}); await l.press("Tab").catch(() => {}); } } catch (e) {} };
      const pickRadio = async () => { try { const r = page.locator("input[type=radio]"); if (await r.count()) { const el = r.first(); const id = await el.getAttribute("id").catch(() => null); if (id) { const lb = page.locator("label[for=\"" + id + "\"]").first(); if (await lb.count()) { await lb.click({ timeout: 3000 }).catch(() => {}); return; } } await el.check({ force: true }).catch(() => {}); } } catch (e) {} };
      const pickCombos = async () => { try { const cbs = page.locator("button[role=combobox],[role=combobox]"); const n = await cbs.count(); for (let i = 0; i < Math.min(n, 14); i++) { const cb = cbs.nth(i); if (!(await cb.isVisible().catch(() => false))) continue; await cb.click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(600); const opt = page.locator("[role=option],lightning-base-combobox-item").first(); if ((await opt.count()) && (await opt.isVisible().catch(() => false))) await opt.click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(250); } } catch (e) {} };
      const uploadDocs = async () => { try { const fi = page.locator("input[type=file]"); const n = await fi.count(); const order = [files.passport, files.transcript, files.diploma, files.photo].filter(Boolean) as string[]; for (let i = 0; i < n; i++) { const fp = order[i] || files.passport || files.transcript || files.diploma; if (fp) await fi.nth(i).setInputFiles(fp).catch(() => {}); } } catch (e) {} };
      const result: any = { alreadyExists: false, submitted: false, programMissing: false };
      for (let step = 0; step < 14; step++) {
        await page.waitForTimeout(1500);
        if (DUP.test(await bodyText())) { result.alreadyExists = true; break; }
        await pickRadio();
        await fill("input[name=\"Student_First_Name\"]", profile.firstName);
        await fill("input[name=\"Student_Last_Name\"]", profile.lastName);
        await fill("input[name=\"First_Name\"]", profile.firstName);
        await fill("input[name=\"Last_Name\"]", profile.lastName);
        await fill("input[name=\"Student_Passport_Number\"]", profile.passportNumber);
        await fill("input[name*=Passport i]", profile.passportNumber);
        await fill("input[placeholder=\"you@example.com\"]", profile.email);
        await fill("input[name=\"Address\"]", profile.address);
        await fill("input[name=\"City\"]", profile.address);
        await fill("input[name=\"MobilePhone_Text\"]", profile.phone);
        await fill("input[type=date],input[name*=birth i]", profile.dateOfBirth);
        try { const kw = page.getByPlaceholder(/search a keyword/i).first(); if (await kw.count()) { await kw.fill(profile.programName || "").catch(() => {}); await page.waitForTimeout(1800); } } catch (e) {}
        try { const sa = page.getByRole("button", { name: /show all/i }).first(); if (await sa.count()) { await sa.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1500); } } catch (e) {}
        try { const sp = page.getByRole("button", { name: /select_program|^\s*select\s*$/i }).first(); if (await sp.count()) { await sp.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1500); } } catch (e) {}
        await pickCombos();
        await uploadDocs();
        const submitBtn = page.getByRole("button", { name: /submit|complete|tamamla|gonder|finish|onayla/i }).first();
        const nextBtn = page.getByRole("button", { name: /^\s*(next|ileri|sonraki|devam)\s*$/i }).first();
        const hasSubmit = await submitBtn.count();
        const hasNext = await nextBtn.count();
        if (hasSubmit && !hasNext) {
          if (dryRun) { logger.warn("[salesforce:" + cfg.key + "] DRY: final submit reached, NOT clicking"); result.dryReachedFinal = true; break; }
          await submitBtn.click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(6000);
          if (DUP.test(await bodyText())) result.alreadyExists = true; else result.submitted = true;
          break;
        }
        if (!hasNext) { result.stoppedStep = step; break; }
        const before = await sig();
        await nextBtn.click({ timeout: 6000 }).catch(() => {});
        let moved = false;
        for (let t = 0; t < 12; t++) { await page.waitForTimeout(1000); if ((await sig()) !== before) { moved = true; break; } }
        if (!moved) { result.blockedStep = step; break; }
      }
      logger.info("[salesforce:" + cfg.key + "] submit result " + JSON.stringify(result));
      return result;
    },
  };
}

export const salesforceAdapters: UniversityAdapter[] = SALESFORCE_SCHOOLS.map(makeSalesforceAdapter);
