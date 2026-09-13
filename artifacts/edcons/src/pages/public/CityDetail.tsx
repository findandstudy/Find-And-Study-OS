import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { ArrowLeft, Building2, GraduationCap, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { useSeo } from "@/hooks/use-seo";

type CityPayload = {
  data: {
    id: number;
    name: string;
    country: string;
    countryCode: string;
    description: string | null;
    universityCount: number;
    programCount: number;
    universities: Array<{
      id: number;
      name: string;
      universityType: string | null;
      canonicalPath: string;
    }>;
    programs: Array<{
      id: number;
      name: string;
      universityName: string;
      degree: string | null;
      field: string | null;
      canonicalPath: string;
    }>;
  };
  meta: {
    title: string;
    description: string;
    indexable: boolean;
    canonicalPath: string;
    alternatePaths: Record<string, string>;
    requestedPathIsCanonical: boolean;
  };
};

export default function CityDetail({ routeKey }: { routeKey: string }) {
  const { t, lang, localePath } = useI18n();
  const [, setLocation] = useLocation();
  const [payload, setPayload] = useState<CityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const city = payload?.data;

  useSeo({
    title: payload?.meta.title || t("countryDetail.studyDestination"),
    description: payload?.meta.description || t("countryDetail.exploreOpportunities"),
    canonical: payload ? `${SITE_URL}${payload.meta.canonicalPath}` : undefined,
    noindex: error || !payload?.meta.indexable,
    lang,
    alternates: payload?.meta.alternatePaths,
  });
  useJsonLd(city && payload ? [
    {
      "@context": "https://schema.org",
      "@type": "City",
      "@id": `${SITE_URL}${payload.meta.canonicalPath}#city`,
      name: city.name,
      description: payload.meta.description,
      url: `${SITE_URL}${payload.meta.canonicalPath}`,
      containedInPlace: { "@type": "Country", name: city.country },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: t("nav.countries"), item: `${SITE_URL}${localePath("/countries")}` },
        { "@type": "ListItem", position: 3, name: city.name, item: `${SITE_URL}${payload.meta.canonicalPath}` },
      ],
    },
  ] : []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    customFetch<CityPayload>(
      `/api/public/web/cities/${encodeURIComponent(routeKey)}?locale=${encodeURIComponent(lang)}`,
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
  if (error || !city || !payload) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-32 text-center">
        <MapPin className="mx-auto mb-5 h-14 w-14 text-muted-foreground/40" />
        <h1 className="text-2xl font-bold">{t("countryDetail.notFound")}</h1>
        <Button asChild variant="outline" className="mt-7 rounded-full"><Link href={localePath("/countries")}><ArrowLeft className="mr-2 h-4 w-4" />{t("countryDetail.backToDestinations")}</Link></Button>
      </div>
    );
  }

  return (
    <>
      <section className="border-b border-border/40 bg-gradient-to-br from-primary/10 via-background to-accent/10 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Link href={localePath("/countries")} className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" />{t("countryDetail.allDestinations")}</Link>
          <div className="flex items-center gap-5">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-primary/10"><MapPin className="h-9 w-9 text-primary" /></div>
            <div>
              <p className="font-semibold text-primary">{city.country}</p>
              <h1 className="mt-2 font-display text-3xl font-bold md:text-5xl">{city.name}</h1>
              <div className="mt-4 flex flex-wrap gap-2"><Badge variant="outline">{city.universityCount} {t("countryDetail.universities")}</Badge><Badge variant="outline">{city.programCount} {t("countryDetail.programs")}</Badge></div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <article className="max-w-3xl rounded-2xl border border-border/50 bg-card p-6 md:p-8">
            <h2 className="text-2xl font-bold">{t("countryDetail.about", { name: city.name })}</h2>
            <p className="mt-4 whitespace-pre-line leading-7 text-muted-foreground">{city.description || payload.meta.description}</p>
          </article>
        </div>
      </section>

      {city.universities.length > 0 && (
        <section className="bg-secondary/30 py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold">{t("countryDetail.universitiesIn", { name: city.name })}</h2>
            <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {city.universities.map((university) => (
                <Link key={university.id} href={university.canonicalPath} className="group rounded-2xl border border-border/50 bg-card p-5 transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
                  <Building2 className="h-7 w-7 text-primary" />
                  <h3 className="mt-4 font-bold group-hover:text-primary">{university.name}</h3>
                  {university.universityType && <p className="mt-2 text-sm text-muted-foreground">{university.universityType}</p>}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {city.programs.length > 0 && (
        <section className="py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4"><h2 className="text-2xl font-bold">{t("catalogDetail.availablePrograms")}</h2><Button asChild variant="outline" className="rounded-full"><Link href={`${localePath("/programs")}?country=${encodeURIComponent(city.country)}&city=${encodeURIComponent(city.name)}`}>{t("countryDetail.viewAllPrograms")}</Link></Button></div>
            <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {city.programs.map((program) => (
                <Link key={program.id} href={program.canonicalPath} className="group rounded-2xl border border-border/50 bg-card p-5 transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
                  <GraduationCap className="h-7 w-7 text-primary" />
                  <p className="mt-4 text-sm text-primary">{program.universityName}</p>
                  <h3 className="mt-2 font-bold group-hover:text-primary">{program.name}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{[program.degree, program.field].filter(Boolean).join(" · ")}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
