import { DetailLayout } from "./DetailLayout";
import { lazy, Suspense, useEffect, useContext } from "react";
import { DetailPreviewContext } from "./DetailPreviewContext";
import { Link, useLocation } from "wouter";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { DetailBreadcrumbs, DetailHeading, DetailIdentity } from "./DetailEditorial";
import { boundDetailContent, detailContentAddon, detailContentIntro, detailContentNavigation, detailContentSections, detailContentTitle, DetailHeroMedia, DetailMobileActions, detailHeroSection, detailHeroStyle } from "./DetailContentSections";
import { detailCopy, detailCountLabel, localDetailPath, type DetailTuition } from "./detailPresentation";
import { DeferredBelowFold } from "./DeferredBelowFold";
import { Button } from "@/components/ui/button";
import { detailContentPresentationOverrides, detailDisplayTerm, resolveDetailTemplateContent } from "@/lib/website/detailContentContract";
import { detailTemplateVariableValues } from "./detailTemplateVariables";
import { ArrowLeft, Building2, ExternalLink, ArrowUpRight, MapPin, GraduationCap, Award } from "lucide-react";
import { CityWeatherCard, type CityWeatherSnapshot } from "./CityWeatherCard";
import { weatherCopy } from "./weatherPresentation";
import { usePublicDetailPayload } from "./publicDetailQuery";
import { DetailPageSkeleton } from "@/components/public/PublicAsyncFeedback";
import { languageCourseNavigationLabel } from "./LanguageCourseBanner";


type UniversityPayload = {
  editorial?: unknown;
  data: {
    id: number;
    name: string;
    country: string;
    countryPath?: string | null;
    cityPath?: string | null;
    city: string | null;
    weather?: CityWeatherSnapshot | null;
    website: string | null;
    description: string | null;
    ranking: number | null;
    universityType: string | null;
    isActive?: boolean;
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
    tuition?: DetailTuition | null;
    tuitionFee: number | null;
    discountedFee: number | null;
    scholarship: number | null;
    currency: string | null;
    canonicalPath: string;
  }>;
  meta: {
    programCount: number;
    degreeLevels?: string[];
    degreeLevelCounts?: Array<{ degree: string; count: number }>;
    canonicalPath: string;
    requestedPathIsCanonical: boolean;
    indexable: boolean;
    alternatePaths: Record<string, string>;
    programLinkPolicy: "PUBLISHED_INDEXABLE_ONLY" | "LEGACY_UNGATED";
  };
};

const UniversityProgramBrowser = lazy(() => import("./UniversityProgramBrowser").then(module => ({ default: module.UniversityProgramBrowser })));

const normalizeDegreeLevel = (value: string) => {
  const normalized = value.trim();
  if (/\b(?:associate|ön\s*lisans)\b/iu.test(normalized)) return "Associate";
  if (/\b(?:bachelor|undergraduate|lisans)\b/iu.test(normalized)) return "Bachelor";
  if (/\b(?:master|postgraduate|yüksek\s*lisans)\b/iu.test(normalized)) return "Master";
  if (/\b(?:ph\.?d|doctorate|doctoral|doktora)\b/iu.test(normalized)) return "Doctorate";
  if (/\b(?:foundation|pathway|preparatory|hazırlık)\b/iu.test(normalized)) return "Foundation / Pathway";
  return normalized;
};

const degreeOrder = new Map(["Foundation / Pathway", "Associate", "Bachelor", "Master", "Doctorate"].map((value, index) => [value, index]));

const degreeProgramLabel = (degree: string, count: number, locale: string, localizedDegree: string, localizedPrograms: string) => {
  const suffix = count === 1 ? "program" : "programs";
  if (locale.startsWith("tr")) {
    return `${localizedDegree} programı`;
  }
  if (locale.startsWith("en")) return `${degree === "Doctorate" ? "Ph.D" : degree} ${suffix}`;
  return `${localizedDegree} · ${localizedPrograms}`;
};

export default function UniversityDetail({ routeKey }: { routeKey: string }) {
  const preview = useContext(DetailPreviewContext);
  const { t, lang, localePath } = useI18n();
  const [, setLocation] = useLocation();
  const detail = usePublicDetailPayload<UniversityPayload>({
    kind: "university",
    identity: routeKey,
    locale: lang,
    preview: Boolean(preview),
    previewPayload: preview?.payload as UniversityPayload | undefined,
  });
  const payload = detail.payload;
  const loading = detail.loading;
  const error = detail.error;
  const university = payload?.data;
  const boundEditorial = boundDetailContent(payload?.editorial, "university", university?.id, lang);
  const editorial = resolveDetailTemplateContent(boundEditorial, detailTemplateVariableValues("university", payload, lang, boundEditorial));
  const displayTerm = (value: string | null | undefined) => detailDisplayTerm(editorial, value, value ?? "");
  const displayUniversity = displayTerm(university?.name);
  const displayCountry = displayTerm(university?.country);
  const displayCity = displayTerm(university?.city);
  const displayUniversityType = displayTerm(university?.universityType);

  useSeo({
    title: editorial?.seo?.title || displayUniversity || t("countryDetail.universities"),
    description: editorial?.seo?.description || university?.description || [displayCity, displayCountry].filter(Boolean).join(", ") || t("programs.subtitle"),
    ogTitle: editorial?.seo?.ogTitle,
    ogDescription: editorial?.seo?.ogDescription,
    twitterTitle: editorial?.seo?.twitterTitle,
    twitterDescription: editorial?.seo?.twitterDescription,
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
      name: displayUniversity,
      description: editorial?.seo?.description || university.description || undefined,
      url: `${SITE_URL}${university.canonicalPath}`,
      logo: university.logoUrl ? `${SITE_URL}${university.logoUrl}` : undefined,
      address: {
        "@type": "PostalAddress",
        streetAddress: university.address || undefined,
        addressLocality: displayCity || undefined,
        addressCountry: displayCountry,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: t("nav.countries"), item: `${SITE_URL}${localePath("/countries")}` },
        { "@type": "ListItem", position: 3, name: displayUniversity, item: `${SITE_URL}${university.canonicalPath}` },
      ],
    },
  ] : []);

  useEffect(() => {
    if (!preview && payload && !payload.meta.requestedPathIsCanonical) {
      setLocation(payload.meta.canonicalPath, { replace: true });
    }
  }, [payload, preview, setLocation]);

  if (loading) {
    return <DetailPageSkeleton label={t("common.loading")} />;
  }
  if (error || !university || !payload) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-32 text-center">
        <Building2 className="mx-auto mb-5 h-14 w-14 text-muted-foreground/40" />
        <h1 className="text-2xl font-bold">{t("countryDetail.notFound")}</h1>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {error ? <Button type="button" onClick={() => void detail.retry()}>{t("common.retry")}</Button> : null}
          <Button asChild variant="outline" className="rounded-full"><Link href={localePath("/countries")}><ArrowLeft className="mr-2 h-4 w-4" />{t("countryDetail.backToDestinations")}</Link></Button>
        </div>
      </div>
    );
  }

  const rankings = [
    ["QS", university.qsRanking],
    ["Times", university.timesRanking],
    ["Shanghai", university.shanghaiRanking],
    ["CWTS Leiden", university.cwtsLeidenRanking],
  ].filter((entry) => entry[1] !== null);

  const copy = detailCopy(lang);
  const weatherText = weatherCopy(lang);
  const countryPath = localDetailPath(university.countryPath), cityPath = localDetailPath(university.cityPath);
  // Use both the unpaginated server aggregate and the delivered programme
  // sample. A partial aggregate must never hide a level visible on the page.
  const degrees = [...new Set(
    [...(payload.meta.degreeLevels ?? []), ...payload.programs.map(program => program.degree)]
      .filter((value): value is string => Boolean(value?.trim()))
      .map(normalizeDegreeLevel),
  )].sort((left, right) => (degreeOrder.get(left) ?? 99) - (degreeOrder.get(right) ?? 99) || left.localeCompare(right));
  const degreeCounts = [...(payload.meta.degreeLevelCounts ?? [])]
    .reduce((counts, item) => {
      const degree = normalizeDegreeLevel(item.degree);
      counts.set(degree, (counts.get(degree) ?? 0) + item.count);
      return counts;
    }, new Map<string, number>());
  const heroDegreeCounts = [...degreeCounts.entries()]
    .filter(([degree]) => degreeOrder.has(degree))
    .sort(([left], [right]) => (degreeOrder.get(left) ?? 99) - (degreeOrder.get(right) ?? 99));
  const location = <>{cityPath ? <Link href={cityPath}>{displayCity}</Link> : displayCity}{displayCity && " · "}{countryPath ? <Link href={countryPath}>{displayCountry}</Link> : displayCountry}</>;
  const heroSection = detailHeroSection(editorial);
  const factsIntro = detailContentIntro(editorial, "facts");
  const hero = heroSection?.hero;
  const primaryCtaHref = hero?.primaryCtaHref || "#programs";
  const primaryCtaLabel = hero?.primaryCtaLabel || t("catalogDetail.availablePrograms");
  const secondaryCtaHref = hero?.secondaryCtaHref || university.website || localePath("/contact");
  const secondaryCtaLabel = hero?.secondaryCtaLabel || (university.website ? t("programs.visitUniversity") : t("countryDetail.talkToAdvisor"));
  return (
    <DetailLayout kind="university" sectionOrder={editorial?.sectionOrder} sectionPresentation={detailContentPresentationOverrides(editorial)}>
      <section data-detail-section="hero">
        <div className="detail-hero" style={detailHeroStyle(editorial)}>
          <DetailHeroMedia content={editorial} />
          <div className="detail-wrap detail-hero-top">
            <DetailBreadcrumbs label={copy.catalogue} items={[{ label: t("nav.countries"), path: localePath("/countries") }, { label: displayCountry, path: countryPath }, { label: displayCity, path: cityPath }, { label: displayUniversity }]} />
          </div>
          <div className="detail-wrap detail-hero-main">
            <div className="detail-hero-content">
              <div className="detail-identity">
                <DetailIdentity src={university.logoUrl} name={displayUniversity} />
                <p className="detail-eyebrow">{hero?.eyebrow || copy.institution}</p>
              </div>
              <h1>{heroSection?.title || displayUniversity}</h1>
              <p className="detail-hero-lead detail-icon-line"><MapPin size={18} aria-hidden="true" /><span>{location}</span></p>
              {heroSection?.body && <p className="detail-hero-lead">{heroSection.body}</p>}
              <div className="detail-meta-pills">
                {displayUniversityType && <span className="detail-meta-pill"><Building2 size={15} aria-hidden="true" />{displayUniversityType}</span>}
                {degrees.map(degree => <span className="detail-meta-pill" key={degree}><GraduationCap size={15} aria-hidden="true" />{displayTerm(degree)}</span>)}
              </div>
              {university.isActive === false && <p className="detail-provenance" role="status">{t("courseFinderPage.apply")} · {t("common.inactive")}</p>}
            </div>
            <aside className="detail-hero-card" aria-label={t("catalogDetail.availablePrograms")}>
              <p className="detail-eyebrow">{copy.studyOptions}</p>
              {heroDegreeCounts.length > 0 ? <dl className="detail-program-level-counts">
                {heroDegreeCounts.map(([degree, count]) => <div key={degree}><dt>{new Intl.NumberFormat(lang).format(count)}</dt><dd>{degreeProgramLabel(degree, count, lang, displayTerm(degree), copy.programCount)}</dd></div>)}
              </dl> : <p className="detail-summary-count"><strong>{new Intl.NumberFormat(lang).format(payload.meta.programCount)}</strong><span>{detailCountLabel(hero?.programCountLabel, copy.programCount)}</span></p>}
              <div className="detail-actions"><a href={primaryCtaHref} rel="noopener noreferrer" {...(primaryCtaHref.startsWith("https:") ? { target: "_blank" } : {})}>{primaryCtaLabel}<ArrowUpRight size={17} aria-hidden="true" /></a></div>
              <div className="detail-actions"><a className="is-secondary" href={secondaryCtaHref} rel="noopener noreferrer" {...(secondaryCtaHref.startsWith("https:") ? { target: "_blank" } : {})}>{secondaryCtaLabel}{secondaryCtaHref.startsWith("https:") ? <ExternalLink size={16} aria-hidden="true" /> : null}</a></div>
            </aside>
          </div>
        </div>
        {detailContentAddon(editorial, "hero", lang, localePath("/contact"))}
      </section>
      <nav data-detail-section="navigation" className="detail-nav" aria-label={detailContentTitle(editorial, "navigation", displayUniversity)}><div className="detail-wrap">
        <a href="#overview">{copy.overview}</a><a href="#language-courses">{languageCourseNavigationLabel(lang)}</a><a href="#facts">{t("countryDetail.quickFacts")}</a>{university.weather && <a href="#weather">{weatherText.section}</a>}<a href="#programs">{t("catalogDetail.availablePrograms")}</a>
        {detailContentNavigation(editorial)}
      </div></nav>
      <section data-detail-section="overview" id="overview" className="detail-section">
        <div className="detail-wrap detail-university-overview">
          <DetailHeading number="01" eyebrow={copy.institution} title={t("countryDetail.about", { name: displayUniversity })} />
          <div>{university.description ? <p className="detail-prose detail-snapshot">{university.description}</p> : <><p className="detail-prose">{t("countryDetail.exploreOpportunities")}</p><div className="detail-actions"><a href="#programs">{t("catalogDetail.availablePrograms")}<ArrowUpRight size={17} aria-hidden="true" /></a></div></>}</div>
          {detailContentAddon(editorial, "overview", lang, localePath("/contact"))}
        </div>
      </section>
      <section data-detail-section="facts" id="facts" className="detail-section is-sky">
        <div className="detail-wrap detail-university-facts">
          <DetailHeading number="02" eyebrow={copy.overview} title={detailContentTitle(editorial, "facts", t("countryDetail.quickFacts"))} />
          <div className={`detail-university-facts-grid${factsIntro ? "" : " is-single"}`}>
            {factsIntro && <div className="detail-university-facts-copy">{factsIntro}</div>}
            <dl className="detail-keylines detail-university-facts-list">
              <div><dt><MapPin size={17} aria-hidden="true" />{copy.institutionLocation}</dt><dd>{location}</dd></div>
              {university.address && <div><dt><Building2 size={17} aria-hidden="true" />{t("catalogDetail.location")}</dt><dd>{university.address}</dd></div>}
              {displayUniversityType && <div><dt><GraduationCap size={17} aria-hidden="true" />{t("common.type")}</dt><dd>{displayUniversityType}</dd></div>}
              {rankings.map(([label, value]) => <div key={String(label)}><dt><Award size={17} aria-hidden="true" />{String(label)}</dt><dd>#{String(value)}</dd></div>)}
            </dl>
          </div>
        </div>
      </section>
      {university.weather && university.city && <section data-detail-section="weather" id="weather" className="detail-section">
        <div className="detail-wrap">
          <DetailHeading number="03" eyebrow={displayCity} title={detailContentTitle(editorial, "weather", weatherText.campusTitle)} />
          <CityWeatherCard cityName={displayCity} locale={lang} weather={university.weather} />
        </div>
      </section>}
      <section data-detail-section="programs" id="programs" className="detail-section is-sand">
        <div className="detail-wrap">
          <DetailHeading number={university.weather ? "04" : "03"} eyebrow={copy.studyOptions} title={detailContentTitle(editorial, "programs", t("catalogDetail.availablePrograms"))} />
          {detailContentIntro(editorial, "programs")}
          <DeferredBelowFold minHeight={520}><Suspense fallback={<div className="h-[32rem] animate-pulse rounded-3xl bg-secondary" />}><UniversityProgramBrowser key={`${university.id}:${lang}`} universityId={university.id} admissionsOpen={university.isActive !== false} /></Suspense></DeferredBelowFold>
          <div className="detail-actions detail-programs-footer-actions"><Link href={`${localePath("/programs")}?universityId=${university.id}`}>{t("countryDetail.viewAllPrograms")} · {payload.meta.programCount}<ArrowUpRight size={17} aria-hidden="true" /></Link></div>
        </div>
      </section>
      {detailContentSections(editorial, lang, localePath("/contact"), ["hero", "overview"])}
      <DetailMobileActions data-detail-section="mobileActions"><a href="#programs">{t("catalogDetail.availablePrograms")}</a><Link className="is-secondary" href={localePath("/contact")}>{t("countryDetail.talkToAdvisor")}</Link></DetailMobileActions>
    </DetailLayout>
  );
}
