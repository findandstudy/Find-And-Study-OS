import type { DetailContent, DetailContentKind } from "./websiteDetailContentContract";

export type DetailSourceReadiness = "authoritative" | "limited" | "insufficient";

export type DetailGenerationSectionInput = {
  key: string;
  title: string;
  templateBody: string;
  instruction: string;
};

export type DetailGenerationSectionPlan = DetailGenerationSectionInput & {
  objective: string;
  searchIntent: string;
  minCharacters: number;
  maxCharacters: number;
  readiness: DetailSourceReadiness;
  evidenceKeys: string[];
  allocatedEntities: string[];
};

export type DetailGenerationPlan = {
  version: 1;
  kind: DetailContentKind;
  entityName: string;
  audience: "prospective international students";
  primaryIntent: string;
  pageRules: string[];
  sections: DetailGenerationSectionPlan[];
  skippedSections: Array<{ key: string; reason: "INSUFFICIENT_EVIDENCE" }>;
};

export type DetailContentQualityIssue = {
  code: string;
  severity: "warning" | "blocker";
  sections: string[];
  message: string;
};

export type DetailContentQualityReport = {
  version: 1;
  status: "pass" | "review" | "blocked";
  score: number;
  sourceCoverage: number;
  languageStatus: "pass" | "review";
  duplicatePairs: number;
  skippedSections: string[];
  issues: DetailContentQualityIssue[];
};

type SectionPolicy = {
  objective: string;
  intent: string;
  evidence: string[][];
  minCharacters?: number;
  maxCharacters?: number;
};

const PAGE_INTENT: Record<DetailContentKind, string> = {
  destination: "Help a student compare the country's education system, destinations, admissions, funding, visa planning and student life.",
  city: "Help a student judge academic fit, campus location, transport, housing, climate and daily life in the city.",
  university: "Help a student assess the institution's academic offer, admissions, fees, campus, support and recognition.",
  program: "Help a student understand the programme's curriculum, entry requirements, delivery, fees, intakes and outcomes.",
};

const COMMON_POLICIES: Record<string, SectionPolicy> = {
  hero: { objective: "Introduce the exact page entity and its most useful verified study decision point.", intent: "What is this study option and why should I continue reading?", evidence: [["name", "destination", "city", "university", "program"]], minCharacters: 80, maxCharacters: 520 },
  overview: { objective: "Give a durable, entity-specific orientation without repeating the hero.", intent: "What should I know first?", evidence: [["description", "shortDescription"], ["officialSources"]], minCharacters: 180 },
  gallery: { objective: "Explain what a prospective student should assess in the available imagery.", intent: "What can I learn from the location or campus visuals?", evidence: [["description", "shortDescription", "campusGeography", "address"], ["officialSources"]], minCharacters: 140 },
  highlights: { objective: "Present distinct, decision-useful strengths supported by named facts.", intent: "What meaningfully differentiates this option?", evidence: [["programs", "universities", "teachingLanguages", "degree", "field"], ["description", "officialSources"]], minCharacters: 180 },
  cautions: { objective: "Explain practical trade-offs without fear, filler or repeated disclaimers.", intent: "What should I plan carefully?", evidence: [["requirements", "transportModes", "housingSummary", "programs"], ["officialSources"]], minCharacters: 160 },
  education: { objective: "Explain the verified academic options and how a student should compare them.", intent: "What can I study and in which language or level?", evidence: [["programs", "teachingLanguages", "degree", "field"], ["officialSources"]], minCharacters: 180 },
  curriculum: { objective: "Describe verified curriculum or study-format evidence without inventing modules.", intent: "What will the learning experience cover?", evidence: [["curriculum", "programs", "field", "description"], ["officialSources"]], minCharacters: 180 },
  facts: { objective: "Interpret verified facts for a student decision; never narrate live counters.", intent: "Which facts affect my shortlist?", evidence: [["teachingLanguages", "transportModes", "campusGeography", "climateSummary", "housingSummary", "type", "address", "degree", "duration"], ["officialSources"]], minCharacters: 260, maxCharacters: 900 },
  admission: { objective: "Explain the verified admissions path and what must be confirmed for the exact intake.", intent: "How does admission work?", evidence: [["requirements", "intakes"], ["officialSources"]], minCharacters: 180 },
  requirements: { objective: "Summarise only verified entry requirements and distinguish them from planning guidance.", intent: "What do I need to qualify?", evidence: [["requirements"], ["officialSources"]], minCharacters: 160 },
  fees: { objective: "Explain authoritative fee components without inventing or estimating prices.", intent: "What verified fees should I budget for?", evidence: [["tuitionFee", "discountedFee", "currency"], ["officialSources"]], minCharacters: 140 },
  intakes: { objective: "Explain verified intake timing and deadline evidence without guessing dates.", intent: "When can I start and apply?", evidence: [["intakes"], ["officialSources"]], minCharacters: 140 },
  intakeGuide: { objective: "Help students interpret verified intake and application timing.", intent: "How should I plan the application calendar?", evidence: [["intakes"], ["officialSources"]], minCharacters: 160 },
  scholarships: { objective: "Describe verified scholarship or discount evidence and its limitations.", intent: "Which funding options are documented?", evidence: [["scholarship", "discountedFee"], ["officialSources"]], minCharacters: 150 },
  living: { objective: "Give practical, sourced planning guidance for daily student life and costs.", intent: "How should I plan daily life and my budget?", evidence: [["housingSummary", "housingFormats"], ["officialSources"]], minCharacters: 180 },
  climate: { objective: "Interpret verified climate evidence for study and arrival planning.", intent: "How can climate affect daily student life?", evidence: [["climateSummary", "climateAnnualAverageC", "climate"], ["officialSources"]], minCharacters: 150 },
  transport: { objective: "Connect verified transport modes to campus and housing decisions.", intent: "How will I travel between campus and housing?", evidence: [["transportModes", "campusGeography"], ["officialSources"]], minCharacters: 170 },
  campus: { objective: "Explain the verified campus location and what it means for the student's shortlist.", intent: "Where will I study and what should I assess?", evidence: [["campusGeography", "address"], ["officialSources"]], minCharacters: 160 },
  housing: { objective: "Explain verified accommodation formats or practical selection criteria.", intent: "Which accommodation routes can I compare?", evidence: [["housingSummary", "housingFormats"], ["officialSources"]], minCharacters: 170 },
  visa: { objective: "Give source-bound planning guidance without predicting visa outcomes.", intent: "Which official visa and residence steps should I plan?", evidence: [["officialSources"]], minCharacters: 160 },
  services: { objective: "Describe documented student services and how to verify access.", intent: "Which support services can I use?", evidence: [["officialSources"], ["description"]], minCharacters: 150 },
  support: { objective: "Explain documented academic and student support without generic promises.", intent: "What support is documented for students?", evidence: [["officialSources"], ["description"]], minCharacters: 150 },
  recognition: { objective: "Explain only documented recognition, accreditation or ranking evidence.", intent: "How is this option recognised?", evidence: [["ranking", "qsRanking", "timesRanking", "shanghaiRanking", "leidenRanking"], ["officialSources"]], minCharacters: 150 },
  studentStory: { objective: "Describe a plausible decision journey, never a fabricated testimonial.", intent: "How might a student evaluate this option?", evidence: [["programs", "campusGeography", "city"], ["officialSources"]], minCharacters: 170 },
  reviews: { objective: "Explain how to evaluate reliable student feedback without inventing reviews.", intent: "How should I assess student feedback?", evidence: [["officialSources"], ["description"]], minCharacters: 140 },
  faq: { objective: "Answer distinct high-intent questions using only the evidence allocated to this page.", intent: "What are the most important remaining questions?", evidence: [["officialSources"], ["requirements", "programs", "housingSummary", "transportModes"]], minCharacters: 180 },
  applyGuide: { objective: "Give an ordered, evidence-bound application checklist without promising admission.", intent: "What should I do next?", evidence: [["requirements", "intakes"], ["officialSources"]], minCharacters: 180 },
};

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function meaningful(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 2;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(meaningful);
  if (record(value)) return Object.values(value as Record<string, unknown>).some(meaningful);
  return false;
}

function sourceFields(facts: Record<string, unknown>): Set<string> {
  const fields = new Set<string>();
  const sources = Array.isArray(facts.officialSources) ? facts.officialSources : [];
  for (const item of sources) {
    const field = record(item)?.field;
    if (typeof field === "string" && field.trim()) fields.add(field.trim());
  }
  return fields;
}

const SECTION_SOURCE_ALIASES: Record<string, string[]> = {
  hero: ["name", "description", "shortdescription", "website", "heromedia"],
  overview: ["description", "shortdescription", "website"],
  gallery: ["gallery", "heromedia", "campus", "description"],
  highlights: ["highlights", "education", "program", "universit", "description"],
  cautions: ["cautions", "admission", "requirement", "education", "housing", "transport"],
  education: ["education", "program", "language"], curriculum: ["curriculum", "education", "program"],
  facts: ["keyfacts", "language", "currency", "transport", "campus", "climate", "housing", "description"],
  admission: ["admission", "requirement", "intake"], requirements: ["requirement", "admission"],
  fees: ["fee", "tuition", "currency"], intakes: ["intake", "admission"], intakeGuide: ["intake", "admission"],
  scholarships: ["scholarship", "discount", "fee"], living: ["living", "housing", "cost"],
  climate: ["climate", "weather", "coordinate"], transport: ["transport", "campus", "coordinate"],
  campus: ["campus", "address", "gallery"], housing: ["housing", "accommodation", "living"],
  visa: ["visa", "permit", "immigration"], services: ["service", "support"], support: ["support", "service"],
  recognition: ["recognition", "accredit", "ranking", "education"], studentStory: ["studentstory", "campus", "service"],
  reviews: ["review", "service"], faq: ["faq", "admission", "requirement", "housing", "transport"],
  applyGuide: ["apply", "admission", "requirement", "visa", "intake"],
};

function sourceSupportsSection(fields: Set<string>, sectionKey: string): boolean {
  const aliases = SECTION_SOURCE_ALIASES[sectionKey] ?? [sectionKey.toLocaleLowerCase("en-US")];
  return [...fields].some(field => {
    const normalized = field.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
    return aliases.some(alias => normalized.includes(alias));
  });
}

function evidenceForGroup(facts: Record<string, unknown>, fields: Set<string>, group: string[], sectionKey: string): string[] {
  return group.filter(key => {
    if (key === "officialSources") return meaningful(facts.officialSources) && sourceSupportsSection(fields, sectionKey);
    if (meaningful(facts[key]) || fields.has(key)) return true;
    const normalized = key.toLocaleLowerCase("en-US").replace(/(?:summary|formats|annualaveragec|modes|geography)$/u, "");
    return normalized.length >= 4 && [...fields].some(field => field.toLocaleLowerCase("en-US").includes(normalized));
  });
}

function entityPool(facts: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const key of ["universities", "programs"] as const) {
    const rows = Array.isArray(facts[key]) ? facts[key] : [];
    for (const row of rows) {
      const value = record(row);
      const name = typeof value?.name === "string" ? value.name.trim() : "";
      const university = typeof value?.university === "string" ? value.university.trim() : "";
      if (name) names.push(name);
      if (university) names.push(university);
    }
  }
  return [...new Set(names)].slice(0, 24);
}

function policyFor(key: string): SectionPolicy {
  return COMMON_POLICIES[key] ?? {
    objective: `Write a distinct, practical ${key} section using only verified evidence.`,
    intent: `What should a student know about ${key}?`,
    evidence: [["officialSources"], ["description"]],
    minCharacters: 140,
  };
}

export function buildDetailGenerationPlan(input: {
  kind: DetailContentKind;
  entityName: string;
  facts: Record<string, unknown>;
  sections: DetailGenerationSectionInput[];
}): DetailGenerationPlan {
  const fields = sourceFields(input.facts);
  const pool = entityPool(input.facts);
  const planned: DetailGenerationSectionPlan[] = [];
  const skippedSections: DetailGenerationPlan["skippedSections"] = [];
  input.sections.forEach((section, index) => {
    const policy = policyFor(section.key);
    const matched = policy.evidence.map(group => evidenceForGroup(input.facts, fields, group, section.key)).filter(group => group.length);
    const evidenceKeys = [...new Set(matched.flat())];
    const readiness: DetailSourceReadiness = matched.length >= Math.min(2, policy.evidence.length)
      ? "authoritative"
      : matched.length === 1
        ? "limited"
        : "insufficient";
    if (readiness === "insufficient" && !["hero", "overview"].includes(section.key)) {
      skippedSections.push({ key: section.key, reason: "INSUFFICIENT_EVIDENCE" });
      return;
    }
    const allocatedEntities = pool.length
      ? [pool[index % pool.length], pool[(index + Math.max(1, Math.floor(pool.length / 2))) % pool.length]].filter((value, entityIndex, all) => all.indexOf(value) === entityIndex)
      : [];
    planned.push({
      ...section,
      objective: policy.objective,
      searchIntent: policy.intent,
      minCharacters: policy.minCharacters ?? 140,
      maxCharacters: policy.maxCharacters ?? 900,
      readiness,
      evidenceKeys,
      allocatedEntities,
    });
  });
  return {
    version: 1,
    kind: input.kind,
    entityName: input.entityName,
    audience: "prospective international students",
    primaryIntent: PAGE_INTENT[input.kind],
    pageRules: [
      "Give each section one distinct job and do not repeat advice or evidence already assigned elsewhere.",
      "Use deterministic catalogue facts as facts; use AI only to explain their significance.",
      "Do not expose internal catalogue, source-record, prompt, AI or editorial-review language.",
      "Do not use one institution or programme as the recurring example on destination or city pages.",
      "Use verification advice only where time-sensitive evidence genuinely requires it, and never as a stock ending.",
      "Do not merge, remove or rename planned sections in the response.",
    ],
    sections: planned,
    skippedSections,
  };
}

const words = (value: string) => new Set(value.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(token => token.length > 3));
const similarity = (left: string, right: string) => {
  const a = words(left), b = words(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter(token => b.has(token)).length;
  return intersection / Math.min(a.size, b.size);
};

const ENGLISH_LEAKAGE = /\b(?:weather|transport|campus|housing|broken clouds|few clouds|scattered clouds|overcast clouds|clear sky|feels like|daily range|student services)\b/giu;
const INTERNAL_WORDING = /\b(?:catalog(?:ue)?|source record|connected source|prompt|generated by ai|editorial review|katalog|kaynak kaydı)\b/giu;
const STOCK_DISCLAIMER = /\b(?:check directly|confirm directly|ask the (?:institution|university)|verify current|compare the exact|contact the (?:institution|university))\b/giu;

export function evaluateDetailContentQuality(input: {
  content: DetailContent;
  plan: DetailGenerationPlan;
}): DetailContentQualityReport {
  const issues: DetailContentQualityIssue[] = [];
  const generatedKeys = new Set(input.plan.sections.map(section => section.key));
  const sections = input.content.sections.filter(section => generatedKeys.has(section.key) && section.body?.trim());
  const duplicatePairs: Array<[string, string]> = [];
  for (let left = 0; left < sections.length; left += 1) for (let right = left + 1; right < sections.length; right += 1) {
    if (similarity(sections[left]!.body!, sections[right]!.body!) >= 0.72) duplicatePairs.push([sections[left]!.key, sections[right]!.key]);
  }
  if (duplicatePairs.length) issues.push({
    code: "REPEATED_SECTION_COPY",
    severity: duplicatePairs.length > 2 ? "blocker" : "warning",
    sections: [...new Set(duplicatePairs.flat())],
    message: "Sections repeat too much of the same vocabulary and decision guidance.",
  });
  const combined = sections.map(section => `${section.title}\n${section.body}`).join("\n");
  const internalMatches = combined.match(INTERNAL_WORDING) ?? [];
  if (internalMatches.length) issues.push({ code: "INTERNAL_WORDING", severity: "blocker", sections: sections.filter(section => new RegExp(INTERNAL_WORDING.source, "iu").test(`${section.title}\n${section.body}`)).map(section => section.key), message: "Public copy exposes internal catalogue, source or generation language." });
  INTERNAL_WORDING.lastIndex = 0;
  const disclaimerCount = (combined.match(STOCK_DISCLAIMER) ?? []).length;
  if (disclaimerCount > 3) issues.push({ code: "REPEATED_VERIFICATION_DISCLAIMER", severity: "warning", sections: [], message: "Verification advice is repeated as stock copy instead of adding information." });
  const planByKey = new Map(input.plan.sections.map(section => [section.key, section] as const));
  const thin = sections.filter(section => (section.body?.length ?? 0) < (planByKey.get(section.key)?.minCharacters ?? 80)).map(section => section.key);
  if (thin.length) issues.push({ code: "THIN_SECTION_COPY", severity: "warning", sections: thin, message: "One or more generated sections are below their information-value target." });
  let languageStatus: DetailContentQualityReport["languageStatus"] = "pass";
  if (input.content.locale !== "en") {
    const leakage = combined.match(ENGLISH_LEAKAGE) ?? [];
    if (leakage.length) {
      languageStatus = "review";
      issues.push({ code: "SOURCE_LANGUAGE_LEAKAGE", severity: leakage.length > 2 ? "blocker" : "warning", sections: sections.filter(section => new RegExp(ENGLISH_LEAKAGE.source, "iu").test(`${section.title}\n${section.body}`)).map(section => section.key), message: "English interface or weather wording remains in localized content." });
      ENGLISH_LEAKAGE.lastIndex = 0;
    }
  }
  const seo = input.content.seo;
  if (!seo || seo.title.length > 60 || seo.description.length > 160) issues.push({ code: "SEO_LENGTH_OR_MISSING", severity: "warning", sections: [], message: "Localized SEO title or description is missing or outside the preferred search-result length." });
  const sourceReady = input.plan.sections.filter(section => section.readiness !== "insufficient").length;
  const sourceTotal = input.plan.sections.length + input.plan.skippedSections.length;
  const sourceCoverage = sourceTotal ? Math.round(sourceReady / sourceTotal * 100) : 0;
  if (sourceCoverage < 70) issues.push({ code: "LOW_SOURCE_COVERAGE", severity: "warning", sections: input.plan.skippedSections.map(item => item.key), message: "Too few planned sections have topic-relevant evidence." });
  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === "blocker" ? 28 : 9), 0);
  const score = Math.max(0, 100 - Math.min(90, penalty));
  const status = issues.some(issue => issue.severity === "blocker") ? "blocked" : issues.length || score < 85 ? "review" : "pass";
  return { version: 1, status, score, sourceCoverage, languageStatus, duplicatePairs: duplicatePairs.length, skippedSections: input.plan.skippedSections.map(item => item.key), issues };
}
