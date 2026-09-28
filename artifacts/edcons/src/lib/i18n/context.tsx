import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  type Language,
  DEFAULT_LANGUAGE,
  LANGUAGE_META,
  getTranslation,
  isLanguageLoaded,
  isPartialLanguageLoaded,
  installPartialTranslations,
  loadLanguage,
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
const PUBLIC_CRITICAL_SECTIONS = new Set([
  "", "about", "countries", "destinations", "cities", "programs",
  "universities", "guides", "blog", "contact", "agency",
]);

export function isCriticalPublicPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return parts.length >= 1 && isValidLanguage(parts[0]) && PUBLIC_CRITICAL_SECTIONS.has(parts[1] ?? "");
}

async function loadCriticalPublicLanguage(lang: Language): Promise<boolean> {
  if (isPartialLanguageLoaded(lang) || isLanguageLoaded(lang)) return true;
  try {
    const response = await fetch(`/i18n-critical/${lang}.json`, { credentials: "same-origin", cache: "force-cache" });
    if (!response.ok) return false;
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 128 * 1024) return false;
    return installPartialTranslations(lang, await response.json());
  } catch {
    return false;
  }
}

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
  const criticalPublic = typeof window !== "undefined" && isCriticalPublicPath(window.location.pathname);
  // Translations are lazy-loaded per language (bundle-size optimization).
  // `ready` gates the FIRST render only: children mount after the active
  // language's dictionary is in the cache, so t() never shows raw keys.
  const [ready, setReady] = useState<boolean>(() => isLanguageLoaded(lang) || (criticalPublic && isPartialLanguageLoaded(lang)));
  const [dictionaryRevision, setDictionaryRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Every supported locale is build-checked for exact key and placeholder
    // parity. Loading English as well as the active locale doubled the first
    // navigation payload for 22 locales without providing a real fallback.
    // English remains available on demand if a future controlled caller loads
    // it, while the active dictionary alone gates the initial render.
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    const loadFull = () => {
      timeoutId = globalThis.setTimeout(() => {
        void loadLanguage(lang).then((loaded) => {
          if (!cancelled && loaded) setDictionaryRevision((value) => value + 1);
        });
      }, 4_000);
    };
    if (criticalPublic) {
      void loadCriticalPublicLanguage(lang).then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          setReady(true);
          if (document.readyState === "complete") loadFull();
          else window.addEventListener("load", loadFull, { once: true });
        } else {
          void loadLanguage(lang).then((fullLoaded) => {
            if (!cancelled && fullLoaded) setReady(true);
          });
        }
      });
    } else {
      void loadLanguage(lang).then((loaded) => {
        if (!cancelled && loaded) setReady(true);
      });
    }
    return () => {
      cancelled = true;
      window.removeEventListener("load", loadFull);
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Last-write-wins token: rapid successive setLang calls can resolve out of
  // order (each awaits its own chunk); only the LATEST request may commit.
  const langSwitchToken = useRef(0);

  const setLang = useCallback((newLang: Language) => {
    if (!isValidLanguage(newLang)) return;
    // Route synchronization calls setLang for the locale already selected by
    // resolveInitialLang(). Do not turn that no-op into an eager download of
    // the full portal dictionary while a public critical dictionary is active.
    if (newLang === lang) return;
    const token = ++langSwitchToken.current;
    // Keep showing the CURRENT language until the new dictionary is loaded —
    // switching state first would flash raw keys / English fallbacks.
    void loadLanguage(newLang).then((loaded) => {
      if (token !== langSwitchToken.current) return; // superseded by a newer switch
      if (!loaded) return; // fetch failed → stay on the current language
      setLangState(newLang);
      localStorage.setItem(STORAGE_KEY, newLang);
    });
  }, [lang]);

  useEffect(() => {
    const isRTL = RTL_LANGUAGES.includes(lang);
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => getTranslation(lang, key, params),
    [lang, dictionaryRevision]
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

  // Minimal first-render gate: the active language chunk is small (~30-60KB
  // gzip) so this resolves in tens of milliseconds; App.tsx route-level
  // Suspense fallbacks take over from here.
  if (!ready) return null;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
