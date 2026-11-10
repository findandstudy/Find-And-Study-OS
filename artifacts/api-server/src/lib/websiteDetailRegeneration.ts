import { AiContentService } from "./aiService";
import { createHash } from "node:crypto";
import { ObjectStorageService } from "./objectStorage";
import {
  DETAIL_CONTENT_KEYS,
  DETAIL_CONTENT_LAYOUT_KEYS,
  inheritEnglishDetailStructure,
  parseDetailContent,
  preserveDetailSectionDesign,
  type DetailContent,
  type DetailContentKind,
  type DetailContentSection,
} from "./websiteDetailContentContract";
import { buildAutomaticEnglishDetailSeo } from "./websiteDetailSeo";
export { buildAutomaticEnglishDetailSeo } from "./websiteDetailSeo";
import {
  readDetailContentDraft,
  readDetailContentEditorContext,
  saveGeneratedDetailContentDraft,
} from "./websiteDetailContent";
import { readPublishedDetailLayout } from "./websiteDetailLayouts";
import { detailTemplateSectionsForLocale } from "./websiteDetailLayoutContract";
import { translateStructuredDetailContent } from "./websiteDetailTranslation";
import { detailGenerationSources, detailSectionReviewedOn, detailSectionSources } from "./websiteDetailSources";
import {
  buildDetailGenerationPlan,
  evaluateDetailContentQuality,
  type DetailContentQualityReport,
  type DetailGenerationPlan,
} from "./websiteDetailGenerationPolicy";

export type DetailRegenerationResult = {
  entityId: number;
  locale: string;
  status: "created" | "completed" | "preserved" | "failed";
  pageId?: number | null;
  addedSections?: number;
  generatedSections?: number;
  generatedImages?: number;
  imageFailures?: number;
  quality?: DetailContentQualityReport;
  error?: "AI_NOT_CONFIGURED" | "SOURCE_NOT_FOUND" | "INVALID_GENERATED_CONTENT" | "QUALITY_BLOCKED" | "CONFLICT" | "UNAVAILABLE";
};

const generatedImageStorage = new ObjectStorageService();
const AI_IMAGE_TARGETS = [{ key: "hero", count: 1 }, { key: "gallery", count: 2 }] as const;

const titles: Record<string, string> = {
  hero: "Introduction", navigation: "Page navigation", overview: "Overview", gallery: "Image gallery",
  highlights: "Highlights", cautions: "Things to consider", curriculum: "Curriculum", requirements: "Requirements",
  admission: "Admission information", fees: "Fees", intakes: "Intakes", scholarships: "Scholarships",
  living: "Living costs", campus: "Campus", climate: "Weather and climate", housing: "Housing",
  services: "Student services", applyGuide: "Application guide", studentStory: "Student experience",
  recognition: "Recognition and accreditation", related: "Related programs", faq: "Frequently asked questions",
  mobileActions: "Mobile actions", programs: "Programs", facts: "Key facts", education: "Education",
  support: "Student support", reviews: "Student reviews", cities: "Cities", universities: "Universities",
  visa: "Visa and calendar", transport: "Transport", intakeGuide: "Intakes and calendar", cta: "Next step",
};
const genericEditorialTitle = /^(?:overview|introduction|highlights|education|gallery|image gallery|key facts|facts|student life|next step|things to consider)$/iu;
const record = (value: unknown): Record<string, any> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const positiveCount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

function entityFacts(kind: DetailContentKind, payload: unknown, entityId: number) {
  const root = record(payload);
  const entity = record(kind === "destination" ? root?.destination : root?.data);
  const name = text(entity?.name) ?? text(entity?.programName) ?? `#${entityId}`;
  const description = text(entity?.description) ?? text(entity?.shortDescription) ?? text(entity?.summary);
  const website = [entity?.website, entity?.universityWebsite].find(value => {
    if (typeof value !== "string") return false;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  });
  const universityName = text(entity?.universityName);
  const city = text(entity?.city) ?? text(entity?.universityCity);
  const country = text(entity?.country) ?? text(entity?.universityCountry);
  return { name, description, universityName, city, country, sourceUrl: typeof website === "string" ? website : "https://findandstudy.com" };
}

function verifiedGenerationFacts(kind: DetailContentKind, payload: unknown) {
  const root = record(payload) ?? {};
  const entity = record(kind === "destination" ? root.destination : root.data) ?? {};
  const compactRecords = (value: unknown, fields: readonly string[]) => Array.isArray(value)
    ? value.slice(0, 32).flatMap(item => {
        const source = record(item);
        if (!source) return [];
        const compact = Object.fromEntries(fields.flatMap(field => {
          const candidate = source[field];
          return candidate === null || candidate === undefined || candidate === "" ? [] : [[field, candidate]];
        }));
        return Object.keys(compact).length ? [compact] : [];
      })
    : [];
  const officialSources = detailGenerationSources(kind, payload);
  if (kind === "city") {
    const external = record(entity.externalFacts) ?? {};
    return {
      city: text(entity.name), country: text(entity.country), universityCount: positiveCount(entity.universityCount),
      programCount: positiveCount(entity.programCount), teachingLanguages: Array.isArray(entity.programLanguages) ? entity.programLanguages : [],
      transportModes: entity.transportModes, campusGeography: entity.campusGeography,
      climateSummary: external.climateSummary, climateAnnualAverageC: external.climateAnnualAverageC,
      housingSummary: external.housingSummary, housingFormats: external.housingFormats,
      universities: compactRecords(entity.universities, ["name", "type"]),
      programs: compactRecords(entity.programs, ["name", "degree", "field", "language", "university"]),
      officialSources,
    };
  }
  if (kind === "destination") return {
    destination: text(entity.name), country: text(entity.country), shortDescription: text(entity.shortDescription),
    description: text(entity.description), languages: entity.language, currency: entity.currency, climate: entity.climate,
    cities: compactRecords(root.cities, ["name"]),
    universities: compactRecords(root.universities, ["name", "city", "type"]),
    programs: compactRecords(root.programs, ["name", "degree", "field", "language", "university"]),
    officialSources,
  };
  if (kind === "university") return {
    university: text(entity.name), country: text(entity.country), city: text(entity.city), description: text(entity.description),
    type: text(entity.universityType), address: text(entity.address), ranking: entity.ranking, qsRanking: entity.qsRanking,
    timesRanking: entity.timesRanking, shanghaiRanking: entity.shanghaiRanking, leidenRanking: entity.cwtsLeidenRanking,
    programCount: positiveCount(record(root.meta)?.programCount),
    programs: compactRecords(root.programs, ["name", "degree", "field", "language", "duration"]),
    officialSources,
  };
  return {
    // The editor projection exposes the catalogue programme title as `name`.
    // Keep the legacy alias for older payloads so the quality gate always
    // recognises the page's own programme as an allowed catalogue entity.
    program: text(entity.name) ?? text(entity.programName), description: text(entity.description), degree: text(entity.degree), field: text(entity.field),
    teachingLanguage: text(entity.language), duration: text(entity.duration), tuitionFee: entity.tuitionFee,
    discountedFee: entity.discountedFee, currency: text(entity.currency), scholarship: entity.scholarship,
    intakes: entity.intakesText, requirements: entity.requirements, quota: entity.quota,
    university: text(entity.universityName), city: text(entity.universityCity), country: text(entity.universityCountry),
    officialSources,
  };
}

function catalogueDisplayTerms(kind: DetailContentKind, payload: unknown): string[] {
  const facts = verifiedGenerationFacts(kind, payload) as Record<string, unknown>;
  const priorityTerms = new Set<string>();
  const programTerms = new Set<string>();
  const add = (value: unknown, target = priorityTerms) => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (normalized.length >= 2 && normalized.length <= 240 && !/^https?:\/\//iu.test(normalized)) target.add(normalized);
  };
  for (const key of ["destination", "country", "city", "university", "program"]) add(facts[key]);
  for (const collection of [facts.cities, facts.universities]) if (Array.isArray(collection)) {
    for (const item of collection) {
      const value = record(item);
      add(value?.name);
      add(value?.university);
    }
  }
  if (Array.isArray(facts.programs)) for (const item of facts.programs) {
    const value = record(item);
    add(value?.university);
    add(value?.name, programTerms);
  }
  if (Array.isArray(facts.officialSources)) for (const item of facts.officialSources) {
    const value = record(item);
    add(value?.sourceName);
  }
  return [...priorityTerms, ...programTerms].slice(0, 96);
}

async function aiPreferredTranslationTerms(kind: DetailContentKind, payload: unknown, locale: string, ai: AiContentService): Promise<Record<string, string>> {
  if (locale === "en") return {};
  const terms = catalogueDisplayTerms(kind, payload);
  if (!terms.length) return {};
  const keyedTerms = Object.fromEntries(terms.map((value, index) => [`term_${index}`, value]));
  const translated = await ai.translateTextMap({
    sourceLocale: "en",
    targetLocale: locale,
    texts: keyedTerms,
    mode: "display_terms",
  });
  const preferred: Record<string, string> = {};
  terms.forEach((source, index) => {
    const target = translated[`term_${index}`]?.trim();
    if (target) preferred[source] = target;
  });
  return preferred;
}

function protectedTranslationTerms(kind: DetailContentKind, payload: unknown, preferred: Record<string, string> = {}): string[] {
  const facts = verifiedGenerationFacts(kind, payload) as Record<string, unknown>;
  const terms: string[] = [];
  if (kind === "university" && typeof facts.university === "string") terms.push(facts.university);
  if (kind === "program" && typeof facts.program === "string") terms.push(facts.program);
  if (kind === "program" && typeof facts.university === "string") terms.push(facts.university);
  for (const collection of [facts.universities, facts.programs]) if (Array.isArray(collection)) {
    for (const item of collection) {
      const value = record(item);
      if (typeof value?.name === "string") terms.push(value.name);
      if (typeof value?.university === "string") terms.push(value.university);
    }
  }
  return [...new Set(terms.map(value => value.trim()).filter(value => value.length >= 3 && !preferred[value]))].slice(0, 64);
}

function visitorFacingFallback(key: string, sectionTitle: string, facts: ReturnType<typeof entityFacts>) {
  const place = facts.name;
  const fallbacks: Record<string, string> = {
    navigation: `Use the page links to compare the study details that matter most for ${place}.`,
    facts: `Use the live facts below to compare the details that matter to your study plan in ${place}.`,
    weather: `Review current conditions alongside longer-term climate guidance for ${place}.`,
    fees: `Compare the published fee information and the costs that may affect your study budget.`,
    intakes: `Review available start dates and plan enough time for documents and admission steps.`,
    related: `Explore related study options that can help you build a stronger shortlist.`,
    programs: `Compare current study options, levels and teaching languages available in ${place}.`,
    universities: `Compare institutions and their study options in ${place}.`,
    cities: `Explore student destinations and the study choices connected to each city in ${place}.`,
    cta: `Build a focused shortlist and compare the options that best match your study plans.`,
    mobileActions: `Continue to study options or speak with an adviser about your next step.`,
  };
  return fallbacks[key] ?? `Explore ${sectionTitle.toLocaleLowerCase("en-US")} that can help you evaluate ${place}.`;
}

function contextualSectionTitle(key: string, generatedTitle: string, entityName: string) {
  if (!genericEditorialTitle.test(generatedTitle.trim())) return generatedTitle;
  const contextual: Record<string, string> = {
    overview: `${entityName} at a glance`,
    gallery: `See ${entityName} from a student perspective`,
    highlights: `What makes ${entityName} worth comparing`,
    cautions: `Plan your ${entityName} shortlist carefully`,
    education: `Study options connected to ${entityName}`,
    facts: `What the key facts mean for your decision`,
    studentStory: `A student decision journey in ${entityName}`,
    cta: `Turn your research into a focused shortlist`,
  };
  const candidate = contextual[key] ?? `${entityName}: ${generatedTitle}`;
  return candidate.length <= 150 ? candidate : generatedTitle;
}

function buildEnglishSource(kind: DetailContentKind, entityId: number, payload: unknown, layout: Awaited<ReturnType<typeof readPublishedDetailLayout>>): DetailContent {
  const facts = entityFacts(kind, payload, entityId);
  const catalogSources = detailGenerationSources(kind, payload);
  const shared = new Map(detailTemplateSectionsForLocale(layout, "en").map(section => [section.key, section]));
  const reviewedOn = new Date().toISOString().slice(0, 10);
  const sections: DetailContentSection[] = DETAIL_CONTENT_KEYS[kind].map(key => {
    const copy = shared.get(key);
    const title = key === "hero" ? facts.name : copy?.title || titles[key] || key;
    const body = copy?.body
      || ((key === "hero" || key === "overview") && facts.description)
      || visitorFacingFallback(key, title, facts);
    const layoutKey = DETAIL_CONTENT_LAYOUT_KEYS[kind].find(candidate => (candidate.startsWith("editorial-") ? candidate.slice(10) : candidate) === key);
    const fallbackSource = { label: facts.sourceUrl === "https://findandstudy.com" ? "Find & Study source record" : "Official website", url: facts.sourceUrl };
    return {
      key,
      title,
      body,
      ...(layoutKey && layout.presentation[layoutKey] ? { presentation: layout.presentation[layoutKey] } : {}),
      sources: detailSectionSources(key, catalogSources, fallbackSource),
      reviewedOn: detailSectionReviewedOn(key, catalogSources, reviewedOn),
    };
  });
  return { version: 1, kind, entityId, locale: "en", seoMode: "auto", seo: buildAutomaticEnglishDetailSeo(kind, facts), sectionOrder: [...DETAIL_CONTENT_LAYOUT_KEYS[kind]], sections };
}

async function addGeneratedImages(params: {
  kind: DetailContentKind;
  entityId: number;
  entityName: string;
  content: DetailContent;
  existing: DetailContent;
  ai: AiContentService;
}) {
  let generatedImages = 0;
  let imageFailures = 0;
  const existingByKey = new Map(params.existing.sections.map(section => [section.key, section] as const));
  const sections = [...params.content.sections];
  for (const target of AI_IMAGE_TARGETS) {
    const index = sections.findIndex(section => section.key === target.key);
    if (index < 0) continue;
    const section = sections[index];
    const existingImages = existingByKey.get(target.key)?.images ?? [];
    const images = [...existingImages];
    for (let variation = images.length + 1; variation <= target.count; variation += 1) {
      try {
        const generated = await params.ai.generateEditorialImage({
          kind: params.kind,
          entityName: params.entityName,
          sectionKey: section.key,
          sectionTitle: section.title,
          sectionBody: section.body ?? section.title,
          variation,
        });
        const contentSha256 = createHash("sha256").update(generated.buffer).digest("hex");
        await generatedImageStorage.uploadContentAddressedBuffer({
          subdir: `website-ai/detail-pages/${params.kind}/${params.entityId}/${section.key}-${variation}`,
          contentSha256,
          buffer: generated.buffer,
          contentType: generated.contentType,
          extension: ".webp",
        });
        images.push({
          src: `/api/storage/public-website-assets/detail-pages/${params.kind}/${params.entityId}/${section.key}-${variation}/${contentSha256}.webp`,
          alt: `${params.entityName} — ${section.title}`,
          ...(target.key === "gallery" ? { caption: section.title } : {}),
        });
        generatedImages += 1;
      } catch (error) {
        imageFailures += 1;
        const reason = error instanceof Error ? error.message : "unknown_error";
        console.warn("[website-detail-regeneration] optional image generation failed", {
          kind: params.kind,
          entityId: params.entityId,
          section: section.key,
          variation,
          reason: reason.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 300),
        });
      }
    }
    const generatedHeroMedia = target.key === "hero" && images.some(image => image.src.startsWith("/api/storage/public-website-assets/detail-pages/"));
    const overlayOpacity = section.hero?.overlayOpacity;
    sections[index] = images.length ? {
      ...section,
      images,
      ...(generatedHeroMedia && (overlayOpacity === undefined || overlayOpacity > 65)
        ? { hero: { ...section.hero, overlayOpacity: 58 } }
        : {}),
    } : section;
  }
  return { content: { ...params.content, sections }, generatedImages, imageFailures };
}

async function buildAiEnglishSource(kind: DetailContentKind, entityId: number, payload: unknown, layout: Awaited<ReturnType<typeof readPublishedDetailLayout>>, existing: DetailContent, ai: AiContentService) {
  const base = buildEnglishSource(kind, entityId, payload, layout);
  const entityName = entityFacts(kind, payload, entityId).name;
  const existingByKey = new Map(existing.sections.map(section => [section.key, section] as const));
  const shared = new Map(detailTemplateSectionsForLocale(layout, "en").map(section => [section.key, section]));
  const requested = layout.sections.flatMap(layoutKey => {
    const setting = layout.generation[layoutKey];
    if (!setting?.enabled || layout.hidden.includes(layoutKey)) return [];
    const key = layoutKey.startsWith("editorial-") ? layoutKey.slice(10) : layoutKey;
    const section = base.sections.find(value => value.key === key);
    if (!section) return [];
    return [{ key, title: section.title, templateBody: shared.get(key)?.body ?? "", instruction: setting.instruction }];
  });
  const facts = verifiedGenerationFacts(kind, payload);
  const plan = buildDetailGenerationPlan({
    kind,
    entityName: entityFacts(kind, payload, entityId).name,
    facts,
    sections: requested,
  });
  if (!plan.sections.length) return { content: base, plan, generatedSections: 0, generatedImages: 0, imageFailures: 0 };
  const generated = await ai.generateDetailSections({
    kind,
    entityName: entityFacts(kind, payload, entityId).name,
    facts,
    sections: plan.sections,
    plan,
    contentPolicy: layout.contentPolicy,
  });
  const skipped = new Set(plan.skippedSections.map(item => item.key));
  const generatedKeys = new Set(Object.keys(generated));
  const generatedPlaceholder = /^(?:Review and customize|Current .+ is supplied from|Explore .+ that can help you evaluate)/i;
  const content = {
      ...base,
      sections: base.sections.flatMap(section => {
        if (generatedKeys.has(section.key)) return [preserveDetailSectionDesign(
          { ...section, title: section.key === "hero" ? section.title : contextualSectionTitle(section.key, generated[section.key]!.title, entityName), body: generated[section.key]!.body },
          existingByKey.get(section.key),
        )];
        if (skipped.has(section.key)) {
          const current = existingByKey.get(section.key);
          if (current?.body && !generatedPlaceholder.test(current.body)) return [current];
          if (shared.get(section.key)?.body) return [preserveDetailSectionDesign(section, current)];
          return [];
        }
        return [preserveDetailSectionDesign(section, existingByKey.get(section.key))];
      }),
    };
  const visual = await addGeneratedImages({
    kind,
    entityId,
    entityName,
    content,
    existing,
    ai,
  });
  return {
    content: visual.content,
    plan,
    generatedSections: plan.sections.length,
    generatedImages: visual.generatedImages,
    imageFailures: visual.imageFailures,
  };
}

export async function regenerateDetailContentDraft(params: {
  kind: DetailContentKind;
  entityId: number;
  locale: string;
  actorId: number;
  ai: AiContentService | null;
  mode?: "fill_missing" | "regenerate";
}): Promise<DetailRegenerationResult> {
  const { kind, entityId, locale, actorId, ai, mode = "fill_missing" } = params;
  try {
    const payload = await readDetailContentEditorContext(kind, entityId, locale);
    if (!payload) return { entityId, locale, status: "failed", error: "SOURCE_NOT_FOUND" };
    const [target, english, layout] = await Promise.all([
      readDetailContentDraft(kind, entityId, locale),
      locale === "en" ? Promise.resolve(null) : readDetailContentDraft(kind, entityId, "en"),
      readPublishedDetailLayout(kind),
    ]);
    if (locale === "en" && mode === "regenerate" && !ai) return { entityId, locale, status: "failed", pageId: target.pageId, error: "AI_NOT_CONFIGURED" };
    const aiEnglish = locale === "en" && mode === "regenerate" && ai
      ? await buildAiEnglishSource(kind, entityId, payload, layout, target.content, ai)
      : { content: buildEnglishSource(kind, entityId, payload, layout), plan: null as DetailGenerationPlan | null, generatedSections: 0, generatedImages: 0, imageFailures: 0 };
    const generatedEnglish = aiEnglish.content;
    const savedEnglish = english?.content.sections.length ? new Map(english.content.sections.map(section => [section.key, section])) : null;
    const englishBase = savedEnglish ? {
      ...generatedEnglish,
      sections: generatedEnglish.sections.map(section => savedEnglish.get(section.key) ?? section),
    } : generatedEnglish;
    let generated: DetailContent;
    let addedSections = 0;
    const manualSeo = Boolean(target.content.seo && target.content.seoMode !== "auto");
    const qualityPlan = aiEnglish.plan ?? buildDetailGenerationPlan({
      kind,
      entityName: entityFacts(kind, payload, entityId).name,
      facts: verifiedGenerationFacts(kind, payload),
      sections: layout.sections.flatMap(layoutKey => {
        const setting = layout.generation[layoutKey];
        if (!setting?.enabled || layout.hidden.includes(layoutKey)) return [];
        const key = layoutKey.startsWith("editorial-") ? layoutKey.slice(10) : layoutKey;
        const section = generatedEnglish.sections.find(value => value.key === key);
        return [{ key, title: section?.title ?? titles[key] ?? key, templateBody: "", instruction: setting.instruction }];
      }),
    });
    // A full page regeneration is one atomic content operation: sections and
    // language-specific SEO are rebuilt together. Manual SEO is preserved only
    // for the non-destructive fill-missing path.
    const preserveManualSeo = manualSeo && mode !== "regenerate";
    if (locale === "en") {
      const existing = new Map(target.content.sections.map(section => [section.key, section]));
      const regeneratedKeys = new Set(layout.sections.filter(key => layout.generation[key]?.enabled).map(key => key.startsWith("editorial-") ? key.slice(10) : key));
      generated = { ...englishBase, ...(preserveManualSeo ? { seoMode: "manual" as const, seo: target.content.seo } : {}), sections: englishBase.sections.map(section => mode === "regenerate" && regeneratedKeys.has(section.key) ? section : existing.get(section.key) ?? section) };
      addedSections = generated.sections.length - existing.size;
    } else {
      const missing = DETAIL_CONTENT_KEYS[kind].filter(key => !target.content.sections.some(section => section.key === key));
      if (!missing.length && mode === "fill_missing") return { entityId, locale, status: "preserved", pageId: target.pageId, addedSections: 0 };
      if (!ai) return { entityId, locale, status: "failed", pageId: target.pageId, error: "AI_NOT_CONFIGURED" };
      const preferredTerms = await aiPreferredTranslationTerms(kind, payload, locale, ai);
      const translated = await translateStructuredDetailContent(englishBase, locale, ai, {
        protectedTerms: protectedTranslationTerms(kind, payload, preferredTerms),
        preferredTerms,
        editorialGuidance: JSON.stringify({
          direction: layout.contentPolicy.direction,
          tone: layout.contentPolicy.tone,
          style: layout.contentPolicy.style,
          phrasesToAvoid: layout.contentPolicy.prohibitedPhrases,
          preferredWording: layout.contentPolicy.preferredReplacements,
          preferredOrganizations: layout.contentPolicy.preferredOrganizations,
          translationInstruction: layout.contentPolicy.translationInstruction,
        }),
      });
      const translatedByKey = new Map(translated.sections.map(section => [section.key, section]));
      generated = inheritEnglishDetailStructure({
        ...target.content,
        locale,
        displayTerms: { ...(target.content.displayTerms ?? {}), ...preferredTerms },
        seoMode: preserveManualSeo ? "manual" : "auto",
        seo: preserveManualSeo ? target.content.seo : translated.seo,
        sectionOrder: [...DETAIL_CONTENT_LAYOUT_KEYS[kind]],
        sections: mode === "regenerate"
          ? translated.sections
          : [...target.content.sections, ...missing.map(key => translatedByKey.get(key)!).filter(Boolean)],
      }, englishBase);
      addedSections = mode === "regenerate" ? translated.sections.length : missing.length;
    }
    const valid = parseDetailContent(generated);
    if (!valid) return { entityId, locale, status: "failed", pageId: target.pageId, error: "INVALID_GENERATED_CONTENT" };
    const quality = mode === "regenerate" ? evaluateDetailContentQuality({ content: valid, plan: qualityPlan, previous: target.content }) : undefined;
    if (quality?.status === "blocked") return { entityId, locale, status: "failed", pageId: target.pageId, quality, error: "QUALITY_BLOCKED" };
    if (mode !== "regenerate" && !addedSections && target.pageId && manualSeo) return { entityId, locale, status: "preserved", pageId: target.pageId, addedSections: 0 };
    const saved = await saveGeneratedDetailContentDraft(valid, actorId, target.updatedAt);
    return { entityId, locale, status: target.pageId ? "completed" : "created", pageId: saved.pageId, addedSections, generatedSections: aiEnglish.generatedSections, generatedImages: aiEnglish.generatedImages, imageFailures: aiEnglish.imageFailures, ...(quality ? { quality } : {}) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const diagnostic = reason
      .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
      .replace(/Bearer\s+[^\s\"]+/gi, "Bearer [redacted]")
      .slice(0, 600);
    console.warn("[website-detail-regeneration] generation failed", {
      kind,
      entityId,
      locale,
      mode,
      reason: diagnostic || "unknown_error",
    });
    return { entityId, locale, status: "failed", error: reason === "CONFLICT" ? "CONFLICT" : "UNAVAILABLE" };
  }
}

