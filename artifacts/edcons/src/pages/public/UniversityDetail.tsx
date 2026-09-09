import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, ExternalLink, GraduationCap, MapPin } from "lucide-react";

type UniversityPayload = {
  data: {
    id: number;
    name: string;
    country: string;
    city: string | null;
    website: string | null;
    description: string | null;
    ranking: number | null;
    universityType: string | null;
    qsRanking: number | null;
    timesRanking: number | null;
    shanghaiRanking: number | null;
    cwtsLeidenRanking: number | null;
    address: string | null;
    logoUrl: string | null;
    canonicalPath: string;
  };
  programs: Array<{
    id: number;
    name: string;
    degree: string | null;
    field: string | null;
    language: string | null;
    duration: string | null;
    tuitionFee: number | null;
    discountedFee: number | null;
    scholarship: number | null;
    currency: string | null;
    canonicalPath: string;
  }>;
  meta: {
    programCount: number;
    canonicalPath: string;
    requestedPathIsCanonical: boolean;
    indexable: boolean;
    alternatePaths: Record<string, string>;
    programLinkPolicy: "PUBLISHED_INDEXABLE_ONLY" | "LEGACY_UNGATED";
  };
};

function money(value: number | null, currency: string | null, locale: string) {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency || "USD"}`;
  }
}

export default function UniversityDetail({ routeKey }: { routeKey: string }) {
  const { t, lang, localePath } = useI18n();
  const [, setLocation] = useLocation();
  const [payload, setPayload] = useState<UniversityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const university = payload?.data;

  useSeo({
    title: university?.name || t("countryDetail.universities"),
    description: university?.description || [university?.city, university?.country].filter(Boolean).join(", ") || t("programs.subtitle"),
    canonical: university ? `${SITE_URL}${university.canonicalPath}` : undefined,
    noindex: error || !payload?.meta.indexable,
    lang,
    alternates: payload?.meta.alternatePaths,
  });
  useJsonLd(university ? [
    {
      "@context": "https://schema.org",
      "@type": "CollegeOrUniversity",
      "@id": `${SITE_URL}${university.canonicalPath}#institution`,
      name: university.name,
      description: university.description || undefined,
      url: `${SITE_URL}${university.canonicalPath}`,
      logo: university.logoUrl ? `${SITE_URL}${university.logoUrl}` : undefined,
      address: {
        "@type": "PostalAddress",
        streetAddress: university.address || undefined,
        addressLocality: university.city || undefined,
        addressCountry: university.country,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: t("nav.countries"), item: `${SITE_URL}${localePath("/countries")}` },
        { "@type": "ListItem", position: 3, name: university.name, item: `${SITE_URL}${university.canonicalPath}` },
      ],
    },
  ] : []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    customFetch<UniversityPayload>(
      `/api/public/catalog/universities/${encodeURIComponent(routeKey)}?locale=${encodeURIComponent(lang)}`,
      { method: "GET" },
    )
      .then((result) => {
        if (cancelled) return;
        setPayload(result);
        if (!result.meta.requestedPathIsCanonical) {
          setLocation(result.meta.canonicalPath, { replace: true });
        }
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lang, routeKey, setLocation]);

  if (loading) {
    return <div className="mx-auto max-w-7xl px-4 py-24"><div className="h-64 animate-pulse rounded-3xl bg-secondary" /><div className="mt-8 h-96 animate-pulse rounded-3xl bg-secondary" /></div>;
  }
  if (error || !university || !payload) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-32 text-center">
        <Building2 className="mx-auto mb-5 h-14 w-14 text-muted-foreground/40" />
        <h1 className="text-2xl font-bold">{t("countryDetail.notFound")}</h1>
        <Button asChild variant="outline" className="mt-7 rounded-full"><Link href={localePath("/countries")}><ArrowLeft className="mr-2 h-4 w-4" />{t("countryDetail.backToDestinations")}</Link></Button>
      </div>
    );
  }

  const rankings = [
    ["QS", university.qsRanking],
    ["Times", university.timesRanking],
    ["Shanghai", university.shanghaiRanking],
    ["CWTS Leiden", university.cwtsLeidenRanking],
  ].filter((entry) => entry[1] !== null);

  return (
    <>
      <section className="border-b border-border/40 bg-gradient-to-br from-primary/10 via-background to-accent/10 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Link href={localePath("/countries")} className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" />{t("countryDetail.allDestinations")}</Link>
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
              {university.logoUrl ? <img src={university.logoUrl} alt={university.name} className="h-full w-full object-contain p-2" /> : <Building2 className="h-11 w-11 text-primary" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-wrap gap-2">{university.universityType && <Badge>{university.universityType}</Badge>}<Badge variant="outline">{payload.meta.programCount} {t("countryDetail.programs")}</Badge></div>
              <h1 className="font-display text-3xl font-bold md:text-5xl">{university.name}</h1>
              <p className="mt-3 flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" />{[university.city, university.country].filter(Boolean).join(", ")}</p>
            </div>
            {university.website && <Button asChild variant="outline" className="rounded-full"><a href={university.website} target="_blank" rel="noopener noreferrer">{t("programs.visitUniversity")}<ExternalLink className="ml-2 h-4 w-4" /></a></Button>}
          </div>
        </div>
      </section>

      <nav className="sticky top-0 z-20 border-b border-border/60 bg-background/95 backdrop-blur" aria-label={university.name}>
        <div className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-4 py-3 text-sm font-semibold [scrollbar-width:none] sm:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden">
          <a href="#overview" className="whitespace-nowrap text-muted-foreground hover:text-primary">{t("countryDetail.about", { name: university.name })}</a>
          <a href="#facts" className="whitespace-nowrap text-muted-foreground hover:text-primary">{t("countryDetail.quickFacts")}</a>
          <a href="#programs" className="whitespace-nowrap text-muted-foreground hover:text-primary">{t("catalogDetail.availablePrograms")}</a>
        </div>
      </nav>

      <section id="overview" className="scroll-mt-20 py-12">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-3 lg:px-8">
          <article className="rounded-2xl border border-border/50 bg-card p-6 md:p-8 lg:col-span-2">
            <h2 className="text-2xl font-bold">{t("countryDetail.about", { name: university.name })}</h2>
            <p className="mt-4 whitespace-pre-line leading-7 text-muted-foreground">{university.description || t("countryDetail.exploreOpportunities")}</p>
            <dl className="mt-8 grid gap-4 border-t border-border/60 pt-6 sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("countryDetail.programs")}</dt><dd className="mt-2 text-2xl font-extrabold">{payload.meta.programCount}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("catalogDetail.location")}</dt><dd className="mt-2 font-bold">{[university.city, university.country].filter(Boolean).join(", ")}</dd></div>
              {university.universityType ? <div><dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("common.type")}</dt><dd className="mt-2 font-bold">{university.universityType}</dd></div> : null}
            </dl>
          </article>
          <aside id="facts" className="scroll-mt-24 rounded-2xl border border-border/50 bg-card p-6 lg:sticky lg:top-24 lg:self-start">
            <h2 className="font-bold">{t("countryDetail.quickFacts")}</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div><dt className="text-muted-foreground">{t("catalogDetail.location")}</dt><dd className="font-semibold">{university.address || [university.city, university.country].filter(Boolean).join(", ")}</dd></div>
              {rankings.map(([label, value]) => <div key={String(label)}><dt className="text-muted-foreground">{String(label)}</dt><dd className="font-semibold">#{String(value)}</dd></div>)}
            </dl>
          </aside>
        </div>
      </section>

      <section id="programs" className="scroll-mt-24 bg-secondary/30 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><p className="text-sm font-semibold text-primary">{university.name}</p><h2 className="mt-1 text-2xl font-bold">{t("catalogDetail.availablePrograms")}</h2></div>
            <Button asChild variant="outline" className="rounded-full"><Link href={`${localePath("/programs")}?universityId=${university.id}`}>{payload.meta.programCount} {t("countryDetail.programs")}</Link></Button>
          </div>
          {payload.programs.length > 0 ? (
            <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {payload.programs.map((program) => (
                <Link key={program.id} href={program.canonicalPath} className="group rounded-2xl border border-border/50 bg-card p-5 transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
                  <div className="flex items-start justify-between gap-3"><GraduationCap className="h-6 w-6 shrink-0 text-primary" />{program.degree && <Badge variant="secondary">{program.degree}</Badge>}</div>
                  <h3 className="mt-4 line-clamp-2 font-bold group-hover:text-primary">{program.name}</h3>
                  <p className="mt-3 text-sm text-muted-foreground">{[program.field, program.duration, program.language].filter(Boolean).join(" · ")}</p>
                  <p className="mt-5 font-extrabold">{money(program.discountedFee ?? program.tuitionFee, program.currency, lang)}</p>
                </Link>
              ))}
            </div>
          ) : <p className="mt-7 text-muted-foreground">{t("programs.noResults")}</p>}
        </div>
      </section>
    </>
  );
}
