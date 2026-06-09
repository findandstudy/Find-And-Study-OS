import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
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
import { I18nContext } from "./use-i18n-context";

const STORAGE_KEY = "edcons_lang";
const HINT_KEY_PREFIX = "edcons_lang_hint_";
const EMAIL_HINT_KEY_PREFIX = "edcons_lang_hint_email_";
const LAST_USER_KEY = "edcons_lang_last_user";

/**
 * Persist a per-user language hint in localStorage so multiple users sharing
 * the same device each remember their own preferred language.
 *
 * Two keys are written:
 *   edcons_lang_hint_<userId>        — recovered after login when we have a userId
 *   edcons_lang_hint_email_<email>   — recovered on the login page before authentication,
 *                                      so the UI can pre-select the user's language as
 *                                      they type their email address
 *
 * Also records which user last logged in so resolveInitialLang() can restore
 * their preference on the next page load.
 */
export function storeLangHint(
  userId: string | number,
  lang: Language,
  email?: string,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${HINT_KEY_PREFIX}${userId}`, lang);
    localStorage.setItem(LAST_USER_KEY, String(userId));
    if (email) {
      localStorage.setItem(`${EMAIL_HINT_KEY_PREFIX}${email.trim().toLowerCase()}`, lang);
    }
  } catch {}
}

/**
 * Return the stored language hint for a given email address, or null if none
 * exists.  Used on the login page to pre-select language while the user is
 * still typing — before they have authenticated.
 */
export function getLangHintByEmail(email: string): Language | null {
  if (typeof window === "undefined" || !email) return null;
  try {
    const key = `${EMAIL_HINT_KEY_PREFIX}${email.trim().toLowerCase()}`;
    const saved = localStorage.getItem(key);
    return saved && isValidLanguage(saved) ? (saved as Language) : null;
  } catch {
    return null;
  }
}

function resolveInitialLang(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;

  const pathLang = getLanguageFromPath(window.location.pathname);
  if (pathLang) {
    localStorage.setItem(STORAGE_KEY, pathLang);
    return pathLang;
  }

  // If we know who last logged in, use their per-user hint first.
  // This prevents one user's language from bleeding into another user's session
  // when both share the same device.
  try {
    const lastUserId = localStorage.getItem(LAST_USER_KEY);
    if (lastUserId) {
      const hint = localStorage.getItem(`${HINT_KEY_PREFIX}${lastUserId}`);
      if (hint && isValidLanguage(hint)) return hint as Language;
    }
  } catch {}

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
  const dir: "ltr" | "rtl" = isRTL ? "rtl" : "ltr";

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
