import type { AiContentService } from "./aiService";
import type { DetailContent } from "./websiteDetailContentContract";

const nonTranslatableKeys = new Set([
  "key", "locale", "seoMode", "url", "href", "src", "reviewedOn",
  "backgroundColor", "overlayColor", "textColor", "accentColor",
]);

function collectText(value: unknown) {
  const result: Record<string, string> = {};
  const visit = (current: unknown, path: string, key: string) => {
    if (typeof current === "string") {
      if (!nonTranslatableKeys.has(key) && current.trim() && !/^(?:https?:\/\/|mailto:|tel:|\/|#[0-9a-f]{3,8}$)/i.test(current.trim())) result[path] = current;
      return;
    }
    if (Array.isArray(current)) return current.forEach((item, index) => visit(item, `${path}[${index}]`, key));
    if (!current || typeof current !== "object") return;
    for (const [childKey, child] of Object.entries(current as Record<string, unknown>)) visit(child, path ? `${path}.${childKey}` : childKey, childKey);
  };
  visit(value, "root", "root");
  return result;
}

function applyText<T>(value: T, translations: Record<string, string>): T {
  const visit = (current: unknown, path: string, key: string): unknown => {
    if (typeof current === "string") return !nonTranslatableKeys.has(key) && translations[path] !== undefined ? translations[path] : current;
    if (Array.isArray(current)) return current.map((item, index) => visit(item, `${path}[${index}]`, key));
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(Object.entries(current as Record<string, unknown>).map(([childKey, child]) => [childKey, visit(child, path ? `${path}.${childKey}` : childKey, childKey)]));
  };
  return visit(value, "root", "root") as T;
}

/** Translates page copy and its SEO atomically while preserving URLs and structural fields. */
export async function translateStructuredDetailContent(content: DetailContent, locale: string, ai: AiContentService) {
  const source = { ...content, locale };
  const all = collectText(source);
  const translations: Record<string, string> = {};
  let chunk: Record<string, string> = {};
  let chars = 0;
  const flush = async () => {
    if (!Object.keys(chunk).length) return;
    Object.assign(translations, await ai.translateTextMap({ sourceLocale: "en", targetLocale: locale, texts: chunk }));
    chunk = {};
    chars = 0;
  };
  for (const [key, value] of Object.entries(all)) {
    if (Object.keys(chunk).length >= 80 || chars + value.length > 20_000) await flush();
    chunk[key] = value;
    chars += value.length;
  }
  await flush();
  return applyText(source, translations);
}

