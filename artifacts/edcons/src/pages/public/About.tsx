import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { useJsonLd, ORG_SCHEMA, SITE_NAME, SITE_URL } from "@/hooks/use-json-ld";
import { useSeo } from "@/hooks/use-seo";
import { ManagedPublicPage } from "./ManagedPublicPage";
import { useTemplatePage, useTemplatePageSeo } from "./useTemplatePage";

type TeamMember = {
  id: number;
  name: string;
  title: string | null;
  bio: string | null;
  photoUrl: string | null;
};

export default function About() {
  const { t, lang } = useI18n();
  const page = useTemplatePage("about", lang);
  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["cms-team-members", lang],
    queryFn: () => customFetch(`/api/cms/team-members?lang=${encodeURIComponent(lang)}`),
    staleTime: 5 * 60 * 1000,
  });

  useSeo({
    title: page?.meta.title || t("seo.aboutTitle"),
    description: page?.meta.description || t("seo.aboutDesc"),
    lang,
    noindex: page ? !page.meta.indexable : false,
    alternates: page?.meta.alternatePaths,
    canonical: typeof page?.data.seo?.canonicalUrl === "string" && page.data.seo.canonicalUrl
      ? page.data.seo.canonicalUrl
      : undefined,
  });
  useTemplatePageSeo(page);
  useJsonLd([
    ORG_SCHEMA,
    {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      "@id": `${SITE_URL}/en/about#webpage`,
      name: `About ${SITE_NAME}`,
      url: `${SITE_URL}/en/about`,
      description: "Learn about Find And Study, our mission, team, and international education services.",
      isPartOf: { "@id": `${SITE_URL}/#website` },
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ]);

  return <ManagedPublicPage
    template="about"
    lang={lang}
    page={page}
    transformBlock={block => block.blockType === "team_grid" ? {
      ...block,
      content: {
        ...block.content,
        members: teamMembers.map(member => ({
          name: member.name,
          role: member.title || "",
          bio: member.bio || "",
          photo: member.photoUrl || "",
        })),
      },
    } : block}
  />;
}
