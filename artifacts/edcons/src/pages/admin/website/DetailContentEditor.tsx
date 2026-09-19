import { useEffect, useId, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LANGUAGE_META, type Language } from "@/lib/i18n";
import { useI18n } from "@/hooks/use-i18n";
import {
  DETAIL_CONTENT_KEYS, DETAIL_CONTENT_LOCALES, parseDetailContent,
  type DetailContent, type DetailContentKind, type DetailContentSection,
} from "@/lib/website/detailContentContract";

export type DetailContentTarget = {
  kind: DetailContentKind; entityId: number; locale: string; title: string; sourceEditPath: string;
};
type SavedContent = {
  content: DetailContent; pageId: number | null; updatedAt: string | null;
  digest: string | null; published: DetailContent | null;
};
type Copy = (en: string, tr: string) => string;
type PendingAction = { type: "close" } | { type: "locale"; locale: string } | { type: "reload" } | { type: "remove"; key: string };
const sectionLabels: Record<string, [string, string]> = {
  gallery: ["Gallery", "Galeri"], highlights: ["Highlights", "Öne çıkanlar"], cautions: ["Things to consider", "Dikkat edilmesi gerekenler"],
  curriculum: ["Curriculum", "Müfredat"], education: ["Education and faculties", "Eğitim ve fakülteler"], admission: ["Admission guidance", "Kabul rehberi"],
  scholarships: ["Scholarship guidance", "Burs rehberi"], living: ["Living and local context", "Yaşam ve yerel bilgiler"], campus: ["Campus", "Kampüs"],
  housing: ["Housing", "Konaklama"], services: ["Support services", "Destek hizmetleri"], recognition: ["Recognition and outcomes", "Tanınma ve sonuçlar"],
  faq: ["Frequently asked questions", "Sık sorulan sorular"], applyGuide: ["Application guide", "Başvuru rehberi"],
};

function TextField({ label, value, onChange, maxLength, multiline = false, type = "text", max }: {
  label: string; value: string; onChange: (value: string) => void; maxLength?: number; multiline?: boolean; type?: string; max?: string;
}) {
  const id = useId();
  return <div className="min-w-0 space-y-1"><label htmlFor={id} className="text-sm font-medium">{label}</label>
    {multiline ? <Textarea id={id} dir="auto" value={value} maxLength={maxLength} rows={3} onChange={event => onChange(event.target.value)} />
      : <Input id={id} dir={type === "url" || type === "date" ? "ltr" : "auto"} type={type} max={max} value={value} maxLength={maxLength} onChange={event => onChange(event.target.value)} />}
  </div>;
}

function RepeatFields<T extends object>({ title, items, fields, create, onChange, limit, minimum = 0, copy }: {
  title: string; items: T[]; fields: { key: Extract<keyof T, string>; label: string; max: number; multiline?: boolean; type?: string }[];
  create: () => T; onChange: (items: T[]) => void; limit: number; minimum?: number; copy: Copy;
}) {
  return <details className="rounded-lg border p-3" open={items.length > 0 || undefined}>
    <summary className="cursor-pointer font-medium">{title} · {items.length}/{limit}</summary>
    <div className="mt-3 space-y-3">{items.map((item, index) => <fieldset key={index} className="space-y-3 rounded-lg bg-muted/40 p-3">
      <legend className="px-1 text-sm">{title} {index + 1}</legend>
      {fields.map(field => <TextField key={field.key} label={field.label} value={String(item[field.key] ?? "")} maxLength={field.max} multiline={field.multiline} type={field.type}
        onChange={value => onChange(items.map((entry, i) => i === index ? { ...entry, [field.key]: value } : entry))} />)}
      <Button type="button" size="sm" variant="outline" disabled={items.length <= minimum} aria-label={`${copy("Remove", "Kaldır")}: ${title} ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 className="me-1 h-4 w-4" />{copy("Remove", "Kaldır")}</Button>
    </fieldset>)}
      <Button type="button" size="sm" variant="outline" disabled={items.length >= limit} onClick={() => onChange([...items, create()])}><Plus className="me-1 h-4 w-4" />{copy("Add", "Ekle")}: {title}</Button>
    </div>
  </details>;
}

function TableFields({ value, onChange, copy }: { value: DetailContentSection["table"]; onChange: (table: DetailContentSection["table"]) => void; copy: Copy }) {
  const title = copy("Table", "Tablo");
  if (!value) return <Button type="button" variant="outline" size="sm" onClick={() => onChange({ columns: ["", ""], rows: [["", ""]] })}><Plus className="me-1 h-4 w-4" />{copy("Add table", "Tablo ekle")}</Button>;
  return <details open className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">{title} · {value.columns.length}/6 · {value.rows.length}/20</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">{copy("Up to 6 columns and 20 rows. Every cell is required. Do not duplicate catalogue tuition or intake data here.", "En fazla 6 sütun ve 20 satır. Her hücre zorunludur. Katalog ücret ve başvuru dönemi verilerini buraya kopyalamayın.")}</p>
      {value.columns.map((column, index) => <div key={index} className="flex items-end gap-2"><div className="min-w-0 flex-1"><TextField label={`${copy("Column", "Sütun")} ${index + 1}`} value={column} maxLength={160} onChange={text => onChange({ ...value, columns: value.columns.map((v, i) => i === index ? text : v) })} /></div>
        <Button type="button" size="icon" variant="outline" disabled={value.columns.length <= 1} aria-label={`${copy("Remove column", "Sütunu kaldır")} ${index + 1}`} onClick={() => onChange({ columns: value.columns.filter((_, i) => i !== index), rows: value.rows.map(row => row.filter((_, i) => i !== index)) })}><Trash2 className="h-4 w-4" /></Button>
      </div>)}
      <Button type="button" variant="outline" size="sm" disabled={value.columns.length >= 6} onClick={() => onChange({ columns: [...value.columns, ""], rows: value.rows.map(row => [...row, ""]) })}>{copy("Add column", "Sütun ekle")}</Button>
      {value.rows.map((row, index) => <fieldset key={index} className="grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2"><legend className="px-1 text-sm">{copy("Row", "Satır")} {index + 1}</legend>{row.map((cell, column) => <TextField key={column} label={value.columns[column] || `${copy("Column", "Sütun")} ${column + 1}`} value={cell} maxLength={500} onChange={text => onChange({ ...value, rows: value.rows.map((r, i) => i === index ? r.map((v, j) => j === column ? text : v) : r) })} />)}
        <Button type="button" variant="outline" size="sm" disabled={value.rows.length <= 1} onClick={() => onChange({ ...value, rows: value.rows.filter((_, i) => i !== index) })}>{copy("Remove row", "Satırı kaldır")} {index + 1}</Button>
      </fieldset>)}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={value.rows.length >= 20} onClick={() => onChange({ ...value, rows: [...value.rows, value.columns.map(() => "")] })}>{copy("Add row", "Satır ekle")}</Button><Button type="button" variant="outline" size="sm" onClick={() => onChange(undefined)}>{copy("Remove table", "Tabloyu kaldır")}</Button></div>
    </div>
  </details>;
}

function SectionFields({ section, onChange, copy }: { section: DetailContentSection; onChange: (section: DetailContentSection) => void; copy: Copy }) {
  const patch = (value: Partial<DetailContentSection>) => onChange({ ...section, ...value });
  const itemFields = [{ key: "title" as const, label: copy("Title", "Başlık"), max: 160 }, { key: "body" as const, label: copy("Text", "Metin"), max: 2000, multiline: true }];
  return <div className="space-y-4">
    <TextField label={copy("Section title", "Bölüm başlığı")} value={section.title} onChange={title => patch({ title })} maxLength={160} />
    <TextField label={copy("Body (optional, plain text)", "Açıklama (isteğe bağlı, düz metin)")} value={section.body ?? ""} onChange={body => patch({ body: body || undefined })} maxLength={6000} multiline />
    <RepeatFields title={copy("Cards", "Kartlar")} items={section.cards ?? []} fields={[...itemFields, { key: "href", label: copy("Link (optional, HTTPS or site path)", "Bağlantı (isteğe bağlı, HTTPS veya site yolu)"), max: 2048, type: "text" }]} create={() => ({ title: "", body: "", href: "" })} onChange={cards => patch({ cards: cards.length ? cards : undefined })} limit={12} copy={copy} />
    <TableFields value={section.table} onChange={table => patch({ table })} copy={copy} />
    <RepeatFields title={copy("Steps", "Adımlar")} items={section.steps ?? []} fields={itemFields} create={() => ({ title: "", body: "" })} onChange={steps => patch({ steps: steps.length ? steps : undefined })} limit={12} copy={copy} />
    <RepeatFields title={copy("Images", "Görseller")} items={section.images ?? []} fields={[
      { key: "src", label: copy("Owned / licensed image URL or site path", "Sahip olduğunuz / lisanslı görsel URL’si veya site yolu"), max: 2048 },
      { key: "alt", label: copy("Alternative text", "Alternatif metin"), max: 300 }, { key: "caption", label: copy("Caption / credit (optional)", "Açıklama / kaynak (isteğe bağlı)"), max: 500 },
    ]} create={() => ({ src: "", alt: "", caption: "" })} onChange={images => patch({ images: images.length ? images : undefined })} limit={8} copy={copy} />
    <RepeatFields title={copy("Questions and answers", "Sorular ve yanıtlar")} items={section.questions ?? []} fields={[
      { key: "question", label: copy("Question", "Soru"), max: 300 }, { key: "answer", label: copy("Answer", "Yanıt"), max: 3000, multiline: true },
    ]} create={() => ({ question: "", answer: "" })} onChange={questions => patch({ questions: questions.length ? questions : undefined })} limit={12} copy={copy} />
    <div className="space-y-3 rounded-lg border border-primary/30 p-3">
      <p className="text-sm font-medium">{copy("Evidence required for this section", "Bu bölüm için kaynak zorunludur")}</p>
      <TextField label={copy("Actually reviewed on", "Gerçek inceleme tarihi")} value={section.reviewedOn} type="date" max={new Date().toISOString().slice(0, 10)} onChange={reviewedOn => patch({ reviewedOn })} />
      <RepeatFields title={copy("Sources", "Kaynaklar")} items={section.sources} fields={[{ key: "label", label: copy("Source label", "Kaynak adı"), max: 160 }, { key: "url", label: copy("Source URL (HTTPS)", "Kaynak URL’si (HTTPS)"), max: 2048, type: "url" }]} create={() => ({ label: "", url: "" })} onChange={sources => patch({ sources })} limit={8} minimum={1} copy={copy} />
    </div>
  </div>;
}

/** Text-only local preview: no public draft route, remote image request or unsafe HTML. */
export function DetailContentPreview({ content, copy }: { content: DetailContent; copy: Copy }) {
  return <div className="space-y-5" dir={LANGUAGE_META[content.locale as Language]?.dir ?? "ltr"}>
    {!content.sections.length && <p>{copy("No supplemental sections. Publishing this draft removes previously published supplemental sections only.", "Ek bölüm yok. Bu taslağı yayınlamak yalnız önceki ek bölümleri kaldırır.")}</p>}
    {content.sections.map(section => <section key={section.key} className="space-y-3 rounded-lg border p-4">
      <h3 className="break-words text-lg font-semibold">{section.title}</h3>
      {section.body && <p className="whitespace-pre-wrap break-words">{section.body}</p>}
      {!!section.cards?.length && <div className="grid gap-3 sm:grid-cols-2">{section.cards.map((card, index) => <div key={index} className="min-w-0 rounded border p-3"><h4 className="break-words font-medium">{card.title}</h4><p className="whitespace-pre-wrap break-words">{card.body}</p>{card.href && <p className="break-all text-xs text-muted-foreground" dir="ltr">{card.href}</p>}</div>)}</div>}
      {section.table && <div role="region" aria-label={section.title} tabIndex={0} className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{section.table.columns.map((column, i) => <th scope="col" key={i} className="border p-2 text-start">{column}</th>)}</tr></thead><tbody>{section.table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="min-w-28 max-w-xs break-words border p-2">{cell}</td>)}</tr>)}</tbody></table></div>}
      {!!section.steps?.length && <ol className="list-decimal space-y-2 ps-5">{section.steps.map((step, index) => <li key={index}><strong>{step.title}</strong><p className="whitespace-pre-wrap break-words">{step.body}</p></li>)}</ol>}
      {!!section.images?.length && <div className="space-y-2">{section.images.map((image, index) => <div key={index} className="rounded border p-3"><p className="font-medium">{copy("Image", "Görsel")} {index + 1}: {image.alt}</p><p className="break-all text-xs" dir="ltr">{image.src}</p>{image.caption && <p className="break-words text-sm">{image.caption}</p>}</div>)}</div>}
      {section.questions?.map((question, index) => <div key={index}><h4 className="break-words font-medium">{question.question}</h4><p className="whitespace-pre-wrap break-words">{question.answer}</p></div>)}
      <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground"><p>{copy("Reviewed on", "İnceleme tarihi")}: <bdi>{section.reviewedOn}</bdi></p>{section.sources.map((source, index) => <p key={index} className="break-words">{source.label} — <bdi className="break-all">{source.url}</bdi></p>)}</div>
    </section>)}
  </div>;
}

export function prepareDetailContentDraft(content: DetailContent): DetailContent {
  return { ...content, sections: content.sections.map(section => ({ ...section,
    cards: section.cards?.map(({ href, ...card }) => ({ ...card, ...(href ? { href } : {}) })),
    images: section.images?.map(({ caption, ...image }) => ({ ...image, ...(caption ? { caption } : {}) })),
  })) };
}

export default function DetailContentEditor({ target, onClose, onSaved }: { target: DetailContentTarget; onClose: () => void; onSaved?: () => void }) {
  const { lang } = useI18n();
  const copy: Copy = (en, tr) => lang === "tr" ? tr : en;
  const [locale, setLocale] = useState(target.locale);
  const [saved, setSaved] = useState<SavedContent | null>(null);
  const [content, setContent] = useState<DetailContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [approved, setApproved] = useState(false);
  const [preview, setPreview] = useState(false);
  const [showPublished, setShowPublished] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [newKey, setNewKey] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const confirmationOpener = useRef<HTMLElement | null>(null);
  const editorSurface = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);
  const dirty = content !== null && saved !== null && JSON.stringify(content) !== JSON.stringify(saved.content);
  const savedIsPublished = saved?.published !== null && saved !== null && JSON.stringify(saved.content) === JSON.stringify(saved.published);
  const readUrl = `/api/website/detail-content?${new URLSearchParams({ kind: target.kind, entityId: String(target.entityId), locale })}`;
  const checkedEntry = (entry: SavedContent): SavedContent => {
    const parsed = parseDetailContent(entry.content);
    if (!parsed || parsed.kind !== target.kind || parsed.entityId !== target.entityId || parsed.locale !== locale
      || (entry.published !== null && (!parseDetailContent(entry.published) || entry.published.kind !== target.kind || entry.published.entityId !== target.entityId || entry.published.locale !== locale))) throw new Error("Invalid detail content binding");
    return { ...entry, content: parsed };
  };
  const readEntry = async (signal?: AbortSignal) => checkedEntry(await customFetch<SavedContent>(readUrl, { signal, cache: "no-store" }));
  const accept = (entry: SavedContent) => { setSaved(entry); setContent(entry.content); setApproved(false); setReloadRequired(false); setNewKey(""); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setSaved(null); setContent(null); setError(""); setMessage(""); setApproved(false); setPreview(false); setShowPublished(false);
    readEntry(controller.signal).then(entry => { if (!controller.signal.aborted) accept(entry); })
      .catch(() => { if (!controller.signal.aborted) setError(copy("Content could not load. Nothing was changed; retry before editing.", "İçerik yüklenemedi. Hiçbir kayıt değiştirilmedi; düzenlemeden önce yeniden deneyin.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [readUrl, attempt]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  const change = (next: DetailContent) => { setContent(next); setApproved(false); setMessage(""); setError(""); setShowPublished(false); };
  const performAction = (action: PendingAction) => {
    if (action.type === "close") onClose();
    else if (action.type === "locale") { setContent(null); setSaved(null); setLocale(action.locale); setApproved(false); }
    else if (action.type === "reload") setAttempt(value => value + 1);
    else if (content) change({ ...content, sections: content.sections.filter(section => section.key !== action.key) });
  };
  const requestAction = (action: PendingAction) => {
    if (busy || pendingAction) return;
    if (dirty || action.type === "remove") {
      confirmationOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingAction(action);
    } else performAction(action);
  };
  const close = () => requestAction({ type: "close" });
  const changeSection = (index: number, section: DetailContentSection) => { if (content) change({ ...content, sections: content.sections.map((value, i) => i === index ? section : value) }); };
  const moveSection = (index: number, by: number) => {
    if (!content) return;
    const sections = [...content.sections];
    [sections[index], sections[index + by]] = [sections[index + by], sections[index]];
    change({ ...content, sections });
  };
  const mutationError = (reason: unknown) => {
    const status = (reason as { status?: number })?.status;
    return status === 409 ? copy("The saved draft changed. Your edits are kept here. Copy anything you need, then reload and review the latest version.", "Kaydedilmiş taslak değişti. Düzenlemeleriniz burada korunuyor. Gereken metinleri kopyalayıp son sürümü yeniden yükleyin ve inceleyin.")
      : status === 403 ? copy("Not allowed. Publication needs a different authorized administrator; your own draft cannot be self-approved.", "İzin verilmedi. Yayın için farklı bir yetkili yönetici gerekir; kendi taslağınızı onaylayamazsınız.")
        : copy("The operation could not be confirmed. Your edits are kept; reload the saved state before trying again.", "İşlem doğrulanamadı. Düzenlemeleriniz korunuyor; yeniden denemeden önce kaydedilmiş durumu yükleyin.");
  };
  const save = async () => {
    if (!content || !saved || busy || reloadRequired) return;
    const next = prepareDetailContentDraft(content);
    if (!parseDetailContent(next)) {
      const invalid = next.sections.filter(section => !parseDetailContent({ ...next, sections: [section] }));
      setError(`${copy("Complete each section: title, content, an HTTPS source and a real review date (not in the future). Complete every added item/cell, remove empty items, and use plain text without HTML. Maximum total: 100,000 characters.", "Her bölümü tamamlayın: başlık, içerik, HTTPS kaynak ve gerçek inceleme tarihi (gelecekte olamaz). Eklenen her öğeyi/hücreyi doldurun, boş öğeleri kaldırın ve HTML içermeyen düz metin kullanın. Toplam en fazla 100.000 karakter.")} ${invalid.map(section => section.title || sectionLabels[section.key]?.[lang === "tr" ? 1 : 0] || section.key).join(", ")}`);
      return;
    }
    setBusy(true); setError(""); setMessage(""); setApproved(false);
    try {
      const entry = checkedEntry(await customFetch<SavedContent>("/api/website/detail-content/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: next, expectedUpdatedAt: saved.updatedAt }) }));
      if (mounted.current) { accept(entry); setMessage(copy("Draft saved. Public content is unchanged. A different administrator must review and publish.", "Taslak kaydedildi. Yayındaki içerik değişmedi. Farklı bir yönetici inceleyip yayınlamalıdır.")); onSaved?.(); }
    } catch (reason) { if (mounted.current) { setError(mutationError(reason)); setReloadRequired(true); } }
    finally { if (mounted.current) setBusy(false); }
  };
  const publish = async () => {
    if (!saved?.pageId || !saved.digest || dirty || busy || !approved || reloadRequired || savedIsPublished) return;
    setBusy(true); setError(""); setMessage(""); setApproved(false);
    try {
      const entry = checkedEntry(await customFetch<SavedContent>("/api/website/detail-content/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId: saved.pageId, digest: saved.digest, approved: true }) }));
      if (mounted.current) { accept(entry); setMessage(copy("Reviewed content published. Catalogue availability and SEO approval were not changed.", "İncelenen içerik yayınlandı. Katalog kullanılabilirliği ve SEO onayı değiştirilmedi.")); onSaved?.(); }
    } catch (reason) { if (mounted.current) { setError(mutationError(reason)); setReloadRequired(true); } }
    finally { if (mounted.current) setBusy(false); }
  };
  const availableKeys = DETAIL_CONTENT_KEYS[target.kind].filter(key => !content?.sections.some(section => section.key === key));
  const keyLabel = (key: string) => sectionLabels[key]?.[lang === "tr" ? 1 : 0] ?? key;
  const previewContent = showPublished ? saved?.published : content;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent ref={editorSurface} className="flex max-h-[94dvh] w-[calc(100%_-_1rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0" dir={LANGUAGE_META[lang as Language]?.dir ?? "ltr"}
    onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
    onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
    <DialogHeader className="shrink-0 border-b p-4 pr-12 text-start sm:p-5 sm:pr-12"><DialogTitle className="break-words leading-snug">{copy("Detail content", "Detay içeriği")} · <bdi>{target.title}</bdi></DialogTitle>
      <p className="text-xs text-muted-foreground"><bdi>{target.kind} · #{target.entityId}</bdi> — {copy("Bound to the existing catalogue record. No duplicate page or catalogue facts.", "Mevcut katalog kaydına bağlıdır. Kopya sayfa veya katalog bilgisi oluşturulmaz.")}</p>
    </DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><label className="space-y-1 text-sm"><span className="block font-medium">{copy("Content language", "İçerik dili")}</span><select className="h-10 rounded-md border bg-background px-3" aria-label={copy("Content language", "İçerik dili")} disabled={busy} value={locale} onChange={event => requestAction({ type: "locale", locale: event.target.value })}>{DETAIL_CONTENT_LOCALES.map(value => <option key={value} value={value}>{LANGUAGE_META[value].name}</option>)}</select></label>
        <Button asChild variant="outline" size="sm"><a href={target.sourceEditPath} target="_blank" rel="noopener noreferrer"><ExternalLink className="me-1 h-4 w-4" />{copy("Edit catalogue facts", "Katalog bilgilerini düzenle")}</a></Button></div>
      <p className="rounded-lg bg-muted p-3 text-sm">{copy("Use sourced editorial guidance only. Names, tuition, intake dates and admissions availability stay in the catalogue. Do not paste prototype examples, invented reviews or unverified partner claims. Only use photographs you own or may publish.", "Yalnız kaynaklı editoryal rehberlik ekleyin. Adlar, ücretler, başvuru tarihleri ve başvuru açıklığı katalogda kalır. Prototip örneklerini, uydurma yorumları veya doğrulanmamış partnerlik iddialarını kopyalamayın. Yalnız yayın hakkınız olan fotoğrafları kullanın.")}</p>
      {loading && <p role="status">{copy("Loading saved content…", "Kaydedilmiş içerik yükleniyor…")}</p>}
      {error && <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm"><p>{error}</p>{(!content || reloadRequired) && <Button variant="outline" size="sm" disabled={busy} onClick={() => requestAction({ type: "reload" })}>{copy("Reload saved version", "Kaydedilmiş sürümü yeniden yükle")}</Button>}</div>}
      {message && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{message}</p>}
      {content && saved && <>
        <div className="flex flex-wrap items-center gap-2"><Badge variant={dirty ? "outline" : "secondary"}>{dirty ? copy("Unsaved changes", "Kaydedilmemiş değişiklikler") : saved.pageId ? copy("Saved draft", "Kaydedilmiş taslak") : copy("No saved draft", "Kaydedilmiş taslak yok")}</Badge><Badge variant="outline">{savedIsPublished ? copy("Saved version is published", "Kaydedilmiş sürüm yayında") : saved.published ? copy("An earlier version is published", "Önceki sürüm yayında") : copy("No supplemental content published", "Yayınlanmış ek içerik yok")}</Badge>{saved.updatedAt && <span className="text-xs text-muted-foreground"><bdi>{new Date(saved.updatedAt).toLocaleString(lang)}</bdi></span>}</div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant={!preview ? "secondary" : "outline"} onClick={() => { setPreview(false); setShowPublished(false); }}>{copy("Edit draft", "Taslağı düzenle")}</Button><Button size="sm" variant={preview && !showPublished ? "secondary" : "outline"} onClick={() => { setPreview(true); setShowPublished(false); }}>{copy("Local draft preview", "Yerel taslak önizlemesi")}</Button>{saved.published && <Button size="sm" variant={preview && showPublished ? "secondary" : "outline"} onClick={() => { setPreview(true); setShowPublished(true); }}>{copy("Published version", "Yayındaki sürüm")}</Button>}</div>
        {preview ? <div className="space-y-3"><p className="text-sm text-muted-foreground">{copy("Text preview only: images and links are listed without loading external resources. Unpublished content is not sent to a public page.", "Metin önizlemesi: görsel ve bağlantılar dış kaynak yüklenmeden listelenir. Yayınlanmamış içerik halka açık sayfaya gönderilmez.")}</p>{previewContent && <DetailContentPreview content={previewContent} copy={copy} />}</div>
          : <fieldset disabled={busy} className="min-w-0 space-y-4" dir={LANGUAGE_META[locale as Language]?.dir ?? "ltr"}>
            {content.sections.map((section, index) => <details key={section.key} open className="min-w-0 rounded-xl border p-3 sm:p-4"><summary className="cursor-pointer break-words font-semibold">{index + 1}. {keyLabel(section.key)}{section.title ? ` — ${section.title}` : ""}</summary><div className="mt-4 space-y-4"><div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" size="icon" disabled={index === 0} aria-label={`${copy("Move up", "Yukarı taşı")}: ${keyLabel(section.key)}`} onClick={() => moveSection(index, -1)}><ArrowUp className="h-4 w-4" /></Button><Button type="button" variant="outline" size="icon" disabled={index === content.sections.length - 1} aria-label={`${copy("Move down", "Aşağı taşı")}: ${keyLabel(section.key)}`} onClick={() => moveSection(index, 1)}><ArrowDown className="h-4 w-4" /></Button><Button type="button" variant="outline" size="sm" onClick={() => requestAction({ type: "remove", key: section.key })}><Trash2 className="me-1 h-4 w-4" />{copy("Remove section", "Bölümü kaldır")}</Button></div><SectionFields section={section} onChange={value => changeSection(index, value)} copy={copy} /></div></details>)}
            {!content.sections.length && <p className="rounded-lg border border-dashed p-5 text-sm">{copy("No sections yet. Add only content supported by real sources.", "Henüz bölüm yok. Yalnız gerçek kaynaklarla desteklenen içerik ekleyin.")}</p>}
            <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 space-y-1 text-sm"><span className="block font-medium">{copy("New section", "Yeni bölüm")}</span><select className="h-10 w-full rounded-md border bg-background px-3" value={newKey} onChange={event => setNewKey(event.target.value)}><option value="">{copy("Choose a section", "Bölüm seçin")}</option>{availableKeys.map(key => <option key={key} value={key}>{keyLabel(key)}</option>)}</select></label><Button type="button" variant="outline" disabled={!newKey || content.sections.length >= 14 || !availableKeys.includes(newKey)} onClick={() => { change({ ...content, sections: [...content.sections, { key: newKey, title: "", reviewedOn: "", sources: [{ label: "", url: "" }] }] }); setNewKey(""); }}><Plus className="me-1 h-4 w-4" />{copy("Add section", "Bölüm ekle")}</Button></div>
          </fieldset>}
        {!!saved.pageId && !savedIsPublished && <div className="space-y-3 rounded-lg border border-primary/30 p-4"><h3 className="font-semibold">{copy("Separate publication review", "Ayrı yayın incelemesi")}</h3><p className="text-sm">{copy("A different authorized administrator must review this exact saved version and its sources. This does not publish the catalogue entity or change SEO approval. Editing or saving resets approval.", "Farklı bir yetkili yönetici bu kaydedilmiş sürümü ve kaynaklarını incelemelidir. Bu işlem katalog kaydını yayınlamaz veya SEO onayını değiştirmez. Düzenleme veya kaydetme onayı sıfırlar.")}</p><p className="break-all font-mono text-xs" dir="ltr">{saved.digest}</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={approved} disabled={dirty || busy || reloadRequired || !preview || showPublished} onChange={event => setApproved(event.target.checked)} />{copy("I reviewed the local preview of this exact saved draft and approve publication.", "Bu kaydedilmiş taslağın yerel önizlemesini inceledim ve yayınlanmasını onaylıyorum.")}</label><Button disabled={!approved || dirty || busy || reloadRequired || !saved.digest} onClick={() => void publish()}>{copy("Publish reviewed draft", "İncelenen taslağı yayınla")}</Button></div>}
      </>}
    </div>
    <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-background p-4"><Button variant="outline" disabled={busy} onClick={close}>{copy("Close", "Kapat")}</Button><Button disabled={loading || busy || !content || !saved || reloadRequired || (!dirty && !!saved.pageId)} onClick={() => void save()}>{busy ? copy("Working…", "İşleniyor…") : copy("Save draft only", "Yalnız taslağı kaydet")}</Button></div>
    <AlertDialog open={pendingAction !== null} onOpenChange={open => { if (!open) setPendingAction(null); }}>
      <AlertDialogContent className="w-[calc(100%_-_2rem)] rounded-lg" dir={LANGUAGE_META[lang as Language]?.dir ?? "ltr"}
        onCloseAutoFocus={event => {
          const focusTarget = confirmationOpener.current?.isConnected ? confirmationOpener.current : editorSurface.current;
          if (focusTarget?.isConnected) { event.preventDefault(); focusTarget.focus({ preventScroll: true }); }
        }}>
        <AlertDialogHeader className="text-start"><AlertDialogTitle>{pendingAction?.type === "remove" ? copy("Remove this section?", "Bu bölüm kaldırılsın mı?") : copy("Discard unsaved changes?", "Kaydedilmemiş değişiklikler silinsin mi?")}</AlertDialogTitle>
          <AlertDialogDescription>{pendingAction?.type === "remove"
            ? copy("This removes the section from the local draft only. Public content changes only after saving and separate publication approval.", "Bu işlem bölümü yalnız yerel taslaktan kaldırır. Yayındaki içerik ancak kaydetme ve ayrı yayın onayından sonra değişir.")
            : copy("Your unsaved edits will be discarded. The saved draft and published content will not change.", "Kaydedilmemiş düzenlemeleriniz silinir. Kaydedilmiş taslak ve yayın içeriği değişmez.")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{copy("Keep editing", "Düzenlemeye devam et")}</AlertDialogCancel><AlertDialogAction onClick={() => { const action = pendingAction; setPendingAction(null); if (action && !busy) performAction(action); }}>{pendingAction?.type === "remove" ? copy("Remove section", "Bölümü kaldır") : copy("Discard and continue", "Değişiklikleri sil ve devam et")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </DialogContent></Dialog>;
}
