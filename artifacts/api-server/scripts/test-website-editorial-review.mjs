import { test } from "node:test";
import assert from "node:assert/strict";
import { allowStagingEditorialSelfReview } from "../src/lib/websiteEditorialReview.ts";
const staging = { WEBSITE_STAGING_SINGLE_ADMIN_PUBLISH: "true", RELEASE_ID: "staging-20261127T090000Z-012345abcdef", ALLOW_LIVE_INTEGRATIONS: "false", EMAIL_DELIVERY_DISABLED: "true" };
test("explicit staging super admin approval is enabled only in isolated staging", () => {
  assert.equal(allowStagingEditorialSelfReview("super_admin", staging), true);
  for (const role of [undefined,"admin","staff","agent","student"]) assert.equal(allowStagingEditorialSelfReview(role, staging), false);
});
test("production, missing and malformed configuration retain dual review", () => {
  assert.equal(allowStagingEditorialSelfReview("super_admin", {}), false);
  for (const key of Object.keys(staging)) {
    assert.equal(allowStagingEditorialSelfReview("super_admin", {...staging,[key]:undefined}), false);
    assert.equal(allowStagingEditorialSelfReview("super_admin", {...staging,[key]:"invalid"}), false);
  }
  for (const release of ["20261127T090000Z-012345abcdef","production-20261127T090000Z-012345abcdef","staging-"]) assert.equal(allowStagingEditorialSelfReview("super_admin", {...staging,RELEASE_ID:release}), false);
  assert.equal(allowStagingEditorialSelfReview("super_admin", {...staging,ALLOW_LIVE_INTEGRATIONS:"true"}), false);
  assert.equal(allowStagingEditorialSelfReview("super_admin", {...staging,EMAIL_DELIVERY_DISABLED:"false"}), false);
});
