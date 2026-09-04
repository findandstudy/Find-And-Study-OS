import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertSubmitResultContract,
  InvalidSubmitResultError,
} from "../src/submitResultContract.js";

const base = {
  submitted: false,
  alreadyExists: false,
  programMissing: false,
};

test("accepts a single proved terminal outcome", () => {
  assert.doesNotThrow(() =>
    assertSubmitResultContract("test", {
      ...base,
      submitted: true,
      externalRef: "APP-1",
      uploadedSlots: ["passport"],
    }),
  );
});

test("accepts a proof-bound official application number", () => {
  assert.doesNotThrow(() =>
    assertSubmitResultContract("test", {
      ...base,
      submitted: true,
      externalRef: "internal-record-7",
      verifiedApplicationNumber: {
        value: "APP-2026-42",
        source: "matched_application_row",
        sourceLabel: "Application Number",
        identityBound: true,
        targetBound: true,
        uniqueMatch: true,
      },
    }),
  );
});

test("rejects URL-derived or incompletely bound application numbers", () => {
  assert.throws(
    () =>
      assertSubmitResultContract("test", {
        ...base,
        submitted: true,
        verifiedApplicationNumber: {
          value: "route-42",
          source: "success_url",
          identityBound: true,
          targetBound: true,
          uniqueMatch: true,
        } as never,
      }),
    /source is not allowed/,
  );
  assert.throws(
    () =>
      assertSubmitResultContract("test", {
        ...base,
        submitted: true,
        verifiedApplicationNumber: {
          value: "APP-42",
          source: "labeled_portal_field",
          identityBound: true,
          targetBound: false,
          uniqueMatch: true,
        } as never,
      }),
    /identity-, target- and unique-record-bound/,
  );
});

test("rejects contradictory terminal outcomes", () => {
  assert.throws(
    () =>
      assertSubmitResultContract("test", {
        ...base,
        submitted: true,
        alreadyExists: true,
      }),
    InvalidSubmitResultError,
  );
});

test("requires structured program-missing context", () => {
  assert.throws(
    () =>
      assertSubmitResultContract("test", {
        ...base,
        resolution: "not_in_dropdown",
      }),
    /requires programMissing=true/,
  );
  assert.doesNotThrow(() =>
    assertSubmitResultContract("test", {
      ...base,
      programMissing: true,
      resolution: "not_in_dropdown",
      availablePrograms: [],
    }),
  );
});

test("rejects contradictory document evidence", () => {
  assert.throws(
    () =>
      assertSubmitResultContract("test", {
        ...base,
        missingDocuments: ["Passport"],
        uploadedSlots: [" passport "],
      }),
    /both missing and uploaded/,
  );
});

test("requires direct routing for non-members", () => {
  assert.throws(
    () =>
      assertSubmitResultContract("sit", {
        ...base,
        skippedNotMember: true,
      }),
    /routeTo=direct/,
  );
});
