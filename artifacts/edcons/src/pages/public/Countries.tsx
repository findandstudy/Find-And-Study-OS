import { useState, useEffect } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { useSeo } from "@/hooks/use-seo";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Globe2, GraduationCap, Building2, ArrowRight, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Destination {
  id: number;
  name: string;
  slug: string;
  country: string;
  flagEmoji: string | null;
  heroImageUrl: string | null;
  thumbnailUrl: string | null;
  shortDescription: string | null;
  universityCount: number;
  programCount: number;
  isFeatured: boolean;
}

export default function Countries() {
  useSeo({ title: "Study Destinations", description: "Explore top study destinations worldwide. Find universities and programs in Turkey, UK, Canada, and more." });
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    customFetch<Destination[]>("/api/public/destinations", { method: "GET" })
      .then(data => setDestinations(data))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const featured = destinations.filter(d => d.isFeatured);
  const others = destinations.filter(d => !d.isFeatured);

  return (
    <PublicLayout>
      <section className="pt-24 pb-16 bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-2 rounded-full mb-6">
              <Globe2 className="w-4 h-4" /> {destinations.length > 0 ? `${destinations.length} Destinations` : "Study Destinations"}
            </span>
            <h1 className="text-4xl md:text-6xl font-display font-bold text-foreground mb-6">
              Explore Study <span className="text-primary">Destinations</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Discover the best countries for your education journey. Each destination offers unique opportunities and experiences.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {isLoading ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-80 rounded-3xl bg-secondary animate-pulse" />
              ))}
            </div>
          ) : destinations.length === 0 ? (
            <div className="text-center py-24">
              <Globe2 className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-foreground mb-2">No destinations available yet</h3>
              <p className="text-muted-foreground">Check back soon for exciting study destinations.</p>
            </div>
          ) : (
            <>
              {featured.length > 0 && (
                <div className="mb-12">
                  <h2 className="text-2xl font-display font-bold text-foreground mb-8">Featured Destinations</h2>
                  <div className="grid md:grid-cols-2 gap-8">
                    {featured.map((dest, i) => (
                      <DestinationCard key={dest.id} destination={dest} index={i} featured />
                    ))}
                  </div>
                </div>
              )}

              {others.length > 0 && (
                <div>
                  {featured.length > 0 && <h2 className="text-2xl font-display font-bold text-foreground mb-8">More Destinations</h2>}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    {others.map((dest, i) => (
                      <DestinationCard key={dest.id} destination={dest} index={i} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="py-16 bg-gradient-to-r from-primary to-accent text-white mx-4 sm:mx-8 rounded-3xl mb-12 overflow-hidden relative">
        <div className="max-w-3xl mx-auto px-8 text-center relative z-10">
          <h2 className="text-3xl font-display font-bold mb-4">Not sure where to study?</h2>
          <p className="text-white/80 mb-8">Our expert advisors can help you choose the perfect destination based on your goals, budget, and preferences.</p>
          <Button asChild size="lg" variant="secondary" className="rounded-full px-8 text-primary font-bold">
            <a href="/contact">Get Free Counseling</a>
          </Button>
        </div>
      </section>
    </PublicLayout>
  );
}

function DestinationCard({ destination: dest, index, featured }: { destination: Destination; index: number; featured?: boolean }) {
  const gradients = [
    "from-blue-500/20 to-indigo-600/20",
    "from-emerald-500/20 to-teal-600/20",
    "from-rose-500/20 to-pink-600/20",
    "from-amber-500/20 to-orange-600/20",
    "from-violet-500/20 to-purple-600/20",
    "from-cyan-500/20 to-sky-600/20",
  ];
  const gradient = gradients[index % gradients.length];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.05 }}
    >
      <Link href={`/countries/${dest.slug}`}>
        <div className={`group relative rounded-3xl overflow-hidden border border-border/40 bg-card shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer ${featured ? 'min-h-[320px]' : 'min-h-[280px]'} flex flex-col`}>
          <div className={`h-36 bg-gradient-to-br ${gradient} relative flex items-center justify-center`}>
            {dest.thumbnailUrl ? (
              <img src={dest.thumbnailUrl} alt={dest.name} className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <span className="text-7xl">{dest.flagEmoji || "🌍"}</span>
            )}
            {dest.isFeatured && (
              <Badge className="absolute top-4 right-4 bg-amber-500 text-white border-0">Featured</Badge>
            )}
          </div>
          <div className="p-6 flex-1 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              {dest.flagEmoji && <span className="text-2xl">{dest.flagEmoji}</span>}
              <h3 className="text-xl font-display font-bold text-foreground group-hover:text-primary transition-colors">
                {dest.name}
              </h3>
            </div>
            {dest.shortDescription && (
              <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{dest.shortDescription}</p>
            )}
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-auto">
              <span className="flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-primary" />
                {dest.universityCount} {dest.universityCount === 1 ? "University" : "Universities"}
              </span>
              <span className="flex items-center gap-1.5">
                <GraduationCap className="w-4 h-4 text-accent" />
                {dest.programCount} Programs
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-primary text-sm font-semibold mt-4 group-hover:gap-3 transition-all">
              Explore <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
