/**
 * @workspace/i18n — locale formatting helpers.
 *
 * Replaces 26+ scattered `toLocaleDateString("tr-TR", …)` calls. Always
 * routes through Intl.DateTimeFormat with a memoized formatter cache so
 * we don't construct a new formatter for every cell in a table.
 *
 * The `lang` argument should be the active i18n language code (e.g.
 * "tr", "en", "ar"). Unknown languages fall back to the BCP-47 tag as-is.
 */

const BCP47: Record<string, string> = {
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

function toLocale(lang?: string | null): string {
  if (!lang) return "en-US";
  return BCP47[lang] ?? lang;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + "::" + JSON.stringify(opts);
  let fmt = fmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, opts);
    fmtCache.set(key, fmt);
  }
  return fmt;
}

export type DatePresetName =
  | "date"        // 2026-05-13 → "May 13, 2026" / "13 Mayıs 2026"
  | "dateShort"   // → "5/13/26"  / "13.05.2026"
  | "dateLong"    // → "May 13, 2026" with weekday
  | "dateTime"    // → date + time
  | "time";       // → "14:32"

const PRESETS: Record<DatePresetName, Intl.DateTimeFormatOptions> = {
  date:      { year: "numeric", month: "short", day: "numeric" },
  dateShort: { year: "2-digit", month: "numeric", day: "numeric" },
  dateLong:  { year: "numeric", month: "long",  day: "numeric", weekday: "long" },
  dateTime:  { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
  time:      { hour: "2-digit", minute: "2-digit" },
};

export type FormatDateOptions = DatePresetName | Intl.DateTimeFormatOptions;

/**
 * Format a Date / ISO string / epoch ms in the active language.
 * Returns "" for null/undefined/invalid input so callers don't have to
 * sprinkle ternaries.
 */
export function formatDate(
  value: Date | string | number | null | undefined,
  lang?: string | null,
  opts: FormatDateOptions = "date",
): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  const options = typeof opts === "string" ? PRESETS[opts] : opts;
  return getFormatter(toLocale(lang), options).format(d);
}

/** Convenience: relative formatting (e.g. "2 days ago"). */
const rtfCache = new Map<string, Intl.RelativeTimeFormat>();

export function formatRelativeTime(
  value: Date | string | number | null | undefined,
  lang?: string | null,
  now: Date = new Date(),
): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  const locale = toLocale(lang);
  let rtf = rtfCache.get(locale);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    rtfCache.set(locale, rtf);
  }
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), "month");
  return rtf.format(Math.round(diffSec / 31536000), "year");
}
