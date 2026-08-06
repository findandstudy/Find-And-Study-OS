import assert from "node:assert/strict";
import test from "node:test";
import { SALESFORCE_SCHOOLS } from "./config.js";

test("requested Salesforce schools use the strict verification contract", () => {
  const requested = new Set([
    "uskudar",
    "bau",
    "ozyegin",
    "sabanci",
    "yeditepe",
    "beykent",
    "isik",
  ]);
  const configured = SALESFORCE_SCHOOLS.filter((school) =>
    requested.has(school.key),
  );

  assert.equal(configured.length, requested.size);
  for (const school of configured) {
    assert.equal(
      school.strictContract,
      true,
      `${school.key} must fail closed`,
    );
  }
});
