import type { ReactNode } from "react";
import type { Language } from "@/lib/i18n";
import { enrichManagedPageBlocks, managedPageStarterBlocks } from "@/lib/website/managedPageStarters";
import type { PageBlock, PageResponse } from "./PublicPage";
import { CmsBlock, CmsPageCanvas } from "./PublicPage";
import type { ManagedTemplateSlug } from "./useTemplatePage";
import { SITE_NAME } from "@/hooks/use-json-ld";
import "./innerPagesVistara.css";

type ManagedPublicPageProps = {
  template: Exclude<ManagedTemplateSlug, "home">;
  lang: Language;
  page: PageResponse | null;
  slotBlockType?: string;
  slotContent?: ReactNode;
  transformBlock?: (block: PageBlock) => PageBlock;
};

/**
 * Keeps managed editorial sections and live product surfaces in one ordered
 * canvas. A catalogue/form/blog slot is replaced with the real interactive
 * implementation, so adopting the managed design never removes filtering,
 * submissions, live rows, or other product behaviour.
 */
export function ManagedPublicPage({
  template,
  lang,
  page,
  slotBlockType,
  slotContent,
  transformBlock,
}: ManagedPublicPageProps) {
  const sourceBlocks = page?.data.blocks?.length
    ? enrichManagedPageBlocks(template, page.data.blocks, lang)
    : managedPageStarterBlocks(template, lang);
  const aboutBlockOrder = new Map([
    ["hero", 0],
    ["media_text", 1],
    ["counter_grid", 2],
    ["grid_box", 3],
    ["process_steps", 4],
    ["team_grid", 5],
    ["logo_marquee", 6],
    ["office_list", 7],
    ["faq", 8],
    ["cta_banner", 9],
  ]);
  // The About template has a fixed presentation narrative: masthead, visual
  // introduction, proof, values, process, people and next action. Content is
  // still CMS-owned, but historical block order can no longer break that flow.
  const orderedBlocks = template === "about"
    ? sourceBlocks
      .map((entry, sourceIndex) => ({ entry, sourceIndex }))
      .sort((a, b) => (aboutBlockOrder.get(a.entry.blockType) ?? 50) - (aboutBlockOrder.get(b.entry.blockType) ?? 50) || a.sourceIndex - b.sourceIndex)
      .map(({ entry }) => entry)
    : sourceBlocks;
  const homeLabels: Partial<Record<Language, string>> = {
    en: "Home", tr: "Ana Sayfa", fr: "Accueil", es: "Inicio",
    ru: "Главная", zh: "首页", ar: "الرئيسية", fa: "خانه",
  };
  const decoratedBlocks = orderedBlocks.map(block => {
    if (block.blockType === "hero") {
      return {
        ...block,
        content: {
          ...block.content,
          backgroundImage: block.content.backgroundImage || "/images/auth-bg.png",
          breadcrumbHome: homeLabels[lang] || "Home",
          breadcrumbHomeUrl: `/${lang}`,
          breadcrumbLabel: page?.data.title || template,
        },
      };
    }

    // Managed About pages previously rendered an empty "Image" placeholder
    // whenever the editor had not selected media. Keep editor media
    // authoritative, but provide a stable branded fallback for starter/legacy
    // content so the public split layout never collapses visually.
    if (template === "about" && block.blockType === "media_text" && !block.content.imageUrl) {
      return {
        ...block,
        content: {
          ...block.content,
          imageUrl: "/images/auth-bg.png",
          altText: block.content.altText || page?.data.title || SITE_NAME,
          imagePosition: "left",
        },
      };
    }

    if (template === "about" && block.blockType === "media_text") {
      return {
        ...block,
        content: { ...block.content, imagePosition: "left" },
      };
    }

    return block;
  });
  const blocks = transformBlock ? decoratedBlocks.map(transformBlock) : decoratedBlocks;
  const hasSlot = Boolean(slotBlockType && blocks.some(block => block.blockType === slotBlockType));
  let insertedFallbackSlot = false;

  return (
    <CmsPageCanvas className={`managed-public-page managed-agency-page managed-agency-page--${template}`}>
      <div data-managed-template={template} data-public-page-version={page?.data.versionNumber ?? "starter"}>
        {blocks.map((block, index) => {
          if (slotBlockType && block.blockType === slotBlockType) {
            return <div key={`live-slot-${slotBlockType}-${index}`} data-managed-live-slot={slotBlockType}>{slotContent}</div>;
          }
          const rendered = <CmsBlock block={block} index={index} variables={{ siteName: SITE_NAME, pageTitle: page?.data.title ?? template, pageSlug: page?.data.slug ?? template, pageLocale: lang }} key={`${block.blockType}-${block.sortOrder}-${index}`} />;
          if (!hasSlot && !insertedFallbackSlot && slotContent && block.blockType === "hero") {
            insertedFallbackSlot = true;
            return <div key={`hero-with-live-slot-${index}`}>{rendered}<div data-managed-live-slot="fallback">{slotContent}</div></div>;
          }
          return rendered;
        })}
        {!hasSlot && !insertedFallbackSlot && slotContent ? <div data-managed-live-slot="fallback-end">{slotContent}</div> : null}
      </div>
    </CmsPageCanvas>
  );
}
