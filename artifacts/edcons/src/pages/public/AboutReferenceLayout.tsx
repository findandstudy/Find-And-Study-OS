import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, ChevronRight, Target, Rocket } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import type { Language } from "@/lib/i18n";
import { enrichManagedPageBlocks, managedPageStarterBlocks } from "@/lib/website/managedPageStarters";
import { CmsBlock, type PageBlock, type PageResponse } from "./PublicPage";
import "./aboutReferenceLayout.css";

const asset = (name: string) => `/images/about-reference/${name}`;
const str = (value: unknown) => typeof value === "string" ? value : "";
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(v => v && typeof v === "object") : [];
function ButtonLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="ar-button" href={href}>{children}<ArrowUpRight size={18} aria-hidden="true" /></a>;
}

/** Dedicated reference composition, fed by the same managed page blocks. */
export function AboutReferenceLayout({ lang, page, transformBlock }: {
  template: string; lang: Language; page: PageResponse | null; transformBlock?: (block: PageBlock) => PageBlock;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const blocks = (page?.data.blocks?.length ? enrichManagedPageBlocks("about", page.data.blocks, lang) : managedPageStarterBlocks("about", lang)).map(b => transformBlock ? transformBlock(b) : b);
  const content = (type: string) => blocks.find(b => b.blockType === type)?.content || {};
  const hero = content("hero"), story = content("media_text"), values = content("grid_box"), process = content("process_steps"), cta = content("cta_banner");
  const cards = rows(values.cards);
  const steps = rows(process.steps);
  const contact = `/${lang}/contact`;
  const storyText = str(story.body) || t("about.missionP1");
  const paragraphs = storyText.split(/\n\s*\n/).filter(Boolean);
  const faq = blocks.find(b => b.blockType === "faq");
  useEffect(() => {
    const nodes = root.current?.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!nodes || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add("ar-revealed"); observer.unobserve(entry.target); }
    }), { threshold: .08 });
    nodes.forEach(node => { node.classList.add("ar-ready"); observer.observe(node); });
    return () => observer.disconnect();
  }, [lang]);
  return <div ref={root} className="about-reference" data-managed-template="about" data-public-page-version={page?.data.versionNumber ?? "starter"}>
    <section className="ar-banner" style={{ backgroundImage: `linear-gradient(#101828a6,#101828a6),url(${asset("page-banner.png")})` }}>
      <nav aria-label="Breadcrumb"><a href={`/${lang}`}>{t("nav.home")}</a><ChevronRight size={17} /><span>{t("about.badge")}</span></nav>
      <h1>{t("about.badge")}</h1>
    </section>
    <section className="ar-section ar-intro" data-cms-block="media_text">
      <div className="ar-container ar-two-col">
        <div className="ar-intro-visual" data-reveal>
          <img src={asset("about-image.jpg")} alt="" className="ar-photo" />
          <div className="ar-photo-caption"><h3>{str(cards[1]?.title) || t("about.studentFirst")}</h3><p>{str(cards[1]?.description) || t("about.studentFirstDesc")}</p></div>
        </div>
        <div data-reveal><span className="ar-kicker">{t("about.badge")} · Find And Study</span>
          <h2>{str(hero.title) || `${t("about.title")} ${t("about.titleHighlight")}`}</h2>
          <p>{paragraphs[0]}</p>
          <div className="ar-intro-detail"><div><h3>{str(cards[2]?.title) || t("about.excellence")}</h3><p>{paragraphs[1] || str(cards[2]?.description)}</p></div><img src={asset("about-image-1.jpg")} alt="" loading="lazy" /></div>
          <ButtonLink href={contact}>{str(story.ctaLabel) || t("about.getStarted")}</ButtonLink>
        </div>
      </div>
    </section>
    <section className="ar-section ar-approach" data-cms-block="grid_box">
      <div className="ar-container ar-two-col">
        <div data-reveal><span className="ar-kicker">{str(values.eyebrow) || t("about.missionTitle")}</span>
          <h2>{str(values.title) || `${t("about.title")} ${t("about.titleHighlight")}`}</h2>
          <p>{str(values.subtitle) || t("about.description")}</p><ButtonLink href={contact}>{t("about.getStarted")}</ButtonLink>
        </div>
        <div className="ar-approach-cards">
          <article data-reveal><span className="ar-icon"><Target /></span><h3>{str(story.title) || t("about.missionTitle")}</h3><p>{paragraphs[2] || paragraphs[0]}</p></article>
          <article data-reveal><span className="ar-icon"><Rocket /></span><h3>{str(cards[0]?.title) || t("about.studentFirst")}</h3><p>{paragraphs[3] || str(cards[0]?.description)}</p></article>
        </div>
      </div>
      <div className="ar-container ar-strip"><Check size={20} /><p>{str(cta.subtitle) || t("about.ctaSubtitle")} <a href={contact}>{t("about.bookConsultation")} ↗</a></p></div>
    </section>
    <section className="ar-section ar-why" data-cms-block="process_steps">
      <div className="ar-container ar-why-layout"><div className="ar-why-visual" data-reveal><img src={asset("choose-us-image.png")} alt="" loading="lazy" /></div>
        <div data-reveal><span className="ar-kicker">{str(process.eyebrow) || t("about.badge")}</span><h2>{str(process.title) || t("about.titleHighlight")}</h2><p>{str(process.subtitle)}</p>
          <div className="ar-numbered">{(steps.length ? steps : cards).slice(0,4).map((item,index) => <article key={index}><span>{String(index+1).padStart(2,"0")}</span><div><h3>{str(item.title)}</h3><p>{str(item.description) || str(item.body)}</p></div></article>)}</div>
        </div>
      </div>
    </section>
    <section className="ar-stat-band"><div className="ar-container">{cards.slice(3,6).map((card,i)=><div key={i}><strong>{str(card.title)}</strong><span>{str(card.description)}</span></div>)}</div></section>
    <section className="ar-panorama" aria-label={t("about.titleHighlight")}><img src={asset("video-bg.jpg")} alt="" loading="lazy" /><a href={contact} className="ar-panorama-action" aria-label={t("about.bookConsultation")}><ArrowUpRight size={38} /></a></section>
    <section className="ar-section ar-enquiry"><div className="ar-container ar-two-col"><div data-reveal><span className="ar-kicker">{t("contact.badge")}</span><h2>{t("contact.title")} <em>{t("contact.titleHighlight")}</em></h2><p>{str(cta.subtitle) || str(hero.subtitle)}</p><ul className="ar-check-list">{steps.slice(0,3).map((step,index)=><li key={index}><Check size={20}/>{str(step.title)}</li>)}</ul></div><InquiryForm /></div></section>
    {blocks.filter(b => b.blockType === "team_grid" && rows(b.content.members).length).map((b,i) => <section className="ar-section ar-team" key={i}><div className="ar-container"><span className="ar-kicker">{t("about.teamTitle")}</span><h2>{str(b.content.title) || t("about.teamTitle")}</h2><p>{str(b.content.subtitle) || t("about.teamSubtitle")}</p><CmsBlock block={b} index={i} /></div></section>)}
    {blocks.filter(b=>b.blockType === "office_list" && rows(b.content.offices).length).map((b,i)=><section className="ar-section" key={`office-${i}`}><div className="ar-container"><CmsBlock block={b} index={i}/></div></section>)}
    {faq && <section className="ar-section ar-faq" data-cms-block="faq"><div className="ar-container ar-two-col"><div data-reveal><span className="ar-kicker">{t("about.badge")}</span><h2>{str(faq.content.title)}</h2><p>{str(faq.content.subtitle)}</p><img className="ar-faq-image" src={asset("faqs-img.jpg")} alt="" loading="lazy" /></div><div className="ar-faq-list">{rows(faq.content.items).map((item,i)=><details key={i}><summary>{str(item.question)}</summary><p>{str(item.answer)}</p></details>)}</div></div></section>}
    <section className="ar-section ar-end"><div className="ar-container" data-reveal><span className="ar-kicker">Find And Study</span><h2>{str(cta.title) || t("about.ctaTitle")}</h2><p>{str(cta.subtitle) || t("about.ctaSubtitle")}</p><div className="ar-actions"><ButtonLink href={contact}>{t("about.bookConsultation")}</ButtonLink><a className="ar-button ar-button-outline" href={`/${lang}/programs`}>{t("about.browsePrograms")}<ArrowUpRight size={18}/></a></div></div></section>
  </div>;
}

function InquiryForm() {
  const { t, lang } = useI18n();
  const [busy,setBusy] = useState(false), [sent,setSent] = useState(false), [error,setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    const data = new FormData(form); if (data.get("_hp")) return;
    setBusy(true); setError("");
    try {
      const check = await fetch("/api/public/website-forms/contact/check");
      const useForm = check.ok && (await check.json()).exists;
      const payload = Object.fromEntries(data.entries());
      const response = await fetch(useForm ? "/api/public/website-forms/contact/submit" : "/api/public/lead", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,lang})});
      if (!response.ok) throw new Error(t("common.error")); setSent(true);
    } catch (err) { setError(err instanceof Error ? err.message : t("common.error")); }
    finally { setBusy(false); }
  }
  return <form className="ar-form" onSubmit={submit} data-reveal><h3>{t("contact.formTitle")}</h3>{sent ? <p role="status">{t("contact.successMessage")}</p> : <><div className="ar-form-grid">{["firstName","lastName","email","phone"].map(name=><label key={name}>{t(`contact.${name}`)}<input name={name} type={name === "email" ? "email" : name === "phone" ? "tel" : "text"} required={name !== "phone"} autoComplete={name === "email" ? "email" : name === "phone" ? "tel" : name === "firstName" ? "given-name" : "family-name"} maxLength={200}/></label>)}</div><label>{t("contact.message")}<textarea name="message" required rows={4} maxLength={400}/></label><input className="ar-honeypot" name="_hp" tabIndex={-1} autoComplete="off" aria-hidden="true"/><button className="ar-button" disabled={busy}>{busy ? t("contact.sending") : t("contact.send")}<ArrowUpRight size={18}/></button>{error && <p role="alert">{error}</p>}</>}</form>;
}
