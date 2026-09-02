import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInstitutionEvidenceShareEnabled,
  parseInstitutionEvidenceShareConfig,
  parseInstitutionEvidenceShareResult,
  validateInstitutionEvidenceShareRequest,
} from "../src/lib/institutionEvidenceShare";

const ID = {
  tenant: "018f9400-0000-7000-8000-000000000001",
  relationship: "018f9400-0000-7000-8000-000000000002",
  applicationCase: "018f9400-0000-7000-8000-000000000003",
  evidence: "018f9400-0000-7000-8000-000000000004",
  consent: "018f9400-0000-7000-8000-000000000005",
  share: "018f9400-0000-7000-8000-000000000006",
};

test("evidence sharing is default-off and allowlist-bound", () => {
  const disabled = parseInstitutionEvidenceShareConfig({});
  assert.equal(disabled.mode, "off");
  assert.throws(
    () => assertInstitutionEvidenceShareEnabled(disabled, ID.relationship),
    /institution_evidence_share_disabled/,
  );
  const allowed = parseInstitutionEvidenceShareConfig({
    INSTITUTION_EVIDENCE_SHARE_V1_MODE: "allowlist",
    INSTITUTION_EVIDENCE_SHARE_V1_RELATIONSHIP_ALLOWLIST: ID.relationship,
  });
  assert.doesNotThrow(() => assertInstitutionEvidenceShareEnabled(allowed, ID.relationship));
  assert.throws(
    () => assertInstitutionEvidenceShareEnabled(
      allowed,
      "018f9400-0000-7000-8000-000000000099",
    ),
    /relationship_not_allowed/,
  );
});

test("invalid and ambiguous rollout configuration fails closed", () => {
  assert.throws(
    () => parseInstitutionEvidenceShareConfig({
      INSTITUTION_EVIDENCE_SHARE_V1_MODE: "allowlist",
    }),
    /allowlist_required/,
  );
  assert.throws(
    () => parseInstitutionEvidenceShareConfig({
      INSTITUTION_EVIDENCE_SHARE_V1_MODE: "all",
      INSTITUTION_EVIDENCE_SHARE_V1_RELATIONSHIP_ALLOWLIST: ID.relationship,
    }),
    /allowlist_unexpected/,
  );
  assert.throws(
    () => parseInstitutionEvidenceShareConfig({
      INSTITUTION_EVIDENCE_SHARE_V1_MODE: "allowlist",
      INSTITUTION_EVIDENCE_SHARE_V1_RELATIONSHIP_ALLOWLIST: "not-a-uuid",
    }),
    /allowlist_invalid/,
  );
});

test("share request accepts only exact UUIDv7 identifiers", () => {
  assert.deepEqual(validateInstitutionEvidenceShareRequest({
    tenantId: ID.tenant.toUpperCase(),
    relationshipId: ID.relationship,
    applicationCaseId: ID.applicationCase,
    journeyEvidenceReceiptId: ID.evidence,
    journeyConsentReceiptId: ID.consent,
  }), {
    tenantId: ID.tenant,
    relationshipId: ID.relationship,
    applicationCaseId: ID.applicationCase,
    journeyEvidenceReceiptId: ID.evidence,
    journeyConsentReceiptId: ID.consent,
  });
  assert.throws(
    () => validateInstitutionEvidenceShareRequest({
      tenantId: ID.tenant,
      relationshipId: ID.relationship,
      applicationCaseId: "018f9400-0000-4000-8000-000000000003",
      journeyEvidenceReceiptId: ID.evidence,
      journeyConsentReceiptId: ID.consent,
    }),
    /scope_invalid/,
  );
});

test("share result projection is bounded and receipt-shaped", () => {
  assert.deepEqual(parseInstitutionEvidenceShareResult({
    outcome: "CREATED",
    share_receipt_id: ID.share,
    evidence_ref_hash: "a".repeat(64),
    content_sha256: "b".repeat(64),
    requirement_code: "academic_transcript",
    receipt_hash: "c".repeat(64),
    valid_until: "2030-01-01T00:00:00.000Z",
  }), {
    outcome: "CREATED",
    shareReceiptId: ID.share,
    evidenceRefHash: "a".repeat(64),
    contentSha256: "b".repeat(64),
    requirementCode: "academic_transcript",
    receiptHash: "c".repeat(64),
    validUntil: "2030-01-01T00:00:00.000Z",
  });
  assert.throws(
    () => parseInstitutionEvidenceShareResult({
      outcome: "CREATED",
      share_receipt_id: ID.share,
      evidence_ref_hash: "raw-object-reference",
      content_sha256: "b".repeat(64),
      requirement_code: "academic_transcript",
      receipt_hash: "c".repeat(64),
      valid_until: null,
    }),
    /result_invalid/,
  );
});
