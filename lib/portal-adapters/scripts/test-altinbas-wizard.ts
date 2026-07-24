import { test } from "node:test";
import assert from "node:assert/strict";

import {
  altinbasMutationCanaryGate,
  altinbasGpaTypeLabel,
  canonicalAltinbasWizardStep,
  chooseAltinbasApplicationRow,
  classifyAltinbasWizardTransition,
  explicitCityOfBirth,
  missingAltinbasPersonalFields,
  parseAltinbasCanaryStage,
  redactAltinbasLog,
  resolveAltinbasWizardState,
  selectAltinbasRollbackIds,
  shouldUseAltinbasUiPath,
} from "../src/universities/altinbas/altinbasWizard.js";

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
