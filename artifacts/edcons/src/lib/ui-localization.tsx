import { useI18nContext } from './i18n/use-i18n-context';
import { getTranslation, isValidLanguage } from './i18n/index';

export { useI18nContext as useUiLanguage } from './i18n/use-i18n-context';

/** Stable lookup for migrated legacy UI copy; never applied to API/user values. */
export function uiTextKey(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `uiText.s${(hash >>> 0).toString(16)}`;
}

export function translateUi(lang: string, english: string, turkish?: string, params?: Record<string, string | number>): string {
  if (!english.trim()) return lang === 'tr' ? turkish ?? english : english;
  const key = uiTextKey(english);
  const value = getTranslation(isValidLanguage(lang) ? lang : 'en', key, params);
  let result = value === key ? (lang === 'tr' && turkish ? turkish : english) : value;
  if (value === key && params) for (const [name, replacement] of Object.entries(params)) result = result.replaceAll(`{${name}}`, String(replacement));
  return result;
}

/** Text-only React result preserves existing layout and follows locale changes. */
export function UiText({ text }: { text: string }) {
  const { lang } = useI18nContext();
  return translateUi(lang, text);
}
