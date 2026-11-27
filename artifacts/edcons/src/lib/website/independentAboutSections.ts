import type { PageBlock } from "./blockTypes";
import { getTranslation, type Language } from "../i18n/index";

const asset = (name: string) => `/images/about-reference/${name}`;
const text = (v: unknown) => typeof v === "string" ? v : "";
const list = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(x => x && typeof x === "object") : [];
export const ABOUT_SECTION_VARIANTS = new Set(["about-banner","about-intro","about-approach","about-why","about-pillars","about-panorama","about-enquiry","about-faq","about-end","about-team","about-offices","about-logos"]);

/** Repair only untouched, generated labels from the first preset conversion. */
function localiseGeneratedLabels(blocks: PageBlock[], locale: Language): PageBlock[] {
  return structuredClone(blocks).map(block => {
    if (block.settings.aboutLocaleDefaults === 1 || !ABOUT_SECTION_VARIANTS.has(text(block.content.variant))) return block;
    const en=(key:string)=>getTranslation("en",key), t=(key:string)=>getTranslation(locale,key);
    const labels: Record<string,Record<string,[string,string]>> = {
      "about-banner": {title:[en("about.badge"),t("about.badge")],breadcrumbLabel:[en("nav.home"),t("nav.home")]},
      "about-intro": {eyebrow:[`${en("about.badge")} · Find And Study`,`${t("about.badge")} · Find And Study`]},
      "about-approach": {ctaLabel:[en("about.getStarted"),t("about.getStarted")]},
      "about-why": {eyebrow:[en("about.badge"),t("about.badge")]},
      "about-panorama": {ctaLabel:[en("about.bookConsultation"),t("about.bookConsultation")]},
      "about-enquiry": {eyebrow:[en("contact.badge"),t("contact.badge")],title:[`${en("contact.title")} ${en("contact.titleHighlight")}`,`${t("contact.title")} ${t("contact.titleHighlight")}`],formTitle:[en("contact.formTitle"),t("contact.formTitle")],submitLabel:[en("contact.send"),t("contact.send")],successMessage:[en("contact.successTitle"),t("contact.successTitle")]},
      "about-faq": {eyebrow:[en("about.badge"),t("about.badge")]},
    };
    for (const [key,[original,translated]] of Object.entries(labels[text(block.content.variant)]||{})) if (block.content[key]===original) block.content[key]=translated;
    block.settings.aboutLocaleDefaults=1;
    return block;
  });
}

/** One-time, non-destructive expansion. Once saved, every section owns its data. */
export function independentAboutSections(source: PageBlock[], locale: Language): PageBlock[] {
  if (source.some(b => ABOUT_SECTION_VARIANTS.has(text(b.content.variant)))) return localiseGeneratedLabels(source,locale);
  const byType = (type: string) => source.find(b => b.blockType === type);
  const get = (type: string) => byType(type)?.content || {};
  const hero=get("hero"), story=get("media_text"), values=get("grid_box"), process=get("process_steps"), cta=get("cta_banner"), faq=get("faq");
  const cards=list(values.cards), steps=list(process.steps);
  const paragraphs=text(story.body).split(/\n\s*\n/).filter(Boolean);
  const t=(key: string) => getTranslation(locale,key);
  const contact=`/${locale}/contact`;
  const block=(type: string, variant: string, content: Record<string,unknown>, owner?: PageBlock): PageBlock => ({blockType:type,content:{...content,variant},settings:structuredClone(owner?.settings || {}),isVisible:owner?.isVisible ?? true,sortOrder:0});
  const output=[
    block("hero","about-banner",{title:t("about.badge"),breadcrumbLabel:t("nav.home"),breadcrumbUrl:`/${locale}`,backgroundImage:asset("page-banner.png")},byType("hero")),
    block("media_text","about-intro",{eyebrow:`${t("about.badge")} · Find And Study`,title:hero.title,body:paragraphs[0]||t("about.missionP1"),detailTitle:cards[2]?.title,detailBody:paragraphs[1]||cards[2]?.description,imageUrl:asset("about-image.jpg"),secondaryImage:asset("about-image-1.jpg"),captionTitle:cards[1]?.title,captionBody:cards[1]?.description,ctaLabel:story.ctaLabel||t("about.getStarted"),ctaUrl:story.ctaUrl||contact},byType("media_text")),
    block("grid_box","about-approach",{eyebrow:values.eyebrow,title:values.title,subtitle:values.subtitle,ctaLabel:t("about.getStarted"),ctaUrl:contact,cards:[{title:story.title,description:paragraphs[2]||paragraphs[0],icon:"target"},{title:cards[0]?.title,description:paragraphs[3]||cards[0]?.description,icon:"rocket"}],stripText:cta.subtitle,stripLabel:cta.ctaLabel||t("about.bookConsultation"),stripUrl:cta.ctaUrl||contact},byType("grid_box")),
    block("process_steps","about-why",{eyebrow:process.eyebrow||t("about.badge"),title:process.title,subtitle:process.subtitle,imageUrl:asset("choose-us-image.png"),steps},byType("process_steps")),
    block("counter_grid","about-pillars",{items:cards.slice(3,6).map(c=>({value:c.title,label:c.description}))},byType("counter_grid")),
    block("image_gallery","about-panorama",{imageUrl:asset("video-bg.jpg"),ctaUrl:contact,ctaLabel:t("about.bookConsultation")}),
    block("column_layout","about-enquiry",{eyebrow:t("contact.badge"),title:`${t("contact.title")} ${t("contact.titleHighlight")}`,subtitle:cta.subtitle||hero.subtitle,items:steps.slice(0,3).map(s=>({title:s.title})),formTitle:t("contact.formTitle"),submitLabel:t("contact.send"),successMessage:t("contact.successTitle"),formSlug:"contact"}),
    ...source.filter(b=>["team_grid","office_list","logo_marquee"].includes(b.blockType)).map(b=>({...structuredClone(b),content:{...structuredClone(b.content),variant:b.blockType==="team_grid"?"about-team":b.blockType==="office_list"?"about-offices":"about-logos"}})),
    ...(byType("faq")?[block("faq","about-faq",{eyebrow:t("about.badge"),title:faq.title,subtitle:faq.subtitle,imageUrl:asset("faqs-img.jpg"),items:faq.items},byType("faq"))]:[]),
    block("cta_banner","about-end",{eyebrow:"Find And Study",title:cta.title,subtitle:cta.subtitle,ctaLabel:cta.ctaLabel||t("about.bookConsultation"),ctaUrl:cta.ctaUrl||contact,secondaryLabel:cta.secondaryLabel||t("about.browsePrograms"),secondaryUrl:cta.secondaryUrl||`/${locale}/programs`},byType("cta_banner")),
    ...source.filter(b=>!["team_grid","office_list","logo_marquee"].includes(b.blockType) && (!["hero","counter_grid","media_text","grid_box","process_steps","faq","cta_banner"].includes(b.blockType) || byType(b.blockType) !== b)),
  ];
  return localiseGeneratedLabels(output.map((b,i)=>({...b,id:undefined,sortOrder:i})),locale);
}
