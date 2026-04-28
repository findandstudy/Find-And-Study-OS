import { Component, type ReactNode } from "react";
import { GraduationCap, RefreshCw, AlertTriangle, ChevronDown, LogOut } from "lucide-react";

const MESSAGES: Record<string, { title: string; desc: string; reload: string; home: string; logout: string; details: string }> = {
  en: { title: "Page could not be loaded", desc: "This may be caused by a network issue or a recent update. Please reload.", reload: "Reload Page", home: "Go to Home", logout: "Sign Out", details: "Technical details" },
  tr: { title: "Sayfa yüklenemedi", desc: "Bu, bir ağ sorunundan veya son bir güncellemeden kaynaklanıyor olabilir. Lütfen yenileyin.", reload: "Sayfayı Yenile", home: "Ana Sayfaya Git", logout: "Çıkış Yap", details: "Teknik ayrıntılar" },
  ar: { title: "تعذّر تحميل الصفحة", desc: "قد يكون هذا بسبب مشكلة في الشبكة أو تحديث حديث. يرجى إعادة التحميل.", reload: "إعادة تحميل الصفحة", home: "الذهاب إلى الرئيسية", logout: "تسجيل الخروج", details: "تفاصيل تقنية" },
  fr: { title: "La page n'a pas pu être chargée", desc: "Cela peut être dû à un problème réseau ou à une mise à jour récente. Veuillez recharger.", reload: "Recharger la page", home: "Aller à l'accueil", logout: "Se déconnecter", details: "Détails techniques" },
  ru: { title: "Страница не загрузилась", desc: "Это может быть связано с проблемой сети или последним обновлением. Пожалуйста, перезагрузите.", reload: "Обновить страницу", home: "На главную", logout: "Выйти", details: "Технические детали" },
  fa: { title: "صفحه بارگذاری نشد", desc: "این ممکن است به دلیل مشکل شبکه یا بروزرسانی اخیر باشد. لطفاً دوباره بارگذاری کنید.", reload: "بارگذاری مجدد صفحه", home: "رفتن به خانه", logout: "خروج", details: "جزئیات فنی" },
  zh: { title: "页面无法加载", desc: "这可能是由于网络问题或最近的更新导致的。请重新加载。", reload: "重新加载页面", home: "返回主页", logout: "退出登录", details: "技术细节" },
  hi: { title: "पेज लोड नहीं हो सका", desc: "यह नेटवर्क समस्या या हाल के अपडेट के कारण हो सकता है। कृपया पुनः लोड करें।", reload: "पेज रीलोड करें", home: "होम पर जाएं", logout: "लॉग आउट", details: "तकनीकी विवरण" },
  es: { title: "No se pudo cargar la página", desc: "Esto puede deberse a un problema de red o a una actualización reciente. Por favor, recarga.", reload: "Recargar página", home: "Ir al inicio", logout: "Cerrar sesión", details: "Detalles técnicos" },
  id: { title: "Halaman tidak dapat dimuat", desc: "Ini mungkin disebabkan oleh masalah jaringan atau pembaruan terbaru. Silakan muat ulang.", reload: "Muat Ulang Halaman", home: "Ke Beranda", logout: "Keluar", details: "Detail teknis" },
};

const RTL_LANGS = new Set(["ar", "fa"]);

// A single auto-reload attempt is allowed per pathname per 5-minute window.
// This breaks any infinite loop while still recovering from one-shot
// transient failures (stale chunk after deploy, etc).
const RECOVER_COOLDOWN_MS = 5 * 60 * 1000;
const RECOVER_KEY_PREFIX = "edcons_recover:";

function getLang(): string {
  try {
    const saved = localStorage.getItem("edcons_lang");
    if (saved && saved in MESSAGES) return saved;
    const urlLang = window.location.pathname.split("/")[1];
    if (urlLang && urlLang in MESSAGES) return urlLang;
  } catch {}
  return "en";
}

function recoverKeyForPath(): string {
  try {
    return `${RECOVER_KEY_PREFIX}${window.location.pathname}`;
  } catch {
    return RECOVER_KEY_PREFIX;
  }
}

function cacheBustedReload(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("_cb", Date.now().toString());
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean; lang: string; errorName: string; errorMessage: string; errorStack: string; showDetails: boolean }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, lang: "en", errorName: "", errorMessage: "", errorStack: "", showDetails: false };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const e = error as Error | undefined;
    return {
      hasError: true,
      lang: getLang(),
      errorName: e?.name || "Error",
      errorMessage: e?.message || String(error),
      errorStack: (e?.stack || "").split("\n").slice(0, 6).join("\n"),
    };
  }

  componentDidCatch(error: unknown) {
    console.error("[ErrorBoundary]", error);
    // Auto-recover: try ONE cache-busted reload per pathname per 5 minutes.
    // We persist a TIMESTAMP (not a boolean) in sessionStorage so that the
    // boundary can never reload twice in quick succession — that was the
    // bug that put users in an infinite loop. After the first auto-reload
    // we ALWAYS show the recovery UI on the next failure within the
    // cooldown window so the user can pick what to do (reload, go home,
    // or sign out).
    try {
      const key = recoverKeyForPath();
      const lastRaw = sessionStorage.getItem(key);
      const last = lastRaw ? Number(lastRaw) : 0;
      const now = Date.now();
      if (!last || now - last > RECOVER_COOLDOWN_MS) {
        sessionStorage.setItem(key, String(now));
        setTimeout(() => cacheBustedReload(), 50);
      }
    } catch {}
  }

  componentDidUpdate(_: Props, prevState: State) {
    // Only clear the cooldown after we transition from error → no-error,
    // i.e. the user successfully navigated away or the retry worked.
    if (prevState.hasError && !this.state.hasError) {
      try { sessionStorage.removeItem(recoverKeyForPath()); } catch {}
    }
  }

  handleReload = () => {
    // User pressed reload manually — clear cooldown so they can recover
    // again later if needed, then do the cache-busted reload.
    try { sessionStorage.removeItem(recoverKeyForPath()); } catch {}
    cacheBustedReload();
  };

  handleHome = () => {
    try { sessionStorage.removeItem(recoverKeyForPath()); } catch {}
    const lang = this.state.lang;
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    window.location.href = `${base}/${lang}/?_cb=${Date.now()}`;
  };

  handleLogout = async () => {
    // Hard logout — call the server, clear all client state, and bounce
    // to the login page. Survives a broken dashboard so the user can
    // always escape.
    try { sessionStorage.clear(); } catch {}
    try { localStorage.removeItem("edcons_user"); } catch {}
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    try {
      await fetch(`${base}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch {}
    const lang = this.state.lang;
    window.location.href = `${base}/${lang}/login?_cb=${Date.now()}`;
  };

  toggleDetails = () => this.setState((s) => ({ showDetails: !s.showDetails }));

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const lang = this.state.lang;
    const m = MESSAGES[lang] ?? MESSAGES["en"];
    const isRTL = RTL_LANGS.has(lang);
    const hasDetails = Boolean(this.state.errorMessage);

    return (
      <div
        dir={isRTL ? "rtl" : "ltr"}
        className="min-h-screen w-full flex flex-col items-center justify-center bg-background p-6 text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg mb-6">
          <GraduationCap className="w-8 h-8 text-white" />
        </div>

        <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
          <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
        </div>

        <h1 className="text-xl font-bold text-foreground mb-2 max-w-sm">{m.title}</h1>
        <p className="text-sm text-muted-foreground mb-6 max-w-xs leading-relaxed">{m.desc}</p>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={this.handleReload}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:opacity-90 active:scale-95 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            {m.reload}
          </button>
          <button
            onClick={this.handleHome}
            className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-6 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            {m.home}
          </button>
          <button
            onClick={this.handleLogout}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-6 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            {m.logout}
          </button>
        </div>

        {hasDetails && (
          <div className="mt-8 max-w-xl w-full">
            <button
              onClick={this.toggleDetails}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${this.state.showDetails ? "rotate-180" : ""}`} />
              {m.details}
            </button>
            {this.state.showDetails && (
              <pre
                dir="ltr"
                className="mt-3 text-left text-[11px] leading-relaxed bg-muted/40 border border-border rounded-lg p-3 overflow-auto max-h-64 font-mono text-muted-foreground"
              >
                {this.state.errorName}: {this.state.errorMessage}
                {this.state.errorStack ? `\n\n${this.state.errorStack}` : ""}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }
}
