import { isReservedPublicPageSlug, parsePublicCatalogPageBlockSource } from "./publicCatalogRenderContract";
import { PROGRAM_SUPPORTED_LOCALES, type ProgramSupportedLocale } from "./programTranslationContract";

/** Authoring input only: never accepts catalogue facts, publication state or actor IDs. */
export function parseWebsitePageDraft(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid page draft");
  const body = input as Record<string, unknown>;
  const allowed = new Set(["title", "slug", "locale", "starter", "country", "city"]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new Error("Unsupported page field");
  const title = text(body.title, 200);
  const slug = text(body.slug, 150);
  if (!title) throw new Error("Page title is required");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || isReservedPublicPageSlug(slug)
    || PROGRAM_SUPPORTED_LOCALES.includes(slug as ProgramSupportedLocale)) {
    throw new Error("Use a unique lowercase page address; system routes are reserved");
  }
  const locale = authoringLocale(body.locale ?? "en");
  const starter = body.starter ?? "blank";
  const source = starter === "blank" ? null : parsePublicCatalogPageBlockSource(starter);
  if (starter !== "blank" && !source) throw new Error("Invalid page starter");
  const country = text(body.country ?? "", 120);
  const city = text(body.city ?? "", 120);
  return {
    page: { title, slug, locale, template: "default", status: "draft", robotsIndex: false, robotsFollow: true },
    blocks: source ? [{
      blockType: "hero", content: { title }, settings: {}, sortOrder: 0, isVisible: true,
    }, {
      blockType: "catalog_grid", content: { title, source, limit: 6, country, city },
      settings: {}, sortOrder: 1, isVisible: true,
    }] : [],
  };
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error("Invalid text field");
  return value.trim();
}

function authoringLocale(value: unknown): ProgramSupportedLocale {
  if (typeof value !== "string" || !PROGRAM_SUPPORTED_LOCALES.includes(value as ProgramSupportedLocale)) throw new Error("Unsupported locale");
  return value as ProgramSupportedLocale;
}

export function parseWebsiteCatalogPreview(input: Record<string, unknown>) {
  const source = parsePublicCatalogPageBlockSource(input.source);
  if (!source || typeof input.source !== "string") throw new Error("Invalid catalogue source");
  const rawLimit = input.limit ?? "6";
  if (typeof rawLimit !== "string" || !/^\d{1,2}$/.test(rawLimit)) throw new Error("Invalid preview limit");
  const limit = Number(rawLimit);
  if (limit < 1 || limit > 12) throw new Error("Preview limit must be between 1 and 12");
  return {
    config: { source, limit, country: text(input.country ?? "", 120), city: text(input.city ?? "", 120) },
    locale: authoringLocale(input.locale ?? "en"),
  };
}
