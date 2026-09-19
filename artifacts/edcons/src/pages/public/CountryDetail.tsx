import { DetailLayout } from "./DetailLayout";
import { useState, useEffect } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useJsonLd, SITE_URL, SITE_NAME } from "@/hooks/use-json-ld";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { DetailArtwork, DetailBreadcrumbs, DetailCard, DetailHeading, DetailImage } from "./DetailEditorial";
import { catalogueCount, detailCopy } from "./detailPresentation";

import { Button } from "@/components/ui/button";
import { CountryFlag, countryCodeFromEmoji } from "@/components/CountryFlag";
import type { Language } from "@/lib/i18n";
import { Globe2, ArrowLeft, ArrowUpRight } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Destination {
  id: number | null;
  source?: "catalog" | "destination";
  catalogCountryId?: number;
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
  canonicalPath: string;
}

interface UniversityBrief {
  id: number;
  name: string;
  city: string | null;
  logoUrl: string | null;
  ranking: number | null;
  universityType: string | null;
  programCount?: number;
  canonicalPath: string;
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
  universityName: string;
  canonicalPath: string;
}

function fixStorageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let fixed = url.replace(/\/api\/storage\/objects\/objects\//, "/api/storage/objects/");
  if (!fixed.startsWith("http") && !fixed.startsWith(BASE_URL)) {
    fixed = `${BASE_URL}${fixed.startsWith("/") ? "" : "/"}${fixed}`;
  }
  return fixed;
}

export default function CountryDetail({ slug }: { slug: string }) {
  const { t, lang, localePath } = useI18n();
  const [data, setData] = useState<{
    destination: Destination;
    universities: UniversityBrief[];
    programs: ProgramBrief[];
    cities: Array<{ id: number; name: string; sourceName: string; canonicalPath: string }>;
    stats: { universityCount: number; programCount: number };
    meta: {
      locale: Language;
      indexable: boolean;
      canonicalPath: string;
      alternatePaths: Partial<Record<Language, string>>;
      internalLinkPolicy: "PUBLISHED_INDEXABLE_ONLY" | "LEGACY_UNGATED";
    };
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useSeo({
    title: data ? t("countryDetail.studyIn", { name: data.destination.name }) : t("countryDetail.studyDestination"),
    description: data?.destination.shortDescription || t("countryDetail.exploreOpportunities"),
    canonical: data ? `${SITE_URL}${data.meta.canonicalPath}` : undefined,
    noindex: !data?.meta.indexable,
    lang,
    alternates: data?.meta.alternatePaths,
  });
  useJsonLd(
    data
      ? [
          {
            "@context": "https://schema.org",
            "@type": "TouristDestination",
            "@id": `${SITE_URL}${data.meta.canonicalPath}#destination`,
            name: data.destination.name,
            description: data.destination.shortDescription || undefined,
            url: `${SITE_URL}${data.meta.canonicalPath}`,
            touristType: { "@type": "Audience", audienceType: "International Students" },
          },
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "@id": `${SITE_URL}${data.meta.canonicalPath}#webpage`,
            name: `Study in ${data.destination.name} — ${SITE_NAME}`,
            url: `${SITE_URL}${data.meta.canonicalPath}`,
            description: data.destination.shortDescription || undefined,
            isPartOf: { "@id": `${SITE_URL}/#website` },
            breadcrumb: {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
                { "@type": "ListItem", position: 2, name: "Countries", item: `${SITE_URL}/en/countries` },
                { "@type": "ListItem", position: 3, name: data.destination.name, item: `${SITE_URL}${data.meta.canonicalPath}` },
              ],
            },
          },
        ]
      : []
  );

  useEffect(() => {
    setIsLoading(true);
    setError(false);
    customFetch<any>(`/api/public/destinations/${slug}?locale=${encodeURIComponent(lang)}`, { method: "GET" })
      .then(d => setData(d))
      .catch(() => setError(true))
      .finally(() => setIsLoading(false));
  }, [slug, lang]);

  if (isLoading) {
    return (
      <div className="pt-24 pb-16 max-w-7xl mx-auto px-4">
        <div className="h-64 rounded-3xl bg-secondary animate-pulse mb-8" />
        <div className="h-8 w-64 bg-secondary animate-pulse rounded mb-4" />
        <div className="h-4 w-full max-w-xl bg-secondary animate-pulse rounded" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="pt-24 pb-16 text-center max-w-7xl mx-auto px-4">
        <Globe2 className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-foreground mb-2">{t("countryDetail.notFound")}</h2>
        <p className="text-muted-foreground mb-6">{t("countryDetail.notFoundDesc")}</p>
        <Button asChild variant="outline" className="rounded-full">
          <Link href={localePath("/countries")}><ArrowLeft className="w-4 h-4 mr-2" /> {t("countryDetail.backToDestinations")}</Link>
        </Button>
      </div>
    );
  }

  const { destination: dest, universities, stats } = data;
  const copy = detailCopy(lang);
  const whyPoints = dest.whyStudyHere?.split(/\.\s+/).filter(p => p.trim().length > 5) || [];
  const cityNames = dest.popularCities?.split(",").map(c => c.trim()).filter(Boolean) || [];
  const cityLinks = new Map(data.cities.flatMap((city) => [
    [city.name.toLocaleLowerCase("en-US"), city.canonicalPath] as const,
    [city.sourceName.toLocaleLowerCase("en-US"), city.canonicalPath] as const,
  ]));
  const cities = [...data.cities.map(city => ({ name: city.name, canonicalPath: city.canonicalPath })), ...cityNames
    .filter(name => !cityLinks.has(name.toLocaleLowerCase("en-US")))
    .map(name => ({ name, canonicalPath: null }))];
  const facts = [
    { label: t("countryDetail.language"), value: dest.language },
    { label: t("countryDetail.currency"), value: dest.currency },
    { label: t("countryDetail.livingCost"), value: dest.livingCost },
    { label: t("countryDetail.climate"), value: dest.climate },
    { label: t("countryDetail.visaInfo"), value: dest.visaInfo },
    { label: t("countryDetail.workPermit"), value: dest.workPermit },
  ].filter(fact => !!fact.value);
  const iso = (dest.country && dest.country.length === 2 ? dest.country : null) || (dest.flagEmoji ? countryCodeFromEmoji(dest.flagEmoji) : null);
  return (
    <DetailLayout kind="destination">
      <section data-detail-section="hero">
        <div className="detail-hero is-destination">
          {dest.heroImageUrl && <div className="detail-hero-backdrop"><DetailImage src={fixStorageUrl(dest.heroImageUrl)} alt="" /></div>}
          <div className="detail-wrap detail-hero-main is-wide">
            <div>
              <p className="detail-eyebrow">{copy.destination}</p>
              {iso && <CountryFlag code={iso} size="xl" alt={dest.name} />}
              <h1>{t("countryDetail.studyIn", { name: dest.name })}</h1>
              {dest.shortDescription && <p className="detail-hero-lead">{dest.shortDescription}</p>}
              <div className="detail-country-stats">
                <div><strong>{stats.universityCount}</strong><span>{copy.universityCount}</span></div>
                <div><strong>{stats.programCount}</strong><span>{copy.programCount}</span></div>
              </div>
            </div>
            <DetailArtwork />
          </div>
        </div>
        <div className="detail-wrap"><DetailBreadcrumbs label={copy.catalogue} items={[{ label: t("nav.countries"), path: localePath("/countries") }, { label: dest.name }]} /></div>
      </section>
      <nav data-detail-section="navigation" className="detail-nav" aria-label={dest.name}><div className="detail-wrap">
        <a href="#overview">{copy.overview}</a>
        {facts.length > 0 && <a href="#facts">{t("countryDetail.quickFacts")}</a>}
        {cities.length > 0 && <a href="#cities">{t("countryDetail.popularCities")}</a>}
        {universities.length > 0 && <a href="#universities">{t("countryDetail.universities")}</a>}
        <a href="#cta">{copy.next}</a>
      </div></nav>
      <section data-detail-section="overview" id="overview" className="detail-section">
        <div className="detail-wrap">
          <DetailHeading number="01" eyebrow={copy.destination} title={t("countryDetail.about", { name: dest.name })} />
          <div className="detail-split">
            <p className="detail-prose detail-snapshot">{dest.description || dest.shortDescription || t("countryDetail.exploreOpportunities")}</p>
            {whyPoints.length > 0 ? <div><p className="detail-eyebrow">{t("countryDetail.whyStudy", { name: dest.name })}</p><ul className="detail-program-points">{whyPoints.map((point, i) => <li key={i}>{point}</li>)}</ul></div> : <div className="detail-actions"><Link href={localePath(`/programs?country=${encodeURIComponent(dest.country)}`)}>{t("countryDetail.browsePrograms")}<ArrowUpRight size={17} aria-hidden="true" /></Link></div>}
          </div>
        </div>
      </section>
      {facts.length > 0 && <section data-detail-section="facts" id="facts" className="detail-section is-sky">
        <div className="detail-wrap detail-split">
          <DetailHeading number="02" eyebrow={copy.overview} title={t("countryDetail.quickFacts")} />
          <dl className="detail-keylines">{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
        </div>
      </section>}
      {cities.length > 0 && <section data-detail-section="cities" id="cities" className="detail-section is-dark">
        <div className="detail-wrap">
          <DetailHeading number="03" eyebrow={dest.name} title={t("countryDetail.popularCities")} />
          <div className="detail-grid">{cities.map((city, index) => {
            const cityPath = city.canonicalPath;
            return cityPath ? <DetailCard key={city.name} href={cityPath} eyebrow={dest.name} title={city.name} index={index} /> : <article key={city.name} className="detail-catalog-card"><p className="detail-eyebrow">{dest.name}</p><h3>{city.name}</h3></article>;
          })}</div>
        </div>
      </section>}
      {universities.length > 0 && <section data-detail-section="universities" id="universities" className="detail-section is-sand">
        <div className="detail-wrap">
          <DetailHeading number="04" eyebrow={copy.studyOptions} title={t("countryDetail.universitiesIn", { name: dest.name })} />
          <div className="detail-grid">{universities.map((uni, index) => <DetailCard key={uni.id} href={uni.canonicalPath} title={uni.name} eyebrow={uni.city || dest.name} index={index}>
            <p>{[uni.universityType, catalogueCount(uni.programCount, t("countryDetail.programs"))].filter(Boolean).join(" · ")}</p>
          </DetailCard>)}</div>
        </div>
      </section>}
      <section data-detail-section="cta" id="cta" className="detail-section is-dark">
        <div className="detail-wrap detail-cta">
          <div><p className="detail-eyebrow">{copy.next}</p><h2>{t("countryDetail.readyToStudy", { name: dest.name })}</h2></div>
          <div className="detail-actions">
            <Link href={localePath(`/programs?country=${encodeURIComponent(dest.country)}`)}>{t("countryDetail.browsePrograms")}<ArrowUpRight size={17} aria-hidden="true" /></Link>
            <Link className="is-secondary" href={localePath("/contact")}>{t("countryDetail.talkToAdvisor")}</Link>
          </div>
        </div>
      </section>
    </DetailLayout>
  );
}
