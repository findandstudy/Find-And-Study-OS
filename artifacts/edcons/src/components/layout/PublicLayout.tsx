import { ReactNode } from "react";
import { Link } from "wouter";
import { useI18n } from "@/hooks/use-i18n";
import { Button } from "@/components/ui/button";
import { GraduationCap, Globe, Menu } from "lucide-react";

export function PublicLayout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();

  return (
    <div className="min-h-screen flex flex-col font-sans">
      <header className="sticky top-0 z-50 w-full glass border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white shadow-lg group-hover:scale-105 transition-transform duration-300">
              <GraduationCap className="w-6 h-6" />
            </div>
            <span className="font-display font-bold text-2xl tracking-tight text-foreground">
              Edu<span className="text-primary">Cons</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-8 font-medium text-sm text-muted-foreground">
            <Link href="/" className="hover:text-primary transition-colors">{t('nav.home')}</Link>
            <Link href="/about" className="hover:text-primary transition-colors">{t('nav.about')}</Link>
            <Link href="/programs" className="hover:text-primary transition-colors">{t('nav.programs')}</Link>
            <Link href="/blog" className="hover:text-primary transition-colors">{t('nav.blog')}</Link>
            <Link href="/contact" className="hover:text-primary transition-colors">{t('nav.contact')}</Link>
          </nav>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              <select 
                value={lang} 
                onChange={(e) => setLang(e.target.value as any)}
                className="bg-transparent border-none text-sm font-medium focus:ring-0 cursor-pointer outline-none"
              >
                <option value="en">EN</option>
                <option value="tr">TR</option>
              </select>
            </div>
            
            <Button asChild className="rounded-full px-6 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5">
              <a href="/api/auth/login">{t('nav.login')}</a>
            </Button>
            
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="w-6 h-6" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="bg-foreground text-white/70 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
             <div className="flex items-center gap-2 mb-6">
                <GraduationCap className="w-8 h-8 text-primary" />
                <span className="font-display font-bold text-2xl text-white">
                  EduCons
                </span>
              </div>
              <p className="max-w-md">Empowering students to achieve their global education dreams through expert guidance, seamless applications, and dedicated support.</p>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6 font-display">Quick Links</h4>
            <ul className="space-y-3">
              <li><Link href="/programs" className="hover:text-primary transition-colors">Find Programs</Link></li>
              <li><Link href="/about" className="hover:text-primary transition-colors">Our Services</Link></li>
              <li><Link href="/blog" className="hover:text-primary transition-colors">Student Blog</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold mb-6 font-display">Contact</h4>
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
