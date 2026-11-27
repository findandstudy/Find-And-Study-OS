import assert from "node:assert/strict";
import { test } from "node:test";
import { workPipelineEnvironmentAllowed as allowed } from "../src/lib/workPipelineEnvironment";
const local = { NODE_ENV: "development", ALLOW_LIVE_INTEGRATIONS: "false", DATABASE_URL: "postgres://fas_app:fixture@127.0.0.1:5433/fasos_apply_local" };
const staging = { ...local, NODE_ENV: "production", WORK_PIPELINES_ENV: "staging", DATABASE_URL: "postgres://fas_app:fixture@db:5432/fasos_staging", BASE_URL: "https://staging.findandstudy.com", RELEASE_ID: "staging-test-123", EMAIL_DELIVERY_DISABLED: "true" };
test("explicit staging and existing isolated local are accepted", () => {
  assert.equal(allowed(local), true); assert.equal(allowed(staging), true);
});
test("production, delivery and target drift remain denied", () => {
  for (const patch of [
    { WORK_PIPELINES_ENV: undefined }, { WORK_PIPELINES_ENV: "production" },
    { ALLOW_LIVE_INTEGRATIONS: "true" }, { EMAIL_DELIVERY_DISABLED: "false" },
    { BASE_URL: "https://apply.findandstudy.com" }, { RELEASE_ID: "production-test" },
    { DATABASE_URL: "postgres://fas_app:fixture@db:5432/fasos_apply" },
    { DATABASE_URL: "postgres://postgres:fixture@db:5432/fasos_staging" },
    { DATABASE_URL: "postgres://fas_app:fixture@external:5432/fasos_staging" },
    { DATABASE_URL: "postgres://fas_app:fixture@db:5432/fasos_staging?options=unsafe" },
  ]) assert.equal(allowed({ ...staging, ...patch }), false, JSON.stringify(Object.keys(patch)));
  assert.equal(allowed({ ...local, NODE_ENV: "production" }), false);
  assert.equal(allowed({ ...local, DATABASE_URL: "malformed" }), false);
});
