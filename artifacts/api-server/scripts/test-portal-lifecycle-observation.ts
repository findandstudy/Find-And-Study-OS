import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePortalLifecycleObservation,
  parsePortalStatusIdentityProof,
} from "../src/lib/portalLifecycleObservation";

const identityProof = {
  source: "matched_application_row" as const,
  sourceLabel: "Candidate Applications exact row",
  identityBound: true as const,
  targetBound: true as const,
  uniqueMatch: true as const,
};

test("builds a deterministic, evidence-bound lifecycle observation", () => {
  const input = {
    submissionId: 11,
    applicationId: 22,
    adapterKey: "multico",
    result: {
      status: " Missing Documents ",
      identityProof,
      missingDocuments: [
        { code: "passport", label: "Passport Copy" },
        { code: "passport", label: "Passport Copy" },
        { code: "transcript", label: "Final Transcript" },
      ],
    },
    observedAt: new Date("2026-09-04T12:00:00.000Z"),
  };
  const first = normalizePortalLifecycleObservation(input);
  const second = normalizePortalLifecycleObservation(input);
  assert.equal(first.disposition, "MISSING_DOCUMENT");
  assert.equal(first.identityVerified, true);
  assert.equal(first.missingDocuments.length, 2);
  assert.equal(first.observationHash, second.observationHash);
  assert.equal(first.observationHash.length, 64);
});

test("a locator or partial proof never verifies application identity", () => {
  assert.equal(parsePortalStatusIdentityProof({ source: "url_parameter" }), null);
  assert.equal(
    parsePortalStatusIdentityProof({ ...identityProof, uniqueMatch: false }),
    null,
  );
  const observation = normalizePortalLifecycleObservation({
    submissionId: 1,
    applicationId: 2,
    adapterKey: "example",
    result: { status: "Unconditional Offer" },
  });
  assert.equal(observation.identityVerified, false);
  assert.equal(observation.disposition, "UNCONDITIONAL_OFFER");
});

test("official application number requires the complete semantic proof", () => {
  const rejected = normalizePortalLifecycleObservation({
    submissionId: 1,
    applicationId: 2,
    adapterKey: "example",
    result: {
      status: "Submitted",
      identityProof,
      verifiedApplicationNumber: {
        value: "APP-123",
        source: "matched_application_row",
        identityBound: true,
        targetBound: true,
        uniqueMatch: false,
      } as never,
    },
  });
  assert.equal(rejected.verifiedApplicationNumber, null);

  const accepted = normalizePortalLifecycleObservation({
    submissionId: 1,
    applicationId: 2,
    adapterKey: "example",
    result: {
      status: "Submitted",
      identityProof,
      verifiedApplicationNumber: {
        value: "APP-123",
        source: "matched_application_row",
        sourceLabel: "Official Application Number",
        identityBound: true,
        targetBound: true,
        uniqueMatch: true,
      },
    },
  });
  assert.equal(accepted.verifiedApplicationNumber?.value, "APP-123");
});

test("oversized or malformed status payloads fail closed", () => {
  assert.throws(
    () => normalizePortalLifecycleObservation({
      submissionId: 1,
      applicationId: 2,
      adapterKey: "example",
      result: { status: "x".repeat(251), identityProof },
    }),
    /portal_status_invalid/,
  );
  assert.throws(
    () => normalizePortalLifecycleObservation({
      submissionId: 1,
      applicationId: 2,
      adapterKey: "example",
      result: {
        status: "Missing Documents",
        identityProof,
        missingDocuments: [{ code: "bad code", label: "Transcript" }],
      },
    }),
    /missing_document_code_invalid/,
  );
});
