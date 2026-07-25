import assert from "node:assert/strict";
import test from "node:test";
import type { SubmitProfile } from "../../types.js";
import { resolveOkanRequiredFields } from "./adapter.js";

const baseProfile = {
  addressCity: "Istanbul",
  cityOfBirth: "Dushanbe",
  schoolName: "Example School",
  educationRecords: [
    {
      level: "High School",
      schoolName: "Example School",
      city: "Khujand",
    },
  ],
} as SubmitProfile;

test("Okan uses dedicated residence, birth and education city fields", () => {
  assert.deepEqual(resolveOkanRequiredFields(baseProfile), {
    city: "Istanbul",
    birthplace: "Dushanbe",
    secondarySchoolCity: "Khujand",
    missing: [],
    policyFallbacks: [],
  });
});

test("Okan never parses city or birthplace from a free-text address", () => {
  const resolved = resolveOkanRequiredFields({
    ...baseProfile,
    address: "COUNTRY REGION STREET 12",
    addressCity: undefined,
    cityOfBirth: undefined,
    educationRecords: [],
  });
  assert.equal(resolved.city, "");
  assert.equal(resolved.birthplace, "");
  assert.deepEqual(resolved.missing, [
    "addressCity",
    "cityOfBirth",
    "secondarySchoolCity",
  ]);
});

test("Okan legacy policy may reuse explicit residence city for school city", () => {
  const resolved = resolveOkanRequiredFields({
    ...baseProfile,
    educationRecords: [],
  });
  assert.equal(resolved.secondarySchoolCity, "Istanbul");
  assert.deepEqual(resolved.policyFallbacks, [
    "secondarySchoolCity<-addressCity",
  ]);
});
