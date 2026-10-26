import { DetailLayout } from "./DetailLayout";
import { lazy, Suspense, useState, useEffect, useContext } from "react";
import { DetailPreviewContext } from "./DetailPreviewContext";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useJsonLd, SITE_URL, SITE_NAME } from "@/hooks/use-json-ld";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { DetailBreadcrumbs, DetailCard, DetailHeading, DetailImage } from "./DetailEditorial";
import { boundDetailContent, detailContentAddon, detailContentIntro, detailContentNavigation, detailContentSections, detailContentTitle, DetailHeroMedia, detailHeroSection, detailHeroStyle } from "./DetailContentSections";
import { catalogueCount, detailCopy, detailCountLabel } from "./detailPresentation";

import { Button } from "@/components/ui/button";
import type { Language } from "@/lib/i18n";
import { detailContentPresentationOverrides, resolveDetailTemplateContent } from "@/lib/website/detailContentContract";
import { detailTemplateVariableValues } from "./detailTemplateVariables";
import { Globe2, ArrowLeft, ArrowUpRight, Building2, GraduationCap, MapPin } from "lucide-react";
import { DeferredBelowFold } from "./DeferredBelowFold";

const DetailProgramBrowser = lazy(() => import("./UniversityProgramBrowser").then(module => ({ default: module.DetailProgramBrowser })));

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Destination {
  id: number | null;
  source?: "catalog" | "destination";
  catalogCountryId?: number;
  name: string;
  slug: string;
  country: string;
  filterCountry?: string;
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
  const preview = useContext(DetailPreviewContext);
  const { t, lang, localePath } = useI18n();
  const [fetchedData, setData] = useState<{
    editorial?: unknown;
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
  const data = preview ? preview.payload as NonNullable<typeof fetchedData> : fetchedData;
  const [isLoading, setIsLoading] = useState(!preview);
  const [error, setError] = useState(false);
  const editorial = resolveDetailTemplateContent(boundDetailContent(data?.editorial, "destination", data?.destination.catalogCountryId, lang), detailTemplateVariableValues("destination", data, lang));

  useSeo({
    title: editorial?.seo?.title || (data ? t("countryDetail.studyIn", { name: data.destination.name }) : t("countryDetail.studyDestination")),
    description: editorial?.seo?.description || data?.destination.shortDescription || t("countryDetail.exploreOpportunities"),
    ogTitle: editorial?.seo?.ogTitle,
    ogDescription: editorial?.seo?.ogDescription,
    twitterTitle: editorial?.seo?.twitterTitle,
    twitterDescription: editorial?.seo?.twitterDescription,
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
            description: editorial?.seo?.description || data.destination.shortDescription || undefined,
            url: `${SITE_URL}${data.meta.canonicalPath}`,
            touristType: { "@type": "Audience", audienceType: "International Students" },
          },
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "@id": `${SITE_URL}${data.meta.canonicalPath}#webpage`,
            name: editorial?.seo?.title || `Study in ${data.destination.name} — ${SITE_NAME}`,
            url: `${SITE_URL}${data.meta.canonicalPath}`,
            description: editorial?.seo?.description || data.destination.shortDescription || undefined,
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
    if (preview) return;
    const controller = new AbortController();
    setIsLoading(true);
    setError(false);
    customFetch<any>(`/api/public/destinations/${encodeURIComponent(slug)}?locale=${encodeURIComponent(lang)}`, { method: "GET", signal: controller.signal })
      .then(d => setData(d))
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
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
  const overviewDescription = dest.description?.trim() || dest.shortDescription?.trim();
  const overviewImage = fixStorageUrl(dest.heroImageUrl);
  const hasOverviewImage = !!overviewImage && /^(?:https?:\/\/|\/(?!\/))/.test(overviewImage);
  const hasOverview = !!overviewDescription || whyPoints.length > 0 || hasOverviewImage;
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
  const programsPath = localePath(`/programs?country=${encodeURIComponent(dest.filterCountry || dest.country)}`);
  const heroSection = detailHeroSection(editorial);
  const hero = heroSection?.hero;
  const universityCountLabel = detailCountLabel(hero?.universityCountLabel, copy.universityCount);
  const programCountLabel = detailCountLabel(hero?.programCountLabel, copy.programCount);
  const heroTitle = heroSection?.title || t("countryDetail.studyIn", { name: dest.name });
  const heroBody = heroSection?.body || dest.shortDescription || t("countryDetail.exploreOpportunities");
  const primaryCtaHref = hero?.primaryCtaHref || programsPath;
  const primaryCtaLabel = hero?.primaryCtaLabel || t("countryDetail.browsePrograms");
  const secondaryCtaHref = hero?.secondaryCtaHref || localePath("/contact");
  const secondaryCtaLabel = hero?.secondaryCtaLabel || t("countryDetail.talkToAdvisor");
  const hasEditorialOverview = detailContentTitle(editorial, "overview", "") !== "";
  return (
    <DetailLayout kind="destination" sectionOrder={editorial?.sectionOrder} sectionPresentation={detailContentPresentationOverrides(editorial)}>
      <section data-detail-section="hero">
        <div className="detail-hero is-destination detail-country-cover" style={detailHeroStyle(editorial)}>
          <DetailHeroMedia content={editorial} />
          <div className="detail-wrap detail-hero-top">
            <DetailBreadcrumbs label={copy.catalogue} items={[{ label: t("nav.countries"), path: localePath("/countries") }, { label: dest.name }]} />
          </div>
          <div className="detail-wrap detail-country-cover-inner">
            <div className="detail-country-cover-kicker"><span>{hero?.eyebrow || `${copy.destination} · 2026–27`}</span></div>
              <h1>{heroTitle}</h1>
            <div className="detail-country-cover-rule" />
            <p className="detail-country-cover-claim">
              <span><b>{stats.universityCount.toLocaleString(lang)}</b> {universityCountLabel}. <b>{stats.programCount.toLocaleString(lang)}</b> {programCountLabel}.</span>
              <span>{heroBody}</span>
            </p>
            <div className="detail-country-cover-foot">
              <span><Building2 size={18} aria-hidden="true" /><strong>{stats.universityCount.toLocaleString(lang)}</strong> {universityCountLabel}</span>
              <span><GraduationCap size={18} aria-hidden="true" /><strong>{stats.programCount.toLocaleString(lang)}</strong> {programCountLabel}</span>
              {cities.length > 0 && <a href="#cities"><MapPin size={17} aria-hidden="true" />{t("countryDetail.popularCities")}</a>}
              <Link href={primaryCtaHref}>{primaryCtaLabel}<ArrowUpRight size={17} aria-hidden="true" /></Link>
              <Link href={secondaryCtaHref}>{secondaryCtaLabel}<ArrowUpRight size={17} aria-hidden="true" /></Link>
            </div>
          </div>
        </div>
      </section>
      <nav data-detail-section="navigation" className="detail-nav" aria-label={detailContentTitle(editorial, "navigation", dest.name)}><div className="detail-wrap">
        {(hasOverview || hasEditorialOverview) && <a href="#overview">{copy.overview}</a>}
        {facts.length > 0 && <a href="#facts">{t("countryDetail.quickFacts")}</a>}
        {cities.length > 0 && <a href="#cities">{t("countryDetail.popularCities")}</a>}
        {stats.programCount > 0 && <a href="#programs">{t("countryDetail.programs")}</a>}
        {universities.length > 0 && <a href="#universities">{t("countryDetail.universities")}</a>}
        {detailContentNavigation(editorial ? { ...editorial, sections: editorial.sections.filter(section => section.key !== "gallery"), templateSections: editorial.templateSections?.filter(section => section.key !== "gallery") } : null)}
        <a href="#cta">{copy.next}</a>
      </div></nav>
      {(hasOverview || hasEditorialOverview) && <section data-detail-section="overview" id="overview" className="detail-section">
        {hasEditorialOverview ? detailContentAddon(editorial, "overview", lang, localePath("/contact")) : <div className="detail-wrap">
            <DetailHeading number="01" eyebrow={copy.destination} title={t("countryDetail.about", { name: dest.name })} />
            <div className={overviewDescription && (whyPoints.length > 0 || hasOverviewImage) ? "detail-split" : "detail-overview-single"}>
              {overviewDescription && <p className="detail-prose detail-snapshot">{overviewDescription}</p>}
              {whyPoints.length > 0 ? <div>{hasOverviewImage && <DetailImage className="detail-destination-image" src={overviewImage} alt={dest.name} />}<p className="detail-eyebrow">{t("countryDetail.whyStudy", { name: dest.name })}</p><ul className="detail-program-points">{whyPoints.map((point, i) => <li key={i}>{point}</li>)}</ul></div> : hasOverviewImage && <DetailImage className="detail-destination-image" src={overviewImage} alt={dest.name} />}
            </div>
          </div>}
      </section>}
      {facts.length > 0 && <section data-detail-section="facts" id="facts" className="detail-section is-sky">
        <div className="detail-wrap detail-split">
          <DetailHeading number="02" eyebrow={copy.overview} title={detailContentTitle(editorial, "facts", t("countryDetail.quickFacts"))} />
          {detailContentIntro(editorial, "facts")}
          <dl className="detail-keylines">{facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
        </div>
      </section>}
      {cities.length > 0 && <section data-detail-section="cities" id="cities" className="detail-section is-sky">
        <div className="detail-wrap">
          <DetailHeading number="03" eyebrow={dest.name} title={detailContentTitle(editorial, "cities", t("countryDetail.popularCities"))} />
          {detailContentIntro(editorial, "cities")}
          <div className="detail-grid">{cities.map((city) => {
            const cityPath = city.canonicalPath;
            return cityPath ? <DetailCard key={city.name} href={cityPath} eyebrow={dest.name} title={city.name} kind="city" /> : <article key={city.name} className="detail-catalog-card"><MapPin aria-hidden="true" /><p className="detail-eyebrow">{dest.name}</p><h3>{city.name}</h3></article>;
          })}</div>
        </div>
      </section>}
      {universities.length > 0 && <section data-detail-section="universities" id="universities" className="detail-section is-sand">
        <div className="detail-wrap">
          <DetailHeading number="04" eyebrow={copy.studyOptions} title={detailContentTitle(editorial, "universities", t("countryDetail.universitiesIn", { name: dest.name }))} />
          {detailContentIntro(editorial, "universities")}
          <div className="detail-grid">{universities.map((uni) => <DetailCard key={uni.id} href={uni.canonicalPath} title={uni.name} eyebrow={uni.city || dest.name} kind="university" logoUrl={fixStorageUrl(uni.logoUrl)}>
            <p>{[uni.universityType, catalogueCount(uni.programCount, t("countryDetail.programs"))].filter(Boolean).join(" · ")}</p>
          </DetailCard>)}</div>
        </div>
      </section>}
      {stats.programCount > 0 && <section data-detail-section="programs" id="programs" className="detail-section">
        <div className="detail-wrap">
          <DetailHeading number="05" eyebrow={copy.studyOptions} title={detailContentTitle(editorial, "programs", t("catalogDetail.availablePrograms"))} />
          {detailContentIntro(editorial, "programs")}
          <DeferredBelowFold minHeight={520}><Suspense fallback={<div className="h-[32rem] animate-pulse rounded-3xl bg-secondary" />}><DetailProgramBrowser scope={{ kind: "country", country: dest.filterCountry || dest.country }} admissionsOpen previewPrograms={data.programs.map(program => ({ ...program, universityPath: "", universityCountry: dest.country }))} previewTotal={stats.programCount} /></Suspense></DeferredBelowFold>
          <div className="detail-actions"><Link href={programsPath}>{t("countryDetail.viewAllPrograms")} · {stats.programCount}<ArrowUpRight size={17} aria-hidden="true" /></Link></div>
        </div>
      </section>}
      {detailContentSections(editorial, lang, localePath("/contact"), ["hero", "overview"])}
      <section data-detail-section="cta" id="cta" className="detail-section is-dark">
        <div className="detail-wrap detail-cta">
          <div><p className="detail-eyebrow">{copy.next}</p><h2>{detailContentTitle(editorial, "cta", t("countryDetail.readyToStudy", { name: dest.name }))}</h2>{detailContentIntro(editorial, "cta")}</div>
          <div className="detail-actions">
            <Link href={programsPath}>{t("countryDetail.browsePrograms")}<ArrowUpRight size={17} aria-hidden="true" /></Link>
            <Link className="is-secondary" href={localePath("/contact")}>{t("countryDetail.talkToAdvisor")}</Link>
          </div>
        </div>
      </section>
    </DetailLayout>
  );
}
