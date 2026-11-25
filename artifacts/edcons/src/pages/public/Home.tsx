import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useTemplatePage, useTemplatePageSeo } from "./useTemplatePage";
import { CmsBlock, CmsPageCanvas } from "./PublicPage";
import type { PageBlock } from "@/lib/website/blockTypes";
import { useJsonLd, SITE_URL, SITE_NAME, ORG_SCHEMA } from "@/hooks/use-json-ld";
import { enrichManagedHomePageBlocks, managedHomePageBlocks } from "@/lib/website/managedPageStarters";
import { hydrateManagedHomeDestinations, hydrateManagedHomeUniversities, type HomeDestination, type HomeUniversity } from "@/lib/website/homeDestinationCards";

type HomeUniversityResponse = { data: HomeUniversity[] };

function HomeBlocks({ blocks, version, pageTitle, locale }: { blocks: PageBlock[]; version?: number; pageTitle: string; locale: string }) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(":scope > .cms-editorial-block"));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.classList.add("home-motion-ready");
    blocks.forEach((block, index) => block.style.setProperty("--home-reveal-order", String(Math.min(index, 8))));
    if (reducedMotion || !("IntersectionObserver" in window)) {
      blocks.forEach(block => block.classList.add("home-reveal-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        (entry.target as HTMLElement).classList.add("home-reveal-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -10%", threshold: .08 });
    blocks.forEach((block, index) => index === 0 ? block.classList.add("home-reveal-visible") : observer.observe(block));
    return () => observer.disconnect();
  }, [blocks, locale, version]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    if (reducedMotion.matches || coarsePointer.matches) return;

    let animationFrame = 0;
    const resetPointer = () => {
      root.style.setProperty("--home-pointer-x", "0px");
      root.style.setProperty("--home-pointer-y", "0px");
      root.style.setProperty("--home-pointer-px", "72%");
      root.style.setProperty("--home-pointer-py", "30%");
    };
    const updatePointer = (event: PointerEvent) => {
      cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const viewportWidth = Math.max(window.innerWidth, 1);
        const viewportHeight = Math.max(window.innerHeight, 1);
        const normalizedX = Math.min(1, Math.max(0, event.clientX / viewportWidth));
        const normalizedY = Math.min(1, Math.max(0, event.clientY / viewportHeight));
        root.style.setProperty("--home-pointer-x", `${((normalizedX - 0.5) * 18).toFixed(2)}px`);
        root.style.setProperty("--home-pointer-y", `${((normalizedY - 0.5) * 12).toFixed(2)}px`);
        root.style.setProperty("--home-pointer-px", `${(normalizedX * 100).toFixed(2)}%`);
        root.style.setProperty("--home-pointer-py", `${(normalizedY * 100).toFixed(2)}%`);
      });
    };

    resetPointer();
    root.addEventListener("pointermove", updatePointer, { passive: true });
    root.addEventListener("pointerleave", resetPointer);
    return () => {
      cancelAnimationFrame(animationFrame);
      root.removeEventListener("pointermove", updatePointer);
      root.removeEventListener("pointerleave", resetPointer);
    };
  }, [blocks, locale, version]);

  const content = <div ref={contentRef} data-public-page-version={version}>{blocks.map((block, index) => <CmsBlock block={block} index={index} variables={{ siteName: SITE_NAME, pageTitle, pageSlug: "home", pageLocale: locale }} key={`${block.blockType}-${index}`} />)}</div>;
  return <CmsPageCanvas className="home-future-page">{content}</CmsPageCanvas>;
}

export default function Home() {
  const { t, lang, localePath } = useI18n();
  const page = useTemplatePage("home", lang);
  const destinationQuery = useQuery<HomeDestination[]>({
    queryKey: ["home-featured-destinations", lang],
    queryFn: () => customFetch(`/api/public/destinations?locale=${encodeURIComponent(lang)}`),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const universityQuery = useQuery<HomeUniversityResponse>({
    queryKey: ["home-featured-universities"],
    queryFn: () => customFetch("/api/universities?limit=100&offset=0"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  useSeo({ title: page?.meta.title || t("seo.homeTitle"), description: page?.meta.description || t("seo.homeDesc"), lang,
    noindex: page ? !page.meta.indexable : false, alternates: page?.meta.alternatePaths,
    canonical: typeof page?.data.seo?.canonicalUrl === "string" && page.data.seo.canonicalUrl ? page.data.seo.canonicalUrl : undefined });
  useTemplatePageSeo(page);
  useJsonLd([
    ORG_SCHEMA,
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: "International student consultancy — find universities, programs and study destinations worldwide.",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_URL}/en/programs?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ]);

  if (page) {
    const blocks = enrichManagedHomePageBlocks(page.data.blocks, localePath("/programs"), {
      completeSystemFallback: page.data.id === 0 && page.data.versionNumber === 0,
    });
    const hydrated = hydrateManagedHomeUniversities(
      hydrateManagedHomeDestinations(blocks, destinationQuery.data || []),
      universityQuery.data?.data || [],
    );
    return <HomeBlocks blocks={hydrated} version={page.data.versionNumber} pageTitle={page.data.title} locale={lang} />;
  }

  const fallbackBlocks = managedHomePageBlocks({
    badge: t("hero.badge"),
    title: t("hero.title"),
    subtitle: t("hero.subtitle"),
    primaryLabel: t("hero.cta"),
    secondaryLabel: t("hero.browse"),
    visaRate: t("stats.visaRate"),
    universities: t("stats.universities"),
    countries: t("stats.countries"),
    scholarships: t("stats.scholarships"),
    featuresTitle: t("features.title"),
    featuresSubtitle: t("features.subtitle"),
    universityTitle: t("features.university"),
    universityDescription: t("features.universityDesc"),
    applicationTitle: t("features.application"),
    applicationDescription: t("features.applicationDesc"),
    visaTitle: t("features.visa"),
    visaDescription: t("features.visaDesc"),
  }, localePath("/programs"));

  const hydrated = hydrateManagedHomeUniversities(
    hydrateManagedHomeDestinations(fallbackBlocks, destinationQuery.data || []),
    universityQuery.data?.data || [],
  );
  return <HomeBlocks blocks={hydrated} pageTitle={t("seo.homeTitle")} locale={lang} />;
}
