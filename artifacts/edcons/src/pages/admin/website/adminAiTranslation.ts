import { customFetch } from "@workspace/api-client-react";

export async function translateAdminTextMap(
  texts: Record<string, string>,
  targetLocale: string,
  sourceLocale = "en",
): Promise<Record<string, string>> {
  const result = await customFetch<{ translations: Record<string, string> }>("/api/website/ai/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceLocale, targetLocale, texts }),
  });
  return result.translations;
}

const NON_TRANSLATABLE_KEYS = new Set(["id", "key", "type", "locale", "slug", "url", "href", "src", "source", "icon", "image", "color", "style", "class", "layout", "position", "width", "size", "column", "columns", "limit", "opacity", "visible", "enabled", "overlay"]);

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
