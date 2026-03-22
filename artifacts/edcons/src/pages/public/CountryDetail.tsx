import { useState, useEffect } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { useSeo } from "@/hooks/use-seo";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Globe2, GraduationCap, Building2, MapPin, DollarSign, Languages,
  Wallet, Thermometer, FileText, Briefcase, ArrowLeft, ChevronRight,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Destination {
  id: number;
  name: string;
  slug: string;
  country: string;
  flagEmoji: string | null;
  heroImageUrl: string | null;
  shortDescription: string | null;
  description: string | null;
  whyStudyHere: string | null;
  livingCost: string | null;
  climate: string | null;
  language: string | null;
  currency: string | null;
  visaInfo: string | null;
  workPermit: string | null;
  popularCities: string | null;
}

interface UniversityBrief {
  id: number;
  name: string;
  city: string | null;
  logoUrl: string | null;
  ranking: number | null;
  universityType: string | null;
}

interface ProgramBrief {
  id: number;
  name: string;
  degree: string | null;
  language: string | null;
  duration: string | null;
  tuitionFee: number | null;
  currency: string | null;
  discountedFee: number | null;
  universityId: number;
}

function fixStorageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let fixed = url.replace(/\/api\/storage\/objects\/objects\//, "/api/storage/objects/");
  if (!fixed.startsWith("http") && !fixed.startsWith(BASE_URL)) {
    fixed = `${BASE_URL}${fixed.startsWith("/") ? "" : "/"}${fixed}`;
  }
  return fixed;
}

function InfoCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="bg-card rounded-2xl border border-border/40 p-5 flex gap-4 items-start">
      <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center shrink-0`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">{label}</p>
        <p className="text-sm text-foreground font-medium">{value}</p>
      </div>
    </div>
  );
}

export default function CountryDetail({ slug }: { slug: string }) {
  const [data, setData] = useState<{
    destination: Destination;
    universities: UniversityBrief[];
    programs: ProgramBrief[];
    stats: { universityCount: number; programCount: number };
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useSeo({
    title: data ? `Study in ${data.destination.name}` : "Study Destination",
    description: data?.destination.shortDescription || "Explore study opportunities in this destination.",
  });

  useEffect(() => {
    setIsLoading(true);
    setError(false);
    customFetch<any>(`/api/public/destinations/${slug}`, { method: "GET" })
      .then(d => setData(d))
      .catch(() => setError(true))
      .finally(() => setIsLoading(false));
  }, [slug]);

  if (isLoading) {
    return (
      <PublicLayout>
        <div className="pt-24 pb-16 max-w-7xl mx-auto px-4">
          <div className="h-64 rounded-3xl bg-secondary animate-pulse mb-8" />
          <div className="h-8 w-64 bg-secondary animate-pulse rounded mb-4" />
          <div className="h-4 w-full max-w-xl bg-secondary animate-pulse rounded" />
        </div>
      </PublicLayout>
    );
  }

  if (error || !data) {
    return (
      <PublicLayout>
        <div className="pt-24 pb-16 text-center max-w-7xl mx-auto px-4">
          <Globe2 className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-foreground mb-2">Destination not found</h2>
          <p className="text-muted-foreground mb-6">The destination you're looking for doesn't exist or is no longer available.</p>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/countries"><ArrowLeft className="w-4 h-4 mr-2" /> Back to Destinations</Link>
          </Button>
        </div>
      </PublicLayout>
    );
  }

  const { destination: dest, universities, programs, stats } = data;
  const whyPoints = dest.whyStudyHere?.split(/\.\s+/).filter(p => p.trim().length > 5) || [];
  const cities = dest.popularCities?.split(",").map(c => c.trim()).filter(Boolean) || [];

  const uniMap = new Map(universities.map(u => [u.id, u]));

  return (
    <PublicLayout>
      <section className="pt-24 pb-16 bg-gradient-to-br from-primary/10 via-accent/5 to-primary/5 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href="/countries" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-6">
            <ArrowLeft className="w-4 h-4" /> All Destinations
          </Link>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center gap-6">
            <span className="text-7xl">{dest.flagEmoji || "🌍"}</span>
            <div>
              <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-3">
                Study in <span className="text-primary">{dest.name}</span>
              </h1>
              {dest.shortDescription && (
                <p className="text-lg text-muted-foreground max-w-2xl">{dest.shortDescription}</p>
              )}
              <div className="flex items-center gap-6 mt-4">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Building2 className="w-4 h-4 text-primary" /> {stats.universityCount} Universities
                </span>
                <span className="flex items-center gap-2 text-sm font-medium">
                  <GraduationCap className="w-4 h-4 text-accent" /> {stats.programCount} Programs
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              {dest.description && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
                  <h2 className="text-2xl font-display font-bold text-foreground mb-4">About {dest.name}</h2>
                  <p className="text-muted-foreground leading-relaxed">{dest.description}</p>
                </motion.div>
              )}

              {whyPoints.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
                  <h2 className="text-2xl font-display font-bold text-foreground mb-4">Why Study in {dest.name}?</h2>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {whyPoints.map((point, i) => (
                      <div key={i} className="flex gap-3 bg-card rounded-xl border border-border/40 p-4">
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">
                          {i + 1}
                        </div>
                        <p className="text-sm text-foreground">{point.endsWith(".") ? point : `${point}.`}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {cities.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
                  <h2 className="text-2xl font-display font-bold text-foreground mb-4">Popular Cities</h2>
                  <div className="flex flex-wrap gap-3">
                    {cities.map(city => (
                      <div key={city} className="flex items-center gap-2 bg-card rounded-full border border-border/40 px-4 py-2">
                        <MapPin className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">{city}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-display font-bold text-foreground mb-2">Quick Facts</h3>
              {dest.language && <InfoCard icon={Languages} label="Language" value={dest.language} color="bg-blue-500" />}
              {dest.currency && <InfoCard icon={Wallet} label="Currency" value={dest.currency} color="bg-emerald-500" />}
              {dest.livingCost && <InfoCard icon={DollarSign} label="Living Cost" value={dest.livingCost} color="bg-amber-500" />}
              {dest.climate && <InfoCard icon={Thermometer} label="Climate" value={dest.climate} color="bg-orange-500" />}
              {dest.visaInfo && <InfoCard icon={FileText} label="Visa Info" value={dest.visaInfo} color="bg-violet-500" />}
              {dest.workPermit && <InfoCard icon={Briefcase} label="Work Permit" value={dest.workPermit} color="bg-rose-500" />}
            </div>
          </div>
        </div>
      </section>

      {universities.length > 0 && (
        <section className="py-12 bg-secondary/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-display font-bold text-foreground">
                Universities in {dest.name}
              </h2>
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link href={`/programs?country=${encodeURIComponent(dest.country)}`}>
                  View All Programs <ChevronRight className="w-4 h-4 ml-1" />
                </Link>
              </Button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {universities.map((uni, i) => {
                const logoSrc = fixStorageUrl(uni.logoUrl);
                const uniPrograms = programs.filter(p => p.universityId === uni.id);
                return (
                  <motion.div key={uni.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
                    className="bg-card rounded-2xl border border-border/40 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                    <div className="p-5">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
                          {logoSrc ? (
                            <img src={logoSrc} alt={uni.name} className="w-10 h-10 object-contain" loading="lazy"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <Building2 className="w-6 h-6 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-bold text-foreground text-sm truncate">{uni.name}</h3>
                          {uni.city && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {uni.city}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {uni.universityType && (
                          <Badge variant="secondary" className="text-xs">{uni.universityType}</Badge>
                        )}
                        {uni.ranking && (
                          <Badge variant="outline" className="text-xs">Rank #{uni.ranking}</Badge>
                        )}
                        <Badge className="text-xs bg-primary/10 text-primary border-0">
                          {uniPrograms.length} Programs
                        </Badge>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="py-16 bg-gradient-to-r from-primary to-accent text-white mx-4 sm:mx-8 rounded-3xl mb-12 overflow-hidden relative">
        <div className="max-w-3xl mx-auto px-8 text-center relative z-10">
          <h2 className="text-3xl font-display font-bold mb-4">Ready to study in {dest.name}?</h2>
          <p className="text-white/80 mb-8">Get personalized guidance from our expert counselors and start your application today.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" variant="secondary" className="rounded-full px-8 text-primary font-bold">
              <Link href={`/programs?country=${encodeURIComponent(dest.country)}`}>Browse Programs</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-8 text-white border-white/30 hover:bg-white/10 font-bold">
              <a href="/contact">Talk to an Advisor</a>
            </Button>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
