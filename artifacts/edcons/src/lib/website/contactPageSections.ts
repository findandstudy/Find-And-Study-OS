import type { PageBlock } from "./blockTypes";
import { contactDesignBlocks } from "./studentServices";
import { getTranslation, type Language } from "../i18n/index";
export function contactPageSections(source:PageBlock[],locale:Language):PageBlock[]{
 if(source.some(b=>b.content.variant==="contact-workspace"))return structuredClone(source).map(b=>b.content.variant==="contact-workspace"?{...b,content:{embedWidgetSlug:"website-contact",...b.content}}:b);
 const blocks=contactDesignBlocks(locale);
 if(!["en","tr"].includes(locale)){
  const t=(key:string)=>getTranslation(locale,key);
  blocks[0].content.title=t("nav.contact");blocks[0].content.breadcrumbLabel=t("nav.home");
  Object.assign(blocks[1].content,{eyebrow:t("contact.badge"),title:t("contact.title"),titleAccent:t("contact.titleHighlight"),formTitle:t("contact.formTitle"),subtitle:t("contact.formSubtitle"),submitLabel:t("contact.send")});
 }
 const inherited=source.find(b=>b.blockType==="hero"); if(inherited)blocks[0].settings=structuredClone(inherited.settings);
 return blocks;
}
