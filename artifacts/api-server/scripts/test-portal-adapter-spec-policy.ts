import assert from "node:assert/strict";
import test from "node:test";
import { parseAdapterSpec } from "@workspace/portal-adapters";
import {
  buildPortalAdapterSpecPolicySnapshot,
  portalAdapterSpecActivationBlockers,
  portalAdapterSpecSha256,
} from "../src/lib/portalAdapterSpecPolicy.js";

function validSpec(): Record<string, unknown> {
  return {
    specVersion: 1,
    ignoredSecret: "must-not-be-persisted",
    meta: {
      key: "policy_fixture",
      name: "Policy Fixture",
      baseUrl: "https://apply.policy-fixture.example",
      matches: ["policy fixture"],
    },
    auth: {
      loginUrl: "https://apply.policy-fixture.example/login",
      loginSteps: [
        { action: "fill", selector: "#email", valueFrom: "profile.email" },
        { action: "click", selector: "button[type=submit]" },
      ],
    },
    steps: [
      { action: "navigate", url: "https://apply.policy-fixture.example/apply" },
      { action: "click", selector: "button[type=submit]", final: true },
    ],
    success: { successText: "submitted" },
  };
}

test("canonical upload strips unknown properties and has a stable fingerprint", () => {
  const parsed = parseAdapterSpec(validSpec());
  if (!parsed.ok) throw new Error(parsed.error);
  const snapshot = buildPortalAdapterSpecPolicySnapshot(parsed.spec, {
    privilegedApproved: false,
    jsHookApproved: false,
  });
  assert.equal("ignoredSecret" in snapshot.canonicalSpec, false);
  assert.equal(snapshot.sha256.length, 64);
  assert.equal(snapshot.sha256, portalAdapterSpecSha256(snapshot.canonicalSpec));
  assert.deepEqual(snapshot.activationBlockers, []);
});

test("privileged and jsHook specs require separate, version-bound approvals", () => {
  const raw = validSpec();
  (raw.steps as Array<Record<string, unknown>>).push({
    action: "jsHook",
    script: "window.scrollTo(0, 0)",
  });
  const parsed = parseAdapterSpec(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  assert.deepEqual(
    portalAdapterSpecActivationBlockers({
      spec: parsed.spec,
      privilegedApproved: false,
      jsHookApproved: false,
    }),
    ["PRIVILEGED_APPROVAL_REQUIRED", "JSHOOK_APPROVAL_REQUIRED"],
  );
  assert.deepEqual(
    portalAdapterSpecActivationBlockers({
      spec: parsed.spec,
      privilegedApproved: true,
      jsHookApproved: true,
    }),
    [],
  );
});

test("an invalid stored spec is never activation-ready", () => {
  assert.deepEqual(
    portalAdapterSpecActivationBlockers({
      spec: { garbage: true },
      privilegedApproved: true,
      jsHookApproved: true,
    }),
    ["INVALID_SPEC"],
  );
});
