import { useI18nContext } from './i18n/use-i18n-context';
import { getTranslation, type Language } from './i18n';

export { useI18nContext as useUiLanguage } from './i18n/use-i18n-context';

/** Stable lookup for migrated legacy UI copy; never applied to API/user values. */
export function uiTextKey(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `uiText.s${(hash >>> 0).toString(16)}`;
}

export function translateUi(lang: Language, english: string, turkish?: string): string {
  const key = uiTextKey(english);
  const value = getTranslation(lang, key);
  return value === key ? (lang === 'tr' && turkish ? turkish : english) : value;
}

/** Text-only React result preserves existing layout and follows locale changes. */
export function UiText({ text }: { text: string }) {
  const { lang } = useI18nContext();
  return translateUi(lang, text);
}
