import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Mail, Phone, MapPin, Clock, ArrowUpRight, CheckCircle } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useJsonLd, SITE_URL, SITE_NAME } from "@/hooks/use-json-ld";
import { PhoneCodePicker } from "@/components/ui/phone-code-picker";
import { toLatinUpper } from "@/lib/textTransform";
import { safeSectionImage, safeSectionUrl } from "@/lib/website/sectionUrls";
import { STUDENT_SERVICES, canonicalServiceSlug, serviceCopy } from "@/lib/website/studentServices";
import { contactPageSections } from "@/lib/website/contactPageSections";
import { CmsBlock, CmsPageCanvas } from "./PublicPage";
import { useTemplatePage, useTemplatePageSeo } from "./useTemplatePage";
import "./studentServices.css";
const str=(v:unknown)=>typeof v==="string"?v:"";
type Office={id:number;name:string;address:string|null;phone:string|null;email:string|null;city:string|null;country:string|null};
type Branding={companyEmail?:string;supportEmail?:string;companyPhone?:string;workingHours?:string};
type Country={id:number;name:string;isActive:boolean};
export function ContactWorkspaceSection({content:c,preview=false}:{content:Record<string,unknown>;preview?:boolean}){
 const {t,lang}=useI18n();const live=c.dataMode!=="manual";
 const {data:branding}=useQuery<Branding>({queryKey:["settings-branding-contact"],queryFn:()=>customFetch("/api/settings/branding"),enabled:live,staleTime:600000,retry:false});
 const {data:offices=[]}=useQuery<Office[]>({queryKey:["cms-offices",lang],queryFn:()=>customFetch(`/api/cms/offices?lang=${lang}`),enabled:live,staleTime:300000,retry:false});
 const {data:countries}=useQuery<{data:Country[]}>({queryKey:["contact-countries"],queryFn:()=>customFetch("/api/countries?limit=500"),staleTime:300000,retry:false});
 const requestedService=STUDENT_SERVICES.find(service=>canonicalServiceSlug(service.slug)===new URLSearchParams(window.location.search).get("service"));
 const [form,setForm]=useState({firstName:"",lastName:"",email:"",phoneCode:"",phone:"",nationality:"",message:requestedService?(lang==="tr"?"Hizmet talebi: ":"Service enquiry: ")+serviceCopy(requestedService,lang).name:"",_hp:""});
 const [busy,setBusy]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState("");
 const field=(key:keyof typeof form,value:string)=>setForm(f=>({...f,[key]:value}));
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(preview||busy||form._hp)return;if(form.phone&&!form.phoneCode){setError(t("contact.phoneCodeRequired"));return;}setBusy(true);setError("");try{
  const check=await fetch("/api/public/website-forms/contact/check");const exists=check.ok&&(await check.json()).exists;
  const response=await fetch(exists?"/api/public/website-forms/contact/submit":"/api/public/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,phone:form.phone?`${form.phoneCode}${form.phone}`:undefined,lang})});
  if(!response.ok)throw Error(t("common.error"));setSent(true);
 }catch(e){setError(e instanceof Error?e.message:t("common.error"));}finally{setBusy(false);}}
 const office=offices[0],phone=live?(branding?.companyPhone||office?.phone||str(c.phone)):str(c.phone),email=live?(branding?.supportEmail||branding?.companyEmail||office?.email||str(c.email)):str(c.email),address=live?(office?.address||str(c.address)):str(c.address),hours=live?(branding?.workingHours||str(c.hours)):str(c.hours);
 const info=[{Icon:Phone,label:t("contact.phoneLabel"),value:phone,href:phone?`tel:${phone.replace(/[^+\d]/g,"")}`:""},{Icon:Mail,label:t("contact.emailLabel"),value:email,href:email?`mailto:${email}`:""},{Icon:MapPin,label:t("contact.ourOffices"),value:address,href:address?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`:""},{Icon:Clock,label:t("contact.hoursLabel"),value:hours,href:""}].filter(x=>x.value);
 const input=(key:"firstName"|"lastName"|"email",label:string)=><label>{label}<input name={key} type={key==="email"?"email":"text"} autoComplete={key==="email"?"email":key==="firstName"?"given-name":"family-name"} required maxLength={200} value={form[key]} onChange={e=>field(key,key==="email"?e.target.value:toLatinUpper(e.target.value.replace(/<[^>]*>/g,"")))}/></label>;
 return <section className="sd-contact sd-design"><div className="sd-container sd-contact-grid"><div><span className="sd-kicker">{str(c.eyebrow)}</span><h2>{str(c.title)} <em>{str(c.titleAccent)}</em></h2><div className="sd-contact-visual">{safeSectionImage(c.imageUrl)&&<img src={safeSectionImage(c.imageUrl)!} alt={str(c.altText)} loading="lazy"/>}<div className="sd-contact-info">{info.map(({Icon,label,value,href})=><div key={label}><span><Icon aria-hidden="true"/></span><div>{safeSectionUrl(href)?<a href={safeSectionUrl(href)!}>{value}</a>:<strong>{value}</strong>}<small>{label}</small></div></div>)}</div></div></div><div id="contact-form" className="sd-form-panel"><h2>{str(c.formTitle)}</h2><p>{str(c.subtitle)}</p>{sent?<div role="status" className="sd-success"><CheckCircle/><h3>{t("contact.successTitle")}</h3><p>{t("contact.successMessage")}</p><button onClick={()=>{setSent(false);setForm({firstName:"",lastName:"",email:"",phoneCode:"",phone:"",nationality:"",message:requestedService?(lang==="tr"?"Hizmet talebi: ":"Service enquiry: ")+serviceCopy(requestedService,lang).name:"",_hp:""});}}>{t("contact.sendAnother")}</button></div>:<form onSubmit={submit} className="sd-form"><div className="sd-form-row">{input("firstName",t("contact.firstName"))}{input("lastName",t("contact.lastName"))}</div><label>{t("contact.phone")}<div className="sd-phone"><PhoneCodePicker value={form.phoneCode} onChange={v=>field("phoneCode",v)} triggerClassName="w-24 shrink-0"/><input type="tel" name="phone" required maxLength={32} value={form.phone} autoComplete="tel-national" onChange={e=>field("phone",e.target.value.replace(/[^\d\s()-]/g,""))}/></div></label>{input("email",t("contact.email"))}<label>{t("contact.nationality")}{countries?.data?.length?<select required value={form.nationality} onChange={e=>field("nationality",e.target.value)}><option value="">{t("contact.nationalityPlaceholder")}</option>{countries.data.filter(c=>c.isActive).sort((a,b)=>a.name.localeCompare(b.name)).map(c=><option key={c.id} value={c.name}>{c.name}</option>)}</select>:<input required value={form.nationality} onChange={e=>field("nationality",e.target.value)} maxLength={120}/>}</label><label>{t("contact.message")}<textarea name="message" rows={5} value={form.message} maxLength={400} onChange={e=>field("message",e.target.value.replace(/<[^>]*>/g,""))}/></label><input className="sd-honeypot" name="_hp" value={form._hp} tabIndex={-1} aria-hidden="true" autoComplete="off" onChange={e=>field("_hp",e.target.value)}/>{error&&<p role="alert">{error}</p>}<button className="sd-button" type="submit" disabled={preview||busy}>{busy?t("contact.sending"):str(c.submitLabel)||t("contact.send")}<ArrowUpRight aria-hidden="true"/></button>{preview&&<p className="sd-preview-note">{t("contact.formTitle")} · Preview</p>}</form>}</div></div></section>;
}
export default function Contact(){
 const {lang,t}=useI18n();const page=useTemplatePage("contact",lang);useSeo({title:page?.meta.title||t("seo.contactTitle"),description:page?.meta.description||t("seo.contactDesc"),lang,noindex:page?!page.meta.indexable:false,alternates:page?.meta.alternatePaths});useTemplatePageSeo(page);
 useJsonLd({"@context":"https://schema.org","@type":"ContactPage",name:`${t("nav.contact")} | ${SITE_NAME}`,url:`${SITE_URL}/${lang}/contact`,inLanguage:lang});
 const blocks=contactPageSections((page?.data.blocks||[]).map(b=>({...b,isVisible:(b as {isVisible?:boolean}).isVisible??true})),lang);
 return <CmsPageCanvas className="cms-contact-page">{blocks.filter(b=>b.isVisible).map((block,index)=><CmsBlock key={index} block={block} index={index} variables={{siteName:SITE_NAME,pageTitle:page?.data.title||t("nav.contact"),pageSlug:"contact",pageLocale:lang}}/>)}</CmsPageCanvas>;
}

