import { useState } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useListUniversities, useListPrograms } from "@workspace/api-client-react";
import { Search, MapPin, BookOpen, Star, GraduationCap, Globe2, Clock, DollarSign } from "lucide-react";
import { motion } from "framer-motion";

const countries = ["All", "UK", "USA", "Canada", "Australia", "Germany", "Netherlands", "Turkey"];
const levels = ["All", "Bachelor", "Master", "PhD", "Language", "Foundation"];

export default function Programs() {
  useSeo({ title: "Programs", description: "Browse programs at 200+ partner universities worldwide." });
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("All");
  const [level, setLevel] = useState("All");
  const { data: universitiesResp, isLoading } = useListUniversities({ query: { queryKey: ['programs-universities'] } });
  const universities = (universitiesResp as any)?.data || universitiesResp || [];

  const filtered = (Array.isArray(universities) ? universities : []).filter((u: any) => {
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.country.toLowerCase().includes(search.toLowerCase());
    const matchCountry = country === "All" || u.country === country;
    return matchSearch && matchCountry;
  });

  return (
    <PublicLayout>
      {/* Hero */}
      <section className="pt-24 pb-16 bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-2 rounded-full mb-6">
              <GraduationCap className="w-4 h-4" /> 200+ Partner Universities
            </span>
            <h1 className="text-4xl md:text-6xl font-display font-bold text-foreground mb-6">
              Find Your Perfect <span className="text-primary">Program</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              Browse thousands of programs at top universities worldwide and find the one that's right for you.
            </p>
            <div className="max-w-2xl mx-auto relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search universities, programs, locations..."
                className="pl-12 pr-4 py-6 text-base rounded-full shadow-lg border-border/50 focus:border-primary"
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* Filters */}
      <section className="sticky top-20 z-40 bg-background/95 backdrop-blur-sm border-b py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-6 overflow-x-auto pb-2">
            <div className="flex gap-2 shrink-0">
              <span className="text-sm text-muted-foreground self-center font-medium">Country:</span>
              {countries.map(c => (
                <button key={c} onClick={() => setCountry(c)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap
                    ${country === c ? 'bg-primary text-white shadow-md shadow-primary/25' : 'bg-secondary hover:bg-primary/10 text-muted-foreground hover:text-primary'}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2 shrink-0">
              <span className="text-sm text-muted-foreground self-center font-medium">Level:</span>
              {levels.map(l => (
                <button key={l} onClick={() => setLevel(l)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap
                    ${level === l ? 'bg-accent text-white shadow-md shadow-accent/25' : 'bg-secondary hover:bg-accent/10 text-muted-foreground hover:text-accent'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <p className="text-muted-foreground">
              Showing <span className="font-bold text-foreground">{filtered.length}</span> universities
            </p>
          </div>

          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-64 rounded-2xl bg-secondary animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-24">
              <Globe2 className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-foreground mb-2">No results found</h3>
              <p className="text-muted-foreground">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((uni, i) => (
                <motion.div key={uni.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="group bg-card rounded-2xl overflow-hidden shadow-lg shadow-black/5 hover:-translate-y-2 transition-all duration-300 hover:shadow-xl hover:shadow-primary/10 border border-border/40">
                  <div className="h-40 bg-gradient-to-br from-primary/20 via-accent/10 to-primary/5 relative overflow-hidden">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-20 h-20 rounded-2xl bg-white/80 shadow-md flex items-center justify-center">
                        <GraduationCap className="w-10 h-10 text-primary" />
                      </div>
                    </div>
                    <div className="absolute top-4 right-4 flex gap-2">
                      <Badge className="bg-white/90 text-foreground text-xs font-semibold">{uni.country}</Badge>
                      {uni.isActive && <Badge className="bg-green-500/90 text-white text-xs">Partner</Badge>}
                    </div>
                  </div>
                  <div className="p-6">
                    <h3 className="font-display font-bold text-foreground text-lg mb-1 group-hover:text-primary transition-colors leading-tight">
                      {uni.name}
                    </h3>
                    <div className="flex items-center gap-1 text-muted-foreground text-sm mb-3">
                      <MapPin className="w-4 h-4" />
                      <span>{uni.city || uni.country}</span>
                    </div>
                    {uni.description && (
                      <p className="text-muted-foreground text-sm line-clamp-2 mb-4">{uni.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-5">
                      <span className="flex items-center gap-1"><Star className="w-4 h-4 text-amber-500" /> Top Ranked</span>
                      <span className="flex items-center gap-1"><BookOpen className="w-4 h-4 text-blue-500" /> 50+ Programs</span>
                    </div>
                    <Button asChild className="w-full rounded-xl" variant="outline">
                      <a href="/api/auth/login">Apply Now</a>
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-16 bg-gradient-to-r from-primary to-accent text-white mx-4 sm:mx-8 rounded-3xl mb-12 overflow-hidden relative">
        <div className="max-w-3xl mx-auto px-8 text-center relative z-10">
          <h2 className="text-3xl font-display font-bold mb-4">Can't find the right program?</h2>
          <p className="text-white/80 mb-8">Our advisors can help you find the perfect fit for your academic goals.</p>
          <Button asChild size="lg" variant="secondary" className="rounded-full px-8 text-primary font-bold">
            <a href="/contact">Talk to an Advisor</a>
          </Button>
        </div>
      </section>
    </PublicLayout>
  );
}
