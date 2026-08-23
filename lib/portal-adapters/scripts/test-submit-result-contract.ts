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
