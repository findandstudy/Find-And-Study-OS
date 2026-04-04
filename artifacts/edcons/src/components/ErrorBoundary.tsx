import { Component, type ReactNode } from "react";
import { GraduationCap, RefreshCw, AlertTriangle } from "lucide-react";

const MESSAGES: Record<string, { title: string; desc: string; reload: string; home: string }> = {
  en: { title: "Page could not be loaded", desc: "This may be caused by a network issue or a recent update. Please reload.", reload: "Reload Page", home: "Go to Home" },
  tr: { title: "Sayfa yüklenemedi", desc: "Bu, bir ağ sorunundan veya son bir güncellemeden kaynaklanıyor olabilir. Lütfen yenileyin.", reload: "Sayfayı Yenile", home: "Ana Sayfaya Git" },
  ar: { title: "تعذّر تحميل الصفحة", desc: "قد يكون هذا بسبب مشكلة في الشبكة أو تحديث حديث. يرجى إعادة التحميل.", reload: "إعادة تحميل الصفحة", home: "الذهاب إلى الرئيسية" },
  fr: { title: "La page n'a pas pu être chargée", desc: "Cela peut être dû à un problème réseau ou à une mise à jour récente. Veuillez recharger.", reload: "Recharger la page", home: "Aller à l'accueil" },
  ru: { title: "Страница не загрузилась", desc: "Это может быть связано с проблемой сети или последним обновлением. Пожалуйста, перезагрузите.", reload: "Обновить страницу", home: "На главную" },
  fa: { title: "صفحه بارگذاری نشد", desc: "این ممکن است به دلیل مشکل شبکه یا بروزرسانی اخیر باشد. لطفاً دوباره بارگذاری کنید.", reload: "بارگذاری مجدد صفحه", home: "رفتن به خانه" },
  zh: { title: "页面无法加载", desc: "这可能是由于网络问题或最近的更新导致的。请重新加载。", reload: "重新加载页面", home: "返回主页" },
  hi: { title: "पेज लोड नहीं हो सका", desc: "यह नेटवर्क समस्या या हाल के अपडेट के कारण हो सकता है। कृपया पुनः लोड करें।", reload: "पेज रीलोड करें", home: "होम पर जाएं" },
  es: { title: "No se pudo cargar la página", desc: "Esto puede deberse a un problema de red o a una actualización reciente. Por favor, recarga.", reload: "Recargar página", home: "Ir al inicio" },
  id: { title: "Halaman tidak dapat dimuat", desc: "Ini mungkin disebabkan oleh masalah jaringan atau pembaruan terbaru. Silakan muat ulang.", reload: "Muat Ulang Halaman", home: "Ke Beranda" },
};

const RTL_LANGS = new Set(["ar", "fa"]);

function isChunkError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err as Error)?.message || "";
  const name = (err as Error)?.name || "";
  return (
    name === "ChunkLoadError" ||
    msg.includes("Loading chunk") ||
    msg.includes("Loading CSS chunk") ||
    msg.includes("dynamically imported module") ||
    msg.includes("Failed to fetch dynamically") ||
    msg.includes("Importing a module script failed")
  );
}

function getLang(): string {
  try {
    const saved = localStorage.getItem("edcons_lang");
    if (saved && saved in MESSAGES) return saved;
    const urlLang = window.location.pathname.split("/")[1];
    if (urlLang && urlLang in MESSAGES) return urlLang;
  } catch {}
  return "en";
}

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean; isChunk: boolean; lang: string }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, isChunk: false, lang: "en" };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { hasError: true, isChunk: isChunkError(error), lang: getLang() };
  }

  componentDidMount() {
    sessionStorage.removeItem("chunk_reload");
  }

  componentDidCatch(error: unknown) {
    console.error("[ErrorBoundary]", error);
  }

  handleReload = () => {
    sessionStorage.removeItem("chunk_reload");
    window.location.reload();
  };

  handleHome = () => {
    const lang = this.state.lang;
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
    window.location.href = `${base}/${lang}/`;
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const lang = this.state.lang;
    const m = MESSAGES[lang] ?? MESSAGES["en"];
    const isRTL = RTL_LANGS.has(lang);

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
        <p className="text-sm text-muted-foreground mb-8 max-w-xs leading-relaxed">{m.desc}</p>

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
      </div>
    );
  }
}
