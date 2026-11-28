import { translateUi, useUiLanguage } from "@/lib/ui-localization";
import { useEffect, useRef, type CSSProperties } from "react";
import { ArrowUpRight, Check, ChevronRight, Target, Rocket } from "lucide-react";
import { safeSectionUrl, safeSectionImage } from "@/lib/website/sectionUrls";
import { EditorialInquiryForm } from "./EditorialInquiryForm";
import { PublicPageHeader } from "./PublicPageHeader";
import "./aboutReferenceLayout.css";
const s=(v:unknown)=>typeof v==="string"?v:"";
const rows=(v:unknown):Record<string,unknown>[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==="object").slice(0,50):[];
function Image({src,alt="",className=""}:{src:unknown;alt?:string;className?:string}) {const url=safeSectionImage(src);return url?<img src={url} alt={alt} className={className} loading="lazy"/>:null;}
function Action({url,label,outline=false}:{url:unknown;label:unknown;outline?:boolean}) {const href=safeSectionUrl(url);return href&&s(label)?<a className={`ar-button${outline?" ar-button-outline":""}`} href={href}>{s(label)}<ArrowUpRight size={18} aria-hidden="true"/></a>:null;}
export function ReusableEditorialSection({variant,content:c,preview=false}:{variant:string;content:Record<string,unknown>;preview?:boolean}) {
  const { lang: uiLanguage } = useUiLanguage();
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(preview||matchMedia("(prefers-reduced-motion: reduce)").matches)return;const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("ar-revealed");observer.unobserve(e.target);}}),{threshold:.08});root.current?.querySelectorAll("[data-reveal]").forEach(e=>{e.classList.add("ar-ready");observer.observe(e);});return()=>observer.disconnect();},[preview,variant]);
 const heading=<><span className="ar-kicker">{s(c.eyebrow)}</span><h2>{s(c.title)}</h2>{c.subtitle?<p>{s(c.subtitle)}</p>:null}</>;
 let section;
 switch(variant){
 case "about-banner": section=<PublicPageHeader title={s(c.title)} backgroundImage={c.backgroundImage} homeLabel={s(c.breadcrumbLabel)} homeUrl={s(c.breadcrumbUrl)}/>;break;
 case "about-intro": section=<section className="ar-section ar-intro"><div className="ar-container ar-two-col"><div className="ar-intro-visual" data-reveal><Image src={c.imageUrl} alt={s(c.altText)} className="ar-photo"/>{(c.captionTitle||c.captionBody)?<div className="ar-photo-caption"><h3>{s(c.captionTitle)}</h3><p>{s(c.captionBody)}</p></div>:null}</div><div data-reveal><span className="ar-kicker">{s(c.eyebrow)}</span><h2>{s(c.title)}</h2><p>{s(c.body)}</p><div className="ar-intro-detail"><div><h3>{s(c.detailTitle)}</h3><p>{s(c.detailBody)}</p></div><Image src={c.secondaryImage}/></div><Action url={c.ctaUrl} label={c.ctaLabel}/></div></div></section>;break;
 case "about-approach": section=<section className="ar-section ar-approach"><div className="ar-container ar-two-col"><div data-reveal>{heading}<Action url={c.ctaUrl} label={c.ctaLabel}/></div><div className="ar-approach-cards">{rows(c.cards).map((card,i)=><article data-reveal key={i}><span className="ar-icon">{card.icon==="rocket"?<Rocket/>:<Target/>}</span><h3>{s(card.title)}</h3><p>{s(card.description)}</p></article>)}</div></div>{(c.stripText||c.stripLabel)?<div className="ar-container ar-strip"><Check size={20}/><p>{s(c.stripText)} {safeSectionUrl(c.stripUrl)&&<a href={safeSectionUrl(c.stripUrl)!}>{s(c.stripLabel)} ↗</a>}</p></div>:null}</section>;break;
 case "about-why": section=<section className="ar-section ar-why"><div className="ar-container ar-why-layout"><div className="ar-why-visual" data-reveal><Image src={c.imageUrl} alt={s(c.altText)}/></div><div data-reveal>{heading}<div className="ar-numbered">{rows(c.steps).map((item,i)=><article key={i}><span>{s(item.number)||String(i+1).padStart(2,"0")}</span><div><h3>{s(item.title)}</h3><p>{s(item.description)}</p></div></article>)}</div></div></div></section>;break;
 case "about-pillars": section=<section className="ar-stat-band"><div className="ar-container">{rows(c.items).map((item,i)=><div key={i}><strong>{s(item.value)}</strong><span>{s(item.label)}</span></div>)}</div></section>;break;
 case "about-panorama": section=<section className="ar-panorama" aria-label={s(c.ctaLabel)}><Image src={c.imageUrl} alt={s(c.altText)}/>{safeSectionUrl(c.ctaUrl)&&<a className="ar-panorama-action" href={safeSectionUrl(c.ctaUrl)!} aria-label={s(c.ctaLabel)}><ArrowUpRight size={38}/></a>}</section>;break;
 case "about-enquiry": section=<section className="ar-section ar-enquiry"><div className="ar-container ar-two-col"><div data-reveal>{heading}<ul className="ar-check-list">{rows(c.items).map((item,i)=><li key={i}><Check size={20}/>{s(item.title)}</li>)}</ul></div><EditorialInquiryForm content={c} preview={preview}/></div></section>;break;
 case "about-faq": section=<section className="ar-section ar-faq"><div className="ar-container ar-two-col"><div data-reveal>{heading}<Image src={c.imageUrl} alt={s(c.altText)} className="ar-faq-image"/></div><div className="ar-faq-list">{rows(c.items).map((item,i)=><details key={i}><summary>{s(item.question)}</summary><p>{s(item.answer)}</p></details>)}</div></div></section>;break;
 case "about-end": section=<section className="ar-section ar-end"><div className="ar-container" data-reveal>{heading}<div className="ar-actions"><Action url={c.ctaUrl} label={c.ctaLabel}/><Action url={c.secondaryUrl} label={c.secondaryLabel} outline/></div></div></section>;break;
 default:return null;
 }
 const background=safeSectionImage(c.backgroundImage);
 const style=Object.hasOwn(c,"backgroundImage")?{"--ar-section-image":background?`url(${JSON.stringify(background)})`:"none"} as CSSProperties:undefined;
 return <div ref={root} className="about-reference cms-independent-editorial" data-section-design={variant} style={style}>{section}</div>;
}
