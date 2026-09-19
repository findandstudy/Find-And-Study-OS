import React, { useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, BookOpen, ChevronDown, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { parseDetailContent, type DetailContent, type DetailContentKind, type DetailContentSection } from "@/lib/website/detailContentContract";

/** Reject stale responses for a different entity or language; never mix translations. */
export function boundDetailContent(value: unknown, kind: DetailContentKind, entityId: number | undefined, locale: string): DetailContent | null {
  const content = parseDetailContent(value);
  return content?.kind === kind && content.entityId === entityId && content.locale === locale ? content : null;
}

const labels: Record<string, [string, string, string, string]> = {
  en: ["Sources", "Editorial review", "Suggest a correction", "Enlarge image"],
  tr: ["Kaynaklar", "Editoryal inceleme", "Düzeltme öner", "Görseli büyüt"],
  ar: ["المصادر", "مراجعة تحريرية", "اقتراح تصحيح", "تكبير الصورة"],
  fr: ["Sources", "Révision éditoriale", "Suggérer une correction", "Agrandir l’image"],
  ru: ["Источники", "Редакционная проверка", "Предложить исправление", "Увеличить изображение"],
  fa: ["منابع", "بازبینی تحریریه", "پیشنهاد اصلاح", "بزرگ‌نمایی تصویر"],
  zh: ["资料来源", "编辑审核", "建议更正", "放大图片"],
  hi: ["स्रोत", "संपादकीय समीक्षा", "सुधार सुझाएँ", "चित्र बड़ा करें"],
  es: ["Fuentes", "Revisión editorial", "Sugerir una corrección", "Ampliar imagen"],
  id: ["Sumber", "Tinjauan editorial", "Sarankan koreksi", "Perbesar gambar"],
  ur: ["ذرائع", "ادارتی جائزہ", "تصحیح تجویز کریں", "تصویر بڑی کریں"],
  tk: ["Çeşmeler", "Redaksion barlag", "Düzediş teklip ediň", "Suraty ulaldyň"],
  ky: ["Булактар", "Редакциялык текшерүү", "Оңдоо сунуштоо", "Сүрөттү чоңойтуу"],
  kk: ["Дереккөздер", "Редакциялық тексеру", "Түзету ұсыну", "Суретті үлкейту"],
  uz: ["Manbalar", "Tahririy tekshiruv", "Tuzatish taklif qilish", "Rasmni kattalashtirish"],
  tg: ["Манбаъҳо", "Баррасии таҳрирӣ", "Пешниҳоди ислоҳ", "Калон кардани тасвир"],
  bn: ["উৎস", "সম্পাদকীয় পর্যালোচনা", "সংশোধনের পরামর্শ দিন", "ছবি বড় করুন"],
  pt: ["Fontes", "Revisão editorial", "Sugerir correção", "Ampliar imagem"],
  ne: ["स्रोतहरू", "सम्पादकीय समीक्षा", "सुधार सुझाव दिनुहोस्", "चित्र ठूलो पार्नुहोस्"],
  vi: ["Nguồn", "Đánh giá biên tập", "Đề xuất chỉnh sửa", "Phóng to ảnh"],
  ko: ["출처", "편집 검토", "수정 제안", "이미지 확대"],
  uk: ["Джерела", "Редакційна перевірка", "Запропонувати виправлення", "Збільшити зображення"],
  it: ["Fonti", "Revisione editoriale", "Suggerisci una correzione", "Ingrandisci immagine"],
};
export const detailContentLabels = (locale: string) => labels[locale] ?? labels.en;

function Gallery({ images, title, locale }: { images: NonNullable<DetailContentSection["images"]>; title: string; locale: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const [selected, setSelected] = useState<(typeof images)[number] | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const visible = images.filter(image => !failed.includes(image.src));
  if (!visible.length) return null;
  return <>
    <div className="detail-editorial-gallery">{visible.map((image, index) => <figure key={`${image.src}-${index}`}>
      <button type="button" aria-label={`${detailContentLabels(locale)[3]}: ${image.alt}`} onClick={event => { opener.current = event.currentTarget; setSelected(image); }}>
        <img src={image.src} alt={image.alt} loading="lazy" decoding="async" width="800" height="560" onError={() => setFailed(old => [...old, image.src])} />
        <span aria-hidden="true"><ArrowUpRight size={19} /></span>
      </button>{image.caption && <figcaption>{image.caption}</figcaption>}
    </figure>)}</div>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent className="w-[calc(100%_-_2rem)] max-w-4xl max-h-[90vh] overflow-y-auto rtl:[&>button]:right-auto rtl:[&>button]:left-4" aria-describedby={undefined} dir={["ar", "fa", "ur"].includes(locale) ? "rtl" : "ltr"}
        onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }); } }}>
        <DialogTitle className="min-w-0 break-words pe-7 text-start">{selected?.caption || selected?.alt || title}</DialogTitle>
        {selected && <img src={selected.src} alt={selected.alt} className="max-h-[70vh] w-full object-contain" />}
      </DialogContent>
    </Dialog>
  </>;
}

/** Returned as direct children so the existing CMS layout can order/hide each section. */
export function detailContentSections(content: DetailContent | null, locale: string, correctionPath: string): ReactNode[] {
  if (!content) return [];
  const copy = detailContentLabels(locale);
  return content.sections.map(section => <section key={section.key} data-detail-section={`editorial-${section.key}`} id={`editorial-${section.key}`} className={`detail-section detail-editorial-section is-${section.key}`}>
    <div className="detail-wrap">
      <div className="detail-editorial-heading"><span aria-hidden="true"><BookOpen size={20} strokeWidth={1.6} /></span><h2>{section.title}</h2></div>
      {section.body && <p className="detail-prose detail-editorial-intro">{section.body}</p>}
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
      <footer className="detail-editorial-evidence"><div><span>{copy[0]}:</span>{section.sources.map((source, i) => <a key={i} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ExternalLink size={12} aria-hidden="true" /></a>)}</div>
        <p>{copy[1]}: <time dateTime={section.reviewedOn}>{new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(section.reviewedOn))}</time></p>
        <a href={correctionPath}>{copy[2]}<ArrowUpRight size={13} aria-hidden="true" /></a>
      </footer>
    </div>
  </section>);
}

export function detailContentNavigation(content: DetailContent | null): ReactNode[] {
  return content?.sections.map(section => <a key={section.key} href={`#editorial-${section.key}`}>{section.title}</a>) ?? [];
}

/** A compact repeat of the existing actions; no alternate application flow. */
export function DetailMobileActions({ children }: { children: ReactNode; "data-detail-section"?: "mobileActions" }) {
  return <div data-detail-section="mobileActions" className="detail-mobile-actions"><div className="detail-actions">{children}</div></div>;
}
