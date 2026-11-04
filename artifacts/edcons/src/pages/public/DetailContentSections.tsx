import React, { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { DETAIL_GENERATED_CONTENT_KEYS, effectiveDetailContentSections, parseDetailContent, type DetailContent, type DetailContentKind, type DetailContentSection } from "@/lib/website/detailContentContract";

const DetailGalleryDialog = lazy(() => import("./DetailGalleryDialog"));

/** Reject stale responses for a different entity or language; never mix translations. */
export function boundDetailContent(value: unknown, kind: DetailContentKind, entityId: number | undefined, locale: string): DetailContent | null {
  const content = parseDetailContent(value);
  return content?.kind === kind && content.entityId === entityId && content.locale === locale ? content : null;
}

const labels: Record<string, string> = {
  en: "Enlarge image", tr: "Görseli büyüt", ar: "تكبير الصورة", fr: "Agrandir l’image",
  ru: "Увеличить изображение", fa: "بزرگ‌نمایی تصویر", zh: "放大图片", hi: "चित्र बड़ा करें",
  es: "Ampliar imagen", id: "Perbesar gambar", ur: "تصویر بڑی کریں", tk: "Suraty ulaldyň",
  ky: "Сүрөттү чоңойтуу", kk: "Суретті үлкейту", uz: "Rasmni kattalashtirish",
  tg: "Калон кардани тасвир", bn: "ছবি বড় করুন", pt: "Ampliar imagem", ne: "चित्र ठूलो पार्नुहोस्",
  vi: "Phóng to ảnh", ko: "이미지 확대", uk: "Збільшити зображення", it: "Ingrandisci immagine",
};
export const detailContentLabels = (locale: string) => labels[locale] ?? labels.en;

/**
 * Editor hydration needs valid, source-bound copy before an author or AI has
 * written a section. Those instructions are useful in the admin form but are
 * never public editorial content. Keep the match deliberately exact so normal
 * prose containing words such as "edit" or "source" is not removed.
 */
export function isDetailEditorInstruction(value: string | undefined): boolean {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return /^(?:Edit the .+ section for .+ from this page\.|.+ for .+ is shown together with the current source records\.|.+ için .+ bölümünü bu alandan düzenleyebilirsiniz\.|.+ için .+ bilgileri güncel kaynak kayıtlarıyla birlikte gösterilir\.)$/u.test(normalized);
}

function publicDetailSection(section: DetailContentSection): DetailContentSection {
  if (!isDetailEditorInstruction(section.body)) return section;
  const { body: _instruction, ...publicSection } = section;
  return publicSection;
}

function hasPublicSectionContent(section: DetailContentSection): boolean {
  return !!section.body?.trim()
    || !!section.hero
    || !!section.cards?.length
    || !!section.table
    || !!section.steps?.length
    || !!section.images?.length
    || !!section.questions?.length;
}

function publicDetailSections(content: DetailContent | null): DetailContentSection[] {
  return effectiveDetailContentSections(content).map(publicDetailSection);
}

function Gallery({ images, title, locale }: { images: NonNullable<DetailContentSection["images"]>; title: string; locale: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string[]>([]);
  const [selected, setSelected] = useState<(typeof images)[number] | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const visible = images.filter(image => !failed.includes(image.src));
  if (!visible.length) return null;
  return <>
    <div className="detail-editorial-gallery">{visible.map((image, index) => <figure key={`${image.src}-${index}`}>
      <button type="button" aria-label={`${detailContentLabels(locale)}: ${image.alt}`} onClick={event => { opener.current = event.currentTarget; setSelected(image); }}>
        <img src={image.src} alt={image.alt} className={`detail-progressive-image ${loaded.includes(image.src) ? "is-loaded" : ""}`} loading="lazy" decoding="async" width="800" height="560" onLoad={() => setLoaded(old => old.includes(image.src) ? old : [...old, image.src])} onError={() => setFailed(old => [...old, image.src])} />
        <span aria-hidden="true"><ArrowUpRight size={19} /></span>
      </button>{image.caption && <figcaption>{image.caption}</figcaption>}
    </figure>)}</div>
    {selected && <Suspense fallback={null}><DetailGalleryDialog
      image={selected}
      title={title}
      locale={locale}
      onClose={() => setSelected(null)}
      onClosedAutoFocus={() => {
        if (!opener.current?.isConnected) return false;
        opener.current.focus({ preventScroll: true });
        return true;
      }}
    /></Suspense>}
  </>;
}

/** Uses only the first reviewed CMS image as the prototype-style cover. */
export function DetailHeroMedia({ content }: { content: DetailContent | null }) {
  const heroImage = content?.sections.find(section => section.key === "hero")?.images?.[0];
  const cityGalleryFallback = content?.kind === "city"
    ? content.sections.find(section => section.key === "gallery")?.images?.[0]
    : undefined;
  const image = heroImage ?? cityGalleryFallback;
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [image?.src]);
  if (!image || failed) return null;
  return <div className="detail-hero-media" aria-hidden="true">
    <img src={image.src} alt="" className={`detail-progressive-image ${loaded ? "is-loaded" : ""}`} loading="eager" decoding="async" fetchPriority="high" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
  </div>;
}

export function detailHeroSection(content: DetailContent | null) {
  return publicDetailSections(content).find((section) => section.key === "hero") ?? null;
}

export function detailHeroStyle(content: DetailContent | null): CSSProperties {
  const hero = detailHeroSection(content)?.hero;
  return {
    ...(hero?.backgroundColor
      ? { "--detail-hero-background": hero.backgroundColor }
      : {}),
    ...(hero?.overlayColor
      ? { "--detail-hero-overlay-color": hero.overlayColor }
      : {}),
    ...(hero?.overlayOpacity !== undefined
      ? { "--detail-hero-overlay-opacity": String(hero.overlayOpacity / 100) }
      : {}),
    ...(hero?.textColor ? { "--detail-hero-text": hero.textColor } : {}),
    ...(hero?.accentColor
      ? { "--detail-hero-accent": hero.accentColor }
      : {}),
  } as CSSProperties;
}

const sectionKickers: Record<string, Record<string, string>> = {
  en: { overview: "Overview", gallery: "Gallery", highlights: "Highlights", cautions: "Plan carefully", education: "Education", facts: "Key facts", weather: "Weather", living: "Student life", climate: "Climate", transport: "Transport", campus: "Campuses", housing: "Housing", requirements: "Requirements", visa: "Visa", services: "Support", universities: "Universities", programs: "Programs", faq: "FAQ", applyGuide: "Next steps", navigation: "On this page" },
  tr: { overview: "Genel bakış", gallery: "Galeri", highlights: "Öne çıkanlar", cautions: "Dikkatli planlayın", education: "Eğitim", facts: "Temel bilgiler", weather: "Hava durumu", living: "Öğrenci yaşamı", climate: "İklim", transport: "Ulaşım", campus: "Kampüsler", housing: "Konaklama", requirements: "Gereklilikler", visa: "Vize", services: "Destek", universities: "Üniversiteler", programs: "Programlar", faq: "Sık sorulanlar", applyGuide: "Sonraki adımlar", navigation: "Bu sayfada" },
  ar: { overview: "نظرة عامة", gallery: "معرض الصور", highlights: "أبرز المزايا", cautions: "خطط بعناية", education: "الدراسة", facts: "حقائق أساسية", weather: "الطقس", living: "حياة الطلاب", climate: "المناخ", transport: "النقل", campus: "الحُرُم الجامعية", housing: "السكن", requirements: "المتطلبات", visa: "التأشيرة", services: "الدعم", universities: "الجامعات", programs: "البرامج", faq: "أسئلة شائعة", applyGuide: "الخطوات التالية", navigation: "في هذه الصفحة" },
  fr: { overview: "Aperçu", gallery: "Galerie", highlights: "Points forts", cautions: "À bien planifier", education: "Études", facts: "Informations clés", weather: "Météo", living: "Vie étudiante", climate: "Climat", transport: "Transports", campus: "Campus", housing: "Logement", requirements: "Conditions", visa: "Visa", services: "Accompagnement", universities: "Universités", programs: "Programmes", faq: "Questions fréquentes", applyGuide: "Prochaines étapes", navigation: "Sur cette page" },
  ru: { overview: "Обзор", gallery: "Галерея", highlights: "Преимущества", cautions: "Что учесть", education: "Обучение", facts: "Основные факты", weather: "Погода", living: "Студенческая жизнь", climate: "Климат", transport: "Транспорт", campus: "Кампусы", housing: "Жильё", requirements: "Требования", visa: "Виза", services: "Поддержка", universities: "Университеты", programs: "Программы", faq: "Частые вопросы", applyGuide: "Следующие шаги", navigation: "На этой странице" },
  fa: { overview: "نمای کلی", gallery: "گالری", highlights: "نکات برجسته", cautions: "برنامه‌ریزی دقیق", education: "تحصیل", facts: "اطلاعات کلیدی", weather: "آب‌وهوا", living: "زندگی دانشجویی", climate: "اقلیم", transport: "حمل‌ونقل", campus: "پردیس‌ها", housing: "اقامت", requirements: "شرایط", visa: "ویزا", services: "پشتیبانی", universities: "دانشگاه‌ها", programs: "برنامه‌ها", faq: "پرسش‌های متداول", applyGuide: "گام‌های بعدی", navigation: "در این صفحه" },
  zh: { overview: "概览", gallery: "图片", highlights: "亮点", cautions: "规划要点", education: "学习", facts: "关键信息", weather: "天气", living: "学生生活", climate: "气候", transport: "交通", campus: "校区", housing: "住宿", requirements: "要求", visa: "签证", services: "支持", universities: "大学", programs: "课程", faq: "常见问题", applyGuide: "后续步骤", navigation: "本页内容" },
  hi: { overview: "अवलोकन", gallery: "चित्र", highlights: "मुख्य बातें", cautions: "सावधानी से योजना बनाएँ", education: "पढ़ाई", facts: "मुख्य तथ्य", weather: "मौसम", living: "छात्र जीवन", climate: "जलवायु", transport: "परिवहन", campus: "परिसर", housing: "आवास", requirements: "आवश्यकताएँ", visa: "वीज़ा", services: "सहायता", universities: "विश्वविद्यालय", programs: "कार्यक्रम", faq: "सामान्य प्रश्न", applyGuide: "अगले कदम", navigation: "इस पृष्ठ पर" },
  es: { overview: "Resumen", gallery: "Galería", highlights: "Puntos destacados", cautions: "Planifica con cuidado", education: "Estudios", facts: "Datos clave", weather: "Tiempo", living: "Vida estudiantil", climate: "Clima", transport: "Transporte", campus: "Campus", housing: "Alojamiento", requirements: "Requisitos", visa: "Visado", services: "Apoyo", universities: "Universidades", programs: "Programas", faq: "Preguntas frecuentes", applyGuide: "Próximos pasos", navigation: "En esta página" },
  id: { overview: "Ikhtisar", gallery: "Galeri", highlights: "Sorotan", cautions: "Rencanakan dengan cermat", education: "Studi", facts: "Fakta utama", weather: "Cuaca", living: "Kehidupan mahasiswa", climate: "Iklim", transport: "Transportasi", campus: "Kampus", housing: "Akomodasi", requirements: "Persyaratan", visa: "Visa", services: "Dukungan", universities: "Universitas", programs: "Program", faq: "Pertanyaan umum", applyGuide: "Langkah berikutnya", navigation: "Di halaman ini" },
};

export function detailSectionKicker(key: string, locale: string) {
  return sectionKickers[locale]?.[key] ?? sectionKickers.en[key] ?? key.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ");
}

function compactEditorialSummary(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const sentence = normalized.match(/^.*?(?:[.!?](?=\s|$)|$)/u)?.[0] || normalized;
  if (sentence.length <= maxLength) return sentence;
  const clipped = sentence.slice(0, maxLength + 1);
  return `${clipped.slice(0, Math.max(1, clipped.lastIndexOf(" "))).replace(/[,:;\s]+$/u, "")}…`;
}

/** Short, locale-bound copy for compact hero facts; never mixes another locale. */
export function detailContentSummary(content: DetailContent | null, key: string, fallback = "", maxLength = 180): string {
  const section = publicDetailSections(content).find(entry => entry.key === key);
  if (!section) return compactEditorialSummary(fallback, maxLength);
  if (section.body?.trim()) return compactEditorialSummary(section.body, maxLength);
  const cardTitles = section.cards?.map(card => card.title.trim()).filter(Boolean) ?? [];
  return cardTitles.length ? compactEditorialSummary(cardTitles.slice(0, 3).join(" · "), maxLength) : compactEditorialSummary(fallback, maxLength);
}

function detailContentSectionBody(section: DetailContentSection, locale: string, _correctionPath: string): ReactNode {
  const heading = section.key === "hero" ? null : <><div className="detail-editorial-heading"><span lang={locale}>{detailSectionKicker(section.key, locale)}</span><h2>{section.title}</h2></div>
    {section.body && <p className="detail-prose detail-editorial-intro">{section.body}</p>}</>;

  if (section.key === "climate") return <div className="detail-wrap detail-editorial-content detail-climate-shell">
    <div className="detail-climate-head">{heading}</div>
    {!!section.cards?.length && <div className="detail-climate-ribbon">{section.cards.map((card, i) => <article key={i}><span>{card.title}</span><b>{card.body}</b></article>)}</div>}
    {section.table && <div className="detail-editorial-table" role="region" aria-label={section.title} tabIndex={0}><table><caption className="sr-only">{section.title}</caption><thead><tr>{section.table.columns.map((column, i) => <th scope="col" key={i}>{column}</th>)}</tr></thead><tbody>{section.table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th scope="row" key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}
  </div>;

  if (section.key === "housing") return <div className="detail-wrap detail-editorial-content">
    <div className="detail-section-head">{heading}</div>
    {!!section.cards?.length && <div className={`detail-housing-strip ${section.images?.length ? "has-media" : "is-text-only"}`}>{section.cards.map((card, i) => <article key={i} className={section.images?.[i] ? "has-media" : "is-text-only"}>
      {section.images?.[i] && <img src={section.images[i].src} alt={section.images[i].alt} loading="lazy" decoding="async" width="900" height="620" />}
      <div><span>{String(i + 1).padStart(2, "0")}</span><h3>{card.href ? <a href={card.href}>{card.title}</a> : card.title}</h3><p>{card.body}</p></div>
    </article>)}</div>}
    {!section.cards?.length && !!section.images?.length && <Gallery images={section.images} title={section.title} locale={locale} />}
    {section.table && <div className="detail-editorial-table" role="region" aria-label={section.title} tabIndex={0}><table><caption className="sr-only">{section.title}</caption><thead><tr>{section.table.columns.map((column, i) => <th scope="col" key={i}>{column}</th>)}</tr></thead><tbody>{section.table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th scope="row" key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}
  </div>;

  if (section.key === "studentStory" || section.key === "reviews") return <div className="detail-wrap detail-editorial-content">
    {heading}
    <div className="detail-review-grid">{section.images?.[0] && <figure><img src={section.images[0].src} alt={section.images[0].alt} loading="lazy" decoding="async" width="900" height="650" /></figure>}
      {!!section.cards?.length && <div>{section.cards.map((card, i) => <blockquote key={i}><p>“{card.body}”</p><cite>{card.title}</cite></blockquote>)}</div>}
    </div>
  </div>;

  if (section.key === "services" || section.key === "support") return <div className="detail-wrap detail-editorial-content detail-toolkit">
    {heading}
    {!!section.cards?.length && <div className="detail-service-grid">{section.cards.map((card, i) => <article key={i}><span>{String(i + 1).padStart(2, "0")}</span><h3>{card.title}</h3><p>{card.body}</p>{card.href && <a href={card.href}>{card.title}<ArrowUpRight size={15} aria-hidden="true" /></a>}</article>)}</div>}
    {!!section.steps?.length && <ol className="detail-editorial-steps">{section.steps.map((step, i) => <li key={i}><span aria-hidden="true">{i + 1}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>)}</ol>}
  </div>;

  return <div className="detail-wrap detail-editorial-content">
      {heading}
      {!!section.images?.length && <Gallery images={section.images} title={section.title} locale={locale} />}
      {!!section.cards?.length && <div className="detail-editorial-cards">{section.cards.map((card, i) => <article key={i}>
        <span className="detail-editorial-index" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
        <h3>{card.href ? <a href={card.href} {...(card.href.startsWith("https:") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{card.title}<ArrowUpRight size={17} aria-hidden="true" /></a> : card.title}</h3><p>{card.body}</p>
      </article>)}</div>}
      {section.table && <div className="detail-editorial-table" role="region" aria-label={section.title} tabIndex={0}><table>
        <caption className="sr-only">{section.title}</caption><thead><tr>{section.table.columns.map((column, i) => <th scope="col" key={i}>{column}</th>)}</tr></thead>
        <tbody>{section.table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th scope="row" key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table></div>}
      {!!section.steps?.length && <ol className="detail-editorial-steps">{section.steps.map((step, i) => <li key={i}><span aria-hidden="true">{i + 1}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>)}</ol>}
      {!!section.questions?.length && <div className="detail-editorial-faq">{section.questions.map((question, i) => <details key={i}><summary>{question.question}<ChevronDown size={19} aria-hidden="true" /></summary><p>{question.answer}</p></details>)}</div>}
    </div>;
}

/** Adds the static CMS layer inside a factual section without duplicating its catalogue fields. */
export function detailContentAddon(content: DetailContent | null, key: string, locale: string, correctionPath: string): ReactNode {
  const section = publicDetailSections(content).find(entry => entry.key === key);
  if (!section || !hasPublicSectionContent(section)) return null;
  if (key === "hero") {
    // Hero title, supporting copy and reviewed image are rendered by the
    // actual hero. Only genuinely supplemental structures belong below it.
    const hasSupplementalContent = !!section.cards?.length
      || !!section.table
      || !!section.steps?.length
      || !!section.questions?.length;
    if (!hasSupplementalContent) return null;
    return detailContentSectionBody({
      ...section,
      title: "",
      body: undefined,
      images: undefined,
    }, locale, correctionPath);
  }
  return detailContentSectionBody(section, locale, correctionPath);
}

export function detailContentTitle(
  content: DetailContent | null,
  key: string,
  fallback: string,
): string {
  return publicDetailSections(content).find((section) => section.key === key)?.title || fallback;
}

export function detailContentIntro(
  content: DetailContent | null,
  key: string,
): ReactNode {
  const body = publicDetailSections(content).find((section) => section.key === key)?.body;
  return body ? <p className="detail-prose detail-editorial-intro">{body}</p> : null;
}

/** Returned as direct children so the existing CMS layout can order/hide each standalone section. */
export function detailContentSections(content: DetailContent | null, locale: string, correctionPath: string, exclude: readonly string[] = []): ReactNode[] {
  if (!content) return [];
  return publicDetailSections(content).filter(section => hasPublicSectionContent(section) && !exclude.includes(section.key) && !DETAIL_GENERATED_CONTENT_KEYS.includes(section.key as (typeof DETAIL_GENERATED_CONTENT_KEYS)[number])).map(section => <section key={section.key} data-detail-section={`editorial-${section.key}`} id={`editorial-${section.key}`} className={`detail-section detail-editorial-section is-${section.key} ${section.key === "services" || section.key === "support" ? "detail-band" : ""}`}>
    {detailContentSectionBody(section, locale, correctionPath)}
  </section>);
}

export function detailContentNavigation(content: DetailContent | null): ReactNode[] {
  return publicDetailSections(content).filter(section => hasPublicSectionContent(section) && !["hero", "overview", "requirements"].includes(section.key) && !DETAIL_GENERATED_CONTENT_KEYS.includes(section.key as (typeof DETAIL_GENERATED_CONTENT_KEYS)[number]))
    .map(section => <a key={section.key} href={`#editorial-${section.key}`}>{section.title}</a>) ?? [];
}

/** A compact repeat of the existing actions; no alternate application flow. */
export function DetailMobileActions({ children }: { children: ReactNode; "data-detail-section"?: "mobileActions" }) {
  return <div data-detail-section="mobileActions" className="detail-mobile-actions"><div className="detail-actions">{children}</div></div>;
}
