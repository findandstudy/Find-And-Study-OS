import { test } from "node:test";
import assert from "node:assert/strict";

import {
  altinbasMutationCanaryGate,
  altinbasGpaTypeLabel,
  canonicalAltinbasWizardStep,
  chooseAltinbasApplicationRow,
  chooseAltinbasLabeledCombobox,
  classifyAltinbasWizardTransition,
  explicitCityOfBirth,
  missingAltinbasPersonalFields,
  parseAltinbasCanaryStage,
  redactAltinbasLog,
  resolveAltinbasResumeFieldAction,
  resolveAltinbasVisaResumeAction,
  resolveAltinbasWizardState,
  selectAltinbasRollbackIds,
  shouldUseAltinbasUiPath,
} from "../src/universities/altinbas/altinbasWizard.js";
import {
  altinbasProgramName,
  isAltinbasQuotaFull,
  selectAltinbasProgram,
} from "../src/universities/altinbas/altinbasProgram.js";

test("AW1: canonicalizes the live SLDS stage-name marker", () => {
  assert.equal(
    canonicalAltinbasWizardStep("Stage: Personal Information"),
    "Personal Information",
  );
});

test("AW2: accepts only exact live-discovered stage names", () => {
  assert.equal(canonicalAltinbasWizardStep("Documents"), "Documents");
  assert.equal(canonicalAltinbasWizardStep("Required Documents"), "");
  assert.equal(canonicalAltinbasWizardStep("Personal Information Extra"), "");
});

test("AW3: unique stage marker plus matching current-li title resolves", () => {
  assert.deepEqual(
    resolveAltinbasWizardState({
      stageNames: ["Stage: Educational Information"],
      currentTitles: ["Educational Information"],
      fileInputCount: 0,
    }),
    {
      step: "Educational Information",
      fileInputCount: 0,
      documentScreen: false,
      reason: "ok",
    },
  );
});

test("AW4: Documents is stage-driven even when file inputs are hidden/absent", () => {
  const state = resolveAltinbasWizardState({
    stageNames: ["Stage: Documents"],
    currentTitles: ["Documents"],
    fileInputCount: 0,
  });
  assert.equal(state.step, "Documents");
  assert.equal(state.documentScreen, true);
});

test("AW5: file inputs cannot misclassify a non-Documents stage", () => {
  const state = resolveAltinbasWizardState({
    stageNames: ["Stage: Personal Information"],
    currentTitles: ["Personal Information"],
    fileInputCount: 4,
  });
  assert.equal(state.step, "Personal Information");
  assert.equal(state.documentScreen, false);
});

test("AW6: missing, ambiguous and conflicting markers fail closed", () => {
  assert.equal(
    resolveAltinbasWizardState({
      stageNames: [],
      currentTitles: [],
      fileInputCount: 0,
    }).reason,
    "stage_missing",
  );
  assert.equal(
    resolveAltinbasWizardState({
      stageNames: ["Stage: Personal Information", "Stage: Questionnaire"],
      currentTitles: [],
      fileInputCount: 0,
    }).reason,
    "stage_ambiguous",
  );
  assert.equal(
    resolveAltinbasWizardState({
      stageNames: [
        "Stage: Personal Information",
        "Stage: Personal Information",
      ],
      currentTitles: ["Personal Information"],
      fileInputCount: 0,
    }).reason,
    "stage_ambiguous",
  );
  assert.equal(
    resolveAltinbasWizardState({
      stageNames: ["Stage: Personal Information"],
      currentTitles: ["Questionnaire"],
      fileInputCount: 0,
    }).reason,
    "marker_mismatch",
  );
});

test("AW7: transition reducer allows only the next canonical edge", () => {
  assert.equal(
    classifyAltinbasWizardTransition(
      "Personal Information",
      "Educational Information",
    ),
    "advanced",
  );
  assert.equal(
    classifyAltinbasWizardTransition(
      "Personal Information",
      "Personal Information",
    ),
    "unchanged",
  );
  assert.equal(
    classifyAltinbasWizardTransition("", "Educational Information"),
    "unknown",
  );
  assert.equal(
    classifyAltinbasWizardTransition("Personal Information", "Questionnaire"),
    "invalid",
  );
});

test("AW8: City of Birth accepts only a dedicated non-placeholder value", () => {
  assert.equal(explicitCityOfBirth("  Khujand  "), "Khujand");
  assert.equal(explicitCityOfBirth(""), null);
  assert.equal(explicitCityOfBirth(" - "), null);
  assert.equal(explicitCityOfBirth(undefined), null);
});

test("AW9: live Personal contract treats City of Birth optional and structured address required", () => {
  const complete = {
    email: "student@example.com",
    firstName: "Ali",
    lastName: "Yilmaz",
    passportNumber: "A1234567",
    dateOfBirth: "2000-01-01",
    passportIssueDate: "2020-01-01",
    passportExpiryDate: "2030-01-01",
    gender: "Male",
    nationality: "Turkey",
    addressStreet: "Main Street 1",
    addressCity: "Istanbul",
    addressZip: "34000",
  };
  assert.deepEqual(missingAltinbasPersonalFields(complete), []);
  assert.deepEqual(
    missingAltinbasPersonalFields({ ...complete, addressCity: "", addressZip: "" }),
    ["addressCity", "addressZip"],
  );
});

test("AW10: multiple application rows require unique name+programme proof", () => {
  assert.equal(
    chooseAltinbasApplicationRow(
      [
        "aliyilmazbusinessadministrationcompleteapplication",
        "aliyilmazelectricalelectronicsengineeringcompleteapplication",
      ],
      ["aliyilmaz", "yilmazali"],
      ["electricalelectronicsengineering"],
    ),
    1,
  );
  assert.equal(
    chooseAltinbasApplicationRow(
      ["", ""],
      ["aliyilmaz"],
      ["electricalelectronicsengineering"],
    ),
    -1,
  );
  assert.equal(
    chooseAltinbasApplicationRow([""], ["aliyilmaz"], ["computerengineering"]),
    0,
  );
});

test("AW11: mutation canary requires UI completion and dry runner mode", () => {
  assert.equal(
    altinbasMutationCanaryGate({ requested: false, uiComplete: false, dryRun: false }),
    "inactive",
  );
  assert.equal(
    altinbasMutationCanaryGate({ requested: true, uiComplete: false, dryRun: true }),
    "requires_ui_complete",
  );
  assert.equal(
    altinbasMutationCanaryGate({ requested: true, uiComplete: true, dryRun: false }),
    "requires_dry_run",
  );
  assert.equal(
    altinbasMutationCanaryGate({ requested: true, uiComplete: true, dryRun: true }),
    "ready",
  );
});

test("AW12: every dry-run uses the read-only UI path", () => {
  assert.equal(
    shouldUseAltinbasUiPath({ uiComplete: false, dryRun: true }),
    true,
  );
  assert.equal(
    shouldUseAltinbasUiPath({ uiComplete: false, dryRun: false }),
    false,
  );
});

test("AW13: portal logging redacts applicant PII and signed tokens", () => {
  const redacted = redactAltinbasLog(
    'email=test@example.com passportNumber="P1234567" addressStreet="Secret Road" phone=+905551112233 https://x.test/file?token=secret',
  );
  assert.ok(!redacted.includes("test@example.com"));
  assert.ok(!redacted.includes("P1234567"));
  assert.ok(!redacted.includes("Secret Road"));
  assert.ok(!redacted.includes("+905551112233"));
  assert.ok(!redacted.includes("token=secret"));
});

test("AW14: GPA system maps only known CRM scales to exact portal labels", () => {
  assert.equal(altinbasGpaTypeLabel("4"), "GRADING SYSTEM OUT OF 4");
  assert.equal(altinbasGpaTypeLabel("4.0"), "GRADING SYSTEM OUT OF 4");
  assert.equal(altinbasGpaTypeLabel("percentage"), "GRADING SYSTEM OUT OF 100");
  assert.equal(
    altinbasGpaTypeLabel("GRADING SYSTEM OUT OF 5"),
    "GRADING SYSTEM OUT OF 5",
  );
  assert.equal(altinbasGpaTypeLabel("letter"), null);
});

test("AW15: rollback accepts only ids proven created in the current run", () => {
  assert.deepEqual(
    selectAltinbasRollbackIds({
      runCreatedIds: ["a02Q30000000001", "a02Q30000000001", "not-an-id"],
      explicitAppIds: ["a02Q30000000999"],
    }),
    ["a02Q30000000001"],
  );
});

test("AW16: canary stage is explicit and can never target Documents", () => {
  assert.equal(parseAltinbasCanaryStage(undefined), "Personal Information");
  assert.equal(
    parseAltinbasCanaryStage("educational"),
    "Educational Information",
  );
  assert.equal(parseAltinbasCanaryStage("questionnaire"), "Questionnaire");
  assert.equal(parseAltinbasCanaryStage("documents"), null);
});

test("AW17: live Program Availability name wins over internal PE record name", () => {
  assert.equal(
    altinbasProgramName({
      Id: "a0AQ3000007Te4WMAS",
      Name: "PE-01904",
      eduhub__Program_Name__c: "Biomedical Sciences (With Thesis)",
    }),
    "Biomedical Sciences (With Thesis)",
  );
});

test("AW18: quota-full requires an explicit true value", () => {
  assert.equal(isAltinbasQuotaFull({ eduhub__Quota_Full__c: true }), true);
  assert.equal(isAltinbasQuotaFull({ eduhub__Quota_Full__c: "true" }), true);
  assert.equal(isAltinbasQuotaFull({ eduhub__Quota_Full__c: false }), false);
  assert.equal(isAltinbasQuotaFull({ eduhub__Quota_Full__c: "false" }), false);
  assert.equal(isAltinbasQuotaFull({}), false);
});

test("AW19: programme selection prefers availability rows and preserves exact quota flags", () => {
  const selection = selectAltinbasProgram(
    [
      [
        "a0BQH000008IDVQ2A4",
        {
          Id: "a0BQH000008IDVQ2A4",
          Name: "Data Analytics (With Thesis)",
        },
      ],
      [
        "a0AQ3000007Te4jMAC",
        {
          Id: "a0AQ3000007Te4jMAC",
          Name: "PE-01917",
          eduhub__Program__c: "a0BQH000008IDVQ2A4",
          eduhub__Program_Name__c: "Data Analytics (With Thesis)",
          eduhub__Quota_Full__c: true,
          eduhub__Quota_of_Program__c: 13,
          // Live capture carries false here even for eligible options; it must
          // never override the dedicated quota flag.
          eduhub__Is_Active__c: false,
        },
      ],
      [
        "a0AQ3000007Te4XMAS",
        {
          Id: "a0AQ3000007Te4XMAS",
          Name: "PE-01905",
          eduhub__Program__c: "a0BQH000008IDS72AO",
          eduhub__Program_Name__c:
            "Biomedical Sciences (With Thesis) (in English)",
          eduhub__Quota_Full__c: false,
          eduhub__Is_Active__c: false,
        },
      ],
    ],
    "Data Analytics (With Thesis)",
  );

  assert.equal(selection.option?.value, "a0AQ3000007Te4jMAC");
  assert.equal(selection.option?.name, "Data Analytics (With Thesis)");
  assert.equal(selection.option?.enabled, false);
  assert.equal(selection.record?.["Name"], "PE-01917");
  assert.equal(selection.candidates.length, 2, "base a0B row is ignored");
  assert.equal(
    selection.candidates.find(
      (candidate) => candidate.value === "a0AQ3000007Te4XMAS",
    )?.enabled,
    true,
    "Quota_Full=false remains selectable even when Is_Active=false",
  );
});

test("AW20: unknown programme never becomes a quota-full false positive", () => {
  const selection = selectAltinbasProgram(
    [
      [
        "a0AQ3000007Te4WMAS",
        {
          eduhub__Program__c: "a0BQH000008IDS62AO",
          eduhub__Program_Name__c: "Biomedical Sciences (With Thesis)",
          eduhub__Quota_Full__c: true,
        },
      ],
    ],
    "A Programme That Does Not Exist",
  );
  assert.equal(selection.option, null);
  assert.equal(selection.record, null);
  assert.equal(selection.candidates[0]?.enabled, false);
});

test("AW21: resumed fields prefer CRM, otherwise require a valid saved portal value", () => {
  assert.equal(
    resolveAltinbasResumeFieldAction({
      crmValue: "CRM value",
      portalValue: "older portal value",
      portalValid: true,
    }),
    "write_crm_value",
  );
  assert.equal(
    resolveAltinbasResumeFieldAction({
      crmValue: "",
      portalValue: "saved portal value",
      portalValid: true,
    }),
    "accept_existing_portal_value",
  );
  assert.equal(
    resolveAltinbasResumeFieldAction({
      crmValue: "",
      portalValue: "",
      portalValid: true,
    }),
    "data_missing",
  );
  assert.equal(
    resolveAltinbasResumeFieldAction({
      crmValue: "",
      portalValue: "saved but invalid",
      portalValid: false,
    }),
    "data_missing",
  );
  assert.equal(
    resolveAltinbasResumeFieldAction({
      crmValue: "",
      portalValue: "-",
      portalValid: true,
    }),
    "data_missing",
  );
});

test("AW22: resumed questionnaire reuses only a saved No answer", () => {
  assert.equal(
    resolveAltinbasVisaResumeAction({ crmValue: "No", portalValue: "" }),
    "select_no_from_crm",
  );
  assert.equal(
    resolveAltinbasVisaResumeAction({ crmValue: "", portalValue: "No" }),
    "accept_existing_no",
  );
  assert.equal(
    resolveAltinbasVisaResumeAction({ crmValue: "Yes", portalValue: "No" }),
    "questionnaire_followup_unmapped",
  );
  assert.equal(
    resolveAltinbasVisaResumeAction({ crmValue: "", portalValue: "Yes" }),
    "questionnaire_followup_unmapped",
  );
  assert.equal(
    resolveAltinbasVisaResumeAction({ crmValue: "", portalValue: "" }),
    "data_missing",
  );
});

test("AW23: country picker ignores its labeled listbox and requires one actionable input", () => {
  assert.equal(
    chooseAltinbasLabeledCombobox([
      {
        tagName: "INPUT",
        role: "combobox",
        visible: true,
        disabled: false,
        readOnly: false,
      },
      {
        tagName: "DIV",
        role: "listbox",
        visible: false,
        disabled: false,
        readOnly: false,
      },
    ]),
    0,
  );
  assert.equal(
    chooseAltinbasLabeledCombobox([
      {
        tagName: "INPUT",
        role: "combobox",
        visible: true,
        disabled: false,
        readOnly: false,
      },
      {
        tagName: "INPUT",
        role: "combobox",
        visible: true,
        disabled: false,
        readOnly: false,
      },
    ]),
    -1,
    "two actionable inputs remain ambiguous",
  );
  assert.equal(
    chooseAltinbasLabeledCombobox([
      {
        tagName: "INPUT",
        role: "combobox",
        visible: true,
        disabled: false,
        readOnly: true,
      },
    ]),
    -1,
    "read-only controls are never mutated",
  );
});
