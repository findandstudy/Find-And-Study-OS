import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Award,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Globe2,
  GraduationCap,
  MapPin,
  WalletCards,
} from "lucide-react";

type ProgramDetailPayload = {
  data: {
    id: number;
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
  related: Array<{
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

function money(value: number | null, currency: string | null, locale: string) {
  if (value === null) return null;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency || "USD"}`;
  }
}

function localizedDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function minorMoney(value: string, currency: string, locale: string): string | null {
  const amountMinor = Number(value);
  if (!Number.isSafeInteger(amountMinor)) return null;
  return money(amountMinor / 100, currency, locale);
}

export default function ProgramDetail({ routeKey }: { routeKey: string }) {
  const { t, lang, localePath } = useI18n();
  const [, setLocation] = useLocation();
  const [payload, setPayload] = useState<ProgramDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const program = payload?.data;

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
      offers: program.tuitionFee !== null ? {
        "@type": "Offer",
        price: program.discountedFee ?? program.tuitionFee,
        priceCurrency: program.currency || "USD",
      } : undefined,
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

  const effectiveFee = program.discountedFee ?? program.tuitionFee;
  const verifiedTuition = payload.prices.find((price) => price.componentType === "TUITION");
  const visiblePrices = payload.prices.slice(0, 8);

  return (
    <>
      <section className="border-b border-border/40 bg-gradient-to-br from-primary/10 via-background to-accent/10 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Link href={localePath("/programs")} className="mb-7 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary">
            <ArrowLeft className="h-4 w-4" /> {t("countryDetail.viewAllPrograms")}
          </Link>
          <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="mb-4 flex flex-wrap gap-2">
                {program.degree && <Badge>{program.degree}</Badge>}
                {program.field && <Badge variant="secondary">{program.field}</Badge>}
                {program.universityType && <Badge variant="outline">{program.universityType}</Badge>}
              </div>
              <h1 className="max-w-4xl font-display text-3xl font-bold leading-tight text-foreground md:text-5xl">{program.name}</h1>
              <Link href={program.universityPath} className="mt-5 inline-flex items-center gap-2 font-semibold text-primary hover:underline">
                <Building2 className="h-5 w-5" /> {program.universityName}
              </Link>
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" /> {[program.universityCity, program.universityCountry].filter(Boolean).join(", ")}
              </p>
            </div>
            <div className="min-w-[260px] rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("courseFinderPage.tuitionFee")}</p>
              <p className="mt-2 text-3xl font-extrabold text-foreground">{money(effectiveFee, program.currency, lang) || "—"}</p>
              {program.discountedFee !== null && program.tuitionFee !== null && program.discountedFee < program.tuitionFee && (
                <p className="mt-1 text-sm text-muted-foreground line-through">{money(program.tuitionFee, program.currency, lang)}</p>
              )}
              {verifiedTuition && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{t("catalogDetail.verifiedPrice")}</p>
              )}
              <Button asChild className="mt-6 w-full rounded-xl">
                <Link href={`${localePath("/programs")}?programId=${program.id}`}>{t("courseFinderPage.apply")}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <nav className="sticky top-0 z-20 border-b border-border/60 bg-background/95 backdrop-blur" aria-label={t("programs.programDetails")}>
        <div className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-4 py-3 text-sm font-semibold [scrollbar-width:none] sm:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden">
          <a href="#overview" className="whitespace-nowrap text-muted-foreground hover:text-primary">{t("programs.programDetails")}</a>
          {program.requirements ? <a href="#requirements" className="whitespace-nowrap text-muted-foreground hover:text-primary">{t("programs.requirements")}</a> : null}
          {payload.intakes.length > 0 ? <a href="#intakes" className="whitespace-nowrap text-muted-foreground hover:text-primary">{t("catalogDetail.availableIntakes")}</a> : null}
          {visiblePrices.length > 0 ? <a href="#fees" className="whitespace-nowrap text-muted-foreground hover:text-primary">{t("courseFinderPage.tuitionFee")}</a> : null}
          {payload.related.length > 0 ? <a href="#related" className="whitespace-nowrap text-muted-foreground hover:text-primary">{t("catalogDetail.relatedPrograms")}</a> : null}
        </div>
      </nav>

      <section id="overview" className="scroll-mt-20 py-12">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-3 lg:px-8">
          <div className="space-y-8 lg:col-span-2">
            {program.description && (
              <article id="requirements" className="scroll-mt-24 rounded-2xl border border-border/50 bg-card p-6 md:p-8">
                <h2 className="text-2xl font-bold">{t("countryDetail.about", { name: program.name })}</h2>
                <p className="mt-4 whitespace-pre-line leading-7 text-muted-foreground">{program.description}</p>
              </article>
            )}
            {program.requirements && (
              <article className="rounded-2xl border border-border/50 bg-card p-6 md:p-8">
                <h2 className="flex items-center gap-2 text-2xl font-bold"><CheckCircle2 className="h-6 w-6 text-primary" />{t("programs.requirements")}</h2>
                <p className="mt-4 whitespace-pre-line leading-7 text-muted-foreground">{program.requirements}</p>
              </article>
            )}
            {payload.intakes.length > 0 && (
              <section id="intakes" className="scroll-mt-24 rounded-2xl border border-border/50 bg-card p-6 md:p-8">
                <h2 className="flex items-center gap-2 text-2xl font-bold"><CalendarDays className="h-6 w-6 text-primary" />{t("catalogDetail.availableIntakes")}</h2>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {payload.intakes.map((intake) => (
                    <div key={intake.id} className="rounded-xl border border-border/50 bg-secondary/30 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="font-bold">{intake.intakeKey}</p><p className="text-sm text-muted-foreground">{intake.academicYear} · {t(`catalogDetail.delivery${intake.deliveryMode === "ON_CAMPUS" ? "OnCampus" : intake.deliveryMode.charAt(0) + intake.deliveryMode.slice(1).toLowerCase()}`)}</p></div>
                        <Badge variant={intake.capacityStatus === "OPEN" ? "default" : "secondary"}>{t(`catalogDetail.capacity${intake.capacityStatus.charAt(0) + intake.capacityStatus.slice(1).toLowerCase()}`)}</Badge>
                      </div>
                      {intake.campusName && <p className="mt-3 text-sm text-muted-foreground">{intake.campusName}</p>}
                      {(localizedDate(intake.startsOn, lang) || localizedDate(intake.applicationDeadlineAt, lang)) && (
                        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/50 pt-3 text-xs">
                          {localizedDate(intake.startsOn, lang) ? <div><dt className="text-muted-foreground">{t("common.date")}</dt><dd className="mt-1 font-semibold">{localizedDate(intake.startsOn, lang)}</dd></div> : null}
                          {localizedDate(intake.applicationDeadlineAt, lang) ? <div><dt className="text-muted-foreground">{t("studentJourney.deadline")}</dt><dd className="mt-1 font-semibold">{localizedDate(intake.applicationDeadlineAt, lang)}</dd></div> : null}
                        </dl>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {visiblePrices.length > 0 && (
              <section id="fees" className="scroll-mt-24 rounded-2xl border border-border/50 bg-card p-6 md:p-8">
                <h2 className="flex items-center gap-2 text-2xl font-bold"><WalletCards className="h-6 w-6 text-primary" />{t("courseFinderPage.tuitionFee")}</h2>
                <dl className="mt-5 divide-y divide-border/60 rounded-xl border border-border/60">
                  {visiblePrices.map((price) => (
                    <div key={price.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                      <dt className="text-muted-foreground">{price.componentType === "TUITION" ? t("courseFinderPage.tuitionFee") : price.componentType === "DEPOSIT" ? t("catalogDetail.deposit") : price.componentType.replaceAll("_", " ").toLowerCase()}</dt>
                      <dd className="text-right font-bold">{minorMoney(price.amountMinor, price.currencyCode, lang) || "—"}<span className="ml-1 font-normal text-muted-foreground">· {price.frequency.toLowerCase()}</span></dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 flex items-center gap-2 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" />{t("catalogDetail.verifiedPrice")}</p>
              </section>
            )}
          </div>

          <aside className="space-y-5">
            <div className="rounded-2xl border border-border/50 bg-card p-6 lg:sticky lg:top-24">
              <h2 className="font-bold">{t("programs.programDetails")}</h2>
              <dl className="mt-5 space-y-4 text-sm">
                {[
                  [GraduationCap, t("courseFinderPage.degree"), program.degree],
                  [BookOpen, t("courseFinderPage.field"), program.field],
                  [Globe2, t("courseFinderPage.language"), program.language],
                  [Clock3, t("courseFinderPage.duration"), program.duration],
                  [CalendarDays, t("courseFinderPage.intakes"), program.intakes],
                  [Award, t("courseFinderPage.scholarship"), money(program.scholarship, program.currency, lang)],
                  [WalletCards, t("catalogDetail.deposit"), money(program.depositFee, program.currency, lang)],
                ].filter((item) => Boolean(item[2])).map(([Icon, label, value]) => {
                  const DetailIcon = Icon as typeof BookOpen;
                  return <div key={String(label)} className="flex gap-3"><DetailIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><dt className="text-muted-foreground">{String(label)}</dt><dd className="font-semibold text-foreground">{String(value)}</dd></div></div>;
                })}
              </dl>
            </div>
          </aside>
        </div>
      </section>

      {payload.related.length > 0 && (
        <section id="related" className="scroll-mt-24 bg-secondary/30 py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold">{t("catalogDetail.relatedPrograms")}</h2>
            <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {payload.related.map((related) => (
                <Link key={related.id} href={related.canonicalPath} className="rounded-2xl border border-border/50 bg-card p-5 transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-md">
                  <p className="text-xs font-semibold text-primary">{related.universityName}</p>
                  <h3 className="mt-2 line-clamp-2 font-bold">{related.name}</h3>
                  <p className="mt-3 text-sm text-muted-foreground">{[related.degree, related.duration, related.language].filter(Boolean).join(" · ")}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
