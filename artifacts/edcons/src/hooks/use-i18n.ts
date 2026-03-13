import { useState, useEffect, useCallback } from 'react';
import { translations, Language } from '../lib/i18n';

export function useI18n() {
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem('edcons_lang');
    return (saved as Language) || 'en';
  });

  useEffect(() => {
    localStorage.setItem('edcons_lang', lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback((key: string): string => {
    return translations[lang]?.[key] || translations['en']?.[key] || key;
  }, [lang]);

  return { lang, setLang, t };
}
