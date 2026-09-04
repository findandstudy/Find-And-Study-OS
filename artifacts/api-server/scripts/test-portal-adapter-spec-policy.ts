import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeclarativeStatusResult,
  parseAdapterSpec,
  specIsPrivileged,
} from "@workspace/portal-adapters";
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

test("v2 status checks are read-only, privileged and bind evidence to externalRef", () => {
  const raw = validSpec();
  raw.specVersion = 2;
  (raw.meta as Record<string, unknown>).allowedOrigins = [
    "https://apply.policy-fixture.example",
  ];
  raw.statusCheck = {
    steps: [
      {
        action: "http",
        method: "GET",
        url: "https://apply.policy-fixture.example/api/applications/{{vars.externalRefEncoded}}",
        saveAs: "lastResponse",
      },
    ],
    statusFrom: {
      source: "captured",
      path: "lastResponse",
      jsonPath: "application.status",
    },
    identity: {
      valueFrom: {
        source: "captured",
        path: "lastResponse",
        jsonPath: "application.externalRef",
      },
      source: "structured_portal_field",
      sourceLabel: "Application API external reference",
      matchExternalRef: true,
    },
    applicationNumber: {
      valueFrom: {
        source: "captured",
        path: "lastResponse",
        jsonPath: "application.officialNumber",
      },
      source: "structured_portal_field",
      sourceLabel: "Official application number",
    },
    missingDocuments: {
      valueFrom: {
        source: "captured",
        path: "lastResponse",
        jsonPath: "application.missingDocuments",
      },
      codeField: "code",
      labelField: "label",
    },
  };
  const parsed = parseAdapterSpec(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  assert.equal(specIsPrivileged(parsed.spec), true);

  const response = JSON.stringify({
    application: {
      status: "Missing Documents",
      externalRef: "student-7:application-42",
      officialNumber: "OFF-2026-0042",
      missingDocuments: [{ code: "passport", label: "Passport copy" }],
    },
  });
  const result = buildDeclarativeStatusResult({
    statusCheck: parsed.spec.statusCheck!,
    externalRef: "student-7:application-42",
    captured: { lastResponse: response },
  });
  assert.equal(result.status, "Missing Documents");
  assert.equal(result.identityProof?.uniqueMatch, true);
  assert.equal(result.verifiedApplicationNumber?.value, "OFF-2026-0042");
  assert.deepEqual(result.missingDocuments, [
    { code: "passport", label: "Passport copy" },
  ]);

  const wrongApplication = buildDeclarativeStatusResult({
    statusCheck: parsed.spec.statusCheck!,
    externalRef: "student-7:application-99",
    captured: { lastResponse: response },
  });
  assert.equal(wrongApplication.identityProof, undefined);
  assert.equal(wrongApplication.verifiedApplicationNumber, undefined);
});

test("status checks reject mutation steps and legacy specs", () => {
  for (const specVersion of [1, 2]) {
    const raw = validSpec();
    raw.specVersion = specVersion;
    raw.statusCheck = {
      steps: [{ action: "click", selector: "button.accept", final: true }],
      statusFrom: { source: "captured", path: "status" },
      identity: {
        valueFrom: { source: "captured", path: "externalRef" },
        source: "matched_application_row",
        sourceLabel: "Exact application row",
        matchExternalRef: true,
      },
    };
    const parsed = parseAdapterSpec(raw);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.error, /statusCheck/);
      if (specVersion === 1) assert.match(parsed.error, /specVersion 2/);
      else assert.match(parsed.error, /read-only/);
    }
  }
});
