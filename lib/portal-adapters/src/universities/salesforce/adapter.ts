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
        for (const __s of ["input[type=email]","input[name*=email i]","input[id*=email i]","input[type=text]"]) { const __l = page.locator(__s).first(); if ((await __l.count()) && (await __l.isVisible().catch(() => false))) { await __l.fill(user).catch(() => {}); break; } }
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
      doSubmit: boolean = true,
    ): Promise<SubmitResult> {
      logger.info(`[salesforce:${cfg.key}] submit — program: ${profile.programName}`);

      for (const doc of cfg.requiredDocs) {
        if (!files[doc]) {
          logger.warn(`[salesforce:${cfg.key}] missing required doc: ${doc}`);
        }
      }

      const page: any = session.page;
      const dryRun = doSubmit === false || process.env.PORTAL_DRYRUN === "1" || process.env.SF_DRYRUN === "1";

      // --- Boot-first SPA navigation (Sabancı / 2-phase Experience Cloud fix) ---
      // A cold goto(application-form) is redirected Home by the SPA route-guard,
      // so the wizard never renders. Boot on Home first (let the app-shell
      // hydrate), then reach the wizard via an in-app link, falling back to a
      // warmed goto. Retry up to 3× until a wizard form field is visible.
      const agencyUrl = cfg.portalUrl.replace(/\/$/, "") + "/";
      const appFormUrl = agencyUrl + "application-form";
      const FORM_SEL = 'input[name="First_Name"], input[name="Last_Name"], input[name="Passport_Number"], input[name="Student_First_Name"], input[name="eduhubPicklistOptions"], select[name="Gender"], input[name="Country_of_Secondary_School"], input[type=file]';
      // "Any visible match" — FORM_SEL is a broad union, so .first() can bind to
      // a hidden element while another field is actually on screen. Iterate.
      const onWizard = async (): Promise<boolean> => { try { const loc = page.locator(FORM_SEL); const n = await loc.count(); for (let i = 0; i < Math.min(n, 12); i++) { if (await loc.nth(i).isVisible().catch(() => false)) return true; } return false; } catch (e) { return false; } };
      const gotoAppForm = async (): Promise<void> => {
        await page.goto(agencyUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(8000); // SPA app-shell hydration (networkidle unreliable on Salesforce)
        const link = page.locator('a[href*="application-form"], a[href$="/application-form"]').first();
        if (await link.count().catch(() => 0)) {
          await link.scrollIntoViewIfNeeded().catch(() => {});
          await link.click({ timeout: 6000 }).catch(() => {});
          await page.waitForTimeout(3000);
        }
        if (!(await onWizard())) {
          await page.goto(appFormUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
        }
        // Poll for ANY visible wizard field (don't waitFor .first(), which may be hidden).
        for (let i = 0; i < 30 && !(await onWizard()); i++) await page.waitForTimeout(1000);
      };
      for (let attempt = 0; attempt < 3 && !(await onWizard()); attempt++) await gotoAppForm();
      await page.waitForTimeout(2000);

      const DUP = /already an application for this (passport|email)|already exists/i;
      // Existing-application detection on the Applicant Detail page: an
      // application number like "SU260169828" means a record already exists —
      // never open a NEW application for the same student.
      const APP_NUM = /\b[A-Z]{2,3}\d{6,}\b/;
      const result: any = { alreadyExists: false, submitted: false, programMissing: false };
      const bodyText = async (): Promise<string> => { try { return (await page.evaluate("(() => document.body ? document.body.innerText : '')()")) as string; } catch (e) { return ""; } };
      const has = async (sel: string): Promise<boolean> => { try { return (await page.locator(sel).count()) > 0; } catch (e) { return false; } };
      const heading = async (): Promise<string> => { try { return (await page.evaluate("(() => { var a=[]; document.querySelectorAll('h1,h2,legend,.slds-text-heading_medium').forEach(function(h){ if(h.offsetParent!==null) a.push((h.innerText||'').slice(0,24)); }); return a.join('|'); })()")) as string; } catch (e) { return Math.random().toString(); } };
      const typeInto = async (sel: string, v?: string | number) => { if (v === undefined || v === null || v === "") return; try { const loc = page.locator(sel); const cnt = await loc.count(); let t: any = null; for (let i = 0; i < cnt; i++) { if (await loc.nth(i).isVisible().catch(() => false)) { t = loc.nth(i); break; } } if (!t) return; await t.fill(String(v)).catch(() => {}); const __cur = await t.inputValue().catch(() => ""); if (__cur !== String(v)) { await t.click().catch(() => {}); await page.waitForTimeout(200); await t.fill("").catch(() => {}); await t.pressSequentially(String(v), { delay: 60 }).catch(() => {}); } await t.press("Tab").catch(() => {}); } catch (e) {} };
      const fill = async (sel: string, v?: string | number) => { if (v === undefined || v === null || v === "") return; try { const l = page.locator(sel).first(); if ((await l.count()) && (await l.isVisible().catch(() => false))) { await l.fill(String(v)).catch(() => {}); await l.press("Tab").catch(() => {}); } } catch (e) {} };
      const selByName = async (name: string, label?: string) => { try { const s = page.locator("select[name=\"" + name + "\"]").first(); if (!(await s.count())) return; if (label) { try { await s.selectOption({ label }); } catch (e) { await s.selectOption({ index: 1 }).catch(() => {}); } } else { await s.selectOption({ index: 1 }).catch(() => {}); } } catch (e) {} };
      const clickNext = async () => { const n = page.getByRole("button", { name: /^\s*(next|ileri|sonraki|devam)\s*$/i }).first(); if (await n.count()) { await n.click({ timeout: 6000 }).catch(() => {}); return true; } const __cna = page.getByRole("button", { name: /create new application|add application|create application/i }).first(); if (await __cna.count()) { await __cna.click({ timeout: 6000 }).catch(() => {}); return true; } return false; };
      const dobm = String(profile.dateOfBirth || "").match(/(\d{4})-(\d{2})-(\d{2})/);
      const dobStr = dobm ? (dobm[2] + "/" + dobm[3] + "/" + dobm[1]) : "01/01/2000";
      for (let step = 0; step < 12; step++) {
        await page.waitForTimeout(2500);
        const txt = await bodyText();
        if (DUP.test(txt) || (/application\s*number/i.test(txt) && APP_NUM.test(txt))) { result.alreadyExists = true; break; }
        const before = (await bodyText()).replace(/\s+/g, " ").slice(0, 600);
        if (/review and submit|not submitted yet|please review/i.test(txt)) {
          if (dryRun) { result.dryReachedFinal = true; break; }
          await clickNext();
          await page.waitForTimeout(6000);
          const aft = await bodyText();
          if (DUP.test(aft)) result.alreadyExists = true; else result.submitted = true;
          break;
        } else if ((await has("input[name=\"Student_First_Name\"]")) || ((await has("input[name=\"First_Name\"]")) && !(await has("select[name=\"Gender\"]")))) {
          await typeInto("input[name=\"Student_First_Name\"]", profile.firstName);
          await typeInto("input[name=\"First_Name\"]", profile.firstName);
          await typeInto("input[name=\"Student_Last_Name\"]", profile.lastName);
          await typeInto("input[name=\"Last_Name\"]", profile.lastName);
          await typeInto("input[name=\"Student_Passport_Number\"]", profile.passportNumber);
          await typeInto("input[name*=Passport i]", profile.passportNumber);
          await typeInto("input[placeholder=\"you@example.com\"]", profile.email);
          await typeInto("input[type=email]", profile.email);
          await typeInto("input[placeholder*=\"@\"]:not([type=password])", profile.email);
          try { const __cb = page.locator("input[role=combobox], input[aria-autocomplete=list], input[aria-autocomplete=both], input[id*=combobox]"); const __cbn = await __cb.count(); for (let __i = 0; __i < __cbn; __i++) { const __e = __cb.nth(__i); if (!(await __e.isVisible().catch(() => false))) continue; if ((await __e.inputValue().catch(() => "x")) !== "") continue; await __e.click().catch(() => {}); await __e.fill(profile.nationality || "Turkey").catch(() => {}); await page.waitForTimeout(1500); const __o = page.locator("[role=option], lightning-base-combobox-item, .slds-listbox__option, li[role=option]").first(); if (await __o.count()) await __o.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); } } catch (e) {}
          try { const __cand = page.locator("input[required], input[aria-required=\"true\"]"); const __cn = await __cand.count(); for (let __ci = 0; __ci < __cn; __ci++) { const __el = __cand.nth(__ci); if (!(await __el.isVisible().catch(() => false))) continue; const __ty = (await __el.getAttribute("type").catch(() => "")) || "text"; if (__ty === "radio" || __ty === "checkbox") continue; const __idr = ((await __el.getAttribute("id").catch(() => "")) || "") + ((await __el.getAttribute("role").catch(() => "")) || "") + ((await __el.getAttribute("aria-autocomplete").catch(() => "")) || ""); if (/combobox|list|both/i.test(__idr)) continue; const __cv = await __el.inputValue().catch(() => "x"); if (__cv === "") { await __el.fill(profile.email).catch(() => {}); break; } } } catch (e) {}
          try { const cz = page.getByLabel(/citizenship|vatanda/i).first(); if ((await cz.count()) && (await cz.isVisible().catch(() => false))) { await cz.click().catch(() => {}); await cz.fill(profile.nationality || "Turkey").catch(() => {}); await page.waitForTimeout(1500); const o = page.locator("[role=option],lightning-base-combobox-item,li").first(); if (await o.count()) await o.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700); } } catch (e) {}
          try { const eml = page.getByLabel(/applicant email|email address/i).first(); if ((await eml.count()) && (await eml.isVisible().catch(() => false)) && !(await eml.inputValue().catch(() => "x"))) { await eml.click().catch(() => {}); await page.keyboard.type(profile.email || ("fas" + Date.now() + "@example.com"), { delay: 40 }).catch(() => {}); await eml.press("Tab").catch(() => {}); } } catch (e) {}
          await clickNext();
        } else if (/available programs/i.test(txt)) {
          if (profile.programName) { try { const kw = page.getByPlaceholder(/search program name|keyword/i).first(); if (await kw.count()) { await kw.fill(profile.programName).catch(() => {}); await page.waitForTimeout(1800); } } catch (e) {} }
          const sb = page.getByRole("button", { name: /^\s*select\s*$/i }).first();
          if (await sb.count()) { await sb.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(2000); } else { result.programMissing = true; break; }
          await clickNext();
        } else if (await has("select[name=\"Gender\"]")) {
          await fill("input[name=\"First_Name\"]", profile.firstName);
          await fill("input[name=\"Last_Name\"]", profile.lastName);
          await selByName("Gender", /female/i.test(profile.gender || "") ? "Female" : "Male");
          await selByName("Citizenship", profile.nationality);
          await selByName("Country_of_Residence", profile.nationality);
          await selByName("Where_did_you_hear_us", "University Website");
          try { const d = page.locator("input[name*=Date_of_Birth i],input[name*=birth i]").first(); if (await d.count()) { await d.click().catch(() => {}); await d.fill("").catch(() => {}); await d.type(dobStr, { delay: 60 }).catch(() => {}); await d.press("Tab").catch(() => {}); } } catch (e) {}
          try { const rs = page.locator("input[type=radio]"); const rn = await rs.count(); for (let i = 0; i < rn; i++) { const v = await rs.nth(i).getAttribute("value").catch(() => ""); if (/^No/i.test(v || "")) await rs.nth(i).check({ force: true }).catch(() => {}); } } catch (e) {}
          try { const cb = page.locator("button[role=combobox],[role=combobox]").first(); if (await cb.count()) { await cb.click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(800); const opts = page.locator("[role=option]"); const oc = await opts.count(); for (let i = 0; i < oc; i++) { const ot = (await opts.nth(i).innerText().catch(() => "")) || ""; if (!/none/i.test(ot)) { await opts.nth(i).click({ timeout: 2000 }).catch(() => {}); break; } } } } catch (e) {}
          await fill("input[name=\"MobilePhone_Text\"]", profile.phone);
          await fill("input[name=\"Address\"]", profile.address);
          await fill("input[name=\"City\"]", profile.address);
          await clickNext();
        } else if (await has("select[name=\"Country_of_Secondary_School\"]") || /secondary school/i.test(txt)) {
          await fill("input[name=\"Name_of_Secondary_School\"]", profile.schoolName || "High School");
          await selByName("Country_of_Secondary_School", profile.nationality);
          await selByName("Choose_the_education_system_of_the_high_school_you_have_graduated_from");
          await fill("input[name=\"GPA_of_Secondary_School\"]", String(profile.gpa || "3"));
          await clickNext();
        } else if (await has("input[type=file]")) {
          try { const fi = page.locator("input[type=file]"); const order = [files.diploma, files.transcript, files.passport, files.photo].filter(Boolean) as string[]; const n = await fi.count(); for (let i = 0; i < Math.min(n, order.length); i++) { await fi.nth(i).setInputFiles(order[i]).catch(() => {}); await page.waitForTimeout(1800); } } catch (e) {}
          await clickNext();
        } else {
          const cna = page.getByRole("button", { name: /create new application|add application/i }).first();
          if (await cna.count()) { await cna.click({ timeout: 6000 }).catch(() => {}); }
          const sub = page.getByRole("button", { name: /^\s*(submit|complete|tamamla|gönder|finish|onayla)\s*$/i }).first();
          const hn = await page.getByRole("button", { name: /^\s*(next|ileri|sonraki|devam)\s*$/i }).count();
          if ((await sub.count()) && !hn) {
            if (dryRun) { result.dryReachedFinal = true; break; }
            await sub.click({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(6000);
            if (DUP.test(await bodyText())) result.alreadyExists = true; else result.submitted = true;
            break;
          }
          try { const r = page.locator("input[type=radio]"); if (await r.count()) { const id = await r.first().getAttribute("id").catch(() => null); if (id) { const lb = page.locator("label[for=\"" + id + "\"]").first(); if (await lb.count()) await lb.click({ timeout: 3000 }).catch(() => {}); } await r.first().check({ force: true }).catch(() => {}); } } catch (e) {}
          await clickNext();
        }
        let moved = false;
        for (let t = 0; t < 10; t++) { await page.waitForTimeout(1000); if (((await bodyText()).replace(/\s+/g, " ").slice(0, 600)) !== before) { moved = true; break; } }
        if (!moved) { result.stuckStep = step; result.stuckBody = (await bodyText()).replace(/\s+/g, " ").slice(0, 200); if (step > 0) break; }
      }
      logger.info("[salesforce:" + cfg.key + "] submit " + JSON.stringify(result));
      return result;
    },
  };
}

export const salesforceAdapters: UniversityAdapter[] = SALESFORCE_SCHOOLS.map(makeSalesforceAdapter);
