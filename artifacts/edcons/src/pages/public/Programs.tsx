import { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useJsonLd, SITE_URL, SITE_NAME } from "@/hooks/use-json-ld";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PublicProgramFilters } from "./PublicProgramFilters";
import { PublicProgramCard } from "./PublicProgramCard";
import { customFetch } from "@workspace/api-client-react";
import {
  Search, MapPin, BookOpen, GraduationCap, Globe2, Clock, DollarSign, Users,
  Languages, ChevronLeft, ChevronRight, X,
  SlidersHorizontal, Building2, Award,
} from "lucide-react";

const PublicProgramDetailDialog = lazy(() => import("./PublicProgramDetailDialog")
  .then(module => ({ default: module.PublicProgramDetailDialog })));
const PublicProgramApplicationDialog = lazy(() => import("./PublicProgramApplicationDialog"));

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface Program {
  id: number;
  name: string;
  description: string | null;
  degree: string | null;
  field: string | null;
  language: string | null;
  duration: string | null;
  tuitionFee: number | null;
  currency: string | null;
  discountedFee: number | null;
  scholarship: number | null;
  intakes: string | null;
  requirements: string | null;
  applicationFee: number | null;
  advancedFee: number | null;
  depositFee: number | null;
  languageFee: number | null;
  feeType: string | null;
  universityName: string;
  universityCountry: string | null;
  universityType: string | null;
  universityCity: string | null;
  universityLogoUrl: string | null;
  universityWebsite: string | null;
  universityDescription: string | null;
  universityRanking: string | null;
  universityQsRanking: string | null;
  universityTimesRanking: string | null;
  universityAddress: string | null;
  canonicalPath: string;
  universityPath: string;
}

interface Filters {
  countries: string[];
  cities: string[];
  universityTypes: string[];
  universities: { id: number; name: string }[];
  degrees: string[];
  languages: string[];
  fields: string[];
  feeRange: { min: number; max: number } | null;
}

function initialQueryValues(key: string): string[] {
  if (typeof window === "undefined") return [];
  return (new URLSearchParams(window.location.search).get(key) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export default function Programs() {
  const { t, lang, localePath } = useI18n();
  useSeo({ title: t("seo.programsTitle"), description: t("seo.programsDesc"), lang });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [country, setCountry] = useState<string[]>(() => initialQueryValues("country"));
  const [city, setCity] = useState<string[]>(() => initialQueryValues("city"));
  const [universityType, setUniversityType] = useState<string[]>(() => initialQueryValues("universityType"));
  const [universityId, setUniversityId] = useState<string[]>(() => initialQueryValues("universityId"));
  const [level, setLevel] = useState<string[]>(() => initialQueryValues("level"));
  const [language, setLanguage] = useState<string[]>(() => initialQueryValues("language"));
  const [field, setField] = useState<string[]>(() => initialQueryValues("field"));
  const [feeMin, setFeeMin] = useState("");
  const [feeMax, setFeeMax] = useState("");
  const [programs, setPrograms] = useState<Program[]>([]);

  useJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${SITE_URL}/en/programs#webpage`,
      name: `Study Programs — ${SITE_NAME}`,
      url: `${SITE_URL}/en/programs`,
      description: "Browse thousands of undergraduate and postgraduate study programs at universities worldwide.",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Programs", item: `${SITE_URL}/en/programs` },
        ],
      },
    },
    ...(programs.length > 0
      ? [
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "@id": `${SITE_URL}/en/programs#itemlist`,
            name: "Study Programs",
            url: `${SITE_URL}/en/programs`,
            numberOfItems: programs.length,
            itemListElement: programs.slice(0, 20).map((p, i) => ({
              "@type": "ListItem",
              position: i + 1,
              item: {
                "@type": "Course",
                "@id": `${SITE_URL}${p.canonicalPath}`,
                name: p.name,
                description: [p.field, p.degree, p.duration].filter(Boolean).join(" · ") || undefined,
                provider: {
                  "@type": "CollegeOrUniversity",
                  name: p.universityName,
                  ...(p.universityCountry ? { address: { "@type": "PostalAddress", addressCountry: p.universityCountry } } : {}),
                },
                ...(p.language ? { inLanguage: p.language } : {}),
                ...(p.duration ? { timeRequired: p.duration } : {}),
                ...(p.tuitionFee != null
                  ? {
                      offers: {
                        "@type": "Offer",
                        price: p.discountedFee ?? p.tuitionFee,
                        priceCurrency: p.currency || "USD",
                      },
                    }
                  : {}),
              },
            })),
          },
        ]
      : []),
  ]);

  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({ countries: [], cities: [], universityTypes: [], universities: [], degrees: [], languages: [], fields: [], feeRange: null });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [applyProgram, setApplyProgram] = useState<Program | null>(null);
  const [detailProgram, setDetailProgram] = useState<Program | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const debouncedFeeMin = useDebounce(feeMin, 500);
  const debouncedFeeMax = useDebounce(feeMax, 500);

  // Cascading facets — re-fetch /filters whenever a selection changes so each
  // dropdown reflects only options compatible with the user's other choices
  // (e.g. picking Country=Turkey narrows the City and University lists).
  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("scope", "public");
    if (debouncedSearch) p.set("search", debouncedSearch);
    if (country.length) p.set("country", country.join(","));
    if (city.length) p.set("city", city.join(","));
    if (universityType.length) p.set("universityType", universityType.join(","));
    if (universityId.length) p.set("universityId", universityId.join(","));
    if (level.length) p.set("level", level.join(","));
    if (language.length) p.set("language", language.join(","));
    if (field.length) p.set("field", field.join(","));
    if (debouncedFeeMin) p.set("feeMin", debouncedFeeMin);
    if (debouncedFeeMax) p.set("feeMax", debouncedFeeMax);
    return p.toString();
  }, [debouncedSearch, country, city, universityType, universityId, level, language, field, debouncedFeeMin, debouncedFeeMax]);

  useEffect(() => {
    customFetch<Filters>(`/api/course-finder/filters${filterParams ? `?${filterParams}` : ""}`, { method: "GET" })
      .then(data => setFilters(data))
      .catch(() => {});
  }, [filterParams]);

  // Auto-prune selections that the new option list no longer contains, so a
  // stale pick (e.g. City=Istanbul after switching Country to Germany) does
  // not silently filter all results to zero. We must NOT short-circuit on
  // empty option arrays — that's exactly when stale selections are most
  // dangerous. `feeRange` is null only in the pre-fetch initial state, so
  // we use it as a loaded-flag instead.
  useEffect(() => {
    if (filters.feeRange === null) return;
    const validCity = new Set(filters.cities);
    const validType = new Set(filters.universityTypes);
    const validUni = new Set(filters.universities.map(u => String(u.id)));
    const validLevel = new Set(filters.degrees.map(d => d.toLowerCase()));
    const validLang = new Set(filters.languages.map(l => l.toLowerCase()));
    const validField = new Set(filters.fields.map(f => f.toLowerCase()));
    const validCountry = new Set(filters.countries);
    setCountry(prev => { const n = prev.filter(v => validCountry.has(v)); return n.length === prev.length ? prev : n; });
    setCity(prev => { const n = prev.filter(v => validCity.has(v)); return n.length === prev.length ? prev : n; });
    setUniversityType(prev => { const n = prev.filter(v => validType.has(v)); return n.length === prev.length ? prev : n; });
    setUniversityId(prev => { const n = prev.filter(v => validUni.has(v)); return n.length === prev.length ? prev : n; });
    setLevel(prev => { const n = prev.filter(v => validLevel.has(v.toLowerCase())); return n.length === prev.length ? prev : n; });
    setLanguage(prev => { const n = prev.filter(v => validLang.has(v.toLowerCase())); return n.length === prev.length ? prev : n; });
    setField(prev => { const n = prev.filter(v => validField.has(v.toLowerCase())); return n.length === prev.length ? prev : n; });
  }, [filters]);

  const fetchPrograms = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "24" });
      params.set("scope", "public");
      params.set("locale", lang);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (country.length) params.set("country", country.join(","));
      if (city.length) params.set("city", city.join(","));
      if (universityType.length) params.set("universityType", universityType.join(","));
      if (universityId.length) params.set("universityId", universityId.join(","));
      if (level.length) params.set("level", level.join(","));
      if (language.length) params.set("language", language.join(","));
      if (field.length) params.set("field", field.join(","));
      const requestedProgramId = initialQueryValues("programId")[0];
      if (requestedProgramId && /^\d{1,10}$/.test(requestedProgramId)) {
        params.set("programId", requestedProgramId);
      }
      if (debouncedFeeMin) params.set("feeMin", debouncedFeeMin);
      if (debouncedFeeMax) params.set("feeMax", debouncedFeeMax);

      const resp = await customFetch<{ data: Program[]; meta: { total: number; page: number; totalPages: number } }>(
        `/api/course-finder?${params.toString()}`,
        { method: "GET" }
      );
      setPrograms(resp.data || []);
      if (requestedProgramId && resp.data?.length === 1) {
        setApplyProgram((current) => current || resp.data[0]);
      }
      setTotal(resp.meta?.total || 0);
      setTotalPages(resp.meta?.totalPages || 1);
    } catch {
      setPrograms([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, debouncedSearch, country, city, universityType, universityId, level, language, field, debouncedFeeMin, debouncedFeeMax, lang]);

  useEffect(() => { fetchPrograms(); }, [fetchPrograms]);
  useEffect(() => { setPage(1); }, [debouncedSearch, country, city, universityType, universityId, level, language, field, debouncedFeeMin, debouncedFeeMax]);

  function clearAllFilters() {
    setCountry([]);
    setCity([]);
    setUniversityType([]);
    setUniversityId([]);
    setLevel([]);
    setLanguage([]);
    setField([]);
    setFeeMin("");
    setFeeMax("");
    setSearch("");
  }

  const pageNumbers = (() => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  })();

  return (
    <>
      <section className="pt-24 pb-6 bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/[0.07] via-transparent to-transparent" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div>
            <div className="text-center mb-10">
              <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-2 rounded-full mb-6 border border-primary/20">
                <GraduationCap className="w-4 h-4" /> {t("programs.badge")}
              </span>
              <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
                {t("programs.title")} <span className="text-primary">{t("programs.titleHighlight")}</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {t("programs.subtitle")}
              </p>
            </div>
          </div>

          <div>
            <div className="-mb-8">
              <PublicProgramFilters
                filters={filters}
                selection={{ country, city, universityType, universityId, level, language, field, feeMin, feeMax }}
                onSelect={(key, values) => ({ country: setCountry, city: setCity, universityType: setUniversityType, universityId: setUniversityId, level: setLevel, language: setLanguage, field: setField })[key](values)}
                onFeeChange={(key, value) => key === "feeMin" ? setFeeMin(value) : setFeeMax(value)}
                search={search} onSearchChange={setSearch} onClear={clearAllFilters} total={total}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="pt-2 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div
            className="flex items-center justify-between mb-8 bg-card/60 backdrop-blur-sm rounded-2xl px-6 py-4 border border-border/30 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-primary" />
              </div>
              <p className="text-muted-foreground">
                {t("programs.showingResults", { count: String(total) })}
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="rounded-2xl overflow-hidden border border-border/30 bg-card">
                  <div className="h-20 bg-gradient-to-r from-secondary via-secondary/50 to-secondary animate-pulse relative overflow-hidden">
                    <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                  </div>
                  <div className="p-5 space-y-3">
                    <div className="h-5 bg-secondary rounded-lg w-4/5 animate-pulse" />
                    <div className="h-4 bg-secondary rounded-lg w-3/5 animate-pulse" />
                    <div className="grid grid-cols-2 gap-2 mt-4">
                      <div className="h-4 bg-secondary rounded-lg animate-pulse" />
                      <div className="h-4 bg-secondary rounded-lg animate-pulse" />
                    </div>
                    <div className="h-10 bg-secondary rounded-xl mt-4 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : programs.length === 0 ? (
            <div
              className="text-center py-24 bg-gradient-to-br from-primary/[0.03] via-accent/[0.03] to-primary/[0.03] rounded-3xl border border-border/30">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Globe2 className="w-10 h-10 text-primary/40" />
              </div>
              <h3 className="text-xl font-bold font-display text-foreground mb-2">{t("programs.noResults")}</h3>
              <p className="text-muted-foreground mb-6">{t("programs.noResultsDesc")}</p>
              <Button variant="outline" onClick={clearAllFilters} className="rounded-full px-6">
                <X className="w-4 h-4 mr-2" /> {t("programs.clearFilters")}
              </Button>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {programs.map((prog, i) => <PublicProgramCard key={prog.id} program={prog} index={i} onDetails={() => setDetailProgram(prog)} onApply={() => setApplyProgram(prog)} />)}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1.5 mt-12">
                  <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-full w-10 h-10" aria-label={t("programs.prevPage")}>
                    <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  </Button>
                  {pageNumbers.map((p, idx) => (
                    p === "..." ? (
                      <span key={`dots-${idx}`} className="px-2 text-muted-foreground" aria-hidden="true">...</span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPage(p as number)}
                        aria-label={t("programs.goToPage", { page: String(p) })}
                        aria-current={page === p ? "page" : undefined}
                        className={`w-10 h-10 rounded-full text-sm font-semibold transition-all duration-200 ${
                          page === p
                            ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                        }`}>
                        {p}
                      </button>
                    )
                  ))}
                  <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="rounded-full w-10 h-10" aria-label={t("programs.nextPage")}>
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="py-16 bg-gradient-to-r from-primary to-accent text-white mx-4 sm:mx-8 rounded-3xl mb-12 overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_rgba(255,255,255,0.1),transparent_60%)]" />
        <div className="max-w-3xl mx-auto px-8 text-center relative z-10">
          <h2 className="text-3xl font-display font-bold mb-4">{t("programs.cantFind")}</h2>
          <p className="text-white/80 mb-8">{t("programs.cantFindDesc")}</p>
          <Button asChild size="lg" variant="secondary" className="rounded-full px-8 text-primary font-bold shadow-xl shadow-black/10 hover:-translate-y-1 transition-all duration-300">
            <Link href={localePath("/contact")}>{t("programs.talkToAdvisor")}</Link>
          </Button>
        </div>
      </section>

      {applyProgram ? (
        <Suspense fallback={null}>
          <PublicProgramApplicationDialog
            open
            onClose={() => setApplyProgram(null)}
            program={applyProgram}
            countries={filters.countries}
          />
        </Suspense>
      ) : null}
      {detailProgram ? (
        <Suspense fallback={null}>
          <PublicProgramDetailDialog open onClose={() => setDetailProgram(null)} program={detailProgram} />
        </Suspense>
      ) : null}
    </>
  );
}
