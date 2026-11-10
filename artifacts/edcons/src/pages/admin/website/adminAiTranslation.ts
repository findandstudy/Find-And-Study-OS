import { customFetch } from "@workspace/api-client-react";

export async function translateAdminTextMap(
  texts: Record<string, string>,
  targetLocale: string,
  sourceLocale = "en",
  mode: "content" | "display_terms" = "content",
): Promise<Record<string, string>> {
  const result = await customFetch<{ translations: Record<string, string> }>("/api/website/ai/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceLocale, targetLocale, texts, mode }),
  });
  return result.translations;
}

// This set contains normalized (lower-case, punctuation-free) field names.
// Structural identifiers and presentation enums must never be sent to AI.
const NON_TRANSLATABLE_KEYS = new Set([
  "id", "key", "type", "kind", "version", "entityid", "locale", "seomode",
  "sectionorder", "reviewedon", "slug", "url", "href", "src", "source",
  "icon", "image", "color", "style", "class", "layout", "position", "width",
  "size", "limit", "opacity", "visible", "enabled",
  "overlay", "tone", "spacing", "align", "minheight", "backgroundimagefit",
  "backgroundimageposition", "backgroundimagerepeat", "overlayopacity",
]);

function shouldTranslate(key: string, value: string): boolean {
  const normalizedKey = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (!value.trim() || NON_TRANSLATABLE_KEYS.has(normalizedKey) || ["url", "href", "src", "slug", "color", "image", "icon"].some(suffix => normalizedKey.endsWith(suffix))) return false;
  if (/^(?:https?:\/\/|mailto:|tel:|\/|#(?:[0-9a-f]{3,8})$)/i.test(value.trim())) return false;
  if (/^\d+(?:\.\d+)?(?:px|%|rem|em)?$/i.test(value.trim())) return false;
  return true;
}

export function collectTranslatableText(value: unknown): Record<string, string> {
  const texts: Record<string, string> = {};
  const visit = (current: unknown, path: string, key: string) => {
    if (typeof current === "string") {
      if (shouldTranslate(key, current)) texts[path] = current;
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, key));
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [childKey, child] of Object.entries(current as Record<string, unknown>)) {
      visit(child, path ? `${path}.${childKey}` : childKey, childKey);
    }
  };
  visit(value, "root", "root");
  return texts;
}

export function applyTranslatedText<T>(value: T, translations: Record<string, string>): T {
  const visit = (current: unknown, path: string, key: string): unknown => {
    if (typeof current === "string") return shouldTranslate(key, current) && translations[path] !== undefined ? translations[path] : current;
    if (Array.isArray(current)) return current.map((item, index) => visit(item, `${path}[${index}]`, key));
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(Object.entries(current as Record<string, unknown>).map(([childKey, child]) => [childKey, visit(child, path ? `${path}.${childKey}` : childKey, childKey)]));
  };
  return visit(value, "root", "root") as T;
}

export async function translateStructuredDraft<T>(value: T, targetLocale: string, sourceLocale = "en"): Promise<T> {
  const texts = collectTranslatableText(value);
  if (!Object.keys(texts).length) throw new Error("No translatable text was found");
  const translations: Record<string, string> = {};
  let chunk: Record<string, string> = {};
  let chunkSize = 0;
  const flush = async () => {
    if (!Object.keys(chunk).length) return;
    Object.assign(translations, await translateAdminTextMap(chunk, targetLocale, sourceLocale));
    chunk = {};
    chunkSize = 0;
  };
  for (const [key, text] of Object.entries(texts)) {
    if (Object.keys(chunk).length >= 80 || chunkSize + text.length > 20_000) await flush();
    chunk[key] = text;
    chunkSize += text.length;
  }
  await flush();
  return applyTranslatedText(value, translations);
}

const DISPLAY_TERM_FIELDS = new Set([
  "name", "programname", "universityname", "country", "city", "sourcename",
]);

/** Collects catalogue-owned entity/source names without sending descriptions or private fields. */
export function collectAdminDisplayTerms(value: unknown): string[] {
  const priorityTerms = new Set<string>();
  const programTerms = new Set<string>();
  const visit = (current: unknown, key = "", path = "", depth = 0) => {
    if (depth > 7) return;
    if (typeof current === "string") {
      const normalized = current.trim();
      if (DISPLAY_TERM_FIELDS.has(key.toLowerCase()) && normalized.length >= 2 && normalized.length <= 240 && !/^https?:\/\//iu.test(normalized)) {
        // A country page can expose hundreds of programmes. Preserve the
        // scarcer country, city, institution and source names before using
        // the bounded map capacity for programme titles.
        const bucket = /(?:^|\.)programs(?:\.|\[)/iu.test(path) || key.toLowerCase() === "programname"
          ? programTerms
          : priorityTerms;
        bucket.add(normalized);
      }
      return;
    }
    if (Array.isArray(current)) return current.slice(0, 96).forEach((item, index) => visit(item, key, `${path}[${index}]`, depth + 1));
    if (!current || typeof current !== "object") return;
    for (const [childKey, child] of Object.entries(current as Record<string, unknown>)) visit(child, childKey, path ? `${path}.${childKey}` : childKey, depth + 1);
  };
  visit(value);
  return [...priorityTerms, ...programTerms].slice(0, 96);
}

/** Produces a reviewed locale-owned map used by live catalogue cards and labels. */
export async function translateAdminDisplayTerms(
  value: unknown,
  targetLocale: string,
  sourceLocale = "en",
): Promise<Record<string, string>> {
  const terms = collectAdminDisplayTerms(value);
  if (!terms.length) return {};
  const keyed = Object.fromEntries(terms.map((term, index) => [`term_${index}`, term]));
  const translated = await translateAdminTextMap(keyed, targetLocale, sourceLocale, "display_terms");
  return Object.fromEntries(terms.flatMap((source, index) => {
    const target = translated[`term_${index}`]?.trim();
    return target && target.length <= 240 && !/[<>\u0000-\u001f\u007f]/u.test(target) ? [[source, target]] : [];
  }));
}
