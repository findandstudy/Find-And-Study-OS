import { EmbeddedLeadForm } from './EmbeddedLeadForm';
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Mail, Phone, MapPin, Clock } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useJsonLd, SITE_URL, SITE_NAME } from "@/hooks/use-json-ld";
import { safeSectionImage, safeSectionUrl } from "@/lib/website/sectionUrls";
import { contactPageSections } from "@/lib/website/contactPageSections";
import { CmsBlock, CmsPageCanvas } from "./PublicPage";
import { useTemplatePage, useTemplatePageSeo } from "./useTemplatePage";
import "./studentServices.css";
const str=(v:unknown)=>typeof v==="string"?v:"";
type Office={id:number;name:string;address:string|null;phone:string|null;email:string|null;city:string|null;country:string|null};
type Branding={companyEmail?:string;supportEmail?:string;companyPhone?:string;workingHours?:string};
export function ContactWorkspaceSection({content:c,preview=false}:{content:Record<string,unknown>;preview?:boolean}){
 const {t,lang}=useI18n();const live=c.dataMode!=="manual";
 const {data:branding}=useQuery<Branding>({queryKey:["settings-branding-contact"],queryFn:()=>customFetch("/api/settings/branding"),enabled:live,staleTime:600000,retry:false});
 const {data:offices=[]}=useQuery<Office[]>({queryKey:["cms-offices",lang],queryFn:()=>customFetch(`/api/cms/offices?lang=${lang}`),enabled:live,staleTime:300000,retry:false});
 const office=offices[0],phone=live?(branding?.companyPhone||office?.phone||str(c.phone)):str(c.phone),email=live?(branding?.supportEmail||branding?.companyEmail||office?.email||str(c.email)):str(c.email),address=live?(office?.address||str(c.address)):str(c.address),hours=live?(branding?.workingHours||str(c.hours)):str(c.hours);
 const info=[{Icon:Phone,label:t("contact.phoneLabel"),value:phone,href:phone?`tel:${phone.replace(/[^+\d]/g,"")}`:""},{Icon:Mail,label:t("contact.emailLabel"),value:email,href:email?`mailto:${email}`:""},{Icon:MapPin,label:t("contact.ourOffices"),value:address,href:address?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`:""},{Icon:Clock,label:t("contact.hoursLabel"),value:hours,href:""}].filter(x=>x.value);
 return <section className="sd-contact sd-design"><div className="sd-container sd-contact-grid"><div><span className="sd-kicker">{str(c.eyebrow)}</span><h2>{str(c.title)} <em>{str(c.titleAccent)}</em></h2><div className="sd-contact-visual">{safeSectionImage(c.imageUrl)&&<img src={safeSectionImage(c.imageUrl)!} alt={str(c.altText)} loading="lazy"/>}<div className="sd-contact-info">{info.map(({Icon,label,value,href})=><div key={label}><span><Icon aria-hidden="true"/></span><div>{safeSectionUrl(href)?<a href={safeSectionUrl(href)!}>{value}</a>:<strong>{value}</strong>}<small>{label}</small></div></div>)}</div></div></div><div id="contact-form" className="sd-form-panel"><h2>{str(c.formTitle)}</h2><p>{str(c.subtitle)}</p><EmbeddedLeadForm slug={c.embedWidgetSlug} preview={preview}/></div></div></section>;
}
export default function Contact(){
 const {lang,t}=useI18n();const page=useTemplatePage("contact",lang);useSeo({title:page?.meta.title||t("seo.contactTitle"),description:page?.meta.description||t("seo.contactDesc"),lang,noindex:page?!page.meta.indexable:false,alternates:page?.meta.alternatePaths});useTemplatePageSeo(page);
 useJsonLd({"@context":"https://schema.org","@type":"ContactPage",name:`${t("nav.contact")} | ${SITE_NAME}`,url:`${SITE_URL}/${lang}/contact`,inLanguage:lang});
 const blocks=contactPageSections((page?.data.blocks||[]).map(b=>({...b,isVisible:(b as {isVisible?:boolean}).isVisible??true})),lang);
 return <CmsPageCanvas className="cms-contact-page">{blocks.filter(b=>b.isVisible).map((block,index)=><CmsBlock key={index} block={block} index={index} variables={{siteName:SITE_NAME,pageTitle:page?.data.title||t("nav.contact"),pageSlug:"contact",pageLocale:lang}}/>)}</CmsPageCanvas>;
}

