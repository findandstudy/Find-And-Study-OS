import { DetailLayout } from "./DetailLayout";
import { lazy, Suspense, useEffect, useState, useContext, type CSSProperties } from "react";
import { DetailPreviewContext } from "./DetailPreviewContext";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { ArrowLeft, ArrowUpRight, MapPin, Building2, GraduationCap, Globe2 } from "lucide-react";

import { DetailBreadcrumbs, DetailCard, DetailFacts, DetailHeading } from "./DetailEditorial";
import { boundDetailContent, detailContentAddon, detailContentIntro, detailContentNavigation, detailContentSections, detailContentTitle, DetailHeroMedia, detailHeroSection } from "./DetailContentSections";
import type { CityProgramCardData } from "./CityProgramCards";
import { DeferredBelowFold } from "./DeferredBelowFold";
import { cityHeroCopy, detailCopy, detailCountLabel, localDetailPath } from "./detailPresentation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { useSeo } from "@/hooks/use-seo";
import { detailContentPresentationOverrides, resolveDetailTemplateContent } from "@/lib/website/detailContentContract";
import { detailTemplateVariableValues } from "./detailTemplateVariables";

type CityPayload = {
  editorial?: unknown;
  data: {
    id: number;
    name: string;
    country: string;
    countryCode: string;
    filterCountry?: string;
    filterCity?: string;
    countryPath?: string | null;
    cityPath?: string | null;
    description: string | null;
    universityCount: number;
    programCount: number;
    programLanguages: string[];
    universities: Array<{
      id: number;
      name: string;
      universityType: string | null;
      canonicalPath: string;
    }>;
    programs: CityProgramCardData[];
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

const DetailProgramBrowser = lazy(() => import("./UniversityProgramBrowser").then(module => ({ default: module.DetailProgramBrowser })));

export default function CityDetail({ routeKey }: { routeKey: string }) {
  const preview = useContext(DetailPreviewContext);
  const { t, lang, localePath } = useI18n();
  const [, setLocation] = useLocation();
  const [fetchedPayload, setPayload] = useState<CityPayload | null>(null);
  const payload = preview ? preview.payload as CityPayload : fetchedPayload;
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState(false);
  const city = payload?.data;
  const editorial = resolveDetailTemplateContent(boundDetailContent(payload?.editorial, "city", city?.id, lang), detailTemplateVariableValues("city", payload, lang));

  useSeo({
    title: editorial?.seo?.title || payload?.meta.title || t("countryDetail.studyDestination"),
    description: editorial?.seo?.description || payload?.meta.description || t("countryDetail.exploreOpportunities"),
    ogTitle: editorial?.seo?.ogTitle,
    ogDescription: editorial?.seo?.ogDescription,
    twitterTitle: editorial?.seo?.twitterTitle,
    twitterDescription: editorial?.seo?.twitterDescription,
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
      description: editorial?.seo?.description || payload.meta.description,
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
    if (preview) return;
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
  const heroCopy = cityHeroCopy(lang);
  const heroSection = detailHeroSection(editorial);
  const hero = heroSection?.hero;
  const heroStyle = {
    ...(hero?.backgroundColor ? { "--detail-hero-background": hero.backgroundColor } : {}),
    ...(hero?.overlayColor ? { "--detail-hero-overlay-color": hero.overlayColor } : {}),
    ...(hero?.overlayOpacity !== undefined ? { "--detail-hero-overlay-opacity": String(hero.overlayOpacity / 100) } : {}),
    ...(hero?.textColor ? { "--detail-hero-text": hero.textColor } : {}),
    ...(hero?.accentColor ? { "--detail-hero-accent": hero.accentColor } : {}),
  } as CSSProperties;
  const editorialTitle = (key: string, fallback: string) => detailContentTitle(editorial, key, fallback);
  const heroFacts = [
    city.programLanguages.length ? { title: hero?.programLanguagesLabel || editorialTitle("education", heroCopy.education), body: city.programLanguages.join(" · ") } : null,
  ].filter((fact): fact is { title: string; body: string } => Boolean(fact));
  const overviewDescription = city.description?.trim();
  const hasEditorialOverview = detailContentTitle(editorial, "overview", "") !== "";
  const countryPath = localDetailPath(city.countryPath);
  const programsPath = `${localePath("/programs")}?country=${encodeURIComponent(city.filterCountry || city.country)}&city=${encodeURIComponent(city.filterCity || city.name)}`;
  const universityCountLabel = detailCountLabel(hero?.universityCountLabel, copy.universityCount);
  const programCountLabel = detailCountLabel(hero?.programCountLabel, copy.programCount);
  return (
    <DetailLayout kind="city" sectionOrder={editorial?.sectionOrder} sectionPresentation={detailContentPresentationOverrides(editorial)}>
      <section data-detail-section="hero">
        <div className="detail-hero is-city" style={heroStyle}>
          <DetailHeroMedia content={editorial} />
          <div className="detail-wrap detail-hero-top">
            <DetailBreadcrumbs label={copy.catalogue} items={[{ label: t("nav.countries"), path: localePath("/countries") }, { label: city.country, path: countryPath }, { label: city.name }]} />
          </div>
          <div className="detail-wrap detail-hero-main detail-city-cover-inner">
            <div>
              <div className="detail-cover-label"><MapPin size={18} aria-hidden="true" /><span>{hero?.eyebrow || copy.city}</span></div>
              <h1>{heroSection?.title || city.name}</h1>
              {countryPath ? <Link className="detail-hero-link" href={countryPath}><Globe2 size={17} aria-hidden="true" />{city.country}<ArrowUpRight size={17} aria-hidden="true" /></Link> : <p className="detail-hero-lead">{city.country}</p>}
              {heroSection?.body && <p className="detail-hero-lead">{heroSection.body}</p>}
              <div className="detail-actions"><Link href={hero?.primaryCtaHref || programsPath}>{hero?.primaryCtaLabel || t("countryDetail.viewAllPrograms")}<ArrowUpRight size={17} aria-hidden="true" /></Link><Link className="is-secondary" href={hero?.secondaryCtaHref || localePath("/contact")}>{hero?.secondaryCtaLabel || t("countryDetail.talkToAdvisor")}</Link></div>
              <dl className="detail-city-coverstrip">
                <div><dt>{hero?.countryLabel || copy.country}</dt><dd>{city.country}</dd></div>
                <div><dt>{universityCountLabel}</dt><dd>{city.universityCount.toLocaleString(lang)}</dd></div>
                <div><dt>{programCountLabel}</dt><dd>{city.programCount.toLocaleString(lang)}</dd></div>
                {heroFacts.map((fact, index) => <div key={`${fact.title}-${index}`}><dt>{fact.title}</dt><dd>{fact.body}</dd></div>)}
              </dl>
            </div>
          </div>
        </div>
      </section>
      <nav data-detail-section="navigation" className="detail-nav" aria-label={detailContentTitle(editorial, "navigation", city.name)}><div className="detail-wrap">
        {(overviewDescription || hasEditorialOverview) && <a href="#overview">{copy.overview}</a>}<a href="#facts">{t("countryDetail.quickFacts")}</a>
        {city.universities.length > 0 && <a href="#universities">{t("countryDetail.universities")}</a>}
        {city.programCount > 0 && <a href="#programs">{t("countryDetail.programs")}</a>}
        {detailContentNavigation(editorial)}
      </div></nav>
      {(overviewDescription || hasEditorialOverview) && <section data-detail-section="overview" id="overview" className="detail-section">
        <div className={hasEditorialOverview ? "detail-wrap" : "detail-wrap detail-split"}>
          {hasEditorialOverview ? detailContentAddon(editorial, "overview", lang, localePath("/contact")) : <>
            <DetailHeading number="01" eyebrow={copy.city} title={t("countryDetail.about", { name: city.name })} />
            {overviewDescription && <p className="detail-prose detail-snapshot">{overviewDescription}</p>}
          </>}
        </div>
      </section>}
      <section data-detail-section="facts" id="facts" className="detail-section is-sky">
        <div className="detail-wrap">
          <DetailHeading number="02" eyebrow={city.name} title={detailContentTitle(editorial, "facts", t("countryDetail.quickFacts"))} />
          {detailContentIntro(editorial, "facts")}
          <DetailFacts items={[{ label: copy.country, icon: <Globe2 size={19} />, value: countryPath ? <Link href={countryPath}>{city.country}</Link> : city.country }, { label: copy.universityCount, icon: <Building2 size={19} />, value: city.universityCount }, { label: copy.programCount, icon: <GraduationCap size={19} />, value: city.programCount }]} />
        </div>
      </section>
      {city.universities.length > 0 && <section data-detail-section="universities" id="universities" className="detail-section is-sand">
        <div className="detail-wrap">
          <DetailHeading number="03" eyebrow={copy.studyOptions} title={detailContentTitle(editorial, "universities", t("countryDetail.universitiesIn", { name: city.name }))} />
          {detailContentIntro(editorial, "universities")}
          <div className="detail-grid">{city.universities.map((university) => <DetailCard key={university.id} href={university.canonicalPath} eyebrow={university.universityType} title={university.name} kind="university" />)}</div>
        </div>
      </section>}
      {city.programCount > 0 && <section data-detail-section="programs" id="programs" className="detail-section">
        <div className="detail-wrap">
          <DetailHeading number="04" eyebrow={copy.studyOptions} title={detailContentTitle(editorial, "programs", t("catalogDetail.availablePrograms"))} />
          {detailContentIntro(editorial, "programs")}
          <DeferredBelowFold minHeight={520}><Suspense fallback={<div className="h-[32rem] animate-pulse rounded-3xl bg-secondary" />}><DetailProgramBrowser key={`${city.id}:${lang}`} scope={{ kind: "city", country: city.filterCountry || city.country, city: city.filterCity || city.name }} admissionsOpen previewPrograms={city.programs.map(program => ({ ...program, universityId: program.universityId ?? 0, universityPath: program.universityPath ?? "" }))} previewTotal={city.programCount} /></Suspense></DeferredBelowFold>
          <div className="detail-actions"><Link href={programsPath}>{t("countryDetail.viewAllPrograms")}<ArrowUpRight size={17} aria-hidden="true" /></Link></div>
        </div>
      </section>}
      {detailContentSections(editorial, lang, localePath("/contact"), ["hero", "overview"])}
    </DetailLayout>
  );
}
