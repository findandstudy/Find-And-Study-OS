import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertInstitutionCaseIntakeEnabled,
  parseInstitutionCaseIntakeConfig,
  parseInstitutionCaseIntakeResult,
  validateInstitutionCaseIntakeRequest,
} from "../src/lib/institutionCaseIntake";

const tenantId = "018f9200-0000-7000-8000-000000000001";
const relationshipId = "018f9200-0000-7000-8000-000000000002";

test("case intake is fail-closed and disabled by default", () => {
  const config = parseInstitutionCaseIntakeConfig({});
  assert.equal(config.mode, "off");
  assert.throws(
    () => assertInstitutionCaseIntakeEnabled(config, relationshipId),
    /institution_case_intake_disabled/,
  );
});
test("allowlist mode accepts only exact UUIDv7 relationship ids", () => {
  const config = parseInstitutionCaseIntakeConfig({
    INSTITUTION_CASE_INTAKE_V1_MODE: "allowlist",
    INSTITUTION_CASE_INTAKE_V1_RELATIONSHIP_ALLOWLIST: relationshipId,
  });
  assert.doesNotThrow(() => assertInstitutionCaseIntakeEnabled(config, relationshipId));
  assert.throws(
    () => assertInstitutionCaseIntakeEnabled(config, tenantId),
    /institution_case_intake_relationship_not_allowed/,
  );
  assert.throws(() => parseInstitutionCaseIntakeConfig({
    INSTITUTION_CASE_INTAKE_V1_MODE: "allowlist",
  }), /institution_case_intake_allowlist_required/);
  assert.throws(() => parseInstitutionCaseIntakeConfig({
    INSTITUTION_CASE_INTAKE_V1_MODE: "all",
    INSTITUTION_CASE_INTAKE_V1_RELATIONSHIP_ALLOWLIST: relationshipId,
  }), /institution_case_intake_allowlist_unexpected/);
});

test("request parser rejects unbound or unsafe source identifiers", () => {
  assert.deepEqual(validateInstitutionCaseIntakeRequest({
    tenantId: tenantId.toUpperCase(),
    relationshipId: relationshipId.toUpperCase(),
    portalSubmissionId: 42,
  }), { tenantId, relationshipId, portalSubmissionId: 42 });
  assert.throws(() => validateInstitutionCaseIntakeRequest({
    tenantId: "not-a-tenant",
    relationshipId,
    portalSubmissionId: 42,
  }), /institution_case_intake_scope_invalid/);
  assert.throws(() => validateInstitutionCaseIntakeRequest({
    tenantId,
    relationshipId,
    portalSubmissionId: 0,
  }), /institution_case_intake_submission_id_invalid/);
});

test("result parser accepts only PII-minimized receipt output", () => {
  assert.deepEqual(parseInstitutionCaseIntakeResult({
    outcome: "CREATED",
    application_case_id: "018f9200-0000-7000-8000-000000000003",
    receipt_id: "018f9200-0000-7000-8000-000000000004",
    source_snapshot_hash: "a".repeat(64),
    receipt_hash: "b".repeat(64),
    masked_student_ref: "STU-0123456789ABCDEF",
  }), {
    outcome: "CREATED",
    applicationCaseId: "018f9200-0000-7000-8000-000000000003",
    receiptId: "018f9200-0000-7000-8000-000000000004",
    sourceSnapshotHash: "a".repeat(64),
    receiptHash: "b".repeat(64),
    maskedStudentRef: "STU-0123456789ABCDEF",
  });
  assert.throws(() => parseInstitutionCaseIntakeResult({
    outcome: "CREATED",
    application_case_id: "018f9200-0000-7000-8000-000000000003",
    receipt_id: "018f9200-0000-7000-8000-000000000004",
    source_snapshot_hash: "a".repeat(64),
    receipt_hash: "b".repeat(64),
    masked_student_ref: "student@example.test",
  }), /institution_case_intake_result_invalid/);
});
