import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseSalesforceBinaryCandidate,
  hasSalesforceCompletionProof,
  hasSalesforceUploadProof,
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

test("Salesforce upload proof requires exact file selection and portal evidence", () => {
  assert.equal(
    hasSalesforceUploadProof({
      localPath: "/tmp/Passport.pdf",
      inputValue: "C:\\fakepath\\Passport.pdf",
      containerText: "Passport.pdf Uploaded",
      ariaInvalid: "false",
    }),
    true,
  );
  assert.equal(
    hasSalesforceUploadProof({
      localPath: "/tmp/Passport.pdf",
      inputValue: "C:\\fakepath\\Passport.pdf",
      containerText: "Click to upload Passport",
      ariaInvalid: "false",
    }),
    false,
  );
  assert.equal(
    hasSalesforceUploadProof({
      localPath: "/tmp/Passport.pdf",
      inputValue: "C:\\fakepath\\Transcript.pdf",
      containerText: "Upload successful",
      ariaInvalid: "false",
    }),
    false,
  );
  assert.equal(
    hasSalesforceUploadProof({
      localPath: "/tmp/Passport.pdf",
      inputValue: "C:\\fakepath\\Passport.pdf",
      containerText: "Passport.pdf Uploaded",
      ariaInvalid: "true",
    }),
    false,
  );
});
