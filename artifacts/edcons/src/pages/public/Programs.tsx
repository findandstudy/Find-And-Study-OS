import { useState, useEffect, useCallback } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { useSeo } from "@/hooks/use-seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { customFetch } from "@workspace/api-client-react";
import { Search, MapPin, BookOpen, GraduationCap, Globe2, Clock, DollarSign, Languages, ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

interface Program {
  id: number;
  name: string;
  degree: string | null;
  field: string | null;
  language: string | null;
  duration: string | null;
  tuitionFee: number | null;
  currency: string | null;
  discountedFee: number | null;
  scholarship: number | null;
  intakes: string | null;
  universityName: string;
  universityCountry: string | null;
  universityCity: string | null;
  universityLogoUrl: string | null;
}

interface Filters {
  countries: string[];
  degrees: string[];
  languages: string[];
}

function formatFee(fee: number | null, currency: string | null): string {
  if (!fee) return "";
  const cur = currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(fee);
  } catch {
    return `${fee} ${cur}`;
  }
}

export default function Programs() {
  useSeo({ title: "Programs", description: "Browse programs at 200+ partner universities worldwide." });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [country, setCountry] = useState("All");
  const [level, setLevel] = useState("All");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({ countries: [], degrees: [], languages: [] });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    customFetch<Filters>("/api/course-finder/filters", { method: "GET" })
      .then(data => setFilters(data))
      .catch(() => {});
  }, []);

  const fetchPrograms = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "24" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (country !== "All") params.set("country", country);
      if (level !== "All") params.set("level", level);

      const resp = await customFetch<{ data: Program[]; meta: { total: number; page: number; totalPages: number } }>(
        `/api/course-finder?${params.toString()}`,
        { method: "GET" }
      );
      setPrograms(resp.data || []);
      setTotal(resp.meta?.total || 0);
      setTotalPages(resp.meta?.totalPages || 1);
    } catch {
      setPrograms([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, country, level]);

  useEffect(() => {
    fetchPrograms();
  }, [fetchPrograms]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, country, level]);

  const displayCountries = filters.countries.length > 0 ? ["All", ...filters.countries] : ["All"];
  const displayDegrees = filters.degrees.length > 0 ? ["All", ...filters.degrees] : ["All"];

  return (
    <PublicLayout>
      <section className="pt-24 pb-16 bg-gradient-to-br from-primary/5 to-accent/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-2 rounded-full mb-6">
              <GraduationCap className="w-4 h-4" /> {total > 0 ? `${total}+ Programs Available` : "Browse Programs"}
            </span>
            <h1 className="text-4xl md:text-6xl font-display font-bold text-foreground mb-6">
              Find Your Perfect <span className="text-primary">Program</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              Browse programs at top universities worldwide and find the one that's right for you.
            </p>
            <div className="max-w-2xl mx-auto relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search programs, universities, locations..."
                className="pl-12 pr-4 py-6 text-base rounded-full shadow-lg border-border/50 focus:border-primary"
              />
            </div>
          </motion.div>
        </div>
      </section>

      <section className="sticky top-20 z-40 bg-background/95 backdrop-blur-sm border-b py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-6 overflow-x-auto pb-2">
            <div className="flex gap-2 shrink-0">
              <span className="text-sm text-muted-foreground self-center font-medium">Country:</span>
              {displayCountries.map(c => (
                <button key={c} onClick={() => setCountry(c)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap
                    ${country === c ? 'bg-primary text-white shadow-md shadow-primary/25' : 'bg-secondary hover:bg-primary/10 text-muted-foreground hover:text-primary'}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2 shrink-0">
              <span className="text-sm text-muted-foreground self-center font-medium">Level:</span>
              {displayDegrees.map(l => (
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

      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <p className="text-muted-foreground">
              Showing <span className="font-bold text-foreground">{total}</span> programs
            </p>
          </div>

          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-72 rounded-2xl bg-secondary animate-pulse" />
              ))}
            </div>
          ) : programs.length === 0 ? (
            <div className="text-center py-24">
              <Globe2 className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-foreground mb-2">No programs found</h3>
              <p className="text-muted-foreground">Try adjusting your filters or search terms</p>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {programs.map((prog, i) => {
                  const effectiveFee = prog.discountedFee ?? prog.tuitionFee;
                  const hasDiscount = prog.discountedFee && prog.tuitionFee && prog.discountedFee < prog.tuitionFee;
                  return (
                    <motion.div key={prog.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.03 }}
                      className="group bg-card rounded-2xl overflow-hidden shadow-lg shadow-black/5 hover:-translate-y-1 transition-all duration-300 hover:shadow-xl hover:shadow-primary/10 border border-border/40 flex flex-col">
                      <div className="h-16 bg-gradient-to-r from-primary/15 via-accent/10 to-primary/5 relative flex items-center px-5 gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/80 shadow-sm flex items-center justify-center shrink-0">
                          <GraduationCap className="w-5 h-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground truncate">{prog.universityName}</p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          {prog.universityCountry && (
                            <Badge variant="secondary" className="text-[10px] px-2 py-0.5">{prog.universityCountry}</Badge>
                          )}
                          {prog.degree && (
                            <Badge className="bg-primary/90 text-white text-[10px] px-2 py-0.5">{prog.degree}</Badge>
                          )}
                        </div>
                      </div>

                      <div className="p-5 flex-1 flex flex-col">
                        <h3 className="font-display font-bold text-foreground text-base mb-2 group-hover:text-primary transition-colors leading-tight line-clamp-2">
                          {prog.name}
                        </h3>

                        <div className="flex items-center gap-1.5 text-muted-foreground text-sm mb-3">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{[prog.universityCity, prog.universityCountry].filter(Boolean).join(", ")}</span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-4">
                          {prog.language && (
                            <span className="flex items-center gap-1.5">
                              <Languages className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span className="truncate">{prog.language}</span>
                            </span>
                          )}
                          {prog.duration && (
                            <span className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              <span className="truncate">{prog.duration}</span>
                            </span>
                          )}
                          {prog.intakes && (
                            <span className="flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                              <span className="truncate">{prog.intakes}</span>
                            </span>
                          )}
                          {effectiveFee ? (
                            <span className="flex items-center gap-1.5">
                              <DollarSign className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              <span className="truncate">
                                {hasDiscount && (
                                  <span className="line-through text-muted-foreground/50 mr-1 text-xs">
                                    {formatFee(prog.tuitionFee, prog.currency)}
                                  </span>
                                )}
                                {formatFee(effectiveFee, prog.currency)}
                              </span>
                            </span>
                          ) : null}
                        </div>

                        {prog.scholarship && prog.scholarship > 0 ? (
                          <div className="mb-4">
                            <Badge variant="outline" className="text-xs border-green-500/30 text-green-600 bg-green-50 dark:bg-green-950/30">
                              Scholarship: {formatFee(prog.scholarship, prog.currency)}
                            </Badge>
                          </div>
                        ) : null}

                        <div className="mt-auto">
                          <Button asChild className="w-full rounded-xl" variant="outline">
                            <a href="/contact">Inquire Now</a>
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-10">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="rounded-full">
                    <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                    className="rounded-full">
                    Next <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

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
