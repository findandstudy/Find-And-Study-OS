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
  catalogEntities: {
    universities: string[];
    programs: string[];
  };
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
  destination: "Help a student evaluate the country as a study destination: education structure, admissions, funding, visa planning, cities, daily life, costs and practical trade-offs. Institution or programme examples are supporting evidence, never the page's main story.",
  city: "Help a student judge academic fit, campus location, transport, housing, climate and daily life in the city.",
  university: "Help a student assess the institution's academic offer, admissions, fees, campus, support and recognition.",
  program: "Help a student understand the programme's curriculum, entry requirements, delivery, fees, intakes and outcomes.",
};

const COMMON_POLICIES: Record<string, SectionPolicy> = {
  hero: { objective: "Introduce the exact page entity with a source-bound value proposition and the most useful verified study decision point.", intent: "What is this study option, what makes it relevant and why should I continue reading?", evidence: [["name", "destination", "city", "university", "program"]], minCharacters: 150, maxCharacters: 520 },
  overview: { objective: "Give a durable, entity-specific orientation with context, fit and trade-offs without repeating the hero.", intent: "What should I know first?", evidence: [["description", "shortDescription"], ["officialSources"]], minCharacters: 280, maxCharacters: 950 },
  gallery: { objective: "Explain what a prospective student should assess in the available imagery and why those visual cues matter.", intent: "What can I learn from the location or campus visuals?", evidence: [["description", "shortDescription", "campusGeography", "address"], ["officialSources"]], minCharacters: 200, maxCharacters: 760 },
  highlights: { objective: "Present distinct, decision-useful strengths supported by named facts and explain their practical value.", intent: "What meaningfully differentiates this option?", evidence: [["programs", "universities", "teachingLanguages", "degree", "field"], ["description", "officialSources"]], minCharacters: 260, maxCharacters: 900 },
  cautions: { objective: "Explain practical trade-offs and planning decisions without fear, filler or repeated disclaimers.", intent: "What should I plan carefully?", evidence: [["requirements", "transportModes", "housingSummary", "programs"], ["officialSources"]], minCharacters: 230, maxCharacters: 820 },
  education: { objective: "Explain the verified academic options, meaningful variety and how a student should compare them.", intent: "What can I study and in which language or level?", evidence: [["programs", "teachingLanguages", "degree", "field"], ["officialSources"]], minCharacters: 260, maxCharacters: 920 },
  curriculum: { objective: "Describe verified curriculum or study-format evidence and its learning significance without inventing modules.", intent: "What will the learning experience cover?", evidence: [["curriculum", "programs", "field", "description"], ["officialSources"]], minCharacters: 240, maxCharacters: 900 },
  facts: { objective: "Interpret verified facts for a student decision; connect them to practical choices and never narrate live counters.", intent: "Which facts affect my shortlist and why?", evidence: [["teachingLanguages", "transportModes", "campusGeography", "climateSummary", "housingSummary", "type", "address", "degree", "duration"], ["officialSources"]], minCharacters: 480, maxCharacters: 1100 },
  admission: { objective: "Explain the verified admissions path, its sequence and what must be confirmed for the exact intake.", intent: "How does admission work and what should I prepare?", evidence: [["requirements", "intakes"], ["officialSources"]], minCharacters: 250, maxCharacters: 900 },
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
  const topics = Array.isArray(facts.sourceTopics) ? facts.sourceTopics : [];
  for (const item of topics) {
    const topicTitle = record(item)?.topicTitle;
    if (typeof topicTitle === "string" && topicTitle.trim()) fields.add(topicTitle.trim());
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

function catalogNamedEntities(facts: Record<string, unknown>) {
  const universities: string[] = [];
  const programs: string[] = [];
  const add = (target: string[], value: unknown) => {
    if (typeof value === "string" && value.trim()) target.push(value.trim());
  };
  add(universities, facts.university);
  add(programs, facts.program);
  for (const row of Array.isArray(facts.universities) ? facts.universities : []) {
    add(universities, record(row)?.name);
  }
  for (const row of Array.isArray(facts.programs) ? facts.programs : []) {
    const value = record(row);
    add(programs, value?.name);
    add(universities, value?.university);
    if (typeof value?.name === "string" && typeof value?.degree === "string") {
      const name = value.name.trim();
      const degree = value.degree.trim();
      if (name && degree && !name.toLocaleLowerCase("en-US").startsWith(degree.toLocaleLowerCase("en-US"))) {
        programs.push(`${degree} of ${name}`);
      }
    }
  }
  return {
    universities: [...new Set(universities)].slice(0, 64),
    programs: [...new Set(programs)].slice(0, 96),
  };
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
  const destinationEntitySections = new Set(["highlights", "education"]);
  let destinationEntityCursor = 0;
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
    const allocatedEntities = input.kind === "destination"
      ? destinationEntitySections.has(section.key) && destinationEntityCursor < 2 && pool[destinationEntityCursor]
        ? [pool[destinationEntityCursor++]!]
        : []
      : pool.length
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
    catalogEntities: catalogNamedEntities(input.facts),
    pageRules: [
      "Give each section one distinct job and do not repeat advice or evidence already assigned elsewhere.",
      "Use deterministic catalogue facts as facts; use AI only to explain their significance.",
      "University and programme names, levels, languages, durations, fees and availability may come only from the system catalogue fields in VERIFIED_FACTS.",
      "External-source metadata may support general context, official guidance, climate, transport, housing or institutional background, but it must never introduce a university, programme or academic offering absent from the system catalogue inventory.",
      "Use sourceTopics as verified editorial evidence. Match each row to a section by its Topic title; the title is a routing key, not public copy and not a heading that must be repeated.",
      "Do not use model memory or general world knowledge to add named universities or programmes. Use only CATALOG_ENTITIES supplied by the planner.",
      "Write an entity-specific, source-bound value proposition in the hero; do not reduce it to a neutral inventory summary.",
      "Use intent-led editorial headings that reveal the section's value; avoid one-word labels such as Overview or Highlights for generated editorial sections.",
      "Vary heading and paragraph openings across the page. No more than two editorial headings may begin with the same action verb, and adjacent sections must not use the same sentence pattern.",
      "Preserve useful editorial depth. Do not replace specific context, comparisons or trade-offs with shallow totals or generic summaries.",
      ...(input.kind === "destination" ? [
        "Keep the country guide country-first: about 65% destination, city, daily-life, cost and practical context; about 20% education, admissions, funding and visa planning; at most 15% institution or programme examples.",
        "Never name a university or programme in the hero. Across all editorial sections, use at most two distinct verified catalogue examples, only where they clarify a decision rather than advertise the catalogue.",
        "Do not turn highlights, cautions, education or FAQ copy into a list of institutions or programmes. Explain the national system, student choices and trade-offs first.",
        "Country-page editorial copy must not narrate university or programme totals. Live catalogue components own all changing counters.",
        "Name a city, university or programme only when that exact entity is present in VERIFIED_FACTS; never broaden the page with remembered examples.",
        "Name an official authority or source only when it is present in officialSources. Otherwise explain the decision without inventing attribution.",
        "Cover academic choice, admissions planning, scholarships or funding, visa planning, daily life and destination trade-offs only where the allocated evidence supports them; skip unsupported claims rather than adding filler.",
      ] : []),
      ...(input.kind === "program" ? [
        "Make the programme page answer academic fit, verified delivery/language, entry preparation, fees or intakes when available, and one evidence-bound next step; do not reduce it to a fee card and requirement list.",
      ] : []),
      "End action sections with one clear, realistic next step that follows from the evidence on the page.",
      "Do not expose internal catalogue, source-record, prompt, AI or editorial-review language.",
      "Do not use one institution or programme as the recurring example on destination or city pages.",
      "Use verification advice only where time-sensitive evidence genuinely requires it, and never as a stock ending.",
      "Do not merge, remove or rename planned sections in the response.",
    ],
    sections: planned,
    skippedSections,
  };
}

const normalizedEntity = (value: string) => value.toLocaleLowerCase("en-US").normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const INSTITUTION_MENTION = /\b(?:[\p{Lu}][\p{L}\p{M}'’.-]*[ \t]+){1,8}(?:University|College|Institute|Academy)\b/gu;
const PROGRAM_MENTION = /\b(?:Associate|Bachelor|Master|Doctorate)\s+of\s+[\p{Lu}][\p{L}\p{M}'’.-]*(?:\s+(?:(?:and|of|in|for|the)\s+)?[\p{Lu}][\p{L}\p{M}'’.-]*){0,7}/gu;

function unsupportedCatalogEntityMentions(text: string, plan: DetailGenerationPlan) {
  const allowedUniversities = plan.catalogEntities.universities.map(normalizedEntity);
  const allowedPrograms = plan.catalogEntities.programs.map(normalizedEntity);
  const supported = (candidate: string, allowed: string[]) => {
    const normalized = normalizedEntity(candidate);
    return allowed.some(value => value === normalized || value.includes(normalized) || normalized.includes(value));
  };
  const universities = [...text.matchAll(new RegExp(INSTITUTION_MENTION.source, INSTITUTION_MENTION.flags))]
    .map(match => match[0].trim())
    .filter(value => !supported(value, allowedUniversities));
  const programs = [...text.matchAll(new RegExp(PROGRAM_MENTION.source, PROGRAM_MENTION.flags))]
    .map(match => match[0].trim())
    .filter(value => !supported(value, allowedPrograms));
  return [...new Set([...universities, ...programs])];
}

const words = (value: string) => new Set(value.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(token => token.length > 3));
const similarity = (left: string, right: string) => {
  const a = words(left), b = words(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter(token => b.has(token)).length;
  // Measure actual set overlap instead of containment. The former minimum-set
  // denominator treated a concise section as a duplicate whenever its common
  // decision vocabulary appeared inside a longer section. That produced many
  // false blockers in Indic translations while still allowing true/near-exact
  // repeated copy to score at or near 1 with the Jaccard denominator.
  return intersection / (a.size + b.size - intersection);
};

// Multi-language copy can legitimately contain loanwords such as `campus` and
// `transport` (notably in French, Spanish, Italian and Portuguese). Treating
// those isolated words as proof of English leakage caused otherwise valid
// translations to be blocked. Strong, unmistakably English UI/weather phrases
// remain blockers; isolated English-looking terms are review signals only.
const STRONG_ENGLISH_LEAKAGE = /\b(?:broken clouds|few clouds|scattered clouds|overcast clouds|clear sky|feels like|daily range|student services|campus geography|housing formats)\b/giu;
const WEAK_ENGLISH_LEAKAGE = /\b(?:weather|housing)\b/giu;
const INTERNAL_WORDING = /\b(?:catalog(?:ue)?|source record|connected source|prompt|generated by ai|editorial review|katalog|kaynak kaydı)\b/giu;
const STOCK_DISCLAIMER = /\b(?:check directly|confirm directly|ask the (?:institution|university)|verify current|compare the exact|contact the (?:institution|university))\b/giu;
const GENERIC_SECTION_TITLE = /^(?:overview|introduction|highlights|education|gallery|image gallery|key facts|facts|student life|next step|things to consider)$/iu;
const TECHNICAL_OR_DRAFT_COPY = /\b(?:review and customi[sz]e|before publishing|supplied from|connected source|source records?)\b/iu;
const LITERAL_ELLIPSIS = /(?:…|\.\.\.)/u;
const HEADING_OPENING = /^(?:the\s+|a\s+|an\s+)?([\p{L}\p{M}]+)/iu;
const DESTINATION_LIVE_COUNTER = /\b\d[\d.,\s]*\s+(?:universit(?:y|ies)|programme?s?|üniversite(?:ler)?|program(?:lar)?)\b/iu;

function destinationCatalogMentions(text: string, plan: DetailGenerationPlan) {
  const normalizedText = normalizedEntity(text);
  const matches = [...plan.catalogEntities.universities, ...plan.catalogEntities.programs]
    .filter(value => {
      const normalized = normalizedEntity(value);
      return normalized.length >= 4 && normalizedText.includes(normalized);
    });
  return [...new Set(matches)];
}

export function evaluateDetailContentQuality(input: {
  content: DetailContent;
  plan: DetailGenerationPlan;
  previous?: DetailContent;
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
  const unsupportedEntities = unsupportedCatalogEntityMentions(combined, input.plan);
  if (unsupportedEntities.length) issues.push({
    code: "OUT_OF_CATALOG_NAMED_ENTITY",
    severity: "blocker",
    sections: sections.filter(section => unsupportedCatalogEntityMentions(`${section.title}\n${section.body}`, input.plan).length).map(section => section.key),
    message: `Generated copy introduced named universities or programmes outside the system catalogue: ${unsupportedEntities.slice(0, 5).join(", ")}.`,
  });
  const internalMatches = combined.match(INTERNAL_WORDING) ?? [];
  if (internalMatches.length) issues.push({ code: "INTERNAL_WORDING", severity: "blocker", sections: sections.filter(section => new RegExp(INTERNAL_WORDING.source, "iu").test(`${section.title}\n${section.body}`)).map(section => section.key), message: "Public copy exposes internal catalogue, source or generation language." });
  INTERNAL_WORDING.lastIndex = 0;
  const technicalCopy = sections.filter(section => TECHNICAL_OR_DRAFT_COPY.test(`${section.title}\n${section.body}`)).map(section => section.key);
  if (technicalCopy.length) issues.push({ code: "TECHNICAL_FALLBACK_COPY", severity: "blocker", sections: technicalCopy, message: "Public copy contains drafting, publishing or source-system instructions." });
  const genericTitles = sections.filter(section => section.key !== "hero" && GENERIC_SECTION_TITLE.test(section.title.trim())).map(section => section.key);
  if (genericTitles.length >= 2) issues.push({ code: "GENERIC_SECTION_TITLES", severity: "warning", sections: genericTitles, message: "Too many editorial sections use generic labels instead of entity-specific, intent-led headings." });
  const openingGroups = new Map<string, string[]>();
  for (const section of sections.filter(section => section.key !== "hero")) {
    const opening = section.title.trim().match(HEADING_OPENING)?.[1]?.toLocaleLowerCase("en-US");
    if (!opening || opening.length < 3) continue;
    openingGroups.set(opening, [...(openingGroups.get(opening) ?? []), section.key]);
  }
  const repetitiveOpenings = [...openingGroups.entries()].filter(([, keys]) => keys.length >= 3);
  if (repetitiveOpenings.length) issues.push({
    code: "REPETITIVE_HEADING_OPENINGS",
    severity: repetitiveOpenings.some(([, keys]) => keys.length >= 5) ? "blocker" : "warning",
    sections: [...new Set(repetitiveOpenings.flatMap(([, keys]) => keys))],
    message: "Too many editorial headings begin with the same word, making the page feel mechanically generated.",
  });
  const disclaimerCount = (combined.match(STOCK_DISCLAIMER) ?? []).length;
  if (disclaimerCount > 3) issues.push({ code: "REPEATED_VERIFICATION_DISCLAIMER", severity: "warning", sections: [], message: "Verification advice is repeated as stock copy instead of adding information." });
  const planByKey = new Map(input.plan.sections.map(section => [section.key, section] as const));
  const thin = sections.filter(section => (section.body?.length ?? 0) < (planByKey.get(section.key)?.minCharacters ?? 80)).map(section => section.key);
  if (thin.length) issues.push({ code: "THIN_SECTION_COPY", severity: "warning", sections: thin, message: "One or more generated sections are below their information-value target." });
  if (input.plan.kind === "program") {
    const substantive = sections.filter(section => (section.body?.trim().length ?? 0) >= 160);
    const totalCharacters = substantive.reduce((sum, section) => sum + (section.body?.trim().length ?? 0), 0);
    if (substantive.length < 4 || totalCharacters < 900) issues.push({
      code: "THIN_PROGRAM_DECISION_SUPPORT",
      severity: "warning",
      sections: sections.map(section => section.key),
      message: "The programme page does not yet provide enough distinct decision support beyond its live facts, fees and requirements.",
    });
  }
  if (input.plan.kind === "destination" && input.plan.sections.length >= 8) {
    const substantive = sections.filter(section => (section.body?.trim().length ?? 0) >= 180);
    const totalCharacters = substantive.reduce((sum, section) => sum + (section.body?.trim().length ?? 0), 0);
    if (substantive.length < 6 || totalCharacters < 2_400) issues.push({
      code: "THIN_DESTINATION_DECISION_SUPPORT",
      severity: substantive.length < 4 || totalCharacters < 1_500 ? "blocker" : "warning",
      sections: sections.map(section => section.key),
      message: "The country page does not yet provide enough distinct, evidence-bound support for study choice, admissions, funding, visa planning and student life.",
    });
  }
  const hero = sections.find(section => section.key === "hero");
  if (input.plan.kind === "destination" && hero && DESTINATION_LIVE_COUNTER.test(hero.body ?? "")) issues.push({
    code: "DESTINATION_HERO_LIVE_COUNTER",
    severity: "blocker",
    sections: ["hero"],
    message: "Country hero copy narrates a changing catalogue counter that belongs to the live catalogue UI.",
  });
  if (input.plan.kind === "destination" && hero) {
    const heroEntities = destinationCatalogMentions(`${hero.title}\n${hero.body ?? ""}`, input.plan);
    if (heroEntities.length) issues.push({
      code: "DESTINATION_HERO_CATALOG_ENTITY",
      severity: "blocker",
      sections: ["hero"],
      message: "Country hero copy names a university or programme instead of leading with the destination value proposition.",
    });
  }
  if (input.plan.kind === "destination") {
    const namedExamples = destinationCatalogMentions(combined, input.plan);
    if (namedExamples.length > 2) issues.push({
      code: "DESTINATION_CATALOG_DOMINANCE",
      severity: "blocker",
      sections: sections.filter(section => destinationCatalogMentions(`${section.title}\n${section.body ?? ""}`, input.plan).length).map(section => section.key),
      message: "Country editorial copy relies on too many named universities or programmes instead of country-level decision guidance.",
    });
  }
  if (hero && ((hero.body?.length ?? 0) < 150 || /^explore\b/iu.test(hero.body ?? ""))) issues.push({ code: "WEAK_HERO_VALUE_PROPOSITION", severity: "warning", sections: ["hero"], message: "The hero does not yet communicate a strong, entity-specific reason to continue." });
  if (input.plan.kind === "city" && input.plan.sections.some(section => section.allocatedEntities.length)) {
    const allocated = [...new Set(input.plan.sections.flatMap(section => section.allocatedEntities))];
    const mentioned = allocated.filter(entity => combined.toLocaleLowerCase("en-US").includes(entity.toLocaleLowerCase("en-US")));
    if (allocated.length >= 4 && mentioned.length < 2) issues.push({ code: "LOW_ENTITY_DIVERSITY", severity: "warning", sections: sections.map(section => section.key), message: "The page underuses the verified cities, institutions or programmes available for concrete examples." });
  }
  if (input.previous) {
    const previousByKey = new Map(input.previous.sections.map(section => [section.key, section] as const));
    const regressions = sections.flatMap(section => {
      const previousLength = previousByKey.get(section.key)?.body?.trim().length ?? 0;
      const currentLength = section.body?.trim().length ?? 0;
      return previousLength >= 220 && currentLength < previousLength * 0.8 ? [{ key: section.key, ratio: currentLength / previousLength }] : [];
    });
    if (regressions.length) issues.push({
      code: "EXCESSIVE_CONTENT_LOSS",
      severity: regressions.some(item => item.ratio < 0.55) ? "blocker" : "warning",
      sections: regressions.map(item => item.key),
      message: "Regeneration removed too much useful editorial depth compared with the existing page.",
    });
  }
  let languageStatus: DetailContentQualityReport["languageStatus"] = "pass";
  if (input.content.locale !== "en") {
    const strongLeakage = combined.match(STRONG_ENGLISH_LEAKAGE) ?? [];
    STRONG_ENGLISH_LEAKAGE.lastIndex = 0;
    const weakLeakage = combined.match(WEAK_ENGLISH_LEAKAGE) ?? [];
    WEAK_ENGLISH_LEAKAGE.lastIndex = 0;
    if (strongLeakage.length || weakLeakage.length) {
      languageStatus = "review";
      const leakagePattern = new RegExp(
        `(?:${STRONG_ENGLISH_LEAKAGE.source})|(?:${WEAK_ENGLISH_LEAKAGE.source})`,
        "iu",
      );
      issues.push({
        code: "SOURCE_LANGUAGE_LEAKAGE",
        severity: strongLeakage.length ? "blocker" : "warning",
        sections: sections
          .filter(section => leakagePattern.test(`${section.title}\n${section.body}`))
          .map(section => section.key),
        message: strongLeakage.length
          ? "Unmistakably English interface or weather phrasing remains in localized content."
          : "Possible English wording remains and should be reviewed in context.",
      });
    }
  }
  const seo = input.content.seo;
  if (!seo || seo.title.length > 60 || seo.description.length > 160) issues.push({ code: "SEO_LENGTH_OR_MISSING", severity: "warning", sections: [], message: "Localized SEO title or description is missing or outside the preferred search-result length." });
  if (seo && (LITERAL_ELLIPSIS.test(seo.title) || LITERAL_ELLIPSIS.test(seo.description))) issues.push({ code: "SEO_LITERAL_ELLIPSIS", severity: "blocker", sections: [], message: "SEO copy contains a literal ellipsis caused by mechanical truncation." });
  const sourceReady = input.plan.sections.filter(section => section.readiness !== "insufficient").length;
  const sourceTotal = input.plan.sections.length + input.plan.skippedSections.length;
  const sourceCoverage = sourceTotal ? Math.round(sourceReady / sourceTotal * 100) : 0;
  if (sourceCoverage < 70) issues.push({ code: "LOW_SOURCE_COVERAGE", severity: "warning", sections: input.plan.skippedSections.map(item => item.key), message: "Too few planned sections have topic-relevant evidence." });
  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === "blocker" ? 28 : 9), 0);
  const score = Math.max(0, 100 - Math.min(90, penalty));
  const status = issues.some(issue => issue.severity === "blocker") ? "blocked" : issues.length || score < 85 ? "review" : "pass";
  return { version: 1, status, score, sourceCoverage, languageStatus, duplicatePairs: duplicatePairs.length, skippedSections: input.plan.skippedSections.map(item => item.key), issues };
}
