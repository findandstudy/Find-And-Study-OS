import assert from "node:assert/strict";
import test from "node:test";
import {
  hasSalesforceCompletionProof,
  normalizeSalesforceStage,
  salesforcePortalProgramName,
} from "../src/universities/salesforce/portalState.js";

test("normalizes CRM degree prefixes to the portal programme label", () => {
  assert.equal(
    salesforcePortalProgramName(
      "Bachelor of Computer Engineering (English)",
    ),
    "Computer Engineering (English)",
  );
  assert.equal(
    salesforcePortalProgramName(
      "Associate of Medical Laboratory Techniques (Turkish)",
    ),
    "Medical Laboratory Techniques (Turkish)",
  );
  assert.equal(
    salesforcePortalProgramName("PhD in Psychology (English)"),
    "Psychology (English)",
  );
});

test("recognizes only exact Salesforce wizard stages", () => {
  assert.equal(
    normalizeSalesforceStage("Review and Submit"),
    "Review and Submit",
  );
  assert.equal(
    normalizeSalesforceStage("Program Selection Review and Submit Completed"),
    null,
  );
});

test("future Review and Submit label is not completion proof", () => {
  assert.equal(
    hasSalesforceCompletionProof({
      activeStage: "Program Selection",
    }),
    false,
  );
  assert.equal(
    hasSalesforceCompletionProof({
      activeStage: "Review and Submit",
    }),
    false,
  );
});

test("active Completed stage is completion proof", () => {
  assert.equal(
    hasSalesforceCompletionProof({
      activeStage: "Completed",
    }),
    true,
  );
});

test("track proof requires both reference and durable submitted state", () => {
  assert.equal(
    hasSalesforceCompletionProof({
      externalRef: "USK-123456",
      applicationStatus: "Submitted",
    }),
    true,
  );
  assert.equal(
    hasSalesforceCompletionProof({
      externalRef: "USK-123456",
      applicationStatus: "",
      trackStage: "",
    }),
    false,
  );
  assert.equal(
    hasSalesforceCompletionProof({
      applicationStatus: "Submitted",
    }),
    false,
  );
});
