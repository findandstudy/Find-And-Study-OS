import type { Language } from "@/lib/i18n";
import { enrichManagedPageBlocks, managedPageStarterBlocks } from "@/lib/website/managedPageStarters";
import { independentAboutSections } from "@/lib/website/independentAboutSections";
import { CmsBlock, CmsPageCanvas, type PageBlock, type PageResponse } from "./PublicPage";
import { SITE_NAME } from "@/hooks/use-json-ld";
export function AboutReferenceLayout({lang,page,transformBlock}:{template:string;lang:Language;page:PageResponse|null;transformBlock?:(block:PageBlock)=>PageBlock}) {
 const source=page?.data.blocks?.length?enrichManagedPageBlocks("about", page.data.blocks, lang):managedPageStarterBlocks("about",lang);
 const blocks=independentAboutSections(source.map(b=>({...b,isVisible:(b as {isVisible?:boolean}).isVisible??true})),lang).map(b=>transformBlock?transformBlock(b):b);
 return <CmsPageCanvas className="cms-independent-about-page"><div data-managed-template="about" data-public-page-version={page?.data.versionNumber??"starter"}>{blocks.filter(b=>(b as {isVisible?:boolean}).isVisible!==false).map((block,index)=><CmsBlock key={index} block={block} index={index} variables={{siteName:SITE_NAME,pageTitle:page?.data.title??"About",pageSlug:"about",pageLocale:lang}}/>)}</div></CmsPageCanvas>;
}
