import { PublicLayout } from "@/components/layout/PublicLayout";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Award, Globe2, Heart, Users, Target, Zap } from "lucide-react";

const team = [
  { name: "Dr. Ayşe Yıldız", role: "Founder & CEO", img: "AY", bio: "15+ years in international education consulting. Former admissions officer at top UK universities." },
  { name: "Marcus Chen", role: "Head of Admissions", img: "MC", bio: "Guided 2,000+ students to their dream universities across 30 countries." },
  { name: "Fatima Al-Hassan", role: "Visa & Immigration Specialist", img: "FA", bio: "Expert in student visa processes for UK, USA, Canada, Australia, and Europe." },
  { name: "Olena Kovalenko", role: "Regional Manager - Europe", img: "OK", bio: "Specializes in European university placements and scholarship programs." },
];

const values = [
  { icon: Heart, title: "Student-First", desc: "Every decision we make centers on student success and wellbeing." },
  { icon: Target, title: "Excellence", desc: "We maintain the highest standards in guidance and support." },
  { icon: Globe2, title: "Global Reach", desc: "Partnerships with 200+ universities across 40 countries." },
  { icon: Zap, title: "Innovation", desc: "Using technology to streamline the application journey." },
  { icon: Users, title: "Community", desc: "Building lifelong connections between students and institutions." },
  { icon: Award, title: "Integrity", desc: "Honest, transparent advice that puts students' interests first." },
];

export default function About() {
  return (
    <PublicLayout>
      {/* Hero */}
      <section className="relative pt-24 pb-20 overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-2 rounded-full mb-6">
              <Award className="w-4 h-4" /> About EduCons
            </span>
            <h1 className="text-4xl md:text-6xl font-display font-bold text-foreground mb-6 leading-tight">
              We Make Global Education<br /><span className="text-primary">Accessible to Everyone</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Founded in 2010, EduCons has helped over 10,000 students from 50+ countries achieve their academic dreams. 
              We're more than consultants — we're your partners in global success.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 bg-primary text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { num: "10,000+", label: "Students Placed" },
              { num: "200+", label: "Partner Universities" },
              { num: "40+", label: "Countries Served" },
              { num: "95%", label: "Visa Success Rate" },
            ].map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                <p className="text-4xl md:text-5xl font-display font-bold">{s.num}</p>
                <p className="text-white/70 mt-2 font-medium">{s.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-16 items-center">
          <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }}>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-6">Our Mission</h2>
            <p className="text-muted-foreground text-lg leading-relaxed mb-6">
              We believe every motivated student deserves access to world-class education, regardless of their background. 
              Our mission is to eliminate barriers and confusion from the international education journey.
            </p>
            <p className="text-muted-foreground text-lg leading-relaxed mb-8">
              From your first inquiry to graduation day, we're with you every step — selecting the right university, 
              crafting a compelling application, securing your visa, and settling into life abroad.
            </p>
            <Button asChild size="lg" className="rounded-full px-8">
              <Link href="/contact">Get Started Today</Link>
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

      {/* Team */}
      <section className="py-24 bg-secondary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">Meet Our Team</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Expert consultants with decades of combined experience in international education.</p>
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

      {/* CTA */}
      <section className="py-24 bg-gradient-to-br from-primary to-accent text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-5xl font-display font-bold mb-6">Ready to Start Your Journey?</h2>
          <p className="text-white/80 text-lg mb-10 max-w-2xl mx-auto">Book a free consultation with one of our expert advisors today.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" variant="secondary" className="rounded-full px-8 text-primary font-bold hover:bg-white">
              <Link href="/contact">Book Free Consultation</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-8 border-white text-white hover:bg-white/10">
              <Link href="/programs">Browse Programs</Link>
            </Button>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
