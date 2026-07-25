import assert from "node:assert/strict";
import test from "node:test";
import {
  isDiagnosablePortalStatus,
  parsePortalDiagnosis,
  portalFailureFingerprint,
  sanitizePortalEvidence,
} from "../src/lib/portalAiGuardianContract";

const validDiagnosis = {
  classification: "selector_changed",
  confidence: 0.91,
  risk: "medium",
  retrySafe: false,
  requiresCodeChange: true,
  summary: "The stored selector no longer has a unique visible match.",
  evidence: ["exact readback failed on the Basic Information step"],
  recommendedAction:
    "Review the proposed selector and publish a disabled spec version.",
  missingDataFields: [],
  selectorCandidates: [
    {
      field: "cityOfBirth",
      current: "#old-city",
      proposed: "[data-field='cityOfBirth'] input",
      evidence: "The proposed locator is unique in the captured structure.",
    },
  ],
  proposedSpecPatch: [
    {
      op: "replace",
      path: "/steps/0/selector",
      value: "[data-field='cityOfBirth'] input",
      rationale: "Replace the stale selector.",
      evidence: "One visible match was observed.",
    },
  ],
};

test("structured diagnosis accepts fenced JSON", () => {
  const parsed = parsePortalDiagnosis(
    `\`\`\`json\n${JSON.stringify(validDiagnosis)}\n\`\`\``,
  );
  assert.equal(parsed.parseError, false);
  assert.equal(parsed.diagnosis.classification, "selector_changed");
  assert.equal(parsed.diagnosis.confidence, 0.91);
});

test("invalid AI output fails closed and never recommends retry", () => {
  const parsed = parsePortalDiagnosis("Retry it now; it should probably work.");
  assert.equal(parsed.parseError, true);
  assert.equal(parsed.diagnosis.classification, "unknown");
  assert.equal(parsed.diagnosis.risk, "high");
  assert.equal(parsed.diagnosis.retrySafe, false);
  assert.equal(parsed.diagnosis.confidence, 0);
});

test("out-of-contract confidence fails closed", () => {
  const parsed = parsePortalDiagnosis(
    JSON.stringify({ ...validDiagnosis, confidence: 1.5, retrySafe: true }),
  );
  assert.equal(parsed.parseError, true);
  assert.equal(parsed.diagnosis.retrySafe, false);
});

test("portal evidence masks credential and student-value keys recursively", () => {
  const safe = sanitizePortalEvidence({
    selector: "#email",
    email: "student@example.com",
    password: "secret",
    login: { value: "raw-password", token: "signed-token" },
    profile: { addressStreet: "Street 1", phone: "+905551234567" },
  }) as Record<string, unknown>;
  assert.equal(safe.selector, "#email");
  assert.equal(safe.email, "[REDACTED]");
  assert.equal(safe.password, "[REDACTED]");
  assert.deepEqual(safe.login, { value: "[REDACTED]", token: "[REDACTED]" });
  assert.deepEqual(safe.profile, {
    addressStreet: "[REDACTED]",
    phone: "[REDACTED]",
  });
});

test("portal evidence redacts PII embedded in otherwise safe text", () => {
  const safe = sanitizePortalEvidence({
    error:
      'Validation failed for student@example.com and +90 555 123 4567; readback="TAJIKISTAN KHUJAND STREET SADI 12" url=https://portal.example/form?token=secret',
  }) as { error: string };
  assert.doesNotMatch(safe.error, /student@example\.com/);
  assert.doesNotMatch(safe.error, /555 123 4567/);
  assert.doesNotMatch(safe.error, /KHUJAND/);
  assert.doesNotMatch(safe.error, /token=secret/);
});

test("failure fingerprint is deterministic and ignores Guardian annotations", () => {
  const base = {
    id: 42,
    adapterKey: "altinbas",
    status: "failed",
    error: "unique selector proof failed",
    attempts: 2,
    resultJson: { detail: "readback mismatch" },
  };
  const first = portalFailureFingerprint(base);
  const second = portalFailureFingerprint({
    ...base,
    resultJson: {
      detail: "readback mismatch",
      aiGuardian: { status: "proposed", runId: 7 },
    },
  });
  assert.equal(first, second);
  assert.notEqual(
    first,
    portalFailureFingerprint({ ...base, error: "session expired" }),
  );
});

test("only reviewable failure outcomes are diagnosable", () => {
  assert.equal(isDiagnosablePortalStatus("failed"), true);
  assert.equal(isDiagnosablePortalStatus("program_missing"), true);
  assert.equal(isDiagnosablePortalStatus("program_full"), true);
  assert.equal(isDiagnosablePortalStatus("submitted"), false);
  assert.equal(isDiagnosablePortalStatus("already_exists"), false);
  assert.equal(isDiagnosablePortalStatus("queued"), false);
});
