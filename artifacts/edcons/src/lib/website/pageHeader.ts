import { getTranslation,type Language } from "../i18n/index";
import type { PageBlock } from './blockTypes';
export function capitalizePageLabel(value:string,locale='en'):string {
  const text=value.trim();
  return text?text[0].toLocaleUpperCase(locale)+text.slice(1):text;
}
export function sharedPageHeaderBlocks(blocks:PageBlock[],title:string,locale:string):PageBlock[]{
  let found=false;
  return blocks.map(block=>{
    if(found||block.blockType!=='hero')return block;
    found=true;
    if(block.content.variant==='about-banner')return block;
    return {...block,content:{...block.content,variant:'about-banner',sectionPreset:'about-banner',title,
      breadcrumbLabel:getTranslation(locale as Language,'nav.home'),breadcrumbUrl:`/${locale}`,
      backgroundImage:'/images/about-reference/page-banner.png'}};
  });
}
