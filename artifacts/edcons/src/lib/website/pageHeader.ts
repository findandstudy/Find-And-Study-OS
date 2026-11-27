import { getTranslation,type Language } from "../i18n/index";
import type { PageBlock } from './blockTypes';
export function capitalizePageLabel(value:string,locale='en'):string {
  const text=value.trim();
  return text?text[0].toLocaleUpperCase(locale)+text.slice(1):text;
}
export function sharedPageHeaderBlocks(blocks:PageBlock[],title:string,locale:string,template?:string):PageBlock[]{
  let found=false;
  const normalized=blocks.map(block=>{
    if(found||block.blockType!=='hero')return block;
    found=true;
    if(block.content.variant==='about-banner')return block;
    return {...block,content:{...block.content,variant:'about-banner',sectionPreset:'about-banner',title,
      breadcrumbLabel:getTranslation(locale as Language,'nav.home'),breadcrumbUrl:`/${locale}`,
      backgroundImage:'/images/about-reference/page-banner.png'}};
  });
  if(template!=='programs')return normalized;
  const hero=normalized.find(b=>b.blockType==='hero');
  const directory=normalized.find(b=>b.blockType==='catalog_grid'&&b.content.source==='programs'&&!b.content.sectionPreset);
  if(!hero||!directory)return normalized;
  return [hero,directory,...normalized.filter(b=>b!==hero&&b!==directory)].map((b,sortOrder)=>({...b,sortOrder}));
}
