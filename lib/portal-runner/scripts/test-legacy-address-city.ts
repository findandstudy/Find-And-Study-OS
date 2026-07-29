import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLegacyAddressCity } from "../src/altinbasLegacyPolicy.js";

test("legacy City, street shape remains supported", () => {
  assert.equal(
    resolveLegacyAddressCity({
      universityKey: "sit",
      address: "Khujand, Sadi Street 12",
      nationality: "Tajikistan",
    }),
    "Khujand",
  );
});

test("street/house fragment is never reused as city", () => {
  assert.equal(
    resolveLegacyAddressCity({
      universityKey: "study_in_turkey",
      address:
        "HOUSE NO. 165, STREET 02, MADAN PURA, FAISALABAD, PUNJAB, PAKISTAN",
      nationality: "Pakistan",
    }),
    undefined,
  );
  assert.equal(
    resolveLegacyAddressCity({
      universityKey: "study_in_turkey",
      address:
        "RASHID BEHBUDOV STREET 71, KHIRDALAN CITY, ABSHERON DISTRICT",
      nationality: "Azerbaijan",
    }),
    undefined,
  );
});

test("explicit structured city always wins", () => {
  assert.equal(
    resolveLegacyAddressCity({
      universityKey: "sit",
      addressCity: "Faisalabad",
      address: "HOUSE NO. 165, STREET 02",
      nationality: "Pakistan",
    }),
    "Faisalabad",
  );
});
