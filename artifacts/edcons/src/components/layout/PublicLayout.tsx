import { ReactNode, useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useI18n } from "@/hooks/use-i18n";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { GraduationCap, Globe, Menu, X, ChevronDown } from "lucide-react";
import { SUPPORTED_LANGUAGES, LANGUAGE_META, type Language } from "@/lib/i18n/index";

export function PublicLayout({ children }: { children: ReactNode }) {
  const { t, lang, setLang, localePath, isRTL } = useI18n();
  const { settings, resolvedTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const hasLogo = resolvedTheme === "dark" && settings.logoDarkUrl
    ? settings.logoDarkUrl
    : settings.logoUrl;
  const logoUrl = hasLogo
    ? `${BASE_URL}/api/settings/branding/logo${resolvedTheme === "dark" && settings.logoDarkUrl ? "?variant=dark" : ""}`
    : null;
  const companyName = settings.companyName || "EduCons";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentMeta = LANGUAGE_META[lang];

  const navLinks = [
    { href: localePath("/"), label: t("nav.home") },
    { href: localePath("/about"), label: t("nav.about") },
    { href: localePath("/countries"), label: t("nav.countries") },
    { href: localePath("/programs"), label: t("nav.programs") },
    { href: localePath("/blog"), label: t("nav.blog") },
    { href: localePath("/contact"), label: t("nav.contact") },
  ];

  function handleLangSwitch(newLang: Language) {
    setLang(newLang);
    setLangOpen(false);
    const currentPath = window.location.pathname;
    const stripped = currentPath.replace(/^\/[a-z]{2}(\/|$)/, "/") || "/";
    const newPath = `/${newLang}${stripped === "/" ? "" : stripped}`;
    window.location.href = `${BASE_URL}${newPath}`;
  }

  return (
    <div className="min-h-screen flex flex-col font-sans" dir={isRTL ? "rtl" : "ltr"}>
      <header className="sticky top-0 z-50 w-full glass border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <Link href={localePath("/")} className="flex items-center gap-2 group">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName}
                className="h-10 max-w-[180px] object-contain group-hover:scale-105 transition-transform duration-300"
              />
            ) : (
              <>
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform duration-300">
                  <GraduationCap className="w-6 h-6" />
                </div>
                <span className="font-display font-bold text-2xl tracking-tight text-foreground">
                  {companyName.includes("Cons") ? (
                    <>{companyName.replace("Cons", "")}<span className="text-primary">Cons</span></>
                  ) : companyName}
                </span>
              </>
            )}
          </Link>

          <nav aria-label="Main navigation" className="hidden md:flex items-center gap-8 font-medium text-sm text-muted-foreground">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-primary transition-colors">
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="relative" ref={langRef}>
              <button
                onClick={() => setLangOpen(!langOpen)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-secondary/80 transition-colors text-sm font-medium"
                aria-label="Select language"
              >
                <Globe className="w-4 h-4 text-muted-foreground" />
                <span>{currentMeta.flag}</span>
                <span className="text-foreground">{currentMeta.code.toUpperCase()}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${langOpen ? "rotate-180" : ""}`} />
              </button>
              {langOpen && (
                <div className={`absolute top-full mt-2 ${isRTL ? "left-0" : "right-0"} bg-card border border-border rounded-xl shadow-xl py-2 min-w-[200px] z-50 max-h-[400px] overflow-y-auto`}>
                  {SUPPORTED_LANGUAGES.map((code) => {
                    const meta = LANGUAGE_META[code];
                    return (
                      <button
                        key={code}
                        onClick={() => handleLangSwitch(code)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-secondary/80 transition-colors ${
                          code === lang ? "bg-primary/10 text-primary font-semibold" : "text-foreground"
                        }`}
                      >
                        <span className="text-lg">{meta.flag}</span>
                        <span>{meta.nativeName}</span>
                        <span className="text-muted-foreground text-xs ms-auto">{meta.code.toUpperCase()}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <Button asChild className="rounded-full px-6 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5">
              <Link href={localePath("/login")}>{t("nav.login")}</Link>
            </Button>

            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={() => setMobileOpen(!mobileOpen)}>
              {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </Button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t bg-background/95 backdrop-blur-md">
            <nav className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-4 py-3 rounded-lg hover:bg-secondary/80 text-foreground font-medium transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              <div className="border-t mt-2 pt-2">
                <p className="px-4 py-2 text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                  {t("nav.home") === "Home" ? "Language" : ""}
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {SUPPORTED_LANGUAGES.map((code) => {
                    const meta = LANGUAGE_META[code];
                    return (
                      <button
                        key={code}
                        onClick={() => { handleLangSwitch(code); setMobileOpen(false); }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${
                          code === lang ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-secondary/80"
                        }`}
                      >
                        <span>{meta.flag}</span>
                        <span>{meta.nativeName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="bg-foreground text-white/70 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              {logoUrl ? (
                <img src={logoUrl} alt={companyName} className="h-8 max-w-[160px] object-contain brightness-0 invert" />
              ) : (
                <>
                  <GraduationCap className="w-8 h-8 text-primary" />
                  <span className="font-display font-bold text-2xl text-white">
                    {companyName}
                  </span>
                </>
              )}
            </div>
            <p className="max-w-md">{t("footer.description")}</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6 font-display">{t("footer.quickLinks")}</h4>
            <ul className="space-y-3">
              <li><Link href={localePath("/programs")} className="hover:text-primary transition-colors">{t("footer.findPrograms")}</Link></li>
              <li><Link href={localePath("/countries")} className="hover:text-primary transition-colors">{t("footer.studyDestinations")}</Link></li>
              <li><Link href={localePath("/about")} className="hover:text-primary transition-colors">{t("footer.ourServices")}</Link></li>
              <li><Link href={localePath("/blog")} className="hover:text-primary transition-colors">{t("footer.studentBlog")}</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6 font-display">{t("footer.contactTitle")}</h4>
            <ul className="space-y-3">
              <li>info@educons.example.com</li>
              <li>+1 (555) 123-4567</li>
              <li>123 Education Blvd, Suite 100</li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
