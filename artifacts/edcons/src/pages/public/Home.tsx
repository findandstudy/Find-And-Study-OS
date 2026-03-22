import { PublicLayout } from "@/components/layout/PublicLayout";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { ArrowRight, BookOpen, FileText, Globe2, ShieldCheck, Star, Users } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "wouter";

export default function Home() {
  useSeo({ title: "Global Education Consultancy", description: "Expert guidance for university admissions, visas, and scholarships worldwide." });
  const { t } = useI18n();

  return (
    <PublicLayout>
      {/* Hero Section */}
      <section className="relative pt-24 pb-32 lg:pt-36 lg:pb-40 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`} 
            alt=""
            width={1920}
            height={1080}
            className="w-full h-full object-cover opacity-10"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/0 via-background/50 to-background" />
        </div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary font-medium text-sm mb-8 border border-primary/20 shadow-sm">
              <Star className="w-4 h-4 fill-primary" />
              Trusted by 10,000+ Students Worldwide
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold font-display tracking-tight text-foreground max-w-4xl mx-auto leading-[1.1]">
              {t('hero.title')}
            </h1>
            
            <p className="mt-6 text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {t('hero.subtitle')}
            </p>
            
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button size="lg" className="rounded-full px-8 h-14 text-base shadow-xl shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-1 transition-all duration-300" asChild>
                <Link href="/programs">
                  {t('hero.cta')} <ArrowRight className="ml-2 w-5 h-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="rounded-full px-8 h-14 text-base bg-white/50 backdrop-blur hover:bg-white transition-all duration-300" asChild>
                <Link href="/programs">Browse Programs</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-20 bg-card border-y border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: "98%", label: "Visa Success Rate" },
              { value: "500+", label: "Partner Universities" },
              { value: "30+", label: "Countries" },
              { value: "$2M+", label: "Scholarships Secured" },
            ].map((stat, i) => (
              <div key={i} className="space-y-2">
                <h3 className="text-4xl md:text-5xl font-bold font-display text-primary">{stat.value}</h3>
                <p className="text-muted-foreground font-medium">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-bold font-display mb-4">Everything You Need to Succeed</h2>
            <p className="text-lg text-muted-foreground">From choosing the right program to arriving on campus, our platform and expert consultants guide you every step of the way.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Globe2, title: "University Selection", desc: "AI-driven matching to find the perfect program based on your academic profile and career goals." },
              { icon: FileText, title: "Application Support", desc: "Streamlined document collection, review, and direct submission to our partner institutions." },
              { icon: ShieldCheck, title: "Visa Processing", desc: "Expert guidance on visa applications with mock interviews and complete document checklists." },
            ].map((feature, i) => (
              <div key={i} className="glass-card p-8 rounded-3xl hover:-translate-y-2 transition-all duration-300 group">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary transition-colors duration-300">
                  <feature.icon className="w-7 h-7 text-primary group-hover:text-white transition-colors duration-300" />
                </div>
                <h3 className="text-xl font-bold font-display mb-3">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
