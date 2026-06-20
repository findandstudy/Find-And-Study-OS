// lib/portal-adapters/src/universities/okan/adapter.ts — v2 FINAL (full application)
//
// Istanbul Okan University — CODE adapter. CALIBRATED live 2026-06-20 against the
// real 6-step "Application Form" (Track Wizard). All step mechanisms verified:
//   • Navigation: REAL Playwright clicks (page.click) — synthetic JS clicks do NOT advance.
//   • Kendo DropDownList: page.evaluate → jQuery('#id').data('kendoDropDownList').text(v).trigger('change')
//   • Kendo NumericTextBox (GPA): kendo.widgetInstance($('.k-numerictextbox')).value(n)
//   • Plain text inputs: page.fill (real typing).
//   • Program: fill #programKeyword (live filter) → click "Select" on the matching row.
//   • Documents: per mandatory doc → file input.setInputFiles(pdf) → click adjacent "Upload".
//
// Flow: login → Agency Wizard (creates draft, "Done") → Track Wizard 6 steps → submit.
// REQUIRED step-2 Kendo dropdowns: gender, citizenshipId, blueCard(No), residence(No),
// countryOfResidenceId; required text: familyPhoneNumber. Step-4 country = countryOfSecondarySchoolId.
// Mandatory docs: Passport + Last High School Transcript (PDF, ≤5MB).

import { launchPortal, logger } from "../../browser.js";
import { portalCreds } from "../../portalCreds.js";
import type {
  UniversityAdapter, LoginOpts, AdapterSession,
  SubmitProfile, SubmitFiles, SubmitResult,
} from "../../types.js";

const BASE = "https://apply.okan.edu.tr";
function degreeValue(level: string): string {
  const l = (level || "").toLowerCase();
  if (/(önlisans|onlisans|associate)/.test(l)) return "1";
  if (/(yüksek|yuksek|master|graduate)/.test(l)) return "3";
  if (/(phd|doktora|doctorate)/.test(l)) return "4";
  if (/(tömer|tomer|language|dil)/.test(l)) return "5";
  return "2";
}
const genderText = (g: string) => (/fem|kadın|female/i.test(g || "") ? "Female" : "Male");
const lastWord = (s?: string) => ((s || "").trim().split(/\s+/).pop() || "");

export const okanAdapter: UniversityAdapter = {
  key: "okan",
  label: "Istanbul Okan University",
  allowlist: ["Istanbul Okan University", "Okan Üniversitesi", "Okan University", "İstanbul Okan"],
  matches(name: string): boolean { return /okan/i.test(name || ""); },

  async login(opts?: LoginOpts): Promise<AdapterSession> {
    const { user, password } = opts?.credentials ?? portalCreds("okan");
    const session = await launchPortal({ headless: opts?.headless ?? true });
    const page: any = session.page;
    logger.info("[okan] login");
    try {
      await page.goto(BASE + "/Agency/Login", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2000);
      await page.locator("#agencyEmail").first().fill(user);
      await page.locator("#agencyPassword").first().fill(password);
      await page.locator("#login").first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(5000);
      if (await page.locator("#agencyPassword").first().isVisible().catch(() => false))
        throw new Error("[okan] login failed — wrong creds or captcha");
      logger.info("[okan] login successful -> " + page.url());
    } catch (err) { await session.close().catch(() => {}); throw err; }
    return session;
  },

  async submit(session: AdapterSession, profile: SubmitProfile, files: SubmitFiles, doSubmit: boolean = true): Promise<SubmitResult> {
    const page: any = session.page;
    const dryRun = doSubmit === false || process.env.PORTAL_DRYRUN === "1";
    const result: any = { alreadyExists: false, submitted: false, programMissing: false };
    const wait = (ms: number) => page.waitForTimeout(ms);
    logger.info("[okan] submit v2 — level:", profile.level, "dry:", dryRun);

    const clickVisible = async (label: string) => {
      const b = page.locator(`button:has-text("${label}")`);
      const n = await b.count();
      for (let i = 0; i < n; i++) { const x = b.nth(i); if (await x.isVisible().catch(() => false)) { await x.click({ timeout: 8000 }).catch(() => {}); return true; } }
      return false;
    };
    const next = () => clickVisible("Next");
    const setKendo = (id: string, text: string) => text ? page.evaluate(([i, t]: any) => {
      const w = (window as any).jQuery('#' + i).data('kendoDropDownList'); if (w) { w.text(t); w.trigger('change'); }
    }, [id, text]).catch(() => {}) : Promise.resolve();
    const setNumeric = (labelRe: string, val: number) => page.evaluate(([re, v]: any) => {
      const $ = (window as any).jQuery, kendo = (window as any).kendo;
      const lab = [...document.querySelectorAll('label')].find(l => new RegExp(re, 'i').test(l.innerText));
      const grp = lab && lab.closest('.form-group,.col,div');
      const wrap = grp && grp.querySelector('.k-numerictextbox');
      let w: any = null; if (wrap) { try { w = kendo.widgetInstance($(wrap)); } catch (e) {} }
      if (!w && grp) grp.querySelectorAll('input').forEach((inp: any) => { const x = $(inp).data('kendoNumericTextBox'); if (x) w = x; });
      if (w) { w.value(v); w.trigger('change'); }
    }, [labelRe, val]).catch(() => {});
    const fill = async (id: string, v?: string) => { const l = page.locator("#" + id); if ((await l.count()) && v != null && v !== "") await l.fill(String(v)).catch(() => {}); };

    try {
      // ===== A) Agency Wizard — create draft =====
      await page.goto(BASE + "/agency/ApplicationWizard", { waitUntil: "domcontentloaded", timeout: 60000 });
      await wait(2500);
      await page.locator(".image-container[data-value]").first().click({ timeout: 8000 }).catch(() => {});
      await wait(800); await next(); await wait(1500);
      await page.locator(`.image-container[data-value="${degreeValue(profile.level)}"]`).first().click({ timeout: 8000 }).catch(() => {});
      await wait(800); await next(); await wait(1500);
      await fill("firstName", profile.firstName);
      await fill("lastName", profile.lastName);
      await fill("passportNumber", profile.passportNumber);
      await fill("email", profile.email);
      await wait(600);
      if (dryRun) {
        result.dryReachedFinal = await page.locator('button:has-text("Done")').first().isVisible().catch(() => false);
        logger.info("[okan] DRY: reached draft Done boundary — stopping. " + JSON.stringify(result));
        return result as SubmitResult;
      }
      await clickVisible("Done");
      await wait(5000);
      if (!/trackwizard/i.test(page.url())) {
        await page.goto(BASE + "/Agency/TrackApplications", { waitUntil: "domcontentloaded", timeout: 60000 });
        await wait(2500);
        await page.locator('a[href*="trackwizard"]').first().click({ timeout: 8000 }).catch(() => {});
        await wait(3000);
      }

      // ===== B) Application Form (6 steps) =====
      // 1 Application Type
      await page.locator('.image-container[data-value="1"]').first().click({ timeout: 8000 }).catch(() => {});
      await wait(600); await next(); await wait(1500);
      // 2 Personal Details
      await setKendo("gender", genderText((profile as any).gender));
      await fill("passportNumber", profile.passportNumber);
      await fill("birthdate", (profile.dateOfBirth || "").slice(0, 10));
      await setKendo("citizenshipId", profile.nationality);
      await setKendo("blueCard", "No");
      await setKendo("residence", "No");
      await setKendo("countryOfResidenceId", profile.nationality);
      await fill("address", profile.address);
      await fill("mobilePhone", String(profile.phone || "").replace(/^\+?90/, "").replace(/^\+/, ""));
      await fill("city", lastWord(profile.address));
      await fill("birthplace", lastWord(profile.address));
      await fill("mothersName", (profile as any).motherName);
      await fill("fathersName", (profile as any).fatherName);
      await fill("familyPhoneNumber", String(profile.phone || "").replace(/^\+?90/, "").replace(/^\+/, ""));
      await wait(600); await next(); await wait(1800);
      // 3 Program Selection — keyword filter → Select
      if (profile.programName) {
        await fill("programKeyword", profile.programName.replace(/\(.*\)/, "").trim());
        await wait(2000);
        const ok = await page.locator('button:has-text("Select")').first().isVisible().catch(() => false);
        if (ok) await page.locator('button:has-text("Select")').first().click({ timeout: 6000 }).catch(() => {});
        else result.programMissing = true;
        await wait(1000);
      }
      await next(); await wait(1800);
      // 4 Educational Information
      await fill("secondarySchoolName", (profile as any).schoolName);
      await fill("graduationYearOfSecondarySchool", String((profile as any).graduationYear || ""));
      await fill("cityOfSecondarySchool", lastWord((profile as any).schoolName) || lastWord(profile.address));
      await setKendo("countryOfSecondarySchoolId", profile.nationality);
      if ((profile as any).gpa != null) await setNumeric("gpa of secondary", Number((profile as any).gpa));
      await wait(600); await next(); await wait(1800);
      // 5 Documents — Passport + Last High School Transcript (PDF). One file input + "Upload" per doc.
      const uploadDoc = async (labelRe: RegExp, fpath?: string) => {
        if (!fpath) return;
        const grp = page.locator(`div:has(> label:text-matches("${labelRe.source}", "i"))`).first();
        const fi = (await grp.count()) ? grp.locator('input[type=file]').first() : page.locator('input[type=file]').first();
        if (await fi.count()) { await fi.setInputFiles(fpath).catch(() => {}); await wait(800); }
        // click the Upload button nearest this doc
        const up = (await grp.count()) ? grp.locator('button:has-text("Upload")').first() : page.locator('button:has-text("Upload")').first();
        if (await up.count()) { await up.click({ timeout: 8000 }).catch(() => {}); await wait(2500); }
      };
      await uploadDoc(/passport/i, (files as any).passport);
      await uploadDoc(/transcript|high school/i, (files as any).transcript);
      await wait(1000); await next(); await wait(2000);
      // 6 Completed — final submit
      (await clickVisible("Submit")) || (await clickVisible("Complete")) || (await clickVisible("Finish")) || (await clickVisible("Done"));
      await wait(6000);
      const body = (await page.evaluate("(()=>document.body?document.body.innerText:'')()")) as string;
      if (/already|kayıtlı|duplicate|zaten/i.test(body)) result.alreadyExists = true;
      else if (/success|completed|received|başvurunuz|thank you|tamamland|application.*complete/i.test(body)) result.submitted = true;
      result.detail = body.replace(/\s+/g, " ").slice(0, 180);
      logger.info("[okan] submit " + JSON.stringify(result));
      return result as SubmitResult;
    } catch (e: any) {
      result.error = e?.message || String(e);
      logger.info("[okan] submit " + JSON.stringify(result));
      return result as SubmitResult;
    }
  },
};
export default okanAdapter;
