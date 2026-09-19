import { DetailLayout } from "./DetailLayout";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { DetailArtwork, DetailBreadcrumbs, DetailFacts, DetailHeading, DetailPrice } from "./DetailEditorial";
import { detailCopy, displayTuition, localDetailPath, type DetailTuition } from "./detailPresentation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, ExternalLink, ArrowUpRight } from "lucide-react";


type UniversityPayload = {
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
          <div className="detail-wrap detail-hero-main is-wide">
            <div>
              <p className="detail-eyebrow">{copy.institution} · {university.universityType}</p>
              {university.logoUrl && <img className="detail-logo" src={university.logoUrl} alt={university.name} onError={event => { event.currentTarget.hidden = true; }} />}
              <h1>{university.name}</h1>
              <p className="detail-hero-lead">{location}</p>
              {university.isActive === false && <p className="detail-provenance" role="status">{t("courseFinderPage.apply")} · {t("common.inactive")}</p>}
              <div className="detail-actions"><a href="#programs">{t("catalogDetail.availablePrograms")}<ArrowUpRight size={17} aria-hidden="true" /></a>
                {university.website && <a className="is-secondary" href={university.website} target="_blank" rel="noopener noreferrer">{t("programs.visitUniversity")}<ExternalLink size={16} aria-hidden="true" /></a>}
              </div>
            </div>
            <DetailArtwork />
          </div>
        </div>
        <div className="detail-factbar"><div className="detail-wrap">
          <DetailBreadcrumbs label={copy.catalogue} items={[{ label: t("nav.countries"), path: localePath("/countries") }, { label: university.country, path: countryPath }, { label: university.city || "", path: cityPath }, { label: university.name }]} />
          <DetailFacts items={[{ label: copy.programCount, value: payload.meta.programCount }, { label: t("common.type"), value: university.universityType }, { label: copy.institutionLocation, value: location }]} />
        </div></div>
      </section>
      <nav data-detail-section="navigation" className="detail-nav" aria-label={university.name}><div className="detail-wrap">
        <a href="#overview">{copy.overview}</a><a href="#facts">{t("countryDetail.quickFacts")}</a><a href="#programs">{t("catalogDetail.availablePrograms")}</a>
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
            <div><dt>{copy.institutionLocation}</dt><dd>{location}</dd></div>
            {university.address && <div><dt>{t("catalogDetail.location")}</dt><dd>{university.address}</dd></div>}
            {university.universityType && <div><dt>{t("common.type")}</dt><dd>{university.universityType}</dd></div>}
            {rankings.map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>#{String(value)}</dd></div>)}
          </dl>
        </div>
      </section>
      <section data-detail-section="programs" id="programs" className="detail-section is-sand">
        <div className="detail-wrap">
          <DetailHeading number="03" eyebrow={copy.studyOptions} title={t("catalogDetail.availablePrograms")} />
          {degrees.length > 1 && <div className="detail-actions mb-7">{degrees.map(degree => <Link className="is-secondary" key={degree} href={`${localePath("/programs")}?universityId=${university.id}&degree=${encodeURIComponent(degree)}`}>{degree}</Link>)}</div>}
          {payload.programs.length > 0 ? <>
            <div className="detail-table-region" tabIndex={0} role="region" aria-label={t("catalogDetail.availablePrograms")}>
              <table className="detail-table">
                <thead><tr><th scope="col">{t("countryDetail.programs")}</th><th scope="col">{t("courseFinderPage.language")}</th><th scope="col">{t("courseFinderPage.duration")}</th><th scope="col">{t("courseFinderPage.tuitionFee")}</th></tr></thead>
                <tbody>{payload.programs.map(program => <tr key={program.id}>
                  <th scope="row"><p className="detail-eyebrow">{program.degree}</p><Link href={program.canonicalPath}>{program.name}</Link></th>
                  <td>{program.language || "—"}</td><td>{program.duration || "—"}</td>
                  <td><DetailPrice tuition={displayTuition(program, lang)} locale={lang} verifiedLabel={t("catalogDetail.verifiedPrice")} /></td>
                </tr>)}</tbody>
              </table>
            </div>
            <p className="detail-provenance">{copy.scrollTable}</p>
          </> : <p className="detail-prose">{t("programs.noResults")}</p>}
          <div className="detail-actions"><Link href={`${localePath("/programs")}?universityId=${university.id}`}>{t("countryDetail.viewAllPrograms")} · {payload.meta.programCount}<ArrowUpRight size={17} aria-hidden="true" /></Link></div>
        </div>
      </section>
    </DetailLayout>
  );
}
