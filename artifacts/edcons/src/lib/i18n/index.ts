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

const _warnedMissing = new Set<string>();
export function getTranslation(lang: Language, key: string, params?: Record<string, string | number>): string {
  const direct = flatTranslations[lang]?.[key];
  const fallback = flatTranslations[DEFAULT_LANGUAGE]?.[key];
  if (import.meta.env?.DEV && !direct && !fallback && !_warnedMissing.has(key)) {
    _warnedMissing.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[i18n] Missing translation key: "${key}" (lang=${lang})`);
  }
  let value = direct || fallback || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(`{${k}}`, String(v));
    }
  }
  return value;
}

/**
 * Format a relative "time ago" string using i18n keys.
 * Looks up: common.justNow, common.minutesAgo, common.hoursAgo, common.daysAgo (each may use {n}).
 */
export function formatTimeAgo(lang: Language, dateStr: string | Date): string {
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return getTranslation(lang, "common.justNow");
  if (mins < 60) return getTranslation(lang, "common.minutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return getTranslation(lang, "common.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  return getTranslation(lang, "common.daysAgo", { n: days });
}

/**
 * Map our short language code to the BCP47 locale string used by
 * Intl.DateTimeFormat / Number.toLocaleString. Falls back to "en-US".
 */
const LOCALE_MAP: Record<Language, string> = {
  en: "en-US",
  tr: "tr-TR",
  ar: "ar-SA",
  fr: "fr-FR",
  ru: "ru-RU",
  fa: "fa-IR",
  zh: "zh-CN",
  hi: "hi-IN",
  es: "es-ES",
  id: "id-ID",
};

export function getLocale(lang: Language): string {
  return LOCALE_MAP[lang] || "en-US";
}

/** Format a date with the given language's locale. */
export function formatDate(
  lang: Language,
  date: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (date == null) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString(getLocale(lang), options);
  } catch {
    return d.toLocaleDateString("en-US", options);
  }
}

/** Format a time with the given language's locale. */
export function formatTime(
  lang: Language,
  date: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (date == null) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  try {
    return d.toLocaleTimeString(getLocale(lang), options);
  } catch {
    return d.toLocaleTimeString("en-US", options);
  }
}

/** Format a date+time with the given language's locale. */
export function formatDateTime(
  lang: Language,
  date: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (date == null) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString(getLocale(lang), options);
  } catch {
    return d.toLocaleString("en-US", options);
  }
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
