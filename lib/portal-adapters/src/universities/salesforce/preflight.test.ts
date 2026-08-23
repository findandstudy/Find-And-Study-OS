import assert from "node:assert/strict";
import test from "node:test";
import { portalPreflightManifest } from "../../preflight.js";
import { SALESFORCE_SCHOOLS } from "./config.js";

test("every Salesforce adapter is covered by the shared preflight manifest", () => {
  for (const school of SALESFORCE_SCHOOLS) {
    const manifest = portalPreflightManifest(school.key);
    assert.ok(manifest, `${school.key} must have a preflight manifest`);
    assert.equal(manifest.adapterKey, school.key);
    assert.deepEqual(manifest.documents, ["passport", "diploma", "transcript"]);
  }
});

test("Haliç and Piri Reis cannot bypass shared required-data checks", () => {
  for (const key of ["halic", "pirireis"]) {
    const manifest = portalPreflightManifest(key);
    assert.ok(manifest, `${key} must have a preflight manifest`);
    assert.ok(manifest.profileFields.includes("passportNumber"));
    assert.ok(manifest.profileFields.includes("programName"));
    assert.ok(manifest.profileFields.includes("universityName"));
  }
});
