/** Shared structure, presentation and locale copy. Never contains catalogue facts, HTML or SEO overrides. */
export const DETAIL_LAYOUT_KINDS = ["program", "university", "destination", "city"] as const;
export type DetailLayoutKind = typeof DETAIL_LAYOUT_KINDS[number];
export type DetailSectionPresentation = {
  tone?: "default" | "sky" | "sand" | "dark";
  width?: "contained" | "wide" | "full";
  spacing?: "comfortable" | "compact" | "spacious";
  align?: "start" | "center";
  minHeight?: "auto" | "compact" | "medium" | "tall";
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  backgroundImageUrl?: string;
  backgroundImageFit?: "cover" | "contain" | "auto";
  backgroundImagePosition?: "center" | "top" | "bottom" | "left" | "right";
  backgroundImageRepeat?: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
  overlayColor?: string;
  overlayOpacity?: number;
};
export type DetailSectionCopy = { title?: string; body?: string };
export type DetailSectionGeneration = { enabled: boolean; instruction: string };
export type DetailTemplateVariable = { key: string; label: string; group: string };
const variable = (key: string, label: string, group: string): DetailTemplateVariable => ({ key, label, group });
export const DETAIL_TEMPLATE_VARIABLES: Record<DetailLayoutKind, readonly DetailTemplateVariable[]> = {
  destination: [
    variable("destination.name", "Destination name", "Destination"), variable("destination.country", "Country name", "Destination"),
    variable("destination.shortDescription", "Short description", "Destination"), variable("destination.description", "Description", "Destination"),
    variable("destination.language", "Languages", "Study facts"), variable("destination.currency", "Currency", "Study facts"),
    variable("destination.climate", "Climate", "Living"), variable("destination.livingCost", "Living cost", "Living"),
    variable("destination.visaInfo", "Visa information", "Study facts"), variable("destination.workPermit", "Work permit", "Study facts"),
    variable("stats.universityCount", "University count", "Live counts"), variable("stats.programCount", "Program count", "Live counts"),
    variable("stats.cityCount", "City count", "Live counts"),
  ],
  city: [
    variable("city.name", "City name", "City"), variable("city.country", "Country name", "City"), variable("city.description", "Description", "City"),
    variable("city.universityCount", "University count", "Live counts"), variable("city.programCount", "Program count", "Live counts"),
    variable("city.programLanguages", "Teaching languages", "Study facts"), variable("city.transportModes", "Transport modes", "Living"),
    variable("city.campusGeography", "Campus geography", "Study facts"), variable("city.climateSummary", "Climate summary", "External facts"),
    variable("city.climateAverage", "Annual climate average", "External facts"), variable("city.housingSummary", "Housing summary", "External facts"),
    variable("city.housingFormats", "Housing formats", "External facts"),
    variable("weather.temperature", "Current temperature", "Stored weather"), variable("weather.feelsLike", "Feels-like temperature", "Stored weather"),
    variable("weather.description", "Weather condition", "Stored weather"), variable("weather.humidity", "Humidity", "Stored weather"),
    variable("weather.windSpeed", "Wind speed", "Stored weather"),
  ],
  university: [
    variable("university.name", "University name", "University"), variable("university.country", "Country", "University"),
    variable("university.city", "City", "University"), variable("university.description", "Description", "University"),
    variable("university.type", "University type", "University"), variable("university.address", "Address", "University"),
    variable("university.website", "Website", "University"), variable("university.ranking", "General ranking", "Rankings"),
    variable("university.qsRanking", "QS ranking", "Rankings"), variable("university.timesRanking", "Times ranking", "Rankings"),
    variable("university.shanghaiRanking", "Shanghai ranking", "Rankings"), variable("university.leidenRanking", "CWTS Leiden ranking", "Rankings"),
    variable("stats.programCount", "Program count", "Live counts"),
    variable("weather.temperature", "Campus city temperature", "Stored city weather"), variable("weather.feelsLike", "Campus city feels-like temperature", "Stored city weather"),
    variable("weather.description", "Campus city weather condition", "Stored city weather"), variable("weather.humidity", "Campus city humidity", "Stored city weather"),
    variable("weather.windSpeed", "Campus city wind speed", "Stored city weather"),
  ],
  program: [
    variable("program.name", "Program name", "Program"), variable("program.description", "Description", "Program"),
    variable("program.degree", "Degree", "Program"), variable("program.field", "Field", "Program"), variable("program.language", "Teaching language", "Program"),
    variable("program.duration", "Duration", "Program"), variable("program.tuitionFee", "Tuition fee", "Fees"),
    variable("program.discountedFee", "Discounted fee", "Fees"), variable("program.scholarship", "Scholarship", "Fees"),
    variable("program.currency", "Currency", "Fees"), variable("program.depositFee", "Deposit fee", "Fees"),
    variable("program.languageFee", "Language fee", "Fees"), variable("program.feeType", "Fee type", "Fees"),
    variable("program.intakes", "Intakes", "Admissions"), variable("program.requirements", "Requirements", "Admissions"), variable("program.quota", "Quota", "Admissions"),
    variable("university.name", "University name", "University"), variable("university.country", "University country", "University"),
    variable("university.city", "University city", "University"), variable("university.type", "University type", "University"),
    variable("university.website", "University website", "University"), variable("university.address", "University address", "University"),
    variable("stats.intakeCount", "Intake count", "Live counts"), variable("stats.relatedProgramCount", "Related program count", "Live counts"),
  ],
};
export type DetailLayout = { version: 5; kind: DetailLayoutKind; sections: string[]; hidden: string[]; presentation: Record<string, DetailSectionPresentation>; copy: Record<string, Record<string, DetailSectionCopy>>; generation: Record<string, DetailSectionGeneration> };
const LEGACY_SECTIONS: Record<DetailLayoutKind, readonly string[]> = {
  program: ["hero", "navigation", "overview", "related"],
  university: ["hero", "navigation", "overview", "programs"],
  destination: ["hero", "overview", "universities", "cta"],
  city: ["hero", "overview", "universities", "programs"],
};
const V2_SECTIONS: Record<DetailLayoutKind, readonly string[]> = {
  program: ["hero", "navigation", "overview", "requirements", "intakes", "fees", "related"],
  university: ["hero", "navigation", "overview", "facts", "programs"],
  destination: ["hero", "navigation", "overview", "facts", "cities", "universities", "cta"],
  city: ["hero", "navigation", "overview", "facts", "universities", "programs"],
};
const editorial = (...keys: string[]) => keys.map(key => `editorial-${key}`);
export const DETAIL_LAYOUT_SECTIONS: Record<DetailLayoutKind, readonly string[]> = {
  // Order mirrors programv2-revised.html: experience, learning, admission,
  // destination/living, housing, services, apply, alternatives and FAQ.
  program: ["hero", "navigation", "overview", ...editorial("gallery", "highlights", "curriculum"), "requirements", ...editorial("admission"), "fees", "intakes", ...editorial("scholarships", "living", "campus", "climate", "housing", "services", "applyGuide", "studentStory", "recognition"), "related", ...editorial("faq"), "mobileActions"],
  // Order mirrors university-revised.html: overview, programmes, admission,
  // fees/intakes content, support/campus, recognition, reviews and FAQ.
  university: ["hero", "navigation", "overview", ...editorial("gallery", "highlights", "cautions"), "programs", ...editorial("admission", "scholarships", "intakeGuide"), "facts", "weather", ...editorial("education", "support", "services", "campus", "housing", "recognition", "living", "reviews", "faq", "applyGuide"), "mobileActions"],
  destination: ["hero", "navigation", "overview", ...editorial("gallery", "highlights", "cautions", "education"), "facts", ...editorial("admission", "requirements", "scholarships", "living", "climate", "housing", "visa", "services", "recognition"), "cities", "universities", "programs", ...editorial("faq", "applyGuide"), "cta"],
  city: ["hero", "navigation", "overview", ...editorial("gallery", "highlights", "cautions", "education"), "facts", "weather", ...editorial("living", "climate", "transport", "campus", "housing", "requirements", "visa", "services"), "universities", "programs", ...editorial("faq", "applyGuide")],
};
const LIVE_GENERATION_SECTIONS = new Set(["navigation", "facts", "weather", "fees", "intakes", "related", "programs", "universities", "cities", "mobileActions"]);
export function defaultDetailSectionGeneration(kind: DetailLayoutKind, section: string): DetailSectionGeneration {
  const name = section.replace(/^editorial-/, "").replace(/([A-Z])/g, " $1").toLowerCase();
  const enabled = !LIVE_GENERATION_SECTIONS.has(section);
  return {
    enabled,
    instruction: enabled
      ? `Write a concise, practical ${name} section for prospective international students. Use only verified page facts and the shared template direction. Do not invent rankings, prices, deadlines, requirements, visa outcomes or guarantees.`
      : `Keep ${name} connected to authoritative live catalogue or external-source data; do not replace it with generated facts.`,
  };
}
export function defaultDetailGeneration(kind: DetailLayoutKind) {
  return Object.fromEntries(DETAIL_LAYOUT_SECTIONS[kind].map(section => [section, defaultDetailSectionGeneration(kind, section)]));
}
export function defaultDetailLayout(kind: DetailLayoutKind): DetailLayout {
  return { version: 5, kind, sections: [...DETAIL_LAYOUT_SECTIONS[kind]], hidden: [], presentation: {}, copy: {}, generation: defaultDetailGeneration(kind) };
}
const DETAIL_LAYOUT_LOCALES = ["en","tr","ar","fr","ru","fa","zh","hi","es","id","ur","tk","ky","kk","uz","tg","bn","pt","ne","vi","ko","uk","it"] as const;
const CATALOGUE_WORD = /catalog(?:ue)?|katalog|каталог|目录|कैटलॉग|کیٹلاگ|فهرست|فهرست|феҳрист|ক্যাটালগ|catálogo|क्याटलग|danh mục|카탈로그/giu;
/** Old templates exposed the internal data-source name in public copy. */
export function withoutCatalogueWording(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(CATALOGUE_WORD, "").replace(/\s+([,.;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  return cleaned || undefined;
}
const safeCopyText = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const TEMPLATE_TOKEN = /\{\{\s*([a-z][a-zA-Z0-9.]*)\s*(?:\|\s*([^{}]{1,160}?))?\s*\}\}/g;
export function validDetailTemplateText(value: unknown, kind: DetailLayoutKind, max: number): value is string {
  if (!safeCopyText(value, max)) return false;
  const allowed = new Set(DETAIL_TEMPLATE_VARIABLES[kind].map(item => item.key));
  const source = String(value);
  let remainder = source;
  for (const match of source.matchAll(TEMPLATE_TOKEN)) {
    if (!allowed.has(match[1]) || (match[2] !== undefined && !safeCopyText(match[2], 160))) return false;
    remainder = remainder.replace(match[0], "");
  }
  return !remainder.includes("{{") && !remainder.includes("}}");
}
export function resolveDetailTemplateText(value: string | undefined, kind: DetailLayoutKind, values: Readonly<Record<string, string | null | undefined>>): string | undefined {
  if (!value) return undefined;
  if (!validDetailTemplateText(value, kind, 6000)) return undefined;
  const resolved = value.replace(TEMPLATE_TOKEN, (_token, key: string, fallback?: string) => values[key]?.trim() || fallback?.trim() || "");
  const normalized = resolved.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  return normalized || undefined;
}
const PRESENTATION_KEYS = ["tone", "width", "spacing", "align", "minHeight", "backgroundColor", "textColor", "accentColor", "backgroundImageUrl", "backgroundImageFit", "backgroundImagePosition", "backgroundImageRepeat", "overlayColor", "overlayOpacity"] as const;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export function safeDetailBackgroundImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
  if (/^\/(?!\/)/.test(value)) return !value.includes("..");
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}
export function parseDetailSectionPresentation(value: unknown): DetailSectionPresentation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const setting = value as Record<string, unknown>;
  if (!Object.keys(setting).every(name => (PRESENTATION_KEYS as readonly string[]).includes(name))
    || (setting.tone !== undefined && !["default", "sky", "sand", "dark"].includes(String(setting.tone)))
    || (setting.width !== undefined && !["contained", "wide", "full"].includes(String(setting.width)))
    || (setting.spacing !== undefined && !["comfortable", "compact", "spacious"].includes(String(setting.spacing)))
    || (setting.align !== undefined && !["start", "center"].includes(String(setting.align)))
    || (setting.minHeight !== undefined && !["auto", "compact", "medium", "tall"].includes(String(setting.minHeight)))
    || (setting.backgroundImageFit !== undefined && !["cover", "contain", "auto"].includes(String(setting.backgroundImageFit)))
    || (setting.backgroundImagePosition !== undefined && !["center", "top", "bottom", "left", "right"].includes(String(setting.backgroundImagePosition)))
    || (setting.backgroundImageRepeat !== undefined && !["no-repeat", "repeat", "repeat-x", "repeat-y"].includes(String(setting.backgroundImageRepeat)))
    || ["backgroundColor", "textColor", "accentColor", "overlayColor"].some(key => setting[key] !== undefined && (typeof setting[key] !== "string" || !HEX_COLOR.test(setting[key])))
    || (setting.backgroundImageUrl !== undefined && !safeDetailBackgroundImageUrl(setting.backgroundImageUrl))
    || (setting.overlayOpacity !== undefined && (typeof setting.overlayOpacity !== "number" || !Number.isInteger(setting.overlayOpacity) || setting.overlayOpacity < 0 || setting.overlayOpacity > 100))) return null;
  return { ...setting } as DetailSectionPresentation;
}
export function parseDetailLayout(value: unknown): DetailLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).sort().join();
  const expectedKeys = v.version === 5 ? ["copy,generation,hidden,kind,presentation,sections,version", "copy,hidden,kind,presentation,sections,version"] : v.version === 4 ? ["hidden,kind,presentation,sections,version"] : ["hidden,kind,sections,version"];
  if (!expectedKeys.includes(keys) || ![1, 2, 3, 4, 5].includes(v.version as number)
      || !DETAIL_LAYOUT_KINDS.includes(v.kind as DetailLayoutKind)) return null;
  const kind = v.kind as DetailLayoutKind;
  const allowed = v.version === 1 ? LEGACY_SECTIONS[kind] : v.version === 2 ? V2_SECTIONS[kind] : DETAIL_LAYOUT_SECTIONS[kind];
  const savedSections = Array.isArray(v.sections) ? v.sections : [];
  const additiveUpgrade = Number(v.version) >= 3
    && allowed.filter(section => !savedSections.includes(section)).every(section => ["weather", "programs"].includes(section));
  if (!Array.isArray(v.sections) || !Array.isArray(v.hidden) || v.sections.length === 0
      || (v.sections.length !== allowed.length && !additiveUpgrade)
      || new Set(v.sections).size !== v.sections.length
      || !v.sections.every(x => typeof x === "string" && allowed.includes(x))
      || new Set(v.hidden).size !== v.hidden.length
      || !v.hidden.every(x => typeof x === "string" && allowed.includes(x) && !["hero", "navigation", "overview"].includes(x))
      || v.sections[0] !== "hero" || (allowed.includes("navigation") && v.sections[1] !== "navigation")
      || v.sections[allowed.includes("navigation") ? 2 : 1] !== "overview") return null;
  let sections = [...v.sections] as string[];
  if (v.version === 1) {
    // Expand formerly nested overview content without losing the saved tail order.
    const tail = (v.sections as string[]).filter(x => !["hero", "navigation", "overview"].includes(x));
    const expanded = V2_SECTIONS[kind].filter(x => !tail.includes(x));
    sections = [...expanded, ...tail];
  }
  // Insert additive sections near their default neighbour, preserving the order
  // and hidden state of every previously saved section. No database migration.
  for (const [index, section] of DETAIL_LAYOUT_SECTIONS[kind].entries()) {
    if (sections.includes(section)) continue;
    const next = DETAIL_LAYOUT_SECTIONS[kind].slice(index + 1).find(key => sections.includes(key));
    if (next) sections.splice(sections.indexOf(next), 0, section);
    else sections.push(section);
  }
  const presentation: Record<string, DetailSectionPresentation> = {};
  if (v.version === 4 || v.version === 5) {
    if (!v.presentation || typeof v.presentation !== "object" || Array.isArray(v.presentation)) return null;
    for (const [key, raw] of Object.entries(v.presentation as Record<string, unknown>)) {
      const setting = parseDetailSectionPresentation(raw);
      if (!allowed.includes(key) || !setting) return null;
      if (Object.keys(setting).length) presentation[key] = setting;
    }
  }
  const copy: Record<string, Record<string, DetailSectionCopy>> = {};
  if (v.version === 5) {
    if (!v.copy || typeof v.copy !== "object" || Array.isArray(v.copy)) return null;
    for (const [locale, rawSections] of Object.entries(v.copy as Record<string, unknown>)) {
      if (!(DETAIL_LAYOUT_LOCALES as readonly string[]).includes(locale) || !rawSections || typeof rawSections !== "object" || Array.isArray(rawSections)) return null;
      const localized: Record<string, DetailSectionCopy> = {};
      for (const [section, rawCopy] of Object.entries(rawSections as Record<string, unknown>)) {
        if (!allowed.includes(section) || !rawCopy || typeof rawCopy !== "object" || Array.isArray(rawCopy)) return null;
        const setting = rawCopy as Record<string, unknown>;
        if (!Object.keys(setting).every(key => ["title", "body"].includes(key))
          || (setting.title !== undefined && (!validDetailTemplateText(setting.title, kind, 160) || section === "hero"))
          || (setting.body !== undefined && !validDetailTemplateText(setting.body, kind, 6000))
          || (setting.title === undefined && setting.body === undefined)) return null;
        const title = withoutCatalogueWording(setting.title === undefined ? undefined : String(setting.title));
        const body = withoutCatalogueWording(setting.body === undefined ? undefined : String(setting.body));
        if (title || body) localized[section] = { ...(title ? { title } : {}), ...(body ? { body } : {}) };
      }
      if (JSON.stringify(localized).length > 30000) return null;
      if (Object.keys(localized).length) copy[locale] = localized;
    }
  }
  const generation = defaultDetailGeneration(kind);
  if (v.version === 5 && v.generation !== undefined) {
    if (!v.generation || typeof v.generation !== "object" || Array.isArray(v.generation)) return null;
    for (const [section, raw] of Object.entries(v.generation as Record<string, unknown>)) {
      if (!allowed.includes(section) || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const setting = raw as Record<string, unknown>;
      if (Object.keys(setting).sort().join() !== "enabled,instruction" || typeof setting.enabled !== "boolean"
          || typeof setting.instruction !== "string" || setting.instruction.trim().length < 10 || setting.instruction.length > 2000
          || /[<>\u0000-\u001f\u007f]/.test(setting.instruction)) return null;
      generation[section] = { enabled: setting.enabled, instruction: setting.instruction.trim() };
    }
  }
  const parsed = { version: 5 as const, kind, sections, hidden: [...v.hidden] as string[], presentation, copy, generation };
  return JSON.stringify(parsed).length <= 180000 ? parsed : null;
}

/** Converts layout keys to the content keys consumed by public detail pages. */
export function detailTemplateSectionsForLocale(layout: DetailLayout, locale: string) {
  const localized = layout.copy[locale] ?? {};
  return layout.sections.flatMap(layoutKey => {
    // Section order and presentation are language-neutral. Visible copy stays
    // locale-owned so an incomplete translation never leaks English text.
    const value = localized[layoutKey];
    if (!value) return [];
    return [{ key: layoutKey.startsWith("editorial-") ? layoutKey.slice(10) : layoutKey, ...value }];
  });
}
