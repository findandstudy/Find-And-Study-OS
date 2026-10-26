/** Page-owned editorial and localized SEO content; catalogue facts and publication authority remain external. */
import { parseDetailSectionPresentation, resolveDetailTemplateText, validDetailTemplateText, withoutCatalogueWording, type DetailSectionPresentation } from "./detailLayoutContract";

export const DETAIL_CONTENT_KINDS = ["program", "university", "destination", "city"] as const;
export type DetailContentKind = typeof DETAIL_CONTENT_KINDS[number];
export const DETAIL_CONTENT_KEYS: Record<DetailContentKind, readonly string[]> = {
  program: ["hero", "navigation", "overview", "gallery", "highlights", "curriculum", "requirements", "admission", "fees", "intakes", "scholarships", "living", "campus", "climate", "housing", "services", "applyGuide", "studentStory", "recognition", "related", "faq", "mobileActions"],
  university: ["hero", "navigation", "overview", "gallery", "highlights", "cautions", "programs", "admission", "scholarships", "intakeGuide", "facts", "weather", "education", "support", "services", "campus", "housing", "recognition", "living", "reviews", "faq", "applyGuide", "mobileActions"],
  destination: ["hero", "navigation", "overview", "gallery", "highlights", "cautions", "education", "facts", "admission", "requirements", "scholarships", "living", "climate", "housing", "visa", "services", "recognition", "cities", "universities", "programs", "faq", "applyGuide", "cta"],
  city: ["hero", "navigation", "overview", "gallery", "highlights", "cautions", "education", "facts", "weather", "living", "climate", "transport", "campus", "housing", "requirements", "visa", "services", "universities", "programs", "faq", "applyGuide"],
};

const editorialLayoutKeys = (...keys: string[]) => keys.map((key) => `editorial-${key}`);
/** Complete page-level order. The first three structural sections stay fixed. */
export const DETAIL_CONTENT_LAYOUT_KEYS: Record<DetailContentKind, readonly string[]> = {
  program: ["hero", "navigation", "overview", ...editorialLayoutKeys("gallery", "highlights", "curriculum"), "requirements", ...editorialLayoutKeys("admission"), "fees", "intakes", ...editorialLayoutKeys("scholarships", "living", "campus", "climate", "housing", "services", "applyGuide", "studentStory", "recognition"), "related", ...editorialLayoutKeys("faq"), "mobileActions"],
  university: ["hero", "navigation", "overview", ...editorialLayoutKeys("gallery", "highlights", "cautions"), "programs", ...editorialLayoutKeys("admission", "scholarships", "intakeGuide"), "facts", "weather", ...editorialLayoutKeys("education", "support", "services", "campus", "housing", "recognition", "living", "reviews", "faq", "applyGuide"), "mobileActions"],
  destination: ["hero", "navigation", "overview", ...editorialLayoutKeys("gallery", "highlights", "cautions", "education"), "facts", ...editorialLayoutKeys("admission", "requirements", "scholarships", "living", "climate", "housing", "visa", "services", "recognition"), "cities", "universities", "programs", ...editorialLayoutKeys("faq", "applyGuide"), "cta"],
  city: ["hero", "navigation", "overview", ...editorialLayoutKeys("gallery", "highlights", "cautions", "education"), "facts", "weather", ...editorialLayoutKeys("living", "climate", "transport", "campus", "housing", "requirements", "visa", "services"), "universities", "programs", ...editorialLayoutKeys("faq", "applyGuide")],
};

/** Sections whose records stay authoritative in the catalogue while CMS controls presentation copy. */
export const DETAIL_GENERATED_CONTENT_KEYS = [
  "navigation", "facts", "weather", "fees", "intakes", "related", "programs",
  "universities", "cities", "cta", "mobileActions",
] as const;
export const DETAIL_CONTENT_LOCALES = ["en","tr","ar","fr","ru","fa","zh","hi","es","id","ur","tk","ky","kk","uz","tg","bn","pt","ne","vi","ko","uk","it"] as const;
const LEGACY_CATALOGUE_COUNT_QUALIFIER = /catalog(?:ue)?|katalog|каталог|目录|कैटलॉग|کیٹلاگ|феҳрист|ক্যাটালগ|catálogo|क्याटलग|danh mục|카탈로그/iu;
export type DetailHeroSettings = {
  eyebrow?: string;
  primaryCtaLabel?: string; primaryCtaHref?: string;
  secondaryCtaLabel?: string; secondaryCtaHref?: string;
  countryLabel?: string; universityCountLabel?: string; programCountLabel?: string;
  programLanguagesLabel?: string; climateLabel?: string; transportLabel?: string;
  campusGeographyLabel?: string; housingLabel?: string;
  backgroundColor?: string; overlayColor?: string; overlayOpacity?: number;
  textColor?: string; accentColor?: string;
};
export type DetailContentSection = {
  key: string; title: string; body?: string;
  hero?: DetailHeroSettings;
  presentation?: DetailSectionPresentation;
  cards?: { title: string; body: string; href?: string }[];
  table?: { columns: string[]; rows: string[][] };
  steps?: { title: string; body: string }[];
  images?: { src: string; alt: string; caption?: string }[];
  questions?: { question: string; answer: string }[];
  sources: { label: string; url: string }[];
  reviewedOn: string;
};
export type DetailTemplateSectionCopy = { key: string; title?: string; body?: string };
export type DetailSeo = {
  title: string; description: string;
  ogTitle: string; ogDescription: string;
  twitterTitle: string; twitterDescription: string;
};
export type DetailSeoFacts = { city?: string; country?: string; university?: string; program?: string };
export type DetailContent = { version: 1; kind: DetailContentKind; entityId: number; locale: string; seo?: DetailSeo; seoMode?: "auto" | "manual"; sectionOrder?: string[]; sections: DetailContentSection[]; templateSections?: DetailTemplateSectionCopy[] };
const SEO_FALLBACKS: Record<string, (name: string) => string> = {
  en: name => `Explore ${name}, compare study options and plan your next step with Find & Study.`,
  tr: name => `${name} hakkında bilgi alın, eğitim seçeneklerini karşılaştırın ve sonraki adımınızı Find & Study ile planlayın.`,
  ar: name => `اكتشف ${name} وقارن خيارات الدراسة وخطط لخطوتك التالية مع Find & Study.`,
  fr: name => `Découvrez ${name}, comparez les options d’études et préparez votre prochaine étape avec Find & Study.`,
  ru: name => `Узнайте больше о ${name}, сравните варианты обучения и спланируйте следующий шаг с Find & Study.`,
  fa: name => `${name} را بررسی کنید، گزینه‌های تحصیل را مقایسه کنید و گام بعدی را با Find & Study برنامه‌ریزی کنید.`,
  zh: name => `了解${name}，比较留学选择，并与 Find & Study 一起规划下一步。`,
  hi: name => `${name} के बारे में जानें, अध्ययन विकल्पों की तुलना करें और Find & Study के साथ अगला कदम तय करें।`,
  es: name => `Descubre ${name}, compara opciones de estudio y planifica tu próximo paso con Find & Study.`,
  id: name => `Jelajahi ${name}, bandingkan pilihan studi, dan rencanakan langkah berikutnya bersama Find & Study.`,
  ur: name => `${name} کے بارے میں جانیں، تعلیمی اختیارات کا موازنہ کریں اور Find & Study کے ساتھ اگلا قدم طے کریں۔`,
  tk: name => `${name} barada öwreniň, okuw mümkinçiliklerini deňeşdiriň we indiki ädimiňizi Find & Study bilen meýilleşdiriň.`,
  ky: name => `${name} тууралуу билип, окуу мүмкүнчүлүктөрүн салыштырып, кийинки кадамыңызды Find & Study менен пландаңыз.`,
  kk: name => `${name} туралы біліп, оқу нұсқаларын салыстырыңыз және келесі қадамыңызды Find & Study көмегімен жоспарлаңыз.`,
  uz: name => `${name} haqida bilib oling, ta’lim variantlarini solishtiring va keyingi qadamingizni Find & Study bilan rejalashtiring.`,
  tg: name => `Дар бораи ${name} маълумот гиред, имконоти таҳсилро муқоиса кунед ва қадами навбатиро бо Find & Study ба нақша гиред.`,
  bn: name => `${name} সম্পর্কে জানুন, পড়াশোনার বিকল্প তুলনা করুন এবং Find & Study-এর সঙ্গে পরবর্তী পদক্ষেপ পরিকল্পনা করুন।`,
  pt: name => `Conheça ${name}, compare opções de estudo e planeje seu próximo passo com a Find & Study.`,
  ne: name => `${name} बारे जान्नुहोस्, अध्ययन विकल्पहरू तुलना गर्नुहोस् र Find & Study सँग आफ्नो अर्को कदम योजना बनाउनुहोस्।`,
  vi: name => `Khám phá ${name}, so sánh các lựa chọn học tập và lên kế hoạch cho bước tiếp theo cùng Find & Study.`,
  ko: name => `${name} 정보를 확인하고 학업 옵션을 비교하여 Find & Study와 다음 단계를 계획하세요.`,
  uk: name => `Дізнайтеся більше про ${name}, порівняйте варіанти навчання та сплануйте наступний крок із Find & Study.`,
  it: name => `Scopri ${name}, confronta le opzioni di studio e pianifica il prossimo passo con Find & Study.`,
};
const seoLimit = (value: string, max: number) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  const chunk = normalized.slice(0, max + 1), boundary = chunk.lastIndexOf(" ");
  return `${chunk.slice(0, boundary > max * 0.6 ? boundary : max).replace(/[\s,;:.!?-]+$/u, "")}…`;
};
/**
 * Fills missing locale-owned SEO without replacing a previously generated
 * localized value. Explicit regeneration clears `seo` before calling this
 * helper, while human overrides always remain stable.
 */
export function ensureDetailSeo(content: DetailContent, facts: DetailSeoFacts = {}): DetailContent {
  if (content.seo) return content;
  const hero = content.sections.find(section => section.key === "hero");
  const overview = content.sections.find(section => section.key === "overview");
  const contentName = hero?.title?.trim() || overview?.title?.trim() || "Find & Study";
  const name = content.kind === "program"
    ? [facts.program || contentName, facts.university].filter(Boolean).join(" – ")
    : content.kind === "university"
      ? [facts.university || contentName, facts.city, facts.country].filter(Boolean).join(" – ")
      : content.kind === "city"
        ? [facts.city || contentName, facts.country].filter(Boolean).join(" – ")
        : facts.country || contentName;
  const title = seoLimit(`${name} | Find & Study`, 60);
  const sourceDescription = hero?.body?.trim() || overview?.body?.trim() || (SEO_FALLBACKS[content.locale] ?? SEO_FALLBACKS.en)(name);
  const description = seoLimit(sourceDescription, 160);
  return { ...content, seoMode: "auto", seo: { title, description, ogTitle: title, ogDescription: description, twitterTitle: title, twitterDescription: description } };
}
const HERO_VISUAL_KEYS = ["backgroundColor", "overlayColor", "overlayOpacity", "textColor", "accentColor"] as const;
/** Keep every locale on the English design while leaving all visible copy locale-owned. */
export function inheritEnglishDetailStructure(localized: DetailContent, english: DetailContent | null): DetailContent {
  if (!english || english.kind !== localized.kind || english.entityId !== localized.entityId || localized.locale === "en") return localized;
  const englishByKey = new Map(english.sections.map(section => [section.key, section] as const));
  const sections = localized.sections.map((section): DetailContentSection => {
    const englishSection = englishByKey.get(section.key);
    if (!englishSection) return section;
    const visualSettings: Partial<DetailHeroSettings> = {};
    for (const key of HERO_VISUAL_KEYS) if (englishSection.hero?.[key] !== undefined) visualSettings[key] = englishSection.hero[key] as never;
    const hero = section.hero || Object.keys(visualSettings).length ? { ...(section.hero ?? {}), ...visualSettings } : undefined;
    return { ...section, presentation: englishSection.presentation, hero };
  });
  return { ...localized, sectionOrder: english.sectionOrder ? [...english.sectionOrder] : undefined, sections };
}
function resolvePageSection(section: DetailContentSection, kind: DetailContentKind, variables: Readonly<Record<string, string | null | undefined>>): DetailContentSection {
  const resolve = (value: string | undefined) => value === undefined ? undefined : resolveDetailTemplateText(value, kind, variables) ?? "";
  return {
    ...section,
    title: resolve(section.title) ?? "",
    body: resolve(section.body),
    hero: section.hero ? Object.fromEntries(Object.entries(section.hero).map(([key, value]) => [key, typeof value === "string" && !key.endsWith("Href") && !key.endsWith("Color") ? resolve(value) : value])) as DetailHeroSettings : undefined,
    cards: section.cards?.map(item => ({ ...item, title: resolve(item.title) ?? "", body: resolve(item.body) ?? "" })),
    table: section.table ? { columns: section.table.columns.map(value => resolve(value) ?? ""), rows: section.table.rows.map(row => row.map(value => resolve(value) ?? "")) } : undefined,
    steps: section.steps?.map(item => ({ title: resolve(item.title) ?? "", body: resolve(item.body) ?? "" })),
    images: section.images?.map(item => ({ ...item, alt: resolve(item.alt) ?? "", caption: resolve(item.caption) })),
    questions: section.questions?.map(item => ({ question: resolve(item.question) ?? "", answer: resolve(item.answer) ?? "" })),
  };
}
export function effectiveDetailContentSections(content: DetailContent | null | undefined, variables: Readonly<Record<string, string | null | undefined>> = {}): DetailContentSection[] {
  if (!content) return [];
  const result = content.sections.map(section => resolvePageSection(section, content.kind, variables));
  for (const shared of content.templateSections ?? []) {
    const resolvedTitle = resolveDetailTemplateText(shared.title, content.kind, variables);
    const resolvedBody = resolveDetailTemplateText(shared.body, content.kind, variables);
    const index = result.findIndex(section => section.key === shared.key);
    if (index >= 0) {
      const page = result[index];
      result[index] = { ...page, title: page.title || resolvedTitle || "", body: page.body || resolvedBody };
    } else if (resolvedTitle || resolvedBody) {
      result.push({ key: shared.key, title: resolvedTitle || "", body: resolvedBody, sources: [], reviewedOn: "" });
    }
  }
  return result;
}
export function resolveDetailTemplateContent(content: DetailContent | null, variables: Readonly<Record<string, string | null | undefined>>): DetailContent | null {
  if (!content) return null;
  return { ...content, sections: effectiveDetailContentSections(content, variables), templateSections: undefined };
}
export function detailContentPresentationOverrides(content: DetailContent | null | undefined): Record<string, DetailSectionPresentation> {
  if (!content) return {};
  const allowed = DETAIL_CONTENT_LAYOUT_KEYS[content.kind];
  const result: Record<string, DetailSectionPresentation> = {};
  for (const section of content.sections) {
    if (!section.presentation) continue;
    const layoutKey = allowed.includes(section.key) ? section.key : allowed.includes(`editorial-${section.key}`) ? `editorial-${section.key}` : null;
    if (layoutKey) result[layoutKey] = section.presentation;
  }
  return result;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[], required: string[] = []) => Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v,k));
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const templateText = (v: unknown, max: number, kind: DetailContentKind) => text(v, max) && validDetailTemplateText(v, kind, max);
export function safeDetailContentUrl(v: unknown, externalOnly = false): boolean {
  if (typeof v !== "string" || v.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(v)) return false;
  if (!externalOnly && /^#[A-Za-z][A-Za-z0-9_-]*$/.test(v)) return true;
  if (!externalOnly && /^\/(?!\/)/.test(v)) return !v.includes("..");
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}
export function parseDetailContent(value: unknown, today = new Date().toISOString().slice(0,10)): DetailContent | null {
  if (!record(value) || !keys(value,["version","kind","entityId","locale","seo","seoMode","sectionOrder","sections","templateSections"],["version","kind","entityId","locale","sections"])
    || value.version !== 1 || !DETAIL_CONTENT_KINDS.includes(value.kind as DetailContentKind)
    || !Number.isSafeInteger(value.entityId) || Number(value.entityId) <= 0 || Number(value.entityId) > 2147483647
    || !DETAIL_CONTENT_LOCALES.includes(value.locale as typeof DETAIL_CONTENT_LOCALES[number])
    || !Array.isArray(value.sections) || value.sections.length > 30
    || new Set(value.sections.map(s => record(s) ? s.key : null)).size !== value.sections.length) return null;
  if (value.seoMode !== undefined && value.seoMode !== "auto" && value.seoMode !== "manual") return null;
  if (value.seo !== undefined && (!record(value.seo)
    || !keys(value.seo, ["title", "description", "ogTitle", "ogDescription", "twitterTitle", "twitterDescription"], ["title", "description", "ogTitle", "ogDescription", "twitterTitle", "twitterDescription"])
    || !text(value.seo.title, 160) || !text(value.seo.description, 320)
    || !text(value.seo.ogTitle, 160) || !text(value.seo.ogDescription, 320)
    || !text(value.seo.twitterTitle, 160) || !text(value.seo.twitterDescription, 320))) return null;
  if (value.templateSections !== undefined) {
    if (!Array.isArray(value.templateSections) || value.templateSections.length > 30
      || new Set(value.templateSections.map(section => record(section) ? section.key : null)).size !== value.templateSections.length
      || !value.templateSections.every(section => record(section)
        && keys(section, ["key", "title", "body"], ["key"])
        && typeof section.key === "string"
        && DETAIL_CONTENT_KEYS[value.kind as DetailContentKind].includes(section.key)
        && (section.title === undefined || (section.key !== "hero" && text(section.title, 160)))
        && (section.body === undefined || text(section.body, 6000))
        && (section.title !== undefined || section.body !== undefined))) return null;
  }
  let normalizedSectionOrder: string[] | undefined;
  if (value.sectionOrder !== undefined) {
    const expected = DETAIL_CONTENT_LAYOUT_KEYS[value.kind as DetailContentKind];
    const saved = Array.isArray(value.sectionOrder) ? value.sectionOrder : [];
    const missing = expected.filter(key => !saved.includes(key));
    if (!Array.isArray(value.sectionOrder) || (saved.length !== expected.length && !(
      missing.length > 0 && missing.every(key => key === "programs" || key === "weather") && saved.length + missing.length === expected.length
    ))
      || new Set(saved).size !== saved.length
      || !value.sectionOrder.every((key) => typeof key === "string" && expected.includes(key))
      || value.sectionOrder[0] !== "hero" || value.sectionOrder[1] !== "navigation" || value.sectionOrder[2] !== "overview") return null;
    normalizedSectionOrder = [...saved] as string[];
    for (const [index, key] of expected.entries()) if (!normalizedSectionOrder.includes(key)) {
      const next = expected.slice(index + 1).find(candidate => normalizedSectionOrder!.includes(candidate));
      if (next) normalizedSectionOrder.splice(normalizedSectionOrder.indexOf(next), 0, key); else normalizedSectionOrder.push(key);
    }
  }
  for (const s of value.sections) {
    if (!record(s) || !keys(s,["key","title","body","hero","presentation","cards","table","steps","images","questions","sources","reviewedOn"],["key","title","sources","reviewedOn"])
      || typeof s.key !== "string" || !DETAIL_CONTENT_KEYS[value.kind as DetailContentKind].includes(s.key) || !templateText(s.title,160,value.kind as DetailContentKind)
      || (s.body !== undefined && !templateText(s.body,6000,value.kind as DetailContentKind)) || typeof s.reviewedOn !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(s.reviewedOn) || !Number.isFinite(Date.parse(s.reviewedOn))
      || new Date(s.reviewedOn).toISOString().slice(0,10) !== s.reviewedOn || s.reviewedOn > today
      || !Array.isArray(s.sources) || s.sources.length < 1 || s.sources.length > 8
      || !s.sources.every(x => record(x) && keys(x,["label","url"],["label","url"]) && text(x.label,160) && safeDetailContentUrl(x.url,true))) return null;
    if (s.presentation !== undefined && !parseDetailSectionPresentation(s.presentation)) return null;
    if (s.hero !== undefined) {
      const hero = s.hero;
      const heroTextLimits: Record<string, number> = {
        eyebrow: 120, primaryCtaLabel: 120, secondaryCtaLabel: 120,
        countryLabel: 120, universityCountLabel: 120, programCountLabel: 120,
        programLanguagesLabel: 120, climateLabel: 120, transportLabel: 120,
        campusGeographyLabel: 120, housingLabel: 120,
      };
      const allowed = [...Object.keys(heroTextLimits), "primaryCtaHref", "secondaryCtaHref", "backgroundColor", "overlayColor", "overlayOpacity", "textColor", "accentColor"];
      if (s.key !== "hero" || !record(hero) || !keys(hero, allowed) || Object.keys(hero).length === 0) return null;
      for (const [key, limit] of Object.entries(heroTextLimits)) if (hero[key] !== undefined && !templateText(hero[key], limit, value.kind as DetailContentKind)) return null;
      for (const key of ["primaryCtaHref", "secondaryCtaHref"] as const) if (hero[key] !== undefined && !safeDetailContentUrl(hero[key])) return null;
      for (const key of ["backgroundColor", "overlayColor", "textColor", "accentColor"] as const) if (hero[key] !== undefined && (typeof hero[key] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hero[key]))) return null;
      if (hero.overlayOpacity !== undefined && (typeof hero.overlayOpacity !== "number" || !Number.isInteger(hero.overlayOpacity) || hero.overlayOpacity < 0 || hero.overlayOpacity > 100)) return null;
    }
    for (const prop of ["cards","steps","images","questions"] as const) {
      const items = s[prop]; if (items === undefined) continue;
      if (!Array.isArray(items) || items.length < 1 || items.length > (prop === "images" ? 8 : 12)) return null;
      if (!items.every(x => {
        if (!record(x)) return false;
        if (prop === "images") return keys(x,["src","alt","caption"],["src","alt"]) && safeDetailContentUrl(x.src) && templateText(x.alt,300,value.kind as DetailContentKind) && (x.caption === undefined || templateText(x.caption,500,value.kind as DetailContentKind));
        if (prop === "questions") return keys(x,["question","answer"],["question","answer"]) && templateText(x.question,300,value.kind as DetailContentKind) && templateText(x.answer,3000,value.kind as DetailContentKind);
        return keys(x, prop === "cards" ? ["title","body","href"] : ["title","body"],["title","body"]) && templateText(x.title,160,value.kind as DetailContentKind) && templateText(x.body,2000,value.kind as DetailContentKind) && (x.href === undefined || safeDetailContentUrl(x.href));
      })) return null;
    }
    if (s.table !== undefined) {
      const t = s.table;
      if (!record(t) || !keys(t,["columns","rows"],["columns","rows"]) || !Array.isArray(t.columns) || t.columns.length < 1 || t.columns.length > 6
        || !t.columns.every(x => templateText(x,160,value.kind as DetailContentKind)) || !Array.isArray(t.rows) || t.rows.length < 1 || t.rows.length > 20
        || !t.rows.every(row => Array.isArray(row) && row.length === (t.columns as unknown[]).length && row.every(x => templateText(x,500,value.kind as DetailContentKind)))) return null;
    }
    if (!s.body && !s.hero && !s.cards && !s.table && !s.steps && !s.images && !s.questions) return null;
  }
  const normalizedValue = (normalizedSectionOrder ? { ...value, sectionOrder: normalizedSectionOrder } : value) as DetailContent;
  const normalizedSections = normalizedValue.sections.map(section => {
    if (section.key !== "hero") return section;
    const title = withoutCatalogueWording(section.title) ?? section.title;
    const body = withoutCatalogueWording(section.body);
    if (!section.hero) return { ...section, title, ...(body ? { body } : {}) };
    const hero = { ...section.hero };
    for (const key of ["universityCountLabel", "programCountLabel"] as const) {
      if (typeof hero[key] === "string" && LEGACY_CATALOGUE_COUNT_QUALIFIER.test(hero[key])) delete hero[key];
    }
    for (const key of Object.keys(hero) as (keyof DetailHeroSettings)[]) {
      if (typeof hero[key] === "string" && !key.endsWith("Href") && !key.endsWith("Color")) {
        const cleaned = withoutCatalogueWording(hero[key] as string);
        if (cleaned) (hero as Record<string, unknown>)[key] = cleaned;
        else delete hero[key];
      }
    }
    if (Object.keys(hero).length) return { ...section, title, ...(body ? { body } : {}), hero };
    const { hero: _hero, ...withoutHero } = section;
    return { ...withoutHero, title, ...(body ? { body } : {}) };
  });
  const templateSections = normalizedValue.templateSections?.flatMap(section => {
    const title = withoutCatalogueWording(section.title);
    const body = withoutCatalogueWording(section.body);
    return title || body ? [{ key: section.key, ...(title ? { title } : {}), ...(body ? { body } : {}) }] : [];
  });
  const sanitizedValue = { ...normalizedValue, sections: normalizedSections, ...(templateSections ? { templateSections } : {}) };
  const { templateSections: _templateSections, ...pageContent } = sanitizedValue;
  if (JSON.stringify(pageContent).length > 100000 || JSON.stringify(sanitizedValue).length > 140000) return null;
  return JSON.parse(JSON.stringify(sanitizedValue)) as DetailContent;
}
