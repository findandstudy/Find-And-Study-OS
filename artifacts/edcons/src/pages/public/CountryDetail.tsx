import { DetailLayout } from "./DetailLayout";
import { lazy, Suspense, useContext } from "react";
import { DetailPreviewContext } from "./DetailPreviewContext";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useJsonLd, SITE_URL, SITE_NAME } from "@/hooks/use-json-ld";
import { Link } from "wouter";
import { DetailBreadcrumbs, DetailCard, DetailHeading, DetailImage } from "./DetailEditorial";
import { boundDetailContent, detailContentAddon, detailContentIntro, detailContentNavigation, detailContentSections, detailContentTitle, detailSectionKicker, DetailHeroMedia, detailHeroSection, detailHeroStyle } from "./DetailContentSections";
import { catalogueCount, detailCopy, localizedCountryName, localizedUniversityType } from "./detailPresentation";

import { Button } from "@/components/ui/button";
import type { Language } from "@/lib/i18n";
import { detailContentPresentationOverrides, detailDisplayTerm, resolveDetailTemplateContent, type DetailContent } from "@/lib/website/detailContentContract";
import { detailTemplateVariableValues } from "./detailTemplateVariables";
import { Globe2, ArrowLeft, ArrowUpRight, Building2, MapPin } from "lucide-react";
import { DeferredBelowFold } from "./DeferredBelowFold";
import { usePublicDetailPayload } from "./publicDetailQuery";
import { DetailPageSkeleton } from "@/components/public/PublicAsyncFeedback";
import { languageCourseNavigationLabel } from "./LanguageCourseBanner";

const DetailProgramBrowser = lazy(() => import("./UniversityProgramBrowser").then(module => ({ default: module.DetailProgramBrowser })));

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Destination {
  id: number | null;
  source?: "catalog" | "destination";
  catalogCountryId?: number;
  countryCode?: string | null;
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

type DestinationPayload = {
  editorial?: unknown;
  destination: Destination;
  universities: UniversityBrief[];
  programs: ProgramBrief[];
  cities: Array<{ id: number; name: string; sourceName: string; universityCount: number; cardHeroImageUrl: string | null; canonicalPath: string }>;
  stats: { universityCount: number; programCount: number };
  meta: {
    locale: Language;
    indexable: boolean;
    canonicalPath: string;
    alternatePaths: Partial<Record<Language, string>>;
    internalLinkPolicy: "PUBLISHED_INDEXABLE_ONLY" | "LEGACY_UNGATED";
  };
};

function fixStorageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let fixed = url.replace(/\/api\/storage\/objects\/objects\//, "/api/storage/objects/");
  if (!fixed.startsWith("http") && !fixed.startsWith(BASE_URL)) {
    fixed = `${BASE_URL}${fixed.startsWith("/") ? "" : "/"}${fixed}`;
  }
  return fixed;
}

function absoluteSeoImage(url: string | null): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `${SITE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

function detailSchemaEvidence(content: DetailContent | null | undefined) {
  const sources = new Map<string, { "@type": "CreativeWork"; name: string; url: string }>();
  const reviewedDates: string[] = [];
  for (const section of content?.sections ?? []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(section.reviewedOn || "")) reviewedDates.push(section.reviewedOn);
    for (const source of section.sources ?? []) {
      const url = source.url.trim();
      if (!sources.has(url)) sources.set(url, { "@type": "CreativeWork", name: source.label.trim(), url });
    }
  }
  return {
    reviewedOn: reviewedDates.sort().at(-1) ?? null,
    sources: [...sources.values()].slice(0, 24),
  };
}

function detailSchemaQuestions(content: DetailContent | null | undefined) {
  return (content?.sections ?? [])
    .flatMap(section => section.questions ?? [])
    .filter(item => item.question.trim() && item.answer.trim())
    .slice(0, 12);
}

export default function CountryDetail({ slug }: { slug: string }) {
  const preview = useContext(DetailPreviewContext);
  const { t, lang, localePath } = useI18n();
  const detail = usePublicDetailPayload<DestinationPayload>({
    kind: "destination",
    identity: slug,
    locale: lang,
    preview: Boolean(preview),
    previewPayload: preview?.payload as DestinationPayload | undefined,
  });
  const data = detail.payload;
  const isLoading = detail.loading;
  const error = detail.error;
  const editorial = resolveDetailTemplateContent(boundDetailContent(data?.editorial, "destination", data?.destination.catalogCountryId, lang), detailTemplateVariableValues("destination", data, lang));
  const localizedDestinationName = data
    ? localizedCountryName(data.destination.name, data.destination.countryCode, lang)
    : "";
  const heroImage = absoluteSeoImage(fixStorageUrl(
    detailHeroSection(editorial)?.images?.[0]?.src || data?.destination.heroImageUrl,
  ));
  const pageUrl = data ? `${SITE_URL}${data.meta.canonicalPath}` : "";
  const schemaEvidence = detailSchemaEvidence(editorial);
  const schemaQuestions = detailSchemaQuestions(editorial);

  useSeo({
    title: editorial?.seo?.title || (data ? t("countryDetail.studyIn", { name: localizedDestinationName }) : t("countryDetail.studyDestination")),
    description: editorial?.seo?.description || data?.destination.shortDescription || t("countryDetail.exploreOpportunities"),
    ogTitle: editorial?.seo?.ogTitle,
    ogDescription: editorial?.seo?.ogDescription,
    twitterTitle: editorial?.seo?.twitterTitle,
    twitterDescription: editorial?.seo?.twitterDescription,
    ogImage: heroImage,
    twitterImage: heroImage,
    canonical: data ? `${SITE_URL}${data.meta.canonicalPath}` : undefined,
    noindex: !data?.meta.indexable,
    lang,
    alternates: data?.meta.alternatePaths,
  });
  useJsonLd(
    data
      ? {
          "@context": "https://schema.org",
          "@graph": [
          {
            "@type": "EducationalOrganization",
            "@id": `${SITE_URL}/#organization`,
            name: SITE_NAME,
            url: SITE_URL,
          },
          {
            "@type": "WebSite",
            "@id": `${SITE_URL}/#website`,
            name: SITE_NAME,
            url: SITE_URL,
            publisher: { "@id": `${SITE_URL}/#organization` },
          },
          {
            "@type": "TouristDestination",
            "@id": `${pageUrl}#destination`,
            name: localizedDestinationName,
            description: editorial?.seo?.description || data.destination.shortDescription || undefined,
            url: pageUrl,
            inLanguage: lang,
            ...(heroImage ? { image: heroImage } : {}),
            touristType: { "@type": "Audience", audienceType: "International Students" },
          },
          {
            "@type": "ItemList",
            "@id": `${pageUrl}#institutions`,
            numberOfItems: data.stats.universityCount,
            itemListElement: data.universities.map((university, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: `${SITE_URL}${university.canonicalPath}`,
              name: university.name,
            })),
          },
          {
            "@type": "WebPage",
            "@id": `${pageUrl}#webpage`,
            name: editorial?.seo?.title || `${localizedDestinationName} — ${SITE_NAME}`,
            url: pageUrl,
            description: editorial?.seo?.description || data.destination.shortDescription || undefined,
            inLanguage: lang,
            mainEntity: { "@id": `${pageUrl}#destination` },
            ...(heroImage ? { primaryImageOfPage: { "@type": "ImageObject", url: heroImage } } : {}),
            isPartOf: { "@id": `${SITE_URL}/#website` },
            breadcrumb: { "@id": `${pageUrl}#breadcrumb` },
            ...(schemaEvidence.reviewedOn ? { dateModified: schemaEvidence.reviewedOn, lastReviewed: schemaEvidence.reviewedOn } : {}),
            ...(schemaEvidence.sources.length ? { isBasedOn: schemaEvidence.sources, citation: schemaEvidence.sources } : {}),
            ...(schemaQuestions.length ? { hasPart: { "@id": `${pageUrl}#faq` } } : {}),
          },
          {
            "@type": "BreadcrumbList",
            "@id": `${pageUrl}#breadcrumb`,
            itemListElement: [
              { "@type": "ListItem", position: 1, name: t("nav.home"), item: `${SITE_URL}${localePath("/")}` },
              { "@type": "ListItem", position: 2, name: t("nav.countries"), item: `${SITE_URL}${localePath("/countries")}` },
              { "@type": "ListItem", position: 3, name: localizedDestinationName, item: pageUrl },
            ],
          },
          ...(schemaQuestions.length ? [{
            "@type": "FAQPage",
            "@id": `${pageUrl}#faq`,
            mainEntity: schemaQuestions.map(item => ({
              "@type": "Question",
              name: item.question.trim(),
              acceptedAnswer: { "@type": "Answer", text: item.answer.trim() },
            })),
          }] : []),
        ]}
      : []
  );

  if (isLoading) {
    return <DetailPageSkeleton label={t("common.loading")} />;
  }

  if (error || !data) {
    return (
      <div className="pt-24 pb-16 text-center max-w-7xl mx-auto px-4">
        <Globe2 className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-foreground mb-2">{t("countryDetail.notFound")}</h2>
        <p className="text-muted-foreground mb-6">{t("countryDetail.notFoundDesc")}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {error ? <Button type="button" onClick={() => void detail.retry()}>{t("common.retry")}</Button> : null}
          <Button asChild variant="outline" className="rounded-full"><Link href={localePath("/countries")}><ArrowLeft className="w-4 h-4 mr-2" /> {t("countryDetail.backToDestinations")}</Link></Button>
        </div>
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
    [city.name.toLocaleLowerCase("en-US"), city] as const,
    [city.sourceName.toLocaleLowerCase("en-US"), city] as const,
  ]));
  const destinationDisplayName = localizedDestinationName;
  const cities = [...data.cities.map(city => ({ name: detailDisplayTerm(editorial, city.sourceName || city.name, city.name), canonicalPath: city.canonicalPath, universityCount: city.universityCount, heroImageUrl: fixStorageUrl(city.cardHeroImageUrl) })), ...cityNames
    .filter(name => !cityLinks.has(name.toLocaleLowerCase("en-US")))
    .map(name => ({ name: detailDisplayTerm(editorial, name), canonicalPath: null, universityCount: null, heroImageUrl: null }))];
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
  // Keep the first-paint SSR heading and the hydrated heading identical. A
  // generated editorial hero supplies the intent-led title; an unpublished or
  // source-thin page falls back to the canonical localized country name rather
  // than briefly showing the SEO title before hydration.
  const heroTitle = heroSection?.title || localizedDestinationName;
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
            <DetailBreadcrumbs label={copy.catalogue} items={[{ label: t("nav.countries"), path: localePath("/countries") }, { label: localizedDestinationName }]} />
          </div>
          <div className="detail-wrap detail-country-cover-inner">
            <div className="detail-country-cover-kicker"><span>{hero?.eyebrow || `${copy.destination} · 2026–27`}</span></div>
              <h1>{heroTitle}</h1>
            <div className="detail-country-cover-rule" />
            <p className="detail-country-cover-claim">
              <span>{heroBody}</span>
            </p>
            <div className="detail-country-cover-foot">
              {cities.length > 0 && <a className="is-secondary" href="#cities"><MapPin size={17} aria-hidden="true" />{t("countryDetail.popularCities")}</a>}
              <Link className="is-primary" href={primaryCtaHref}>{primaryCtaLabel}<ArrowUpRight size={17} aria-hidden="true" /></Link>
              <Link className="is-secondary" href={secondaryCtaHref}>{secondaryCtaLabel}<ArrowUpRight size={17} aria-hidden="true" /></Link>
            </div>
          </div>
        </div>
      </section>
      <nav data-detail-section="navigation" className="detail-nav is-curated" aria-label={detailContentTitle(editorial, "navigation", dest.name)}><div className="detail-wrap">
        <div className="detail-nav-primary">
          {(hasOverview || hasEditorialOverview) && <a href="#overview">{copy.overview}</a>}
          <a href="#language-courses">{languageCourseNavigationLabel(lang)}</a>
          {cities.length > 0 && <a href="#cities">{t("countryDetail.popularCities")}</a>}
          {stats.programCount > 0 && <a href="#programs">{t("countryDetail.programs")}</a>}
          {universities.length > 0 && <a href="#universities">{t("countryDetail.universities")}</a>}
          <a href="#cta">{copy.next}</a>
        </div>
        <details className="detail-nav-more">
          <summary>{detailSectionKicker("navigation", lang)}</summary>
          <div className="detail-nav-more-panel" onClick={(event) => {
            if ((event.target as Element).closest("a")) (event.currentTarget.parentElement as HTMLDetailsElement).open = false;
          }}>
            {facts.length > 0 && <a href="#facts">{t("countryDetail.quickFacts")}</a>}
            {detailContentNavigation(editorial ? { ...editorial, sections: editorial.sections.filter(section => section.key !== "gallery"), templateSections: editorial.templateSections?.filter(section => section.key !== "gallery") } : null)}
          </div>
        </details>
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
          <DetailHeading number="03" eyebrow={destinationDisplayName} title={detailContentTitle(editorial, "cities", t("countryDetail.popularCities"))} />
          {detailContentIntro(editorial, "cities")}
          <div className="detail-grid">{cities.map((city) => {
            const cityPath = city.canonicalPath;
            const count = Number.isFinite(city.universityCount) ? city.universityCount : null;
            const countLabel = count === null ? null : t(count === 1 ? "countries.university" : "countries.universities");
            const countContent = count === null ? null : <p className="detail-city-university-count"><Building2 size={15} aria-hidden="true" /><strong>{count.toLocaleString(lang)}</strong> {countLabel}</p>;
            return cityPath ? <DetailCard key={city.name} href={cityPath} eyebrow={destinationDisplayName} title={city.name} kind="city" layout="media" mediaUrl={city.heroImageUrl}>{countContent}</DetailCard> : <article key={city.name} className="detail-catalog-card is-city has-media"><div className="detail-card-media is-cover"><span className="detail-card-identity is-city"><MapPin aria-hidden="true" /></span></div><div className="detail-card-content"><p className="detail-eyebrow">{destinationDisplayName}</p><h3>{city.name}</h3>{countContent}</div></article>;
          })}</div>
        </div>
      </section>}
      {universities.length > 0 && <section data-detail-section="universities" id="universities" className="detail-section is-sand">
        <div className="detail-wrap">
          <DetailHeading number="04" eyebrow={copy.studyOptions} title={detailContentTitle(editorial, "universities", t("countryDetail.universitiesIn", { name: dest.name }))} />
          {detailContentIntro(editorial, "universities")}
          <div className="detail-grid">{universities.map((uni) => <DetailCard key={uni.id} href={uni.canonicalPath} title={detailDisplayTerm(editorial, uni.name)} eyebrow={detailDisplayTerm(editorial, uni.city || dest.name, uni.city || destinationDisplayName)} kind="university" logoUrl={fixStorageUrl(uni.logoUrl)} layout="media" mediaFit="contain">
            <p>{[localizedUniversityType(uni.universityType, lang), catalogueCount(uni.programCount, t("countryDetail.programs"))].filter(Boolean).join(" · ")}</p>
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
