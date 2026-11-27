import type { BlockFieldDef, PageBlock } from "./blockTypes";
import { managedHomePageBlocks } from "./managedPageStarters";
import { independentAboutSections } from "./independentAboutSections";
import type { Language } from "../i18n";
export type SectionPreset = { id: string; label: string; family: "Home"|"About"; block: PageBlock };
const home:PageBlock[]=managedHomePageBlocks().map((b,i)=>({...b,content:{...b.content,dataMode:[6,10].includes(i)?"live":"manual",imageUrl:"/images/auth-bg.png",secondaryImageUrl:"/images/hero-bg.png",backgroundImage:"/images/hero-bg.png",...(Array.isArray(b.content.cards)?{cards:b.content.cards.map(c=>({...c as Record<string,unknown>,imageUrl:"/images/auth-bg.png"}))}:{}),...(b.blockType==="home_fallback_stats"?{stats:[{value:"01",label:"Explore your options"},{value:"02",label:"Prepare your application"},{value:"03",label:"Plan your next step"}]}:{})}}));
const homeLabels=["Hero & journey panel","Image story & statistics","Service cards","Offer & benefits","Journey steps","Why choose us","Study destinations","Student support cards","Support network","FAQ with branding","Country tabs & university carousel","Journal cards","Call to action"];
for (const block of home) {
  if (block.blockType === "home_fallback_hero") Object.assign(block.content, { consoleFooter: "Human guidance, connected to one clear view", reviewScore: "", reviewLabel: "", reviewProof: "", heroVisuals: [{title:"",imageUrl:"/images/hero-bg.png",canonicalPath:"",flagEmoji:""}] });
  if (block.blockType === "home_fallback_stats") Object.assign(block.content, { experienceValue: "", experienceLabel: "Education guidance" });
  if (block.content.variant === "home-offer") Object.assign(block.content, { ctaLabel: "Start your journey", highlightTitle: "One connected plan", highlightText: "Research, preparation and progress" });
}
const aboutLabels=["Page banner","Image story & caption","Mission / vision cards","Image & numbered features","Message strip","Panorama / media banner","Enquiry form","Team","Partner logos","Offices","Image & FAQ","Closing call to action"];
const about=independentAboutSections([
  {blockType:"hero",content:{title:"Education advice for your next step"},settings:{},isVisible:true,sortOrder:0},
  {blockType:"media_text",content:{title:"Our mission",body:"Introduce your organisation and the students you support.\n\nExplain how your services help.\n\nDescribe your mission.\n\nDescribe your vision."},settings:{},isVisible:true,sortOrder:1},
  {blockType:"grid_box",content:{eyebrow:"Our approach",title:"Guidance built around you",subtitle:"Explain what makes your approach useful.",cards:[{title:"Our vision",description:"Your vision"},{title:"Student first",description:"Your commitment to students"},{title:"Connected support",description:"Describe your support"},{title:"Explore",description:"Study options"},{title:"Prepare",description:"Your application"},{title:"Connect",description:"Your next step"}]},settings:{},isVisible:true,sortOrder:2},
  {blockType:"process_steps",content:{title:"How we support you",subtitle:"Explain the journey.",steps:[{title:"Explore",description:"Compare your options."},{title:"Prepare",description:"Plan the requirements."},{title:"Apply",description:"Prepare your application."},{title:"Progress",description:"Follow the next step."}]},settings:{},isVisible:true,sortOrder:3},
  {blockType:"team_grid",content:{title:"Our team",members:[]},settings:{},isVisible:true,sortOrder:4},
  {blockType:"logo_marquee",content:{title:"Partners",items:[]},settings:{},isVisible:true,sortOrder:5},
  {blockType:"office_list",content:{title:"Our offices",offices:[]},settings:{},isVisible:true,sortOrder:6},
  {blockType:"faq",content:{title:"Your questions, answered",subtitle:"Useful information before getting started.",items:[{question:"Where should I start?",answer:"Contact our team to discuss your goals."}]},settings:{},isVisible:true,sortOrder:7},
  {blockType:"cta_banner",content:{title:"Plan your next step",subtitle:"Speak with our team.",ctaLabel:"Contact us",ctaUrl:"/en/contact",secondaryLabel:"Explore programs",secondaryUrl:"/en/programs"},settings:{},isVisible:true,sortOrder:8},
],"en");
export const SECTION_PRESETS: SectionPreset[]=[
  ...home.map((block,i)=>({id:`home-${i}`,label:homeLabels[i]||block.blockType,family:"Home" as const,block:{...block,content:{...block.content,sectionPreset:`home-${i}`}}})),
  ...about.map((block,i)=>({id:String(block.content.variant),label:aboutLabels[i]||block.blockType,family:"About" as const,block:{...block,content:{...block.content,...(["team_grid","office_list"].includes(block.blockType)?{dataMode:"manual"}:{}),...(["about-intro","about-why","about-panorama","about-faq"].includes(String(block.content.variant))?{altText:""}:{}),...(block.content.variant==="about-intro"?{secondaryAltText:""}:{}),...(["about-approach","about-end","about-enquiry"].includes(String(block.content.variant))?{backgroundImage:`/images/about-reference/${block.content.variant==="about-enquiry"?"globe-bg-1.png":"footer-bg.png"}`}:{})}}})),
];
export function editableHomeSections(blocks: PageBlock[]): PageBlock[] {
  return blocks.map(block => {
    const preset = SECTION_PRESETS.find(p => p.family === "Home" && p.block.blockType === block.blockType && p.block.content.variant === block.content.variant);
    return preset ? { ...block, content: { dataMode: "live", ...block.content, sectionPreset: preset.id } } : block;
  });
}
export function createSectionPreset(id: string, locale: Language="en"): PageBlock {
  const preset=SECTION_PRESETS.find(p=>p.id===id); if(!preset) throw new Error("Unknown section preset");
  const copy=structuredClone(preset.block);
  const localise=(v:unknown):unknown=>typeof v==="string"&&v.startsWith("/en/")?`/${locale}/${v.slice(4)}`:Array.isArray(v)?v.map(localise):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,localise(x)])):v;
  return {...copy,content:localise(copy.content) as Record<string,unknown>};
}
const label=(key:string)=>key.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,s=>s.toUpperCase());
/** Every content property is editable, including variant-specific media and lists. */
export function presetFields(content: Record<string,unknown>): BlockFieldDef[] {
  return Object.entries(content).filter(([key])=>!["variant","sectionPreset"].includes(key)).map(([key,value])=>({key,label:label(key),type:Array.isArray(value)?"items":typeof value==="boolean"?"toggle":typeof value==="number"?"number":/image|photo|backgroundImage|bgImage/i.test(key)?"image":/url|href/i.test(key)?"url":/body|description|subtitle|text|message/i.test(key)?"textarea":"text",...(Array.isArray(value)?{itemFields:presetFields(Object.assign({},...value.filter(x=>x&&typeof x==="object")))}:{})}));
}
