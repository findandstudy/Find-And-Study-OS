import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveInstitutionAdmissionsFeature,
} from "../src/lib/institutionAdmissionsFeature";
import {
  assertDecisionCanCreateOffer,
  assertEnrolmentEvidenceHash,
  assertIndependentChecker,
  assertInstitutionDataScope,
  canTransitionInstitutionCase,
  projectInstitutionSharedProfile,
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

test("purpose-limited data scopes and auditor projection fail closed", () => {
  const scopes = new Set(["application.profile"]);
  assert.doesNotThrow(() => assertInstitutionDataScope(scopes, "application.profile"));
  assert.throws(() => assertInstitutionDataScope(scopes, "application.evidence"), /data_scope_denied/);
  assert.deepEqual(projectInstitutionSharedProfile({ givenName: "Ada", nationality: "TR" }, "INSTITUTION_AUDITOR"), {});
  assert.deepEqual(projectInstitutionSharedProfile({ givenName: "Ada", nationality: "TR" }, "DECISION_APPROVER"), {
    givenName: "Ada", nationality: "TR",
  });
});

test("institution routes never accept client-selected tenant or relationship authority", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = fs.readFileSync(path.join(root, "src/routes/institutionAdmissions.ts"), "utf8");
  assert.doesNotMatch(source, /req\.(?:body|query|headers)(?:\?|\.)?\.?\[?["']?(?:tenantId|relationshipId|institutionId)["']?\]?/);
  assert.match(source, /withInstitutionContext\(req\.user!\.id/);
  assert.match(source, /req\.apiTokenAuth/);
  assert.doesNotMatch(source, /LOCAL_ASSURANCE|assertLocalAssurance/);
  assert.match(source, /authorizeInstitutionRouteMutation/);
  assert.match(source, /institution_membership_change_requests/);
  assert.doesNotMatch(source, /INSERT INTO institution_memberships/);
  assert.match(source, /institution\.sla\.request/);
  assert.match(source, /'DRAFT'/);
  assert.doesNotMatch(source, /institution_sla_policies SET status='RETIRED'/);
  assert.match(source, /router\.get\("\/institution\/audit"/);
  assert.match(source, /assertInstitutionDataScope\(context\.dataScopes/);
});

test("active-context migration keeps external institution actors separate and step-up exact", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const source = fs.readFileSync(path.join(root, "lib/db/drizzle/0085_institution_active_context_step_up.sql"), "utf8");
  assert.match(source, /institution_active_context_selections/);
  assert.match(source, /institution_step_up_receipts/);
  assert.match(source, /institution_command_authorization_receipts/);
  assert.match(source, /lock_current_mutation_authority/);
  assert.match(source, /REVOKE ALL ON FUNCTION fas_institution_v1\.lock_current_mutation_authority/);
  assert.match(source, /institution_membership_change_requests/);
  assert.match(source, /DROP POLICY institution_memberships_admin_insert/);
  assert.match(source, /DROP POLICY institution_sla_policies_scoped_update/);
  assert.match(source, /capability_key = 'institution\.sla\.request'/);
  assert.match(source, /request_hash/);
  assert.match(source, /status = 'CONSUMED'/);
});

test("case intake migration is receipt-bound, PII-minimized and default-unwired", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const source = fs.readFileSync(path.join(root, "lib/db/drizzle/0086_institution_case_intake_receipts.sql"), "utf8");
  assert.match(source, /institution_case_intake_receipts/);
  assert.match(source, /create_case_from_portal_submission/);
  assert.match(source, /SECURITY DEFINER/);
  assert.match(source, /SET row_security TO on/);
  assert.match(source, /v_submission\.mode::text <> 'real'/);
  assert.match(source, /v_submission\.status::text NOT IN \('submitted', 'already_exists', 'accepted'\)/);
  assert.match(source, /tenant_organization_legacy_branches/);
  assert.match(source, /shared_profile.*'\{\}'::jsonb/s);
  assert.match(source, /EVIDENCE_NOT_SHARED/);
  assert.match(source, /institution_case_intake_receipts_append_only/);
  assert.match(source, /REVOKE ALL ON FUNCTION fas_institution_intake_v1/);
  assert.doesNotMatch(source, /INSERT INTO public\.institution_memberships/);
  assert.doesNotMatch(source, /result_json|screenshot_urls/);
});

test("authority hardening migration binds database scope and current actor", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const source = fs.readFileSync(path.join(root, "lib/db/drizzle/0084_institution_admissions_authority_hardening.sql"), "utf8");
  assert.match(source, /institution_case_scope_matches/);
  assert.match(source, /app\.institution_membership_id/);
  assert.match(source, /institution_evidence_lineage_guard/);
  assert.match(source, /reviewer cannot assign another institution actor/);
  assert.match(source, /current checker/);
});
