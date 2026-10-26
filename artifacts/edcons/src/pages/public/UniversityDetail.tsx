import { DetailLayout } from "./DetailLayout";
import { lazy, Suspense, useEffect, useState, useContext } from "react";
import { DetailPreviewContext } from "./DetailPreviewContext";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { DetailBreadcrumbs, DetailHeading, DetailIdentity } from "./DetailEditorial";
import { boundDetailContent, detailContentAddon, detailContentIntro, detailContentNavigation, detailContentSections, detailContentTitle, DetailHeroMedia, DetailMobileActions, detailHeroSection, detailHeroStyle } from "./DetailContentSections";
import { detailCopy, detailCountLabel, localDetailPath, type DetailTuition } from "./detailPresentation";
import { DeferredBelowFold } from "./DeferredBelowFold";
import { Button } from "@/components/ui/button";
import { detailContentPresentationOverrides, resolveDetailTemplateContent } from "@/lib/website/detailContentContract";
import { detailTemplateVariableValues } from "./detailTemplateVariables";
import { ArrowLeft, Building2, ExternalLink, ArrowUpRight, MapPin, GraduationCap, Award } from "lucide-react";


type UniversityPayload = {
  editorial?: unknown;
  data: {
    id: number;
    name: string;
    country: string;
    countryPath?: string | null;
    cityPath?: string | null;
    city: string | null;
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
    canonicalPath: string;
    requestedPathIsCanonical: boolean;
    indexable: boolean;
    alternatePaths: Record<string, string>;
    programLinkPolicy: "PUBLISHED_INDEXABLE_ONLY" | "LEGACY_UNGATED";
  };
};

const UniversityProgramBrowser = lazy(() => import("./UniversityProgramBrowser").then(module => ({ default: module.UniversityProgramBrowser })));

export default function UniversityDetail({ routeKey }: { routeKey: string }) {
  const preview = useContext(DetailPreviewContext);
  const { t, lang, localePath } = useI18n();
  const [, setLocation] = useLocation();
  const [fetchedPayload, setPayload] = useState<UniversityPayload | null>(null);
  const payload = preview ? preview.payload as UniversityPayload : fetchedPayload;
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState(false);
  const university = payload?.data;
  const editorial = resolveDetailTemplateContent(boundDetailContent(payload?.editorial, "university", university?.id, lang), detailTemplateVariableValues("university", payload, lang));

  useSeo({
    title: editorial?.seo?.title || university?.name || t("countryDetail.universities"),
    description: editorial?.seo?.description || university?.description || [university?.city, university?.country].filter(Boolean).join(", ") || t("programs.subtitle"),
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
      name: university.name,
      description: editorial?.seo?.description || university.description || undefined,
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
    if (preview) return;
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

  const copy = detailCopy(lang);
  const countryPath = localDetailPath(university.countryPath), cityPath = localDetailPath(university.cityPath);
  const degrees = [...new Set(payload.programs.map(program => program.degree).filter((value): value is string => !!value))];
  const location = <>{cityPath ? <Link href={cityPath}>{university.city}</Link> : university.city}{university.city && " · "}{countryPath ? <Link href={countryPath}>{university.country}</Link> : university.country}</>;
  const heroSection = detailHeroSection(editorial);
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
            <DetailBreadcrumbs label={copy.catalogue} items={[{ label: t("nav.countries"), path: localePath("/countries") }, { label: university.country, path: countryPath }, { label: university.city || "", path: cityPath }, { label: university.name }]} />
          </div>
          <div className="detail-wrap detail-hero-main">
            <div className="detail-hero-content">
              <div className="detail-identity">
                <DetailIdentity src={university.logoUrl} name={university.name} />
                <p className="detail-eyebrow">{hero?.eyebrow || copy.institution}</p>
              </div>
              <h1>{heroSection?.title || university.name}</h1>
              <p className="detail-hero-lead detail-icon-line"><MapPin size={18} aria-hidden="true" /><span>{location}</span></p>
              {heroSection?.body && <p className="detail-hero-lead">{heroSection.body}</p>}
              <div className="detail-meta-pills">
                {university.universityType && <span className="detail-meta-pill"><Building2 size={15} aria-hidden="true" />{university.universityType}</span>}
                {degrees.map(degree => <span className="detail-meta-pill" key={degree}><GraduationCap size={15} aria-hidden="true" />{degree}</span>)}
              </div>
              {university.isActive === false && <p className="detail-provenance" role="status">{t("courseFinderPage.apply")} · {t("common.inactive")}</p>}
            </div>
            <aside className="detail-hero-card" aria-label={t("catalogDetail.availablePrograms")}>
              <p className="detail-eyebrow">{copy.studyOptions}</p>
              <p className="detail-summary-count"><strong>{new Intl.NumberFormat(lang).format(payload.meta.programCount)}</strong><span>{detailCountLabel(hero?.programCountLabel, copy.programCount)}</span></p>
              <div className="detail-actions"><a href={primaryCtaHref} rel="noopener noreferrer" {...(primaryCtaHref.startsWith("https:") ? { target: "_blank" } : {})}>{primaryCtaLabel}<ArrowUpRight size={17} aria-hidden="true" /></a></div>
              <div className="detail-actions"><a className="is-secondary" href={secondaryCtaHref} rel="noopener noreferrer" {...(secondaryCtaHref.startsWith("https:") ? { target: "_blank" } : {})}>{secondaryCtaLabel}{secondaryCtaHref.startsWith("https:") ? <ExternalLink size={16} aria-hidden="true" /> : null}</a></div>
            </aside>
          </div>
        </div>
        {detailContentAddon(editorial, "hero", lang, localePath("/contact"))}
      </section>
      <nav data-detail-section="navigation" className="detail-nav" aria-label={detailContentTitle(editorial, "navigation", university.name)}><div className="detail-wrap">
        <a href="#overview">{copy.overview}</a><a href="#facts">{t("countryDetail.quickFacts")}</a><a href="#programs">{t("catalogDetail.availablePrograms")}</a>
        {detailContentNavigation(editorial)}
      </div></nav>
      <section data-detail-section="overview" id="overview" className="detail-section">
        <div className="detail-wrap detail-split">
          <DetailHeading number="01" eyebrow={copy.institution} title={t("countryDetail.about", { name: university.name })} />
          <div>{university.description ? <p className="detail-prose detail-snapshot">{university.description}</p> : <><p className="detail-prose">{t("countryDetail.exploreOpportunities")}</p><div className="detail-actions"><a href="#programs">{t("catalogDetail.availablePrograms")}<ArrowUpRight size={17} aria-hidden="true" /></a></div></>}</div>
          {detailContentAddon(editorial, "overview", lang, localePath("/contact"))}
        </div>
      </section>
      <section data-detail-section="facts" id="facts" className="detail-section is-sky">
        <div className="detail-wrap detail-split">
          <DetailHeading number="02" eyebrow={copy.overview} title={detailContentTitle(editorial, "facts", t("countryDetail.quickFacts"))} />
          {detailContentIntro(editorial, "facts")}
          <dl className="detail-keylines">
            <div><dt><MapPin size={17} aria-hidden="true" />{copy.institutionLocation}</dt><dd>{location}</dd></div>
            {university.address && <div><dt><Building2 size={17} aria-hidden="true" />{t("catalogDetail.location")}</dt><dd>{university.address}</dd></div>}
            {university.universityType && <div><dt><GraduationCap size={17} aria-hidden="true" />{t("common.type")}</dt><dd>{university.universityType}</dd></div>}
            {rankings.map(([label, value]) => <div key={String(label)}><dt><Award size={17} aria-hidden="true" />{String(label)}</dt><dd>#{String(value)}</dd></div>)}
          </dl>
        </div>
      </section>
      <section data-detail-section="programs" id="programs" className="detail-section is-sand">
        <div className="detail-wrap">
          <DetailHeading number="03" eyebrow={copy.studyOptions} title={detailContentTitle(editorial, "programs", t("catalogDetail.availablePrograms"))} />
          {detailContentIntro(editorial, "programs")}
          <DeferredBelowFold minHeight={520}><Suspense fallback={<div className="h-[32rem] animate-pulse rounded-3xl bg-secondary" />}><UniversityProgramBrowser key={`${university.id}:${lang}`} universityId={university.id} admissionsOpen={university.isActive !== false} /></Suspense></DeferredBelowFold>
          <div className="detail-actions"><Link href={`${localePath("/programs")}?universityId=${university.id}`}>{t("countryDetail.viewAllPrograms")} · {payload.meta.programCount}<ArrowUpRight size={17} aria-hidden="true" /></Link></div>
        </div>
      </section>
      {detailContentSections(editorial, lang, localePath("/contact"), ["hero", "overview"])}
      <DetailMobileActions data-detail-section="mobileActions"><a href="#programs">{t("catalogDetail.availablePrograms")}</a><Link className="is-secondary" href={localePath("/contact")}>{t("countryDetail.talkToAdvisor")}</Link></DetailMobileActions>
    </DetailLayout>
  );
}
