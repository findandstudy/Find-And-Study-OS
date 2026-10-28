import { AiContentService } from "./aiService";
import { createHash } from "node:crypto";
import { ObjectStorageService } from "./objectStorage";
import {
  DETAIL_CONTENT_KEYS,
  DETAIL_CONTENT_LAYOUT_KEYS,
  inheritEnglishDetailStructure,
  parseDetailContent,
  type DetailContent,
  type DetailContentKind,
  type DetailSeo,
  type DetailContentSection,
} from "./websiteDetailContentContract";
import {
  readDetailContentDraft,
  readDetailContentEditorContext,
  saveGeneratedDetailContentDraft,
} from "./websiteDetailContent";
import { readPublishedDetailLayout } from "./websiteDetailLayouts";
import { detailTemplateSectionsForLocale } from "./websiteDetailLayoutContract";
import { translateStructuredDetailContent } from "./websiteDetailTranslation";
import { detailGenerationSources, detailSectionReviewedOn, detailSectionSources } from "./websiteDetailSources";

export type DetailRegenerationResult = {
  entityId: number;
  locale: string;
  status: "created" | "completed" | "preserved" | "failed";
  pageId?: number | null;
  addedSections?: number;
  generatedSections?: number;
  generatedImages?: number;
  imageFailures?: number;
  error?: "AI_NOT_CONFIGURED" | "SOURCE_NOT_FOUND" | "INVALID_GENERATED_CONTENT" | "CONFLICT" | "UNAVAILABLE";
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
const liveKeys = new Set(["navigation", "facts", "weather", "fees", "intakes", "related", "programs", "universities", "cities", "cta", "mobileActions"]);
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
    universityCount: positiveCount(record(root.stats)?.universityCount), programCount: positiveCount(record(root.stats)?.programCount),
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
    program: text(entity.programName), description: text(entity.description), degree: text(entity.degree), field: text(entity.field),
    teachingLanguage: text(entity.language), duration: text(entity.duration), tuitionFee: entity.tuitionFee,
    discountedFee: entity.discountedFee, currency: text(entity.currency), scholarship: entity.scholarship,
    intakes: entity.intakesText, requirements: entity.requirements, quota: entity.quota,
    university: text(entity.universityName), city: text(entity.universityCity), country: text(entity.universityCountry),
    officialSources,
  };
}

const trimAtWord = (value: string, max: number) => {
  if (value.length <= max) return value;
  const chunk = value.slice(0, max + 1);
  const boundary = chunk.lastIndexOf(" ");
  return `${chunk.slice(0, boundary > max * 0.6 ? boundary : max).replace(/[\s,;:.!?-]+$/u, "")}…`;
};

function buildEnglishSeo(kind: DetailContentKind, facts: ReturnType<typeof entityFacts>): DetailSeo {
  const title = trimAtWord(kind === "program" && facts.universityName
    ? `${facts.name} at ${facts.universityName} | Find & Study`
    : kind === "university"
      ? `${facts.name} Programs & Admissions | Find & Study`
      : `Study in ${facts.name} | Find & Study`, 60);
  const fallback = kind === "program"
    ? `Explore ${facts.name}${facts.universityName ? ` at ${facts.universityName}` : ""}, including study details, requirements, fees and application guidance.`
    : kind === "university"
      ? `Explore ${facts.name}${facts.city || facts.country ? ` in ${[facts.city, facts.country].filter(Boolean).join(", ")}` : ""}, compare programs and plan your application.`
      : `Explore study opportunities, universities, programs and practical student guidance for ${facts.name}.`;
  const description = trimAtWord(facts.description || fallback, 160);
  return { title, description, ogTitle: title, ogDescription: description, twitterTitle: title, twitterDescription: description };
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
      || (liveKeys.has(key)
        ? `Current ${title.toLocaleLowerCase("en-US")} for ${facts.name} is supplied from the connected source records.`
        : `Review and customize the ${title.toLocaleLowerCase("en-US")} information for ${facts.name} before publishing.`);
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
  return { version: 1, kind, entityId, locale: "en", seoMode: "auto", seo: buildEnglishSeo(kind, facts), sectionOrder: [...DETAIL_CONTENT_LAYOUT_KEYS[kind]], sections };
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
  const shared = new Map(detailTemplateSectionsForLocale(layout, "en").map(section => [section.key, section]));
  const requested = layout.sections.flatMap(layoutKey => {
    const setting = layout.generation[layoutKey];
    if (!setting?.enabled || layout.hidden.includes(layoutKey)) return [];
    const key = layoutKey.startsWith("editorial-") ? layoutKey.slice(10) : layoutKey;
    const section = base.sections.find(value => value.key === key);
    if (!section) return [];
    return [{ key, title: section.title, templateBody: shared.get(key)?.body ?? "", instruction: setting.instruction }];
  });
  if (!requested.length) return { content: base, generatedSections: 0, generatedImages: 0, imageFailures: 0 };
  const generated = await ai.generateDetailSections({
    kind,
    entityName: entityFacts(kind, payload, entityId).name,
    facts: verifiedGenerationFacts(kind, payload),
    sections: requested,
  });
  const content = {
      ...base,
      sections: base.sections.map(section => generated[section.key]
        ? { ...section, title: section.key === "hero" ? section.title : generated[section.key].title, body: generated[section.key].body }
        : section),
    };
  const visual = await addGeneratedImages({
    kind,
    entityId,
    entityName: entityFacts(kind, payload, entityId).name,
    content,
    existing,
    ai,
  });
  return {
    content: visual.content,
    generatedSections: requested.length,
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
      : { content: buildEnglishSource(kind, entityId, payload, layout), generatedSections: 0, generatedImages: 0, imageFailures: 0 };
    const generatedEnglish = aiEnglish.content;
    const savedEnglish = english?.content.sections.length ? new Map(english.content.sections.map(section => [section.key, section])) : null;
    const englishBase = savedEnglish ? {
      ...generatedEnglish,
      sections: generatedEnglish.sections.map(section => savedEnglish.get(section.key) ?? section),
    } : generatedEnglish;
    let generated: DetailContent;
    let addedSections = 0;
    const manualSeo = Boolean(target.content.seo && target.content.seoMode !== "auto");
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
      const translated = await translateStructuredDetailContent(englishBase, locale, ai);
      const translatedByKey = new Map(translated.sections.map(section => [section.key, section]));
      generated = inheritEnglishDetailStructure({
        ...target.content,
        locale,
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
    if (mode !== "regenerate" && !addedSections && target.pageId && manualSeo) return { entityId, locale, status: "preserved", pageId: target.pageId, addedSections: 0 };
    const saved = await saveGeneratedDetailContentDraft(valid, actorId, target.updatedAt);
    return { entityId, locale, status: target.pageId ? "completed" : "created", pageId: saved.pageId, addedSections, generatedSections: aiEnglish.generatedSections, generatedImages: aiEnglish.generatedImages, imageFailures: aiEnglish.imageFailures };
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

