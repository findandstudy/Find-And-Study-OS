import { PublicLayout } from "@/components/layout/PublicLayout";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Award, Globe2, Heart, Users, Target, Zap } from "lucide-react";

const team = [
  { name: "Dr. Ayşe Yıldız", role: "Founder & CEO", img: "AY", bio: "15+ years in international education consulting. Former admissions officer at top UK universities." },
  { name: "Marcus Chen", role: "Head of Admissions", img: "MC", bio: "Guided 2,000+ students to their dream universities across 30 countries." },
  { name: "Fatima Al-Hassan", role: "Visa & Immigration Specialist", img: "FA", bio: "Expert in student visa processes for UK, USA, Canada, Australia, and Europe." },
  { name: "Olena Kovalenko", role: "Regional Manager - Europe", img: "OK", bio: "Specializes in European university placements and scholarship programs." },
];

export default function About() {
  const { t, lang, localePath } = useI18n();
  useSeo({ title: t("seo.aboutTitle"), description: t("seo.aboutDesc"), lang });

  const values = [
    { icon: Heart, title: t("about.studentFirst"), desc: t("about.studentFirstDesc") },
    { icon: Target, title: t("about.excellence"), desc: t("about.excellenceDesc") },
    { icon: Globe2, title: t("about.globalReach"), desc: t("about.globalReachDesc") },
    { icon: Zap, title: t("about.innovation"), desc: t("about.innovationDesc") },
    { icon: Users, title: t("about.community"), desc: t("about.communityDesc") },
    { icon: Award, title: t("about.integrity"), desc: t("about.integrityDesc") },
  ];

  return (
    <PublicLayout>
      <section className="relative pt-24 pb-20 overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-2 rounded-full mb-6">
              <Award className="w-4 h-4" /> {t("about.badge")}
            </span>
            <h1 className="text-4xl md:text-6xl font-display font-bold text-foreground mb-6 leading-tight">
              {t("about.title")}<br /><span className="text-primary">{t("about.titleHighlight")}</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              {t("about.description")}
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-16 bg-primary text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { num: "10,000+", label: t("about.studentsPlaced") },
              { num: "200+", label: t("about.partnerUniversities") },
              { num: "40+", label: t("about.countriesServed") },
              { num: "95%", label: t("about.visaSuccessRate") },
            ].map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                <p className="text-4xl md:text-5xl font-display font-bold">{s.num}</p>
                <p className="text-white/70 mt-2 font-medium">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-16 items-center">
          <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }}>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6">{t("about.missionTitle")}</h2>
            <p className="text-muted-foreground text-lg leading-relaxed mb-6">{t("about.missionP1")}</p>
            <p className="text-muted-foreground text-lg leading-relaxed mb-8">{t("about.missionP2")}</p>
            <Button asChild size="lg" className="rounded-full px-8">
              <Link href={localePath("/contact")}>{t("about.getStarted")}</Link>
            </Button>
          </motion.div>
          <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} className="grid grid-cols-2 gap-4">
            {values.map((v, i) => (
              <div key={i} className="p-6 rounded-2xl bg-secondary/50 hover:bg-primary/5 transition-colors group">
                <v.icon className="w-8 h-8 text-primary mb-4 group-hover:scale-110 transition-transform" />
                <h3 className="font-bold text-foreground mb-2">{v.title}</h3>
                <p className="text-muted-foreground text-sm">{v.desc}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-24 bg-secondary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">{t("about.teamTitle")}</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{t("about.teamSubtitle")}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {team.map((member, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
                className="bg-card rounded-2xl p-6 text-center shadow-lg shadow-black/5 hover:-translate-y-2 transition-transform duration-300">
                <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-display font-bold text-2xl mx-auto mb-4 shadow-lg">
                  {member.img}
                </div>
                <h3 className="font-display font-bold text-foreground mb-1">{member.name}</h3>
                <p className="text-primary text-sm font-semibold mb-3">{member.role}</p>
                <p className="text-muted-foreground text-sm">{member.bio}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 bg-gradient-to-br from-primary to-accent text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-5xl font-display font-bold mb-6">{t("about.ctaTitle")}</h2>
          <p className="text-white/80 text-lg mb-10 max-w-2xl mx-auto">{t("about.ctaSubtitle")}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" variant="secondary" className="rounded-full px-8 text-primary font-bold hover:bg-white">
              <Link href={localePath("/contact")}>{t("about.bookConsultation")}</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-8 border-white text-white hover:bg-white/10">
              <Link href={localePath("/programs")}>{t("about.browsePrograms")}</Link>
            </Button>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
