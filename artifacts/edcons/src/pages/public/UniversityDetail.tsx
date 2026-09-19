import { DetailLayout } from "./DetailLayout";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { DetailBreadcrumbs, DetailHeading, DetailIdentity } from "./DetailEditorial";
import { boundDetailContent, detailContentNavigation, detailContentSections, DetailMobileActions } from "./DetailContentSections";
import { detailCopy, localDetailPath, type DetailTuition } from "./detailPresentation";
import { UniversityProgramBrowser } from "./UniversityProgramBrowser";
import { Button } from "@/components/ui/button";
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

export default function UniversityDetail({ routeKey }: { routeKey: string }) {
  const { t, lang, localePath } = useI18n();
  const [, setLocation] = useLocation();
  const [payload, setPayload] = useState<UniversityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const university = payload?.data;
  const editorial = boundDetailContent(payload?.editorial, "university", university?.id, lang);

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

  const copy = detailCopy(lang);
  const countryPath = localDetailPath(university.countryPath), cityPath = localDetailPath(university.cityPath);
  const degrees = [...new Set(payload.programs.map(program => program.degree).filter((value): value is string => !!value))];
  const location = <>{cityPath ? <Link href={cityPath}>{university.city}</Link> : university.city}{university.city && " · "}{countryPath ? <Link href={countryPath}>{university.country}</Link> : university.country}</>;
  return (
    <DetailLayout kind="university">
      <section data-detail-section="hero">
        <div className="detail-hero">
          <div className="detail-wrap detail-hero-top">
            <DetailBreadcrumbs label={copy.catalogue} items={[{ label: t("nav.countries"), path: localePath("/countries") }, { label: university.country, path: countryPath }, { label: university.city || "", path: cityPath }, { label: university.name }]} />
          </div>
          <div className="detail-wrap detail-hero-main">
            <div className="detail-hero-content">
              <div className="detail-identity">
                <DetailIdentity src={university.logoUrl} name={university.name} />
                <p className="detail-eyebrow">{copy.institution}</p>
              </div>
              <h1>{university.name}</h1>
              <p className="detail-hero-lead detail-icon-line"><MapPin size={18} aria-hidden="true" /><span>{location}</span></p>
              <div className="detail-meta-pills">
                {university.universityType && <span className="detail-meta-pill"><Building2 size={15} aria-hidden="true" />{university.universityType}</span>}
                {degrees.map(degree => <span className="detail-meta-pill" key={degree}><GraduationCap size={15} aria-hidden="true" />{degree}</span>)}
              </div>
              {university.isActive === false && <p className="detail-provenance" role="status">{t("courseFinderPage.apply")} · {t("common.inactive")}</p>}
            </div>
            <aside className="detail-hero-card" aria-label={t("catalogDetail.availablePrograms")}>
              <p className="detail-eyebrow">{copy.studyOptions}</p>
              <p className="detail-summary-count"><strong>{new Intl.NumberFormat(lang).format(payload.meta.programCount)}</strong><span>{copy.programCount}</span></p>
              <div className="detail-actions"><a href="#programs">{t("catalogDetail.availablePrograms")}<ArrowUpRight size={17} aria-hidden="true" /></a></div>
              {university.website && <div className="detail-actions"><a className="is-secondary" href={university.website} target="_blank" rel="noopener noreferrer">{t("programs.visitUniversity")}<ExternalLink size={16} aria-hidden="true" /></a></div>}
            </aside>
          </div>
        </div>
      </section>
      <nav data-detail-section="navigation" className="detail-nav" aria-label={university.name}><div className="detail-wrap">
        <a href="#overview">{copy.overview}</a><a href="#facts">{t("countryDetail.quickFacts")}</a><a href="#programs">{t("catalogDetail.availablePrograms")}</a>
        {detailContentNavigation(editorial)}
      </div></nav>
      <section data-detail-section="overview" id="overview" className="detail-section">
        <div className="detail-wrap detail-split">
          <DetailHeading number="01" eyebrow={copy.institution} title={t("countryDetail.about", { name: university.name })} />
          <div>{university.description ? <p className="detail-prose detail-snapshot">{university.description}</p> : <><p className="detail-prose">{t("countryDetail.exploreOpportunities")}</p><div className="detail-actions"><a href="#programs">{t("catalogDetail.availablePrograms")}<ArrowUpRight size={17} aria-hidden="true" /></a></div></>}</div>
        </div>
      </section>
      <section data-detail-section="facts" id="facts" className="detail-section is-sky">
        <div className="detail-wrap detail-split">
          <DetailHeading number="02" eyebrow={copy.overview} title={t("countryDetail.quickFacts")} />
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
          <DetailHeading number="03" eyebrow={copy.studyOptions} title={t("catalogDetail.availablePrograms")} />
          <UniversityProgramBrowser key={`${university.id}:${lang}`} universityId={university.id} admissionsOpen={university.isActive !== false} />
          <div className="detail-actions"><Link href={`${localePath("/programs")}?universityId=${university.id}`}>{t("countryDetail.viewAllPrograms")} · {payload.meta.programCount}<ArrowUpRight size={17} aria-hidden="true" /></Link></div>
        </div>
      </section>
      {detailContentSections(editorial, lang, localePath("/contact"))}
      <DetailMobileActions data-detail-section="mobileActions"><a href="#programs">{t("catalogDetail.availablePrograms")}</a><Link className="is-secondary" href={localePath("/contact")}>{t("countryDetail.talkToAdvisor")}</Link></DetailMobileActions>
    </DetailLayout>
  );
}
