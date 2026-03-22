import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import {
  type Language,
  DEFAULT_LANGUAGE,
  LANGUAGE_META,
  getTranslation,
  isValidLanguage,
  detectBrowserLanguage,
  getLanguageFromPath,
  buildLocalizedPath,
  RTL_LANGUAGES,
} from "./index";

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  dir: "ltr" | "rtl";
  isRTL: boolean;
  localePath: (path: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "edcons_lang";

function resolveInitialLang(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;

  const pathLang = getLanguageFromPath(window.location.pathname);
  if (pathLang) {
    localStorage.setItem(STORAGE_KEY, pathLang);
    return pathLang;
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && isValidLanguage(saved)) return saved;

  return detectBrowserLanguage();
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(resolveInitialLang);

  const setLang = useCallback((newLang: Language) => {
    if (!isValidLanguage(newLang)) return;
    setLangState(newLang);
    localStorage.setItem(STORAGE_KEY, newLang);
  }, []);

  useEffect(() => {
    const isRTL = RTL_LANGUAGES.includes(lang);
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => getTranslation(lang, key, params),
    [lang]
  );

  const isRTL = RTL_LANGUAGES.includes(lang);
  const dir = isRTL ? "rtl" : "ltr";

  const localePath = useCallback(
    (path: string) => buildLocalizedPath(path, lang),
    [lang]
  );

  const value = useMemo(
    () => ({ lang, setLang, t, dir, isRTL, localePath }),
    [lang, setLang, t, dir, isRTL, localePath]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18nContext(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18nContext must be used within I18nProvider");
  return ctx;
}
