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
import {
  hasSalesforceCompletionProof,
  inferSalesforceDocumentSlot,
  isOwnedSalesforceApplicant,
  normalizeSalesforceStage,
  parseSalesforceStageMarker,
  resolveSalesforceProgramTarget,
  salesforceApplicantReadbackFailures,
  salesforceDuplicateDisposition,
  salesforcePortalProgramCandidates,
  type SalesforceStage,
} from "./portalState.js";

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
      const strictMappedPortal = new Set([
        "uskudar",
        "beykent",
        "isik",
      ]).has(cfg.key);
      if (strictMappedPortal) {
        const missingProfile = [
          ["firstName", profile.firstName],
          ["lastName", profile.lastName],
          ["passportNumber", profile.passportNumber],
          ["email", profile.email],
          ["dateOfBirth", profile.dateOfBirth],
          ["gender", profile.gender],
          ["nationality", profile.nationality],
          ["address", profile.address],
          ["addressCity", profile.addressCity],
          ["phone", profile.phone],
          ["level", profile.level],
          ["programName", profile.programName],
          ["schoolName", profile.schoolName],
          ["gpa", profile.gpa],
        ]
          .filter(([, value]) => value == null || String(value).trim() === "")
          .map(([field]) => String(field));
        if (missingProfile.length > 0) {
          throw new Error(
            `Salesforce ${cfg.key} data_missing: ${missingProfile.join(", ")}`,
          );
        }
        if (!dryRun) {
          const missingDocuments = cfg.requiredDocs.filter(
            (slot) => !files[slot],
          );
          if (missingDocuments.length > 0) {
            return {
              submitted: false,
              alreadyExists: false,
              programMissing: false,
              missingDocuments,
              detail: `${cfg.label}: required documents are missing`,
            };
          }
        }
      }

      // --- Boot-first SPA navigation (Sabancı / 2-phase Experience Cloud fix) ---
      // A cold goto(application-form) is redirected Home by the SPA route-guard,
      // so the wizard never renders. Boot on Home first (let the app-shell
      // hydrate), then reach the wizard via an in-app link, falling back to a
      // warmed goto. Retry up to 3× until a wizard form field is visible.
      const agencyUrl = cfg.portalUrl.replace(/\/$/, "") + "/";
      const appFormUrl = agencyUrl + "application-form";
      const FORM_SEL = 'input[name="First_Name"], input[name="Last_Name"], input[name="Passport_Number"], input[name="Student_First_Name"], input[name="eduhubPicklistOptions"], input[placeholder*="search program" i], input[placeholder*="keyword" i], select[name="Gender"], input[name="Country_of_Secondary_School"], input[type=file]';
      // "Any visible match" — FORM_SEL is a broad union, so .first() can bind to
      // a hidden element while another field is actually on screen. Iterate.
      const onWizard = async (): Promise<boolean> => { try { const loc = page.locator(FORM_SEL); const n = await loc.count(); for (let i = 0; i < Math.min(n, 12); i++) { if (await loc.nth(i).isVisible().catch(() => false)) return true; } return false; } catch (e) { return false; } };
      const filterTrackApplicant = async (
        query: string,
      ): Promise<void> => {
        const listSearch = page
          .getByPlaceholder(/search this list/i)
          .first();
        if (query && (await listSearch.count())) {
          await listSearch.fill(query).catch(() => {});
          await listSearch.press("Enter").catch(() => {});
          await page.waitForTimeout(4000);
          return;
        }

        // Beykent's current lightning-datatable exposes Search as a button.
        // It opens one unlabeled text filter rather than a placeholder input.
        const searchButton = page
          .getByRole("button", { name: /^\s*search\s*$/i })
          .first();
        if (!(await searchButton.count())) return;
        await searchButton.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const textInputs = page.locator('input[type="text"]');
        const visibleTextInputs: any[] = [];
        const count = await textInputs.count().catch(() => 0);
        for (let index = 0; index < count; index++) {
          if (
            await textInputs
              .nth(index)
              .isVisible()
              .catch(() => false)
          ) {
            visibleTextInputs.push(textInputs.nth(index));
          }
        }
        if (query && visibleTextInputs.length === 1) {
          await visibleTextInputs[0].fill(query).catch(() => {});
          await visibleTextInputs[0].press("Enter").catch(() => {});
          await page.waitForTimeout(4000);
        }
      };
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
      const inspectOwnedApplicant = async (): Promise<{
        owned: boolean;
        externalRef: string;
        applicationStatus: string;
        trackStage: string;
      }> => {
        const empty = {
          owned: false,
          externalRef: "",
          applicationStatus: "",
          trackStage: "",
        };
        if (!strictMappedPortal) return empty;
        await page.goto(agencyUrl + "track-application", {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        }).catch(() => {});
        await page.waitForTimeout(8000);
        // Beykent's global filter matches one column at a time, so an exact
        // email lookup is reliable while a combined "First Last" query is not.
        // Ownership below still requires both the name and email readback.
        await filterTrackApplicant(profile.email);
        const emailPattern = new RegExp(
          profile.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i",
        );
        const rows = page.locator("tr").filter({ hasText: emailPattern });
        if ((await rows.count().catch(() => 0)) !== 1) return empty;
        const row = rows.first();
        const cellText = async (label: string): Promise<string> => {
          const cell = row.locator(`[data-label="${label}"]`).first();
          return ((await cell.innerText().catch(() => "")) || "")
            .replace(/\s+/g, " ")
            .trim();
        };
        const firstName = await cellText("First Name");
        const lastName = await cellText("Last Name");
        const rowName =
          `${firstName} ${lastName}`.trim() ||
          (await cellText("Name"));
        const rowEmail = await cellText("Email");
        const mailtoHref =
          (await row
            .locator('a[href^="mailto:"]')
            .first()
            .getAttribute("href")
            .catch(() => "")) || "";
        const owned = isOwnedSalesforceApplicant({
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
          rowName,
          rowEmail: mailtoHref || rowEmail,
        });
        if (!owned) return empty;
        return {
          owned,
          externalRef:
            (await cellText("Application Name")) ||
            (await cellText("Name")),
          applicationStatus: await cellText("Application Status"),
          trackStage: await cellText("Stage"),
        };
      };
      const applicantPreflight = await inspectOwnedApplicant();
      logger.info(`[salesforce:${cfg.key}] applicant preflight`, {
        owned: applicantPreflight.owned,
        hasApplicationRef: Boolean(applicantPreflight.externalRef),
        hasApplicationStatus: Boolean(applicantPreflight.applicationStatus),
        hasTrackStage: Boolean(applicantPreflight.trackStage),
      });
      if (
        applicantPreflight.owned &&
        hasSalesforceCompletionProof(applicantPreflight)
      ) {
        return {
          alreadyExists: true,
          submitted: false,
          programMissing: false,
          externalRef: applicantPreflight.externalRef,
          detail: `${cfg.label}: application already completed in portal`,
        };
      }
      const tryResumeOwnedApplicant = async (): Promise<boolean> => {
        if (!strictMappedPortal || !applicantPreflight.owned) return false;
        await page
          .goto(agencyUrl + "track-application", {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          })
          .catch(() => {});
        await page.waitForTimeout(7000);
        await filterTrackApplicant(profile.email);
        const emailPattern = new RegExp(
          profile.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i",
        );
        const rows = page.locator("tr").filter({ hasText: emailPattern });
        if ((await rows.count().catch(() => 0)) !== 1) return false;
        const row = rows.first();
        const rowText = await row.innerText().catch(() => "");
        const mailto =
          (await row
            .locator('a[href^="mailto:"]')
            .first()
            .getAttribute("href")
            .catch(() => "")) || "";
        if (
          !isOwnedSalesforceApplicant({
            firstName: profile.firstName,
            lastName: profile.lastName,
            email: profile.email,
            rowName: rowText,
            rowEmail: mailto,
          })
        ) {
          return false;
        }
        const selectors = row.locator(
          'input[type="radio"],input[type="checkbox"]',
        );
        if ((await selectors.count().catch(() => 0)) === 1) {
          await selectors.first().check({ force: true }).catch(() => {});
        }
        const actions = row.getByRole("button", {
          name: /complete application|continue application|edit application|view application/i,
        });
        if ((await actions.count().catch(() => 0)) !== 1) return false;
        const popupPromise = page
          .waitForEvent("popup", { timeout: 8000 })
          .catch(() => null);
        await actions.first().click({ timeout: 6000 }).catch(() => {});
        const popup = await popupPromise;
        if (popup) {
          await popup
            .waitForLoadState("domcontentloaded", { timeout: 15_000 })
            .catch(() => {});
          const popupUrl = popup.url();
          if (
            popupUrl &&
            new URL(popupUrl).origin === new URL(agencyUrl).origin
          ) {
            await page
              .goto(popupUrl, {
                waitUntil: "domcontentloaded",
                timeout: 60_000,
              })
              .catch(() => {});
          }
          await popup.close().catch(() => {});
        }
        await page.waitForTimeout(4500);
        if (await onWizard()) return true;

        // Beykent first opens a read-only detail page from the table. Resume
        // only through one uniquely named edit/complete action.
        const detailAction = page.getByRole("button", {
          name: /complete application|continue application|edit application/i,
        });
        if ((await detailAction.count().catch(() => 0)) !== 1) return false;
        await detailAction.first().click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(4500);
        return onWizard();
      };
      await tryResumeOwnedApplicant();
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
      const hasVisible = async (sel: string): Promise<boolean> => {
        try {
          const controls = page.locator(sel);
          const count = await controls.count();
          for (let i = 0; i < count; i++) {
            if (await controls.nth(i).isVisible().catch(() => false)) return true;
          }
          return false;
        } catch {
          return false;
        }
      };
      const typeInto = async (sel: string, v?: string | number): Promise<boolean> => {
        if (v === undefined || v === null || v === "") return false;
        try {
          const loc = page.locator(sel);
          const cnt = await loc.count();
          let target: any = null;
          for (let i = 0; i < cnt; i++) {
            if (await loc.nth(i).isVisible().catch(() => false)) {
              target = loc.nth(i);
              break;
            }
          }
          if (!target) return false;
          const expected = String(v);
          await target.fill(expected);
          let current = await target.inputValue().catch(() => "");
          if (current !== expected) {
            await target.click();
            await target.fill("");
            await target.pressSequentially(expected, { delay: 45 });
            current = await target.inputValue().catch(() => "");
          }
          await target.press("Tab").catch(() => {});
          return (
            current === expected &&
            (await target.getAttribute("aria-invalid").catch(() => null)) !==
              "true"
          );
        } catch {
          return false;
        }
      };
      const fill = typeInto;
      const visibleControls = async (locator: any): Promise<any[]> => {
        const visible: any[] = [];
        const count = await locator.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          if (await locator.nth(i).isVisible().catch(() => false)) {
            visible.push(locator.nth(i));
          }
        }
        return visible;
      };
      const fillAndReadUnique = async (
        locator: any,
        value?: string | number,
      ): Promise<{ value: string; invalid: boolean; found: boolean }> => {
        if (value === undefined || value === null || String(value) === "") {
          return { value: "", invalid: false, found: false };
        }
        const controls = await visibleControls(locator);
        if (controls.length !== 1) {
          return { value: "", invalid: false, found: false };
        }
        const control = controls[0];
        const expected = String(value);
        try {
          await control.fill(expected);
          let current = await control.inputValue().catch(() => "");
          if (current !== expected) {
            await control.click();
            await control.fill("");
            await control.pressSequentially(expected, { delay: 45 });
            current = await control.inputValue().catch(() => "");
          }
          await control.press("Tab").catch(() => {});
          await page.waitForTimeout(180);
          current = await control.inputValue().catch(() => "");
          return {
            value: current,
            invalid:
              (await control
                .getAttribute("aria-invalid")
                .catch(() => null)) === "true",
            found: true,
          };
        } catch {
          return { value: "", invalid: false, found: true };
        }
      };
      const readValidationMessages = async (): Promise<string[]> =>
        (
          await page
            .locator(
              '[role="alert"],.slds-form-element__help,[aria-invalid="true"]',
            )
            .allInnerTexts()
            .catch(() => [])
        )
          .map((text: string) => text.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 8);
      const selByName = async (name: string, label?: string): Promise<boolean> => {
        try {
          const s = page.locator(`select[name="${name}"]`).first();
          if (!(await s.count())) return false;
          if (!label) {
            if (strictMappedPortal) return false;
            await s.selectOption({ index: 1 });
            return Boolean(await s.inputValue());
          }
          try {
            await s.selectOption({ label });
          } catch {
            if (strictMappedPortal) return false;
            await s.selectOption({ index: 1 });
          }
          const selected = await s
            .locator("option:checked")
            .first()
            .innerText()
            .catch(() => "");
          return (
            Boolean(await s.inputValue().catch(() => "")) &&
            (!strictMappedPortal ||
              fold(selected) === fold(label) ||
              fold(selected).includes(fold(label)))
          );
        } catch {
          return false;
        }
      };
      const clickNext = async () => { const n = page.getByRole("button", { name: /^\s*(next|ileri|sonraki|devam)\s*$/i }).first(); if (await n.count()) { await n.click({ timeout: 6000 }).catch(() => {}); return true; } const __cna = page.getByRole("button", { name: /create new application|add application|create application/i }).first(); if (await __cna.count()) { await __cna.click({ timeout: 6000 }).catch(() => {}); return true; } return false; };
      const setBinaryAnswer = async (
        question: RegExp,
        answer: "Yes" | "No",
      ): Promise<boolean> => {
        const groups = page
          .locator("fieldset,.slds-form-element,[role=radiogroup]")
          .filter({ hasText: question });
        const count = await groups.count().catch(() => 0);
        if (count !== 1) return false;
        const target = groups
          .first()
          .locator(
            `input[type="radio"][value="${answer}" i],input[type="radio"][data-value="${answer}" i]`,
          )
          .first();
        if (!(await target.count())) return false;
        await target.check({ force: true }).catch(() => {});
        return target.isChecked().catch(() => false);
      };
      const readActiveStage = async (): Promise<SalesforceStage> => {
        const stageName = page.locator(".slds-path__stage-name").first();
        if (
          (await stageName.count().catch(() => 0)) &&
          (await stageName.isVisible().catch(() => false))
        ) {
          const marker = await stageName.innerText().catch(() => "");
          const stage = parseSalesforceStageMarker(marker);
          if (stage) return stage;
        }
        const current = page.locator(
          [
            ".slds-path__item.slds-is-current",
            ".slds-progress__item.slds-is-active",
            ".slds-progress__item.slds-is-current",
            '[aria-current="step"]',
          ].join(","),
        );
        const count = await current.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const item = current.nth(i);
          if (!(await item.isVisible().catch(() => false))) continue;
          const text = ((await item.innerText().catch(() => "")) || "").trim();
          for (const line of text.split(/\r?\n/)) {
            const stage = normalizeSalesforceStage(line.trim());
            if (stage) return stage;
          }
          const stage = normalizeSalesforceStage(text);
          if (stage) return stage;
        }

        // Control-based inference is used only when the path component exposes
        // no active marker. Future step labels in body text are never evidence.
        if (
          await hasVisible(
            'input[placeholder*="search program" i],input[placeholder*="keyword" i]',
          )
        ) return "Program Selection";
        if (await hasVisible('select[name="Gender"]')) {
          return "Personal Information";
        }
        if (
          await hasVisible(
            'select[name="Country_of_Secondary_School"],input[name="Name_of_Secondary_School"]',
          )
        ) return "Educational Information";
        if (await hasVisible("input[type=file]")) return "Documents";
        const submit = page
          .getByRole("button", {
            name: /^\s*(submit|complete|tamamla|gönder|finish|onayla)\s*$/i,
          })
          .first();
        if (
          (await submit.count()) &&
          (await submit.isVisible().catch(() => false))
        ) return "Review and Submit";
        return null;
      };
      const verifyTrackCompletion = async (): Promise<{
        verified: boolean;
        externalRef?: string;
        applicationStatus?: string;
        trackStage?: string;
      }> => {
        const trackApplicant = await inspectOwnedApplicant();
        if (!trackApplicant.owned) {
          return { verified: false };
        }
        return {
          verified: hasSalesforceCompletionProof(trackApplicant),
          ...(trackApplicant.externalRef
            ? { externalRef: trackApplicant.externalRef }
            : {}),
          applicationStatus: trackApplicant.applicationStatus,
          trackStage: trackApplicant.trackStage,
        };
      };
      const dobm = String(profile.dateOfBirth || "").match(/(\d{4})-(\d{2})-(\d{2})/);
      const dobStr = dobm ? (dobm[2] + "/" + dobm[3] + "/" + dobm[1]) : strictMappedPortal ? "" : "01/01/2000";
      for (let step = 0; step < 12; step++) {
        await page.waitForTimeout(2500);
        const txt = await bodyText();
        const activeStage = await readActiveStage();
        if (DUP.test(txt)) {
          const duplicateDisposition = salesforceDuplicateDisposition({
            activeStage,
            ownedApplicant: applicantPreflight.owned,
            completionProved: hasSalesforceCompletionProof(
              applicantPreflight,
            ),
          });
          if (duplicateDisposition === "continue") {
            logger.info(
              `[salesforce:${cfg.key}] stale applicant duplicate notice ignored after verified wizard advance`,
              { activeStage },
            );
          } else if (duplicateDisposition === "resume") {
            const resume = page
              .getByRole("button", {
                name: /create new application|add application|continue application|complete application/i,
              })
              .first();
            if (await resume.count()) {
              await resume.click({ timeout: 6000 }).catch(() => {});
              await page.waitForTimeout(4000);
              continue;
            }
            if (!activeStage) {
              const beforeResume = (await bodyText()).replace(/\s+/g, " ");
              const clicked = await clickNext();
              if (clicked) {
                await page.waitForTimeout(5000);
                const afterResume = (await bodyText()).replace(/\s+/g, " ");
                const resumedStage = await readActiveStage();
                if (
                  resumedStage ||
                  beforeResume !== afterResume ||
                  (await page
                    .getByPlaceholder(/search program name|keyword/i)
                    .count()) > 0
                ) {
                  continue;
                }
              }
              result.stuckStep = step;
              result.detail =
                `${cfg.label}: owned applicant exists but application continuation did not advance`;
              break;
            }
          } else if (duplicateDisposition === "already_exists") {
            result.alreadyExists = true;
            break;
          } else {
            result.stuckStep = step;
            result.detail =
              `${cfg.label}: applicant already exists, but no owned application continuation or completion proof was found`;
            break;
          }
        }
        if (
          !activeStage &&
          /application\s*number/i.test(txt) &&
          APP_NUM.test(txt)
        ) {
          result.stuckStep = step;
          result.detail =
            `${cfg.label}: application reference exists, but completion could not be proved`;
          break;
        }
        const before = (await bodyText()).replace(/\s+/g, " ").slice(0, 600);
        if ((await has("input[name=\"Student_First_Name\"]")) || ((await has("input[name=\"First_Name\"]")) && !(await has("select[name=\"Gender\"]")))) {
          if (strictMappedPortal) {
            const firstNameProof = await fillAndReadUnique(
              page.locator(
                'input[name="Student_First_Name"],input[name="First_Name"]',
              ),
              profile.firstName,
            );
            const lastNameProof = await fillAndReadUnique(
              page.locator(
                'input[name="Student_Last_Name"],input[name="Last_Name"]',
              ),
              profile.lastName,
            );
            const passportProof = await fillAndReadUnique(
              page.locator(
                'input[name="Student_Passport_Number"],input[name="Passport_Number"]',
              ),
              profile.passportNumber,
            );

            // Beykent exposes this as type=text with a dynamic
            // "<student name>'s Email" label and no stable name/placeholder.
            // Accessible-label lookup is therefore the primary selector.
            let emailLocator = page.getByLabel(/email/i);
            if ((await visibleControls(emailLocator)).length !== 1) {
              emailLocator = page.locator(
                [
                  'input[type="email"]',
                  'input[name*="email" i]',
                  'input[name*="mail" i]',
                  'input[placeholder*="@"]:not([type="password"])',
                ].join(","),
              );
            }
            const emailProof = await fillAndReadUnique(
              emailLocator,
              profile.email,
            );
            const invalidFields = [
              ...(firstNameProof.invalid ? ["firstName"] : []),
              ...(lastNameProof.invalid ? ["lastName"] : []),
              ...(passportProof.invalid ? ["passportNumber"] : []),
              ...(emailProof.invalid ? ["email"] : []),
            ];
            const applicantFailures = salesforceApplicantReadbackFailures(
              {
                firstName: profile.firstName,
                lastName: profile.lastName,
                passportNumber: profile.passportNumber,
                email: profile.email,
              },
              {
                firstName: firstNameProof.value,
                lastName: lastNameProof.value,
                passportNumber: passportProof.value,
                email: emailProof.value,
                invalidFields,
              },
            );
            logger.info(`[salesforce:${cfg.key}] applicant readback`, {
              firstName: !applicantFailures.includes("firstName"),
              lastName: !applicantFailures.includes("lastName"),
              passportNumber: !applicantFailures.includes("passportNumber"),
              email: !applicantFailures.includes("email"),
            });
            if (applicantFailures.length > 0) {
              result.stuckStep = step;
              result.detail =
                `${cfg.label}: applicant fields could not be verified (${applicantFailures.join(", ")})`;
              break;
            }
          } else {
            await typeInto("input[name=\"Student_First_Name\"]", profile.firstName);
            await typeInto("input[name=\"First_Name\"]", profile.firstName);
            await typeInto("input[name=\"Student_Last_Name\"]", profile.lastName);
            await typeInto("input[name=\"Last_Name\"]", profile.lastName);
            await typeInto("input[name=\"Student_Passport_Number\"]", profile.passportNumber);
            await typeInto("input[name*=Passport i]", profile.passportNumber);
            await typeInto("input[placeholder=\"you@example.com\"]", profile.email);
            await typeInto("input[type=email]", profile.email);
            await typeInto("input[placeholder*=\"@\"]:not([type=password])", profile.email);
          }
          if (!strictMappedPortal) {
            try { const __cb = page.locator("input[role=combobox], input[aria-autocomplete=list], input[aria-autocomplete=both], input[id*=combobox]"); const __cbn = await __cb.count(); for (let __i = 0; __i < __cbn; __i++) { const __e = __cb.nth(__i); if (!(await __e.isVisible().catch(() => false))) continue; if ((await __e.inputValue().catch(() => "x")) !== "") continue; await __e.click().catch(() => {}); await __e.fill(profile.nationality || "Turkey").catch(() => {}); await page.waitForTimeout(1500); const __o = page.locator("[role=option], lightning-base-combobox-item, .slds-listbox__option, li[role=option]").first(); if (await __o.count()) await __o.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(600); } } catch (e) {}
          }
          if (!strictMappedPortal) {
            try { const __cand = page.locator("input[required], input[aria-required=\"true\"]"); const __cn = await __cand.count(); for (let __ci = 0; __ci < __cn; __ci++) { const __el = __cand.nth(__ci); if (!(await __el.isVisible().catch(() => false))) continue; const __ty = (await __el.getAttribute("type").catch(() => "")) || "text"; if (__ty === "radio" || __ty === "checkbox") continue; const __idr = ((await __el.getAttribute("id").catch(() => "")) || "") + ((await __el.getAttribute("role").catch(() => "")) || "") + ((await __el.getAttribute("aria-autocomplete").catch(() => "")) || ""); if (/combobox|list|both/i.test(__idr)) continue; const __cv = await __el.inputValue().catch(() => "x"); if (__cv === "") { await __el.fill(profile.email).catch(() => {}); break; } } } catch (e) {}
          }
          try { const cz = page.getByLabel(/citizenship|vatanda/i).first(); if ((await cz.count()) && (await cz.isVisible().catch(() => false))) { await cz.click().catch(() => {}); await cz.fill(profile.nationality || "Turkey").catch(() => {}); await page.waitForTimeout(1500); const o = strictMappedPortal ? page.getByRole("option", { name: new RegExp("^" + profile.nationality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") }).first() : page.locator("[role=option],lightning-base-combobox-item,li").first(); if (await o.count()) await o.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700); } } catch (e) {}
          if (!strictMappedPortal) {
            try { const eml = page.getByLabel(/applicant email|email address/i).first(); if ((await eml.count()) && (await eml.isVisible().catch(() => false)) && !(await eml.inputValue().catch(() => "x")) && profile.email) { await eml.click().catch(() => {}); await page.keyboard.type(profile.email, { delay: 40 }).catch(() => {}); await eml.press("Tab").catch(() => {}); } } catch (e) {}
          }
          if (!(await clickNext())) {
            result.stuckStep = step;
            result.detail = `${cfg.label}: applicant Next control was not found`;
            break;
          }
          let applicantMoved = false;
          for (let t = 0; t < 12; t++) {
            await page.waitForTimeout(750);
            const applicantStillVisible =
              (await hasVisible('input[name="Student_First_Name"]')) ||
              ((await hasVisible('input[name="First_Name"]')) &&
                !(await hasVisible('select[name="Gender"]')));
            if (
              DUP.test(await bodyText()) ||
              (await hasVisible(
                'input[placeholder*="search program" i],input[placeholder*="keyword" i]',
              )) ||
              !applicantStillVisible
            ) {
              applicantMoved = true;
              break;
            }
          }
          if (!applicantMoved) {
            const validation = await readValidationMessages();
            result.stuckStep = step;
            result.detail =
              `${cfg.label}: applicant screen did not advance` +
              (validation.length
                ? ` — validation: ${validation.join(" | ")}`
                : "");
            break;
          }
          continue;
        } else if (/available programs/i.test(txt) || (await page.getByPlaceholder(/search program name|keyword/i).count())) {
          const programTarget = strictMappedPortal
            ? resolveSalesforceProgramTarget(
                profile.programName,
                profile.programNameMap,
                profile.programNameMapGeneral,
              )
            : {
                label: profile.programName,
                source: "normalized" as const,
                ambiguous: false,
              };
          if (programTarget.ambiguous) {
            result.stuckStep = step;
            result.detail =
              `${cfg.label}: programme mapping is ambiguous for the requested CRM programme`;
            break;
          }
          const programCandidates =
            salesforcePortalProgramCandidates(programTarget);
          // Boş program adı match-all regex üretir (yanlış program seçer) → güvenli çıkış.
          if (!programCandidates.length) {
            result.programMissing = true;
            logger.warn("[salesforce:" + cfg.key + "] program adı boş — Available Programs atlanıyor", { crmProgram: profile.programName });
            break;
          }
          // Live Salesforce builds use both "Programme (English)" and
          // "Programme - English". Search each deterministic spelling and
          // accept only one exact visible label; never fall back to a similar
          // or first programme.
          const kw = page
            .getByPlaceholder(/search program name|keyword/i)
            .first();
          let portalProg = programCandidates[0];
          let visibleExactLabels: any[] = [];
          for (const candidate of programCandidates) {
            try {
              if (await kw.count()) {
                await kw.fill("");
                await kw.fill(candidate);
                await kw.press("Tab").catch(() => {});
                await page.waitForTimeout(2500);
              } else {
                await page.waitForTimeout(1200);
              }
            } catch {
              await page.waitForTimeout(1200);
            }

            const escapedCandidate = candidate.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );
            const exactCandidateLabels = page.getByText(
              new RegExp(`^\\s*${escapedCandidate}\\s*$`, "i"),
            );
            const visibleCandidates: any[] = [];
            const candidateCount = await exactCandidateLabels
              .count()
              .catch(() => 0);
            for (let i = 0; i < candidateCount; i++) {
              if (
                await exactCandidateLabels
                  .nth(i)
                  .isVisible()
                  .catch(() => false)
              ) {
                visibleCandidates.push(exactCandidateLabels.nth(i));
              }
            }
            if (visibleCandidates.length > 0) {
              portalProg = candidate;
              visibleExactLabels = visibleCandidates;
              break;
            }
          }
          // Teşhis: filtre sonrası kart metinlerini dök (mapping doğrulama için)
          try {
            const cards = page.locator('li, article, lightning-card, [class*="card" i], [class*="tile" i], tr');
            const cn = Math.min(await cards.count().catch(() => 0), 40);
            const labels: string[] = [];
            for (let i = 0; i < cn; i++) {
              const t = ((await cards.nth(i).innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
              if (t && /select/i.test(t) && t.length < 160) labels.push(t.slice(0, 120));
            }
            logger.info("[salesforce:" + cfg.key + "] Available Programs kartları", {
              portalProg,
              programCandidates,
              mappingSource: programTarget.source,
              count: labels.length,
              sample: labels.slice(0, 15),
            });
          } catch (e) {}
          // KÖK NEDEN: kartlar KAPALI shadow root'ta; page.evaluate manuel walk giremez (cards:0).
          // Playwright locator'ları kapalı shadow'u deler → seçimi tamamen Playwright ile yap.
          const escapedPortalProgram = portalProg.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          );
          const exactProgramLabel = page.getByText(
            new RegExp(`^\\s*${escapedPortalProgram}\\s*$`, "i"),
          );
          if (!visibleExactLabels.length) {
            const exactLabelCount = await exactProgramLabel
              .count()
              .catch(() => 0);
            for (let i = 0; i < exactLabelCount; i++) {
              if (
                await exactProgramLabel
                  .nth(i)
                  .isVisible()
                  .catch(() => false)
              ) {
                visibleExactLabels.push(exactProgramLabel.nth(i));
              }
            }
          }
          const cartBtn = page.getByRole("button", { name: /selected programs/i }).first();
          const readCartN = async () => { const t = (await cartBtn.count()) ? (((await cartBtn.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim()) : ""; return ((t.match(/\((\d+)\)/) || [])[1]) || "0"; };
          let cartN = "0";
          const cardCount = visibleExactLabels.length;
          for (let attempt = 1; attempt <= 2 && cartN === "0"; attempt++) {
            if (!cardCount) break;
            if (strictMappedPortal && cardCount !== 1) {
              logger.warn(
                `[salesforce:${cfg.key}] program target ambiguous; count=${cardCount}`,
              );
              break;
            }
            const label = visibleExactLabels[0];
            let row = label.locator("xpath=ancestor::tr[1]");
            if (!(await row.count().catch(() => 0))) {
              row = page
                .locator(
                  'li,article,lightning-card,[class*="card" i],[class*="tile" i]',
                )
                .filter({ has: label })
                .filter({ hasText: /select/i })
                .last();
            }
            const target = row
              .getByRole("button", { name: /^\s*select\s*$/i })
              .first();
            if (!(await target.count().catch(() => 0))) break;
            await target.scrollIntoViewIfNeeded().catch(() => {});
            await target.click({ timeout: 6000 }).catch(() => {});
            await page.waitForTimeout(2400);
            cartN = await readCartN();
          }
          if (cardCount === 0) {
            result.programMissing = true;
            logger.warn("[salesforce:" + cfg.key + "] program bulunamadı (Available Programs)", { crmProgram: profile.programName, portalProg, cardCount });
            break;
          }
          logger.info("[salesforce:" + cfg.key + "] program Select tıklandı (Playwright/pierce)", { portalProg, cartN, cardCount });
          if (cartN === "0") {
            result.programMissing = true;
            logger.warn("[salesforce:" + cfg.key + "] sepet boş kaldı (Select tıklandı ama sepet artmadı)", { portalProg, cardCount });
            break;
          }
          let advanced = false;
          if ((await cartBtn.count())) {
            await cartBtn.click({ timeout: 4000 }).catch(() => {});
            await page.waitForTimeout(1500);
            const selectedProgramLabelCount = await page
              .getByText(
                new RegExp(`^\\s*${escapedPortalProgram}\\s*$`, "i"),
              )
              .count()
              .catch(() => 0);
            if (strictMappedPortal && selectedProgramLabelCount < 1) {
              result.programMissing = true;
              result.detail =
                `${cfg.label}: selected programme readback could not be proved`;
              break;
            }
            const modalSave = page.getByRole("button", { name: /save and next|save & next/i }).first();
            if (await modalSave.count()) {
              await modalSave.click({ timeout: 6000 }).catch(() => {});
              await page.waitForTimeout(3500);
              advanced = (await readActiveStage()) !== "Program Selection";
            }
          }
          logger.info("[salesforce:" + cfg.key + "] program seçildi (Save and Next)", { portalProg, cartN, advanced });
          if (strictMappedPortal && !advanced) {
            result.stuckStep = step;
            result.detail =
              `${cfg.label}: programme selection did not advance`;
            break;
          }
          continue;
        } else if (await has("select[name=\"Gender\"]")) {
          const personalProof: Record<string, boolean> = {};
          personalProof.firstName = await fill(
            'input[name="First_Name"]',
            profile.firstName,
          );
          personalProof.lastName = await fill(
            'input[name="Last_Name"]',
            profile.lastName,
          );
          personalProof.gender = await selByName(
            "Gender",
            /female/i.test(profile.gender || "") ? "Female" : "Male",
          );
          personalProof.citizenship = await selByName(
            "Citizenship",
            profile.nationality,
          );
          personalProof.residenceCountry = await selByName(
            "Country_of_Residence",
            profile.nationality,
          );
          personalProof.source = await selByName(
            "Where_did_you_hear_us",
            "University Website",
          );
          const dateControl = page
            .locator('input[name*="Date_of_Birth" i],input[name*="birth" i]')
            .first();
          personalProof.dateOfBirth = false;
          if (await dateControl.count()) {
            await dateControl.click().catch(() => {});
            await dateControl.fill("").catch(() => {});
            await dateControl.pressSequentially(dobStr, { delay: 45 }).catch(() => {});
            await dateControl.press("Tab").catch(() => {});
            personalProof.dateOfBirth = Boolean(
              await dateControl.inputValue().catch(() => ""),
            );
          }
          if (strictMappedPortal) {
            personalProof.turkishCitizenship = await setBinaryAnswer(
              /turkish citizenship|türk vatanda/i,
              profile.hasTcId ? "Yes" : "No",
            );
            personalProof.residencePermit = await setBinaryAnswer(
              /residence permit|ikamet izni/i,
              "No",
            );
            personalProof.blueCard = await setBinaryAnswer(
              /blue card|mavi kart/i,
              profile.hasBlueCard ? "Yes" : "No",
            );
          }
          if (!strictMappedPortal) {
            try { const cb = page.locator("button[role=combobox],[role=combobox]").first(); if (await cb.count()) { await cb.click({ timeout: 2500 }).catch(() => {}); await page.waitForTimeout(800); const opts = page.locator("[role=option]"); const oc = await opts.count(); for (let i = 0; i < oc; i++) { const ot = (await opts.nth(i).innerText().catch(() => "")) || ""; if (!/none/i.test(ot)) { await opts.nth(i).click({ timeout: 2000 }).catch(() => {}); break; } } } } catch (e) {}
          }
          personalProof.phone = await fill(
            'input[name="MobilePhone_Text"]',
            profile.phone,
          );
          personalProof.address = await fill(
            'input[name="Address"]',
            profile.addressStreet || profile.address,
          );
          personalProof.city = await fill(
            'input[name="City"]',
            strictMappedPortal ? profile.addressCity : profile.address,
          );
          if (strictMappedPortal) {
            const failed = Object.entries(personalProof)
              .filter(([, ok]) => !ok)
              .map(([field]) => field);
            if (failed.length > 0) {
              result.detail =
                `${cfg.label}: personal fields could not be verified (${failed.join(", ")})`;
              result.stuckStep = step;
              break;
            }
          }
          await clickNext();
        } else if (await has("select[name=\"Country_of_Secondary_School\"]") || /secondary school/i.test(txt)) {
          const educationProof: Record<string, boolean> = {};
          educationProof.schoolName = await fill(
            'input[name="Name_of_Secondary_School"]',
            strictMappedPortal
              ? profile.schoolName
              : profile.schoolName || "High School",
          );
          educationProof.country = await selByName(
            "Country_of_Secondary_School",
            profile.nationality,
          );
          if (strictMappedPortal) {
            educationProof.system = await selByName(
              "Choose_the_education_system_of_the_high_school_you_have_graduated_from",
              "Other",
            );
          } else {
            await selByName("Choose_the_education_system_of_the_high_school_you_have_graduated_from");
          }
          educationProof.gpa = await fill(
            'input[name="GPA_of_Secondary_School"]',
            String(strictMappedPortal ? profile.gpa : profile.gpa || "3"),
          );
          if (strictMappedPortal) {
            const failed = Object.entries(educationProof)
              .filter(([, ok]) => !ok)
              .map(([field]) => field);
            if (failed.length > 0) {
              result.detail =
                `${cfg.label}: education fields could not be verified (${failed.join(", ")})`;
              result.stuckStep = step;
              break;
            }
          }
          await clickNext();
        } else if (
          activeStage === "Documents" &&
          (await has("input[type=file]"))
        ) {
          try {
            const fi = page.locator("input[type=file]");
            const n = await fi.count();
            const uploadedSlots: string[] = [];
            const controlsBySlot = new Map<string, any[]>();
            for (let i = 0; i < n; i++) {
              const input = fi.nth(i);
              const metadata = await input
                .evaluate((el: HTMLInputElement) => {
                  const container = el.closest(
                    "lightning-input,.slds-form-element,[data-name],[class*='upload']",
                  );
                  return [
                    el.name,
                    el.id,
                    el.getAttribute("aria-label") || "",
                    el.getAttribute("title") || "",
                    container?.textContent || "",
                  ]
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim();
                })
                .catch(() => "");
              const slot = inferSalesforceDocumentSlot(metadata);
              if (!slot) continue;
              const group = controlsBySlot.get(slot) ?? [];
              group.push(input);
              controlsBySlot.set(slot, group);
            }
            const fileBySlot: Record<string, string | undefined> = {
              diploma: files.diploma,
              transcript: files.transcript,
              passport: files.passport,
              photo: files.photo,
              english: files.english,
            };
            for (const [slot, localPath] of Object.entries(fileBySlot)) {
              if (!localPath) continue;
              const controls = controlsBySlot.get(slot) ?? [];
              if (controls.length !== 1) {
                logger.warn(
                  `[salesforce:${cfg.key}] upload target not unique`,
                  { slot, count: controls.length },
                );
                continue;
              }
              const input = controls[0];
              await input.setInputFiles(localPath).catch(() => {});
              await page.waitForTimeout(1800);
              const value = await input.inputValue().catch(() => "");
              if (
                value &&
                (await input.getAttribute("aria-invalid").catch(() => null)) !==
                  "true"
              ) {
                uploadedSlots.push(slot);
              }
            }
            result.uploadedSlots = uploadedSlots;
            if (
              strictMappedPortal &&
              cfg.requiredDocs.some(
                (slot) => !uploadedSlots.includes(String(slot)),
              )
            ) {
              result.missingDocuments = cfg.requiredDocs.filter(
                (slot) => !uploadedSlots.includes(String(slot)),
              );
              result.detail = `${cfg.label}: required document upload could not be proved`;
              break;
            }
          } catch (e) {
            if (strictMappedPortal) throw e;
          }
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
            const finalText = await bodyText();
            if (DUP.test(finalText)) {
              result.alreadyExists = true;
            } else if (!strictMappedPortal) {
              result.submitted = true;
            } else {
              const completionStage = await readActiveStage();
              if (
                hasSalesforceCompletionProof({
                  activeStage: completionStage,
                })
              ) {
                result.submitted = true;
              } else {
                const trackProof = await verifyTrackCompletion();
                if (trackProof.verified) {
                  result.submitted = true;
                  if (trackProof.externalRef) {
                    result.externalRef = trackProof.externalRef;
                  }
                } else {
                  result.stuckStep = step;
                  result.detail =
                    `${cfg.label}: final submission outcome could not be proved`;
                }
              }
            }
            break;
          }
          try {
            const r = page.locator("input[type=radio]");
            const radioCount = await r.count();
            if (radioCount) {
              if (
                strictMappedPortal &&
                /term|intake|semester|fall|spring|academic year/i.test(txt) &&
                radioCount !== 1
              ) {
                throw new Error(
                  `Salesforce ${cfg.key}: term target was not unique`,
                );
              }
              let target = r.first();
              if (
                strictMappedPortal &&
                /degree|education level|program level/i.test(txt)
              ) {
                const levelPattern = /associate|önlisans|onlisans/i.test(profile.level)
                  ? /associate|önlisans|onlisans/i
                  : /master|yüksek lisans|yuksek lisans/i.test(profile.level)
                    ? /master|yüksek lisans|yuksek lisans/i
                    : /phd|doctor|doktora/i.test(profile.level)
                      ? /phd|doctor|doktora/i
                      : /bachelor|lisans/i;
                const labels = page.locator("label").filter({ hasText: levelPattern });
                if ((await labels.count()) !== 1) {
                  throw new Error(
                    `Salesforce ${cfg.key}: degree target was not unique`,
                  );
                }
                await labels.first().click({ timeout: 3000 });
                target = page.locator("#__never_used__");
              }
              if (await target.count()) {
                const id = await target.getAttribute("id").catch(() => null);
                if (id) {
                  const lb = page.locator("label[for=\"" + id + "\"]").first();
                  if (await lb.count()) await lb.click({ timeout: 3000 }).catch(() => {});
                }
                await target.check({ force: true }).catch(() => {});
              }
            }
          } catch (e) {
            if (strictMappedPortal) throw e;
          }
          await clickNext();
        }
        let moved = false;
        let afterStage: SalesforceStage = activeStage;
        let bodyChanged = false;
        for (let t = 0; t < 10; t++) {
          await page.waitForTimeout(1000);
          afterStage = await readActiveStage();
          bodyChanged =
            (await bodyText()).replace(/\s+/g, " ").slice(0, 600) !== before;
          if (activeStage && afterStage && afterStage !== activeStage) {
            moved = true;
            break;
          }
          if (!activeStage && bodyChanged) {
            moved = true;
            break;
          }
        }
        if (
          strictMappedPortal &&
          activeStage &&
          afterStage === activeStage &&
          !(activeStage === "Program Selection" && bodyChanged)
        ) {
          const validation = await readValidationMessages();
          result.stuckStep = step;
          result.detail =
            `${cfg.label}: ${activeStage} did not advance` +
            (validation.length
              ? ` — validation: ${validation.join(" | ")}`
              : "");
          break;
        }
        if (!moved) {
          result.stuckStep = step;
          if (!strictMappedPortal) {
            result.stuckBody = (await bodyText())
              .replace(/\s+/g, " ")
              .slice(0, 200);
          }
          if (step > 0) break;
        }
      }
      logger.info("[salesforce:" + cfg.key + "] submit " + JSON.stringify(result));
      return result;
    },
  };
}

export const salesforceAdapters: UniversityAdapter[] = SALESFORCE_SCHOOLS.map(makeSalesforceAdapter);
