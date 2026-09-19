import { DetailLayout } from "./DetailLayout";
import { programAdmissionsOpen } from "@/lib/programAdmissions";
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { Button } from "@/components/ui/button";
import { DetailBreadcrumbs, DetailFacts, DetailHeading, DetailIdentity, DetailPrice } from "./DetailEditorial";
import { boundDetailContent, detailContentNavigation, detailContentSections, DetailMobileActions } from "./DetailContentSections";
import { CityProgramCards, type CityProgramCardData } from "./CityProgramCards";
import { detailCopy, detailMoney, displayTuition, durationIsAmbiguous, localDetailPath, splitRequirements, tuitionOffer, type DetailTuition } from "./detailPresentation";

import { ArrowLeft, BookOpen, ArrowUpRight, Building2, GraduationCap, Clock3, Languages, MapPin, CalendarDays, FileText, Wallet } from "lucide-react";

type ProgramDetailPayload = {
  editorial?: unknown;
  data: {
    id: number;
    isActive?: boolean;
    tuition?: DetailTuition | null;
    countryPath?: string | null;
    cityPath?: string | null;
    name: string;
    description: string | null;
    degree: string | null;
    field: string | null;
    language: string | null;
    duration: string | null;
    tuitionFee: number | null;
    discountedFee: number | null;
    scholarship: number | null;
    currency: string | null;
    intakes: string | null;
    requirements: string | null;
    depositFee: number | null;
    languageFee: number | null;
    feeType: string | null;
    quota: number | null;
    fallbackUsed: boolean;
    canonicalPath: string;
    universityId: number;
    universityIsActive?: boolean;
    universityName: string;
    universityCountry: string;
    universityCity: string | null;
    universityType: string | null;
    universityWebsite: string | null;
    universityDescription: string | null;
    universityAddress: string | null;
    universityLogoUrl: string | null;
    universityPath: string;
  };
  intakes: Array<{
    id: string;
    intakeKey: string;
    academicYear: number;
    startsOn: string | null;
    applicationDeadlineAt: string | null;
    capacityStatus: string;
    deliveryMode: string;
    campusName: string | null;
    campusCountryCode: string | null;
    publicAddress: string | null;
  }>;
  prices: Array<{
    id: string;
    componentType: string;
    amountMinor: string;
    currencyCode: string;
    frequency: string;
  }>;
  related: Array<CityProgramCardData & {
    id: number;
    name: string;
    degree: string | null;
    field: string | null;
    duration: string | null;
    language: string | null;
    tuitionFee: number | null;
    discountedFee: number | null;
    currency: string | null;
    universityName: string;
    universityCountry: string;
    universityCity: string | null;
    canonicalPath: string;
  }>;
  meta: {
    canonicalPath: string;
    requestedPathIsCanonical: boolean;
    indexable: boolean;
    alternatePaths: Record<string, string>;
    relatedPolicy: "PUBLISHED_INDEXABLE_ONLY" | "LEGACY_UNGATED";
  };
};

function localizedDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function minorAmount(value: string, currency: string): number | null {
  const amountMinor = Number(value);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !detailMoney(0, currency, "en")) return null;
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  if (typeof digits !== "number") return null;
  return amountMinor / (10 ** digits);
}

export default function ProgramDetail({ routeKey }: { routeKey: string }) {
  const { t, lang, localePath } = useI18n();
  const [, setLocation] = useLocation();
  const [payload, setPayload] = useState<ProgramDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const program = payload?.data;
  const editorial = boundDetailContent(payload?.editorial, "program", program?.id, lang);
  const tuition = program ? displayTuition(program, lang) : null;
  const copy = detailCopy(lang);

  useSeo({
    title: program?.name || t("programs.programDetails"),
    description: program?.description || [program?.degree, program?.field, program?.universityName].filter(Boolean).join(" · ") || t("programs.subtitle"),
    canonical: program ? `${SITE_URL}${program.canonicalPath}` : undefined,
    noindex: error || !payload?.meta.indexable,
    lang,
    alternates: payload?.meta.alternatePaths,
  });
  useJsonLd(program ? [
    {
      "@context": "https://schema.org",
      "@type": "Course",
      "@id": `${SITE_URL}${program.canonicalPath}#course`,
      name: program.name,
      description: program.description || undefined,
      url: `${SITE_URL}${program.canonicalPath}`,
      provider: {
        "@type": "CollegeOrUniversity",
        name: program.universityName,
        url: `${SITE_URL}${program.universityPath}`,
        address: {
          "@type": "PostalAddress",
          addressLocality: program.universityCity || undefined,
          addressCountry: program.universityCountry,
        },
      },
      inLanguage: program.language || undefined,
      timeRequired: program.duration || undefined,
      offers: tuitionOffer(tuition, programAdmissionsOpen(program)),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: t("nav.programs"), item: `${SITE_URL}${localePath("/programs")}` },
        { "@type": "ListItem", position: 3, name: program.name, item: `${SITE_URL}${program.canonicalPath}` },
      ],
    },
  ] : []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    customFetch<ProgramDetailPayload>(
      `/api/public/catalog/programs/${encodeURIComponent(routeKey)}?locale=${encodeURIComponent(lang)}`,
      { method: "GET" },
    )
      .then((result) => {
        if (cancelled) return;
        setPayload(result);
        if (!result.meta.requestedPathIsCanonical) {
          setLocation(result.meta.canonicalPath, { replace: true });
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [lang, routeKey, setLocation]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24">
        <div className="h-56 animate-pulse rounded-3xl bg-secondary" />
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="h-80 animate-pulse rounded-2xl bg-secondary lg:col-span-2" />
          <div className="h-80 animate-pulse rounded-2xl bg-secondary" />
        </div>
      </div>
    );
  }

  if (error || !program || !payload) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-32 text-center">
        <BookOpen className="mx-auto mb-5 h-14 w-14 text-muted-foreground/40" />
        <h1 className="text-2xl font-bold">{t("programs.noResults")}</h1>
        <p className="mt-2 text-muted-foreground">{t("programs.noResultsDesc")}</p>
        <Button asChild variant="outline" className="mt-7 rounded-full">
          <Link href={localePath("/programs")}><ArrowLeft className="mr-2 h-4 w-4" />{t("countryDetail.viewAllPrograms")}</Link>
        </Button>
      </div>
    );
  }

  const visiblePrices = payload.prices.slice(0, 8);
  const { requirements, metadata } = splitRequirements(program.requirements, { canonicalPath: program.canonicalPath, id: program.id });
  const countryPath = localDetailPath(program.countryPath), cityPath = localDetailPath(program.cityPath);
  const hasFees = visiblePrices.length > 0 || tuition !== null;
  const campuses = [...new Set(payload.intakes.map(intake => intake.campusName).filter(Boolean))].join(" · ");
  const institutionLocation = <>{cityPath ? <Link href={cityPath}>{program.universityCity}</Link> : program.universityCity}{program.universityCity && " · "}{countryPath ? <Link href={countryPath}>{program.universityCountry}</Link> : program.universityCountry}</>;
  const apply = programAdmissionsOpen(program)
    ? <Link href={`${localePath("/programs")}?programId=${program.id}`}>{t("courseFinderPage.apply")}<ArrowUpRight size={17} aria-hidden="true" /></Link>
    : <button disabled>{t("courseFinderPage.apply")} · {t("common.inactive")}</button>;

  return (
    <DetailLayout kind="program">
      <section data-detail-section="hero">
        <div className="detail-hero">
          <div className="detail-wrap detail-hero-top">
            <DetailBreadcrumbs label={copy.catalogue} items={[
              { label: t("nav.programs"), path: localePath("/programs") },
              { label: program.universityCountry, path: countryPath },
              { label: program.universityCity || "", path: cityPath },
              { label: program.universityName, path: program.universityPath },
              { label: program.name },
            ]} />
          </div>
          <div className="detail-wrap detail-hero-main">
            <div className="detail-hero-content">
              <div className="detail-identity">
                <DetailIdentity src={program.universityLogoUrl} name={program.universityName} />
                <Link className="detail-hero-link" href={program.universityPath}>{program.universityName}<ArrowUpRight size={17} aria-hidden="true" /></Link>
              </div>
              <p className="detail-eyebrow">{copy.program}</p>
              <h1>{program.name}</h1>
              <p className="detail-hero-lead detail-icon-line"><MapPin size={18} aria-hidden="true" /><span>{institutionLocation}</span></p>
              <div className="detail-meta-pills">
                {program.degree && <span className="detail-meta-pill"><GraduationCap size={15} aria-hidden="true" />{program.degree}</span>}
                {program.field && <span className="detail-meta-pill"><BookOpen size={15} aria-hidden="true" />{program.field}</span>}
              </div>
            </div>
            <aside className="detail-hero-card" aria-label={t("courseFinderPage.tuitionFee")}>
              <p className="detail-eyebrow detail-icon-line"><Wallet size={16} aria-hidden="true" />{t("courseFinderPage.tuitionFee")}</p>
              <DetailPrice tuition={tuition} locale={lang} verifiedLabel={t("catalogDetail.verifiedPrice")} />
              {(program.duration || payload.intakes.length > 0) && <dl className="detail-summary-list">
                {program.duration && <div><dt><Clock3 size={16} aria-hidden="true" />{durationIsAmbiguous(program.duration) ? copy.durationAsListed : t("courseFinderPage.duration")}</dt><dd><bdi>{program.duration}</bdi></dd></div>}
                {payload.intakes.length > 0 && <div><dt><CalendarDays size={16} aria-hidden="true" />{t("catalogDetail.availableIntakes")}</dt><dd>{new Intl.NumberFormat(lang).format(payload.intakes.length)}</dd></div>}
              </dl>}
              <div className="detail-actions">{apply}</div>
              <div className="detail-actions"><Link href={localePath("/contact")} className="is-secondary">{t("countryDetail.talkToAdvisor")}</Link></div>
            </aside>
          </div>
        </div>
        <div className="detail-factbar"><div className="detail-wrap">
          <DetailFacts items={[
            { label: t("courseFinderPage.degree"), value: program.degree, icon: <GraduationCap size={18} aria-hidden="true" /> },
            { label: durationIsAmbiguous(program.duration) ? copy.durationAsListed : t("courseFinderPage.duration"), value: program.duration, icon: <Clock3 size={18} aria-hidden="true" /> },
            { label: t("courseFinderPage.language"), value: program.language, icon: <Languages size={18} aria-hidden="true" /> },
            { label: campuses ? copy.campus : copy.institutionLocation, value: campuses || institutionLocation, icon: <MapPin size={18} aria-hidden="true" /> },
          ]} />
        </div></div>
      </section>
      <nav data-detail-section="navigation" className="detail-nav" aria-label={t("programs.programDetails")}>
        <div className="detail-wrap">
          <a href="#overview">{copy.overview}</a>
          {requirements.length > 0 && <a href="#requirements">{t("programs.requirements")}</a>}
          {payload.intakes.length > 0 && <a href="#intakes">{t("catalogDetail.availableIntakes")}</a>}
          {hasFees && <a href="#fees">{t("courseFinderPage.tuitionFee")}</a>}
          {detailContentNavigation(editorial)}
          {payload.related.length > 0 && <a href="#related">{t("catalogDetail.relatedPrograms")}</a>}
        </div>
      </nav>
      <section data-detail-section="overview" id="overview" className="detail-section">
        <div className="detail-wrap">
          <DetailHeading number="01" eyebrow={copy.program} title={copy.overview} />
          <div className="detail-split">
            <div>
              {program.description ? <p className="detail-prose detail-snapshot">{program.description}</p> : <DetailFacts items={[
                { label: t("courseFinderPage.degree"), value: program.degree },
                { label: t("courseFinderPage.field"), value: program.field },
                { label: t("courseFinderPage.language"), value: program.language },
              ]} />}
              {durationIsAmbiguous(program.duration) && <p className="detail-provenance">{copy.durationNote}</p>}
            </div>
            <div>
              <p className="detail-eyebrow">{copy.courseInformation}</p>
              <dl className="detail-keylines">
                <div><dt><Building2 size={17} aria-hidden="true" />{copy.institution}</dt><dd><Link href={program.universityPath}>{program.universityName}</Link></dd></div>
                <div><dt><MapPin size={17} aria-hidden="true" />{copy.institutionLocation}</dt><dd>{institutionLocation}</dd></div>
                {metadata.map((item, index) => <div key={index}><dt><BookOpen size={17} aria-hidden="true" />{copy[item.key]}</dt><dd>{item.value}</dd></div>)}
              </dl>
              {metadata.length > 0 && <p className="detail-provenance">{copy.catalogueNote}</p>}
            </div>
          </div>
        </div>
      </section>
      {requirements.length > 0 && <section data-detail-section="requirements" id="requirements" className="detail-section is-sky">
        <div className="detail-wrap detail-split">
          <DetailHeading number="02" eyebrow={copy.program} title={t("programs.requirements")} />
          <ul className="detail-program-points">{requirements.map((item, index) => <li key={index}><FileText size={20} aria-hidden="true" /><span>{item}</span></li>)}</ul>
        </div>
      </section>}
      {payload.intakes.length > 0 && <section data-detail-section="intakes" id="intakes" className="detail-section is-sand">
        <div className="detail-wrap">
          <DetailHeading number="03" eyebrow={copy.program} title={t("catalogDetail.availableIntakes")} />
          <div className="detail-grid">{payload.intakes.map(intake => <article key={intake.id} className="detail-intake">
            <p className="detail-eyebrow detail-icon-line"><CalendarDays size={17} aria-hidden="true" />{intake.academicYear}</p><h3>{intake.intakeKey}</h3>
            <span className="detail-pill">{t(`catalogDetail.capacity${intake.capacityStatus.charAt(0) + intake.capacityStatus.slice(1).toLowerCase()}`)}</span>
            <dl className="detail-keylines">
              <div><dt>{copy.mode}</dt><dd>{t(`catalogDetail.delivery${intake.deliveryMode === "ON_CAMPUS" ? "OnCampus" : intake.deliveryMode.charAt(0) + intake.deliveryMode.slice(1).toLowerCase()}`)}</dd></div>
              {intake.campusName && <div><dt>{copy.campus}</dt><dd>{intake.campusName}{intake.publicAddress && <><br />{intake.publicAddress}</>}</dd></div>}
              {localizedDate(intake.startsOn, lang) && <div><dt>{t("common.date")}</dt><dd>{localizedDate(intake.startsOn, lang)}</dd></div>}
              {localizedDate(intake.applicationDeadlineAt, lang) && <div><dt>{t("studentJourney.deadline")}</dt><dd>{localizedDate(intake.applicationDeadlineAt, lang)}</dd></div>}
            </dl>
          </article>)}</div>
        </div>
      </section>}
      {hasFees && <section data-detail-section="fees" id="fees" className="detail-section is-sky">
        <div className="detail-wrap detail-split">
          <div><DetailHeading number="04" eyebrow={copy.program} title={t("courseFinderPage.tuitionFee")} />{tuition?.source !== "legacy" && <p className="detail-provenance">{copy.priceBasis}</p>}</div>
          <div className="detail-fee-panel">{tuition && <DetailPrice tuition={tuition} locale={lang} verifiedLabel={t("catalogDetail.verifiedPrice")} />}
            {visiblePrices.length > 0 && <dl className="detail-keylines">{visiblePrices.map(price => <div key={price.id}>
              <dt>{price.componentType === "TUITION" ? t("courseFinderPage.tuitionFee") : price.componentType === "DEPOSIT" ? t("catalogDetail.deposit") : price.componentType.replaceAll("_", " ").toLowerCase()}</dt>
              <dd>{detailMoney(minorAmount(price.amountMinor, price.currencyCode), price.currencyCode, lang) || copy.confirmPrice}<small className="block">{price.frequency.replaceAll("_", " ").toLowerCase()}</small></dd>
            </div>)}</dl>}
          </div>
        </div>
      </section>}
      {payload.related.length > 0 && <section data-detail-section="related" id="related" className="detail-section">
        <div className="detail-wrap">
          <DetailHeading number="05" eyebrow={copy.studyOptions} title={t("catalogDetail.relatedPrograms")} />
          <CityProgramCards key={`${program.id}:${lang}`} programs={payload.related} />
        </div>
      </section>}
      {detailContentSections(editorial, lang, localePath("/contact"))}
      <DetailMobileActions data-detail-section="mobileActions">{apply}<Link className="is-secondary" href={localePath("/contact")}>{t("countryDetail.talkToAdvisor")}</Link></DetailMobileActions>
    </DetailLayout>
  );
}
