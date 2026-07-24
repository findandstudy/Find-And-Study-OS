import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalAltinbasWizardStep,
  classifyAltinbasWizardTransition,
  explicitCityOfBirth,
  resolveAltinbasWizardState,
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
