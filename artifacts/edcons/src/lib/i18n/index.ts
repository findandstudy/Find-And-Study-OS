import en from "./translations/en.json";
import tr from "./translations/tr.json";
import ar from "./translations/ar.json";
import fr from "./translations/fr.json";
import ru from "./translations/ru.json";
import fa from "./translations/fa.json";
import zh from "./translations/zh.json";
import hi from "./translations/hi.json";
import es from "./translations/es.json";
import id from "./translations/id.json";

export const SUPPORTED_LANGUAGES = [
  "en", "tr", "ar", "fr", "ru", "fa", "zh", "hi", "es", "id",
] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

export const RTL_LANGUAGES: Language[] = ["ar", "fa"];

export interface LanguageMeta {
  code: Language;
  name: string;
  nativeName: string;
  dir: "ltr" | "rtl";
  flag: string;
}

export const LANGUAGE_META: Record<Language, LanguageMeta> = {
  en: { code: "en", name: "English", nativeName: "English", dir: "ltr", flag: "🇬🇧" },
  tr: { code: "tr", name: "Turkish", nativeName: "Türkçe", dir: "ltr", flag: "🇹🇷" },
  ar: { code: "ar", name: "Arabic", nativeName: "العربية", dir: "rtl", flag: "🇸🇦" },
  fr: { code: "fr", name: "French", nativeName: "Français", dir: "ltr", flag: "🇫🇷" },
  ru: { code: "ru", name: "Russian", nativeName: "Русский", dir: "ltr", flag: "🇷🇺" },
  fa: { code: "fa", name: "Persian", nativeName: "فارسی", dir: "rtl", flag: "🇮🇷" },
  zh: { code: "zh", name: "Chinese", nativeName: "中文", dir: "ltr", flag: "🇨🇳" },
  hi: { code: "hi", name: "Hindi", nativeName: "हिन्दी", dir: "ltr", flag: "🇮🇳" },
  es: { code: "es", name: "Spanish", nativeName: "Español", dir: "ltr", flag: "🇪🇸" },
  id: { code: "id", name: "Indonesian", nativeName: "Bahasa", dir: "ltr", flag: "🇮🇩" },
};

type TranslationMap = Record<string, any>;

const translationFiles: Record<Language, TranslationMap> = {
  en, tr, ar, fr, ru, fa, zh, hi, es, id,
};

function flattenObject(obj: Record<string, any>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === "object" && obj[key] !== null) {
      Object.assign(result, flattenObject(obj[key], fullKey));
    } else {
      result[fullKey] = String(obj[key]);
    }
  }
  return result;
}

const flatTranslations: Record<Language, Record<string, string>> = {} as any;
for (const lang of SUPPORTED_LANGUAGES) {
  flatTranslations[lang] = flattenObject(translationFiles[lang]);
}

export function getTranslation(lang: Language, key: string, params?: Record<string, string | number>): string {
  let value = flatTranslations[lang]?.[key] || flatTranslations[DEFAULT_LANGUAGE]?.[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(`{${k}}`, String(v));
    }
  }
  return value;
}

export function isValidLanguage(lang: string): lang is Language {
  return SUPPORTED_LANGUAGES.includes(lang as Language);
}

export function detectBrowserLanguage(): Language {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  const browserLangs = navigator.languages || [navigator.language];
  for (const bl of browserLangs) {
    const code = bl.split("-")[0].toLowerCase();
    if (isValidLanguage(code)) return code;
  }
  return DEFAULT_LANGUAGE;
}

export function getLanguageFromPath(pathname: string): Language | null {
  const match = pathname.match(/^\/([a-z]{2})(\/|$)/);
  if (match && isValidLanguage(match[1])) return match[1];
  return null;
}

export function buildLocalizedPath(path: string, lang: Language): string {
  const cleanPath = path.replace(/^\/[a-z]{2}(\/|$)/, "/");
  const normalizedPath = cleanPath === "" ? "/" : cleanPath;
  return `/${lang}${normalizedPath === "/" ? "" : normalizedPath}`;
}

export function stripLanguagePrefix(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(\/|$)/, "/") || "/";
}
