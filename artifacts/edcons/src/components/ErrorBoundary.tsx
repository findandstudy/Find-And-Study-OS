import { Component, type ReactNode } from "react";
import { GraduationCap, RefreshCw, AlertTriangle, ChevronDown } from "lucide-react";

const MESSAGES: Record<string, { title: string; desc: string; reload: string; home: string; details: string }> = {
  en: { title: "Page could not be loaded", desc: "This may be caused by a network issue or a recent update. Please reload.", reload: "Reload Page", home: "Go to Home", details: "Technical details" },
  tr: { title: "Sayfa yüklenemedi", desc: "Bu, bir ağ sorunundan veya son bir güncellemeden kaynaklanıyor olabilir. Lütfen yenileyin.", reload: "Sayfayı Yenile", home: "Ana Sayfaya Git", details: "Teknik ayrıntılar" },
  ar: { title: "تعذّر تحميل الصفحة", desc: "قد يكون هذا بسبب مشكلة في الشبكة أو تحديث حديث. يرجى إعادة التحميل.", reload: "إعادة تحميل الصفحة", home: "الذهاب إلى الرئيسية", details: "تفاصيل تقنية" },
  fr: { title: "La page n'a pas pu être chargée", desc: "Cela peut être dû à un problème réseau ou à une mise à jour récente. Veuillez recharger.", reload: "Recharger la page", home: "Aller à l'accueil", details: "Détails techniques" },
  ru: { title: "Страница не загрузилась", desc: "Это может быть связано с проблемой сети или последним обновлением. Пожалуйста, перезагрузите.", reload: "Обновить страницу", home: "На главную", details: "Технические детали" },
  fa: { title: "صفحه بارگذاری نشد", desc: "این ممکن است به دلیل مشکل شبکه یا بروزرسانی اخیر باشد. لطفاً دوباره بارگذاری کنید.", reload: "بارگذاری مجدد صفحه", home: "رفتن به خانه", details: "جزئیات فنی" },
  zh: { title: "页面无法加载", desc: "这可能是由于网络问题或最近的更新导致的。请重新加载。", reload: "重新加载页面", home: "返回主页", details: "技术细节" },
  hi: { title: "पेज लोड नहीं हो सका", desc: "यह नेटवर्क समस्या या हाल के अपडेट के कारण हो सकता है। कृपया पुनः लोड करें।", reload: "पेज रीलोड करें", home: "होम पर जाएं", details: "तकनीकी विवरण" },
  es: { title: "No se pudo cargar la página", desc: "Esto puede deberse a un problema de red o a una actualización reciente. Por favor, recarga.", reload: "Recargar página", home: "Ir al inicio", details: "Detalles técnicos" },
  id: { title: "Halaman tidak dapat dimuat", desc: "Ini mungkin disebabkan oleh masalah jaringan atau pembaruan terbaru. Silakan muat ulang.", reload: "Muat Ulang Halaman", home: "Ke Beranda", details: "Detail teknis" },
};

const RTL_LANGS = new Set(["ar", "fa"]);

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
    return `edcons_recover:${window.location.pathname}`;
  } catch {
    return "edcons_recover";
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

  componentDidMount() {
    // Successful mount → clear the per-path auto-recover flag and the
    // legacy chunk_reload flag so the next failure can recover again.
    try {
      sessionStorage.removeItem(recoverKeyForPath());
      sessionStorage.removeItem("chunk_reload");
    } catch {}
  }

  componentDidCatch(error: unknown) {
    console.error("[ErrorBoundary]", error);
    // Auto-recover: try ONE cache-busted reload per pathname per session.
    // This handles the common case of a bad cached chunk, a transient
    // network blip during initial paint, or a stale module from a deploy
    // that the user's tab missed. If the same path keeps crashing we
    // fall through and show the UI on the second mount.
    try {
      const key = recoverKeyForPath();
      const tried = sessionStorage.getItem(key);
      if (!tried) {
        sessionStorage.setItem(key, String(Date.now()));
        // Defer to next tick so React finishes its error handling cleanly.
        setTimeout(() => cacheBustedReload(), 50);
      }
    } catch {}
  }

  handleReload = () => {
    try {
      sessionStorage.removeItem(recoverKeyForPath());
      sessionStorage.removeItem("chunk_reload");
    } catch {}
    cacheBustedReload();
  };

  handleHome = () => {
    try {
      sessionStorage.removeItem(recoverKeyForPath());
      sessionStorage.removeItem("chunk_reload");
    } catch {}
    const lang = this.state.lang;
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    window.location.href = `${base}/${lang}/?_cb=${Date.now()}`;
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
