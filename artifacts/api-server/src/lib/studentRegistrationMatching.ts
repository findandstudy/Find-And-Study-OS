export type MatchStatus = "compatible" | "review_required" | "not_met";

export type RegistrationAnswers = {
  nationalityCode?: string;
  completedEducationLevel?: string;
  targetEducationLevel?: string;
  gradeValue?: number;
  gradeScale?: string;
  languageTest?: string;
  languageOverall?: number;
  preferredCountryCodes?: string[];
  preferredFields?: string[];
  budgetAmount?: number;
  budgetCurrency?: string;
};

export type MatchCandidate = {
  id: number;
  nationalityPolicy: string;
  acceptedNationalityCodes: unknown;
  nationalitySourceUrl?: string | null;
  nationalityVerifiedAt?: Date | string | null;
  nationalityValidUntil?: Date | string | null;
  requiredEducationLevel?: string | null;
  degree?: string | null;
  minGradeValue?: number | null;
  gradeScale?: string | null;
  legacyMinGpa?: number | null;
  languageRequirements: unknown;
  legacyMinLanguageScore?: number | null;
  conditionalAdmission?: boolean | null;
  requirementSourceUrl?: string | null;
  requirementVerifiedAt?: Date | string | null;
  requirementValidUntil?: Date | string | null;
  countryCode?: string | null;
  field?: string | null;
  fee?: number | null;
  currency?: string | null;
};

export type MatchReason = {
  code: string;
  outcome: "pass" | "review" | "fail";
  detail?: string;
};

type LanguageRequirement = { test: string; overall: number };

const clean = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const code = (value: unknown) => typeof value === "string" ? value.trim().toUpperCase() : "";
const stringArray = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map(code).filter(item => /^[A-Z]{2}$/.test(item)))].slice(0, 250)
  : [];

function languageRules(value: unknown): LanguageRequirement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const test = clean((item as Record<string, unknown>).test);
    const overall = Number((item as Record<string, unknown>).overall);
    return test && Number.isFinite(overall) && overall >= 0 && overall <= 1000 ? [{ test, overall }] : [];
  }).slice(0, 20);
}

function same(value: string | undefined, expected: string | null | undefined) {
  return Boolean(clean(value) && clean(value) === clean(expected));
}

function degreeMatches(target: string, degree: string): boolean {
  const requested = clean(target);
  const available = clean(degree);
  const aliases: Record<string, string[]> = {
    bachelor: ["bachelor", "undergraduate", "lisans"],
    master: ["master", "postgraduate", "yüksek lisans", "yuksek lisans"],
    doctorate: ["doctorate", "doctoral", "phd", "doktora"],
    diploma: ["diploma", "associate", "ön lisans", "on lisans"],
  };
  return (aliases[requested] ?? [requested]).some(alias => available.includes(alias));
}

function hasCurrentEvidence(source: unknown, verifiedAt: unknown, validUntil: unknown, now: Date): boolean {
  if (typeof source !== "string" || !source.trim()) return false;
  try {
    if (new URL(source).protocol !== "https:") return false;
  } catch {
    return false;
  }
  const verified = new Date(verifiedAt as string | number | Date);
  const valid = new Date(validUntil as string | number | Date);
  return Number.isFinite(verified.getTime()) && verified.getTime() <= now.getTime()
    && Number.isFinite(valid.getTime()) && valid.getTime() >= now.getTime();
}

export function evaluateRegistrationCandidate(
  answers: RegistrationAnswers,
  candidate: MatchCandidate,
  now = new Date(),
): { status: MatchStatus; reasons: MatchReason[] } {
  const reasons: MatchReason[] = [];
  if (!answers.targetEducationLevel) reasons.push({ code: "target_level_missing", outcome: "review" });
  else if (!candidate.degree) reasons.push({ code: "program_level_unverified", outcome: "review" });
  else reasons.push(degreeMatches(answers.targetEducationLevel, candidate.degree)
    ? { code: "target_level_met", outcome: "pass" }
    : { code: "target_level_not_met", outcome: "fail", detail: candidate.degree });
  const nationality = code(answers.nationalityCode);
  const policy = clean(candidate.nationalityPolicy) || "unknown";
  const nationalityEvidenceCurrent = hasCurrentEvidence(
    candidate.nationalitySourceUrl,
    candidate.nationalityVerifiedAt,
    candidate.nationalityValidUntil,
    now,
  );
  if (!nationality) reasons.push({ code: "nationality_missing", outcome: "review" });
  else if (!nationalityEvidenceCurrent) reasons.push({ code: "nationality_policy_unverified", outcome: "review" });
  else if (policy === "open") reasons.push({ code: "nationality_open", outcome: "pass" });
  else if (policy === "restricted") {
    const accepted = stringArray(candidate.acceptedNationalityCodes);
    reasons.push(accepted.includes(nationality)
      ? { code: "nationality_accepted", outcome: "pass" }
      : { code: "nationality_not_accepted", outcome: "fail" });
  } else reasons.push({ code: "nationality_policy_unverified", outcome: "review" });

  const requirementEvidenceCurrent = hasCurrentEvidence(
    candidate.requirementSourceUrl,
    candidate.requirementVerifiedAt,
    candidate.requirementValidUntil,
    now,
  );
  if (candidate.requiredEducationLevel && requirementEvidenceCurrent) {
    if (!answers.completedEducationLevel) reasons.push({ code: "education_level_missing", outcome: "review" });
    else reasons.push(same(answers.completedEducationLevel, candidate.requiredEducationLevel)
      ? { code: "education_level_met", outcome: "pass" }
      : { code: "education_level_not_met", outcome: "fail", detail: candidate.requiredEducationLevel });
  } else reasons.push({ code: "education_requirement_unverified", outcome: "review" });

  const minimumGrade = candidate.minGradeValue;
  const scale = clean(candidate.gradeScale);
  if (minimumGrade != null && scale && requirementEvidenceCurrent) {
    if (answers.gradeValue == null || !answers.gradeScale) reasons.push({ code: "grade_missing", outcome: "review" });
    else if (!same(answers.gradeScale, scale)) reasons.push({ code: "grade_scale_not_comparable", outcome: "review", detail: scale });
    else reasons.push(answers.gradeValue >= minimumGrade
      ? { code: "grade_met", outcome: "pass" }
      : { code: "grade_not_met", outcome: "fail", detail: String(minimumGrade) });
  } else reasons.push({ code: "grade_requirement_unverified", outcome: "review" });

  const requirements = languageRules(candidate.languageRequirements);
  const legacyLanguage = candidate.legacyMinLanguageScore;
  if (requirements.length && requirementEvidenceCurrent) {
    if (!answers.languageTest || answers.languageOverall == null) {
      reasons.push({ code: candidate.conditionalAdmission ? "language_conditional_path" : "language_missing", outcome: "review" });
    } else {
      const requirement = requirements.find(item => item.test === clean(answers.languageTest));
      if (requirement) reasons.push(answers.languageOverall >= requirement.overall
        ? { code: "language_met", outcome: "pass" }
        : { code: candidate.conditionalAdmission ? "language_conditional_path" : "language_not_met", outcome: candidate.conditionalAdmission ? "review" : "fail", detail: String(requirement.overall) });
      else reasons.push({ code: candidate.conditionalAdmission ? "language_conditional_path" : "language_test_not_accepted", outcome: candidate.conditionalAdmission ? "review" : "fail" });
    }
  } else reasons.push({ code: legacyLanguage != null ? "language_test_type_unverified" : "language_requirement_unverified", outcome: "review" });

  const preferredCountries = stringArray(answers.preferredCountryCodes);
  if (preferredCountries.length && candidate.countryCode && !preferredCountries.includes(code(candidate.countryCode))) {
    reasons.push({ code: "country_preference_not_met", outcome: "fail" });
  }
  const preferredFields = (answers.preferredFields ?? []).map(clean).filter(Boolean);
  if (preferredFields.length && candidate.field && !preferredFields.includes(clean(candidate.field))) {
    reasons.push({ code: "field_preference_not_met", outcome: "fail" });
  }
  if (answers.budgetAmount != null) {
    if (candidate.fee == null || !candidate.currency) reasons.push({ code: "fee_unknown", outcome: "review" });
    else if (!answers.budgetCurrency || code(answers.budgetCurrency) !== code(candidate.currency)) reasons.push({ code: "currency_not_comparable", outcome: "review" });
    else reasons.push(candidate.fee <= answers.budgetAmount
      ? { code: "budget_met", outcome: "pass" }
      : { code: "budget_preference_not_met", outcome: "fail" });
  }

  const eligibilityFailure = reasons.some(reason => reason.outcome === "fail" && !reason.code.endsWith("preference_not_met"));
  const preferenceFailure = reasons.some(reason => reason.outcome === "fail");
  const review = reasons.some(reason => reason.outcome === "review");
  return { status: eligibilityFailure || preferenceFailure ? "not_met" : review ? "review_required" : "compatible", reasons };
}
