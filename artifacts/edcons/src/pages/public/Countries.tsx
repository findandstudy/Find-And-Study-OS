import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowRight, Building2, Globe2, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CountryFlag, countryCodeFromEmoji } from "@/components/CountryFlag";
import { useI18n } from "@/hooks/use-i18n";
import { useJsonLd, SITE_NAME, SITE_URL } from "@/hooks/use-json-ld";
import { useSeo } from "@/hooks/use-seo";
import { ManagedPublicPage } from "./ManagedPublicPage";
import { useTemplatePage, useTemplatePageSeo } from "./useTemplatePage";

type Destination = {
  id: number;
  name: string;
  slug: string;
  country: string;
  flagEmoji: string | null;
  thumbnailUrl: string | null;
  shortDescription: string | null;
  universityCount: number;
  programCount: number;
  isFeatured: boolean;
  canonicalPath: string;
};

export default function Countries() {
  const { t, lang, localePath } = useI18n();
  const page = useTemplatePage("countries", lang);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useSeo({
    title: page?.meta.title || t("seo.countriesTitle"),
    description: page?.meta.description || t("seo.countriesDesc"),
    lang,
    noindex: page ? !page.meta.indexable : false,
    alternates: page?.meta.alternatePaths,
  });
  useTemplatePageSeo(page);
  useJsonLd({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${SITE_URL}/en/countries#webpage`,
    name: `Study Destinations — ${SITE_NAME}`,
    url: `${SITE_URL}/en/countries`,
    description: "Explore study destinations, universities, living costs, and programmes.",
    isPartOf: { "@id": `${SITE_URL}/#website` },
  });

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    customFetch<Destination[]>(`/api/public/destinations?locale=${encodeURIComponent(lang)}`, { method: "GET" })
      .then(data => { if (!cancelled) setDestinations(data); })
      .catch(() => { if (!cancelled) setDestinations([]); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [lang]);

  const featured = destinations.filter(destination => destination.isFeatured);
  const others = destinations.filter(destination => !destination.isFeatured);
  const directory = (
    <section id="destination-list" className="scroll-mt-28 py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {isLoading ? <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-80 animate-pulse rounded-3xl bg-secondary" />)}</div>
          : destinations.length === 0 ? <div className="py-24 text-center"><Globe2 className="mx-auto mb-4 h-16 w-16 text-muted-foreground/30" /><h2 className="text-xl font-bold">{t("countries.noDestinations")}</h2><p className="mt-2 text-muted-foreground">{t("countries.noDestinationsDesc")}</p></div>
          : <div className="space-y-14">
              {featured.length > 0 ? <DestinationGroup title={t("countries.featured")} destinations={featured} featured t={t} localePath={localePath} /> : null}
              {others.length > 0 ? <DestinationGroup title={featured.length ? t("countries.more") : ""} destinations={others} t={t} localePath={localePath} /> : null}
            </div>}
      </div>
    </section>
  );

  return <ManagedPublicPage template="countries" lang={lang} page={page} slotBlockType="catalog_grid" slotContent={directory} />;
}

function DestinationGroup({ title, destinations, featured, t, localePath }: {
  title: string;
  destinations: Destination[];
  featured?: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  localePath: (path: string) => string;
}) {
  return <div>{title ? <h2 className="mb-8 font-display text-2xl font-bold">{title}</h2> : null}<div className={`grid gap-8 ${featured ? "md:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>{destinations.map((destination, index) => <DestinationCard key={destination.id} destination={destination} index={index} featured={featured} t={t} localePath={localePath} />)}</div></div>;
}

function DestinationCard({ destination, index, featured, t, localePath }: {
  destination: Destination;
  index: number;
  featured?: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  localePath: (path: string) => string;
}) {
  const gradients = ["from-blue-500/20 to-indigo-600/20", "from-emerald-500/20 to-teal-600/20", "from-rose-500/20 to-pink-600/20", "from-amber-500/20 to-orange-600/20"];
  const iso = destination.country?.length === 2 ? destination.country : destination.flagEmoji ? countryCodeFromEmoji(destination.flagEmoji) : null;
  return <Link href={destination.canonicalPath || localePath(`/destinations/${destination.slug}`)} className="group block">
    <article className={`flex ${featured ? "min-h-80" : "min-h-72"} flex-col overflow-hidden rounded-[1.75rem] border border-border/50 bg-card shadow-lg shadow-slate-950/5 transition duration-300 hover:-translate-y-1 hover:shadow-xl`}>
      <div className={`relative flex h-36 items-center justify-center bg-gradient-to-br ${gradients[index % gradients.length]}`}>
        {destination.thumbnailUrl ? <img src={destination.thumbnailUrl} alt={destination.name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" /> : iso ? <CountryFlag code={iso} size="3xl" rounded className="shadow-md" alt={destination.name} /> : null}
        {destination.isFeatured ? <Badge className="absolute end-4 top-4 border-0 bg-amber-500 text-white">{t("countries.featuredBadge")}</Badge> : null}
      </div>
      <div className="flex flex-1 flex-col p-6"><h3 className="font-display text-xl font-bold transition-colors group-hover:text-primary">{destination.name}</h3>{destination.shortDescription ? <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{destination.shortDescription}</p> : null}<div className="mt-auto flex flex-wrap gap-4 pt-5 text-sm text-muted-foreground"><span className="flex items-center gap-1.5"><Building2 className="h-4 w-4 text-primary" />{destination.universityCount} {t(destination.universityCount === 1 ? "countries.university" : "countries.universities")}</span><span className="flex items-center gap-1.5"><GraduationCap className="h-4 w-4 text-accent" />{destination.programCount} {t(destination.programCount === 1 ? "countries.program" : "countries.programs")}</span></div><span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary">{t("countries.explore")} <ArrowRight className="h-4 w-4" /></span></div>
    </article>
  </Link>;
}
