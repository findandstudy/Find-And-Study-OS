import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useTemplatePage, useTemplatePageSeo } from "./useTemplatePage";
import { CmsBlock, CmsPageCanvas } from "./PublicPage";
import type { PageBlock } from "@/lib/website/blockTypes";
import { useJsonLd, SITE_URL, SITE_NAME, ORG_SCHEMA } from "@/hooks/use-json-ld";
import { enrichManagedHomePageBlocks, managedHomePageBlocks, MANAGED_HOME_BLOCK_TYPES } from "@/lib/website/managedPageStarters";

function HomeBlocks({ blocks, version, pageTitle, locale }: { blocks: PageBlock[]; version?: number; pageTitle: string; locale: string }) {
  const content = <div data-public-page-version={version}>{blocks.map((block, index) => <CmsBlock block={block} index={index} variables={{ siteName: SITE_NAME, pageTitle, pageSlug: "home", pageLocale: locale }} key={`${block.blockType}-${index}`} />)}</div>;
  return blocks.every(block => MANAGED_HOME_BLOCK_TYPES.has(block.blockType))
    ? <div className="home-future-page">{content}</div>
    : <CmsPageCanvas className="home-future-page">{content}</CmsPageCanvas>;
}

export default function Home() {
  const { t, lang, localePath } = useI18n();
  const page = useTemplatePage("home", lang);
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

  if (page) return <HomeBlocks blocks={enrichManagedHomePageBlocks(page.data.blocks, localePath("/programs"))} version={page.data.versionNumber} pageTitle={page.data.title} locale={lang} />;

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

  return <HomeBlocks blocks={fallbackBlocks} pageTitle={t("seo.homeTitle")} locale={lang} />;
}
