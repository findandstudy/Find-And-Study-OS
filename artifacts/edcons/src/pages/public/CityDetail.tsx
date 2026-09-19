import { DetailLayout } from "./DetailLayout";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { ArrowLeft, ArrowUpRight, MapPin } from "lucide-react";

import { DetailArtwork, DetailBreadcrumbs, DetailCard, DetailFacts, DetailHeading } from "./DetailEditorial";
import { detailCopy, localDetailPath } from "./detailPresentation";
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
    countryPath?: string | null;
    cityPath?: string | null;
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

  const copy = detailCopy(lang);
  const countryPath = localDetailPath(city.countryPath);
  const programsPath = `${localePath("/programs")}?country=${encodeURIComponent(city.country)}&city=${encodeURIComponent(city.name)}`;
  return (
    <DetailLayout kind="city">
      <section data-detail-section="hero">
        <div className="detail-hero is-destination">
          <div className="detail-wrap detail-hero-main is-wide">
            <div>
              <p className="detail-eyebrow">{copy.city}</p>
              {countryPath ? <Link className="detail-hero-link" href={countryPath}>{city.country}<ArrowUpRight size={17} aria-hidden="true" /></Link> : <p className="detail-hero-lead">{city.country}</p>}
              <h1>{city.name}</h1>
              <div className="detail-country-stats">
                <div><strong>{city.universityCount}</strong><span>{copy.universityCount}</span></div>
                <div><strong>{city.programCount}</strong><span>{copy.programCount}</span></div>
              </div>
              <div className="detail-actions"><Link href={programsPath}>{t("countryDetail.viewAllPrograms")}<ArrowUpRight size={17} aria-hidden="true" /></Link></div>
            </div>
            <DetailArtwork />
          </div>
        </div>
        <div className="detail-wrap"><DetailBreadcrumbs label={copy.catalogue} items={[{ label: t("nav.countries"), path: localePath("/countries") }, { label: city.country, path: countryPath }, { label: city.name }]} /></div>
      </section>
      <nav data-detail-section="navigation" className="detail-nav" aria-label={city.name}><div className="detail-wrap">
        <a href="#overview">{copy.overview}</a><a href="#facts">{t("countryDetail.quickFacts")}</a>
        {city.universities.length > 0 && <a href="#universities">{t("countryDetail.universities")}</a>}
        {city.programs.length > 0 && <a href="#programs">{t("countryDetail.programs")}</a>}
      </div></nav>
      <section data-detail-section="overview" id="overview" className="detail-section">
        <div className="detail-wrap detail-split">
          <DetailHeading number="01" eyebrow={copy.city} title={t("countryDetail.about", { name: city.name })} />
          <p className="detail-prose detail-snapshot">{city.description || payload.meta.description}</p>
        </div>
      </section>
      <section data-detail-section="facts" id="facts" className="detail-section is-sky">
        <div className="detail-wrap">
          <DetailHeading number="02" eyebrow={city.name} title={t("countryDetail.quickFacts")} />
          <DetailFacts items={[{ label: copy.country, value: countryPath ? <Link href={countryPath}>{city.country}</Link> : city.country }, { label: copy.universityCount, value: city.universityCount }, { label: copy.programCount, value: city.programCount }]} />
        </div>
      </section>
      {city.universities.length > 0 && <section data-detail-section="universities" id="universities" className="detail-section is-sand">
        <div className="detail-wrap">
          <DetailHeading number="03" eyebrow={copy.studyOptions} title={t("countryDetail.universitiesIn", { name: city.name })} />
          <div className="detail-grid">{city.universities.map((university, index) => <DetailCard key={university.id} href={university.canonicalPath} eyebrow={university.universityType} title={university.name} index={index} />)}</div>
        </div>
      </section>}
      {city.programs.length > 0 && <section data-detail-section="programs" id="programs" className="detail-section">
        <div className="detail-wrap">
          <DetailHeading number="04" eyebrow={copy.studyOptions} title={t("catalogDetail.availablePrograms")} />
          <div className="detail-grid">{city.programs.map((program, index) => <DetailCard key={program.id} href={program.canonicalPath} eyebrow={program.universityName} title={program.name} index={index}><p>{[program.degree, program.field].filter(Boolean).join(" · ")}</p></DetailCard>)}</div>
          <div className="detail-actions"><Link href={programsPath}>{t("countryDetail.viewAllPrograms")}<ArrowUpRight size={17} aria-hidden="true" /></Link></div>
        </div>
      </section>}
    </DetailLayout>
  );
}
