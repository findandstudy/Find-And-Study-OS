import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateRegistrationCandidate, type MatchCandidate, type RegistrationAnswers } from "../src/lib/studentRegistrationMatching";

const answers: RegistrationAnswers = {
  nationalityCode: "TR",
  completedEducationLevel: "high_school",
  targetEducationLevel: "bachelor",
  gradeValue: 82,
  gradeScale: "percent_100",
  languageTest: "ielts",
  languageOverall: 6.5,
  budgetAmount: 20_000,
  budgetCurrency: "USD",
};

const candidate: MatchCandidate = {
  id: 1,
  degree: "Bachelor",
  nationalityPolicy: "restricted",
  acceptedNationalityCodes: ["TR", "AZ"],
  nationalitySourceUrl: "https://university.example/admissions",
  nationalityVerifiedAt: "2026-01-01T00:00:00.000Z",
  nationalityValidUntil: "2027-01-01T00:00:00.000Z",
  requiredEducationLevel: "high_school",
  minGradeValue: 75,
  gradeScale: "percent_100",
  languageRequirements: [{ test: "ielts", overall: 6 }],
  conditionalAdmission: false,
  requirementSourceUrl: "https://university.example/admissions",
  requirementVerifiedAt: "2026-01-01T00:00:00.000Z",
  requirementValidUntil: "2027-01-01T00:00:00.000Z",
  countryCode: "GB",
  field: "Business",
  fee: 15_000,
  currency: "USD",
};
const evaluatedAt = new Date("2026-09-28T00:00:00.000Z");

test("fully factual matching requirements produce compatible", () => {
  const result = evaluateRegistrationCandidate(answers, candidate, evaluatedAt);
  assert.equal(result.status, "compatible");
  assert(result.reasons.every(reason => reason.outcome === "pass"));
});

test("unknown university nationality policy is review-required, never open", () => {
  const result = evaluateRegistrationCandidate(answers, { ...candidate, nationalityPolicy: "unknown", acceptedNationalityCodes: [] }, evaluatedAt);
  assert.equal(result.status, "review_required");
  assert(result.reasons.some(reason => reason.code === "nationality_policy_unverified"));
});

test("restricted nationality mismatch is explicitly not met", () => {
  const result = evaluateRegistrationCandidate({ ...answers, nationalityCode: "IN" }, candidate, evaluatedAt);
  assert.equal(result.status, "not_met");
  assert(result.reasons.some(reason => reason.code === "nationality_not_accepted"));
});

test("different grade scales are not guessed or converted", () => {
  const result = evaluateRegistrationCandidate({ ...answers, gradeScale: "gpa_4", gradeValue: 3.7 }, candidate, evaluatedAt);
  assert.equal(result.status, "review_required");
  assert(result.reasons.some(reason => reason.code === "grade_scale_not_comparable"));
});

test("verified same-scale grade below minimum is not met", () => {
  const result = evaluateRegistrationCandidate({ ...answers, gradeValue: 60 }, candidate, evaluatedAt);
  assert.equal(result.status, "not_met");
  assert(result.reasons.some(reason => reason.code === "grade_not_met"));
});

test("conditional admission turns a language shortfall into review", () => {
  const result = evaluateRegistrationCandidate({ ...answers, languageOverall: 5 }, { ...candidate, conditionalAdmission: true }, evaluatedAt);
  assert.equal(result.status, "review_required");
  assert(result.reasons.some(reason => reason.code === "language_conditional_path"));
});

test("legacy language number without test type cannot establish eligibility", () => {
  const result = evaluateRegistrationCandidate(answers, { ...candidate, languageRequirements: [], legacyMinLanguageScore: 6 }, evaluatedAt);
  assert.equal(result.status, "review_required");
  assert(result.reasons.some(reason => reason.code === "language_test_type_unverified"));
});

test("target level is checked against the actual program degree", () => {
  const result = evaluateRegistrationCandidate({ ...answers, targetEducationLevel: "master" }, candidate, evaluatedAt);
  assert.equal(result.status, "not_met");
  assert(result.reasons.some(reason => reason.code === "target_level_not_met"));
});

test("unknown fee does not exclude an otherwise plausible program", () => {
  const result = evaluateRegistrationCandidate(answers, { ...candidate, fee: null }, evaluatedAt);
  assert.equal(result.status, "review_required");
  assert(result.reasons.some(reason => reason.code === "fee_unknown"));
});

test("expired evidence cannot produce a factual admission match", () => {
  const result = evaluateRegistrationCandidate(answers, {
    ...candidate,
    nationalityValidUntil: "2026-09-27T23:59:59.000Z",
    requirementValidUntil: "2026-09-27T23:59:59.000Z",
  }, evaluatedAt);
  assert.equal(result.status, "review_required");
  assert(result.reasons.some(reason => reason.code === "nationality_policy_unverified"));
  assert(result.reasons.some(reason => reason.code === "education_requirement_unverified"));
});

test("migration, route and registration wiring preserve declared-versus-verified boundary", () => {
  const migration = readFileSync(new URL("../../../lib/db/drizzle/0126_student_registration_matching.sql", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../src/routes/auth.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/routes/studentRegistrationMatching.ts", import.meta.url), "utf8");
  assert.match(migration, /nationality_policy.*DEFAULT 'unknown'/s);
  assert.match(migration, /declaration_status.*DEFAULT 'declared'/s);
  assert.match(migration, /admission_valid_until/);
  assert.match(auth, /studentRegistrationProfilesTable/);
  assert.match(auth, /declarationStatus: "declared"/);
  assert.match(auth, /db\.transaction\(async \(tx\)/);
  assert.match(auth, /SELECTED_PROGRAM_NO_LONGER_MATCHES/);
  assert.match(route, /Cache-Control", "private, no-store"/);
  assert.match(route, /defaultRequiredEducationLevel/);
  assert.doesNotMatch(route, /openai|anthropic|generate/i);
});
