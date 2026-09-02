import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveInstitutionAdmissionsFeature,
  isLocalInstitutionAssuranceEnabled,
} from "../src/lib/institutionAdmissionsFeature";
import {
  assertDecisionCanCreateOffer,
  assertEnrolmentEvidenceHash,
  assertIndependentChecker,
  canTransitionInstitutionCase,
  sanitizeInstitutionSharedProfile,
} from "../src/lib/institutionAdmissionsPolicy";

test("institution feature is default-off and malformed configuration fails closed", () => {
  assert.equal(resolveInstitutionAdmissionsFeature({ userId: 7 }).enabled, false);
  assert.equal(resolveInstitutionAdmissionsFeature({ mode: "unexpected", userId: 7 }).reason, "invalid_configuration");
  assert.equal(resolveInstitutionAdmissionsFeature({ mode: "allowlist", allowlist: "7,bad", userId: 7 }).enabled, false);
});

test("allowlist and all rollout decisions are deterministic", () => {
  assert.equal(resolveInstitutionAdmissionsFeature({ mode: "allowlist", allowlist: "7,8", userId: 7 }).enabled, true);
  assert.equal(resolveInstitutionAdmissionsFeature({ mode: "allowlist", allowlist: "7,8", userId: 9 }).enabled, false);
  assert.equal(resolveInstitutionAdmissionsFeature({ mode: "all", userId: 9 }).enabled, true);
});

test("case lifecycle permits only explicit forward and rework corridors", () => {
  assert.equal(canTransitionInstitutionCase("RECEIVED", "REVIEWING"), true);
  assert.equal(canTransitionInstitutionCase("DECISION_PENDING_APPROVAL", "READY_FOR_DECISION"), true);
  assert.equal(canTransitionInstitutionCase("RECEIVED", "DECIDED"), false);
  assert.equal(canTransitionInstitutionCase("ENROLLED", "REVIEWING"), false);
});

test("maker-checker and offer evidence boundaries fail closed", () => {
  assert.throws(() => assertIndependentChecker("same", "same"), /maker_checker_conflict/);
  assert.doesNotThrow(() => assertIndependentChecker("maker", "checker"));
  assert.throws(() => assertDecisionCanCreateOffer({ state: "SUBMITTED", decisionType: "CONDITIONAL_OFFER" }), /approved_offer_decision/);
  assert.throws(() => assertDecisionCanCreateOffer({ state: "APPROVED", decisionType: "REJECTED" }), /approved_offer_decision/);
  assert.doesNotThrow(() => assertDecisionCanCreateOffer({ state: "APPROVED", decisionType: "UNCONDITIONAL_OFFER" }));
  assert.throws(() => assertEnrolmentEvidenceHash("raw-document-id"), /evidence_required/);
  assert.doesNotThrow(() => assertEnrolmentEvidenceHash("a".repeat(64)));
});

test("institution profile projection removes CRM and commercial fields", () => {
  assert.deepEqual(sanitizeInstitutionSharedProfile({
    givenName: "Ada",
    nationality: "TR",
    internalNotes: "never expose",
    commissionRate: 20,
    passportNumber: "raw-passport-not-in-projection",
  }), { givenName: "Ada", nationality: "TR" });
});

test("production cannot enable the local assurance escape hatch", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFlag = process.env.INSTITUTION_ADMISSIONS_V1_LOCAL_ASSURANCE;
  process.env.NODE_ENV = "production";
  process.env.INSTITUTION_ADMISSIONS_V1_LOCAL_ASSURANCE = "true";
  try { assert.equal(isLocalInstitutionAssuranceEnabled(), false); }
  finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousFlag === undefined) delete process.env.INSTITUTION_ADMISSIONS_V1_LOCAL_ASSURANCE; else process.env.INSTITUTION_ADMISSIONS_V1_LOCAL_ASSURANCE = previousFlag;
  }
});

test("institution routes never accept client-selected tenant or relationship authority", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = fs.readFileSync(path.join(root, "src/routes/institutionAdmissions.ts"), "utf8");
  assert.doesNotMatch(source, /req\.(?:body|query|headers)(?:\?|\.)?\.?\[?["']?(?:tenantId|relationshipId|institutionId)["']?\]?/);
  assert.match(source, /withInstitutionContext\(req\.user!\.id/);
  assert.match(source, /req\.apiTokenAuth/);
  assert.match(source, /assertLocalAssurance\(\)/);
});
