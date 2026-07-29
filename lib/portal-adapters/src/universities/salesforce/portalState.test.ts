import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseSalesforceBinaryCandidate,
  hasSalesforceCompletionProof,
} from "./portalState.js";

test("Salesforce binary resolver supports value, data-value and associated labels", () => {
  assert.equal(
    chooseSalesforceBinaryCandidate(
      [
        { index: 0, value: "Yes" },
        { index: 1, value: "No" },
      ],
      "No",
    ),
    1,
  );
  assert.equal(
    chooseSalesforceBinaryCandidate(
      [
        { index: 0, dataValue: "true" },
        { index: 1, label: "Hayır" },
      ],
      "No",
    ),
    1,
  );
  assert.equal(
    chooseSalesforceBinaryCandidate(
      [
        { index: 0, label: "No" },
        { index: 1, ariaLabel: "No" },
      ],
      "No",
    ),
    null,
  );
});

test("Salesforce completion rejects a future step label without durable proof", () => {
  assert.equal(
    hasSalesforceCompletionProof({
      activeStage: "Documents",
      trackStage: "Completed",
    }),
    false,
  );
  assert.equal(
    hasSalesforceCompletionProof({
      externalRef: "USK-292440",
      applicationStatus: "Submitted",
    }),
    true,
  );
});
