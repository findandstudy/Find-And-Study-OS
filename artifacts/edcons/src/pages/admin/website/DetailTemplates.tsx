import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowDown, ArrowUp, Braces, Database, Eye, EyeOff, LayoutTemplate, Lightbulb, LockKeyhole, Search } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { parseDetailContent, type DetailContent } from "@/lib/website/detailContentContract";
import { DETAIL_TEMPLATE_VARIABLES, parseDetailLayout, type DetailLayout } from "@/lib/website/detailLayoutContract";
import { LANGUAGE_META, SUPPORTED_LANGUAGES, type Language } from "@/lib/i18n";
import { detailTemplateLabel } from "./detailTemplateLabels";
import { DetailSectionAppearanceFields } from "./DetailSectionAppearanceFields";
import DetailFullPreview from "./DetailFullPreview";
import { installPageEditorNavigationGuard, supportsPageEditorHistoryGuard } from "./pageEditorNavigationGuard";
import { DETAIL_VARIABLE_GROUP_TR, detailVariableGroup, detailVariableHelp, detailVariableLabel } from "./detailVariableLabels";
type Entry = { pageId: number | null; digest: string | null; updatedAt: string | null; status: string; layout: DetailLayout };
type Edit = { layout: DetailLayout; expectedUpdatedAt: string | null };
type PreviewItem = { kind: "country" | "city" | "university" | "program"; sourceId: number; title: string; canonicalPath: string | null; sourceEditPath: string; locale: string; visible: boolean };
type PreviewInventory = { items: PreviewItem[]; pagination: { total: number } };
type PreviewContent = { content: DetailContent; published: DetailContent | null };
export type DetailTemplatesHandle = { requestLeave: (action: () => void) => void };


const DetailTemplates = forwardRef<DetailTemplatesHandle>(function DetailTemplates(_props, ref) {
  const { lang, t } = useI18n();
  const copy = (en: string, tr: string) => lang === "tr" ? tr : en;
  const label = (key: string) => detailTemplateLabel(key, lang);
  const client = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [approved, setApproved] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ run: () => void } | null>(null);
  const [notice, setNotice] = useState("");
  const [reloadError, setReloadError] = useState(false);
  const [editingKind, setEditingKind] = useState<DetailLayout["kind"] | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"sections" | "editor" | "preview">("sections");
  const [previewLocale, setPreviewLocale] = useState<Language>(() => SUPPORTED_LANGUAGES.includes(lang as Language) ? lang as Language : "en");
  const [previewSearchInput, setPreviewSearchInput] = useState("");
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewSourceId, setPreviewSourceId] = useState("");
  const [, setTemplatePreviewReady] = useState(false);
  const [selectedVariable, setSelectedVariable] = useState("");
  const [variableSearch, setVariableSearch] = useState("");
  const titleCopyRef = useRef<HTMLInputElement | null>(null);
  const bodyCopyRef = useRef<HTMLTextAreaElement | null>(null);
  const confirmationOpener = useRef<HTMLElement | null>(null);
  const query = useQuery<Entry[]>({
    queryKey: ["detail-layouts"],
    queryFn: async ({ signal }) => {
      const entries = await customFetch<Entry[]>("/api/website/detail-layouts", { signal });
      return entries.map(entry => {
        const layout = parseDetailLayout(entry.layout);
        if (!layout) throw new Error("Invalid shared detail template");
        return { ...entry, layout };
      });
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const inventoryKind = editingKind === "destination" ? "country" : editingKind;
  const previewInventory = useQuery<PreviewInventory>({
    queryKey: ["detail-template-preview-inventory", inventoryKind, previewLocale, previewSearch],
    enabled: !!inventoryKind,
    queryFn: ({ signal }) => customFetch(`/api/website/catalog-pages?${new URLSearchParams({ kind: inventoryKind!, locale: previewLocale, q: previewSearch, sort: "title_asc", page: "1", pageSize: "25" })}`, { signal, cache: "no-store" }),
    refetchOnWindowFocus: false,
  });
  const previewItems = useMemo(() => (previewInventory.data?.items ?? []).filter(item => item.visible && !!item.canonicalPath), [previewInventory.data]);
  const previewItem = previewItems.find(item => String(item.sourceId) === previewSourceId) ?? null;
  const previewContent = useQuery<PreviewContent>({
    queryKey: ["detail-template-preview-content", editingKind, previewSourceId, previewLocale],
    enabled: !!editingKind && !!previewItem,
    queryFn: ({ signal }) => customFetch(`/api/website/detail-content?${new URLSearchParams({ kind: editingKind!, entityId: previewSourceId, locale: previewLocale })}`, { signal, cache: "no-store" }),
    refetchOnWindowFocus: false,
  });
  useEffect(() => { const timer = setTimeout(() => setPreviewSearch(previewSearchInput.trim()), 250); return () => clearTimeout(timer); }, [previewSearchInput]);
  useEffect(() => {
    if (!editingKind) return;
    setPreviewSourceId(current => previewItems.some(item => String(item.sourceId) === current) ? current : previewItems[0] ? String(previewItems[0].sourceId) : "");
  }, [editingKind, previewLocale, previewSearch, previewItems]);
  const save = useMutation({ mutationFn: ({ entry, edit }: { entry: Entry; edit?: Edit }) => customFetch("/api/website/detail-layouts/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: edit ? edit.expectedUpdatedAt : entry.updatedAt, layout: edit?.layout ?? entry.layout }) }), onSuccess: async (_result, { entry }) => {
    setApproved(false); setSelected([]);
    setEdits(old => { const next = { ...old }; delete next[entry.layout.kind]; return next; });
    await client.invalidateQueries({ queryKey: ["detail-layouts"] });
  } });
  const publish = useMutation({ mutationFn: () => customFetch("/api/website/detail-layouts/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved, selections: query.data?.filter(e => e.pageId && selected.includes(e.pageId)).map(e => ({ pageId: e.pageId, digest: e.digest })) }) }), onSuccess: async () => {
    setApproved(false); setSelected([]);
    await client.invalidateQueries({ queryKey: ["detail-layouts"] });
  } });
  const busy = save.isPending || publish.isPending;
  const dirty = Object.keys(edits).length > 0;
  const navigationState = useRef({ dirty, busy, message: "" });
  navigationState.current = { dirty, busy, message: copy("Discard unsaved layout changes and leave this page?", "Kaydedilmemiş şablon değişikliklerini silip bu sayfadan ayrılmak istiyor musunuz?") };
  useEffect(() => installPageEditorNavigationGuard(window,
    () => navigationState.current.dirty,
    () => window.confirm(navigationState.current.message),
    () => navigationState.current.busy,
  ), []);
  const requestAction = (run: () => void) => {
    if (busy || query.isFetching) {
      setNotice(copy("Wait until the current operation finishes before leaving or reloading.", "Ayrılmadan veya yenilemeden önce devam eden işlemin tamamlanmasını bekleyin."));
      return;
    }
    if (pendingAction) return;
    if (!dirty) { run(); return; }
    confirmationOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingAction({ run });
  };
  useImperativeHandle(ref, () => ({ requestLeave: action => requestAction(() => {
    navigationState.current.dirty = false;
    setEdits({}); setSelected([]); setApproved(false); action();
  }) }));
  const reload = async () => {
    setReloadError(false); setNotice("");
    const result = await query.refetch();
    if (result.isError) { setReloadError(true); return; }
    setEdits({}); setSelected([]); setApproved(false); save.reset(); publish.reset();
  };
  const change = (entry: Entry, layout: DetailLayout) => {
    if (busy || query.isFetching) return;
    setApproved(false); setSelected([]); setNotice(""); save.reset(); publish.reset();
    setEdits(old => {
      const next = { ...old };
      const unchanged = layout.sections.join() === entry.layout.sections.join()
        && [...layout.hidden].sort().join() === [...entry.layout.hidden].sort().join()
        && JSON.stringify(layout.presentation) === JSON.stringify(entry.layout.presentation)
        && JSON.stringify(layout.copy) === JSON.stringify(entry.layout.copy)
        && JSON.stringify(layout.generation) === JSON.stringify(entry.layout.generation);
      if (unchanged) delete next[layout.kind];
      else next[layout.kind] = { layout, expectedUpdatedAt: old[layout.kind] ? old[layout.kind].expectedUpdatedAt : entry.updatedAt };
      return next;
    });
  };
  const openEditor = (entry: Entry) => {
    const layout = edits[entry.layout.kind]?.layout ?? entry.layout;
    setEditingKind(layout.kind); setSelectedSection(layout.sections[0] ?? null); setMobilePane("sections");
  };
  const closeEditor = () => setEditingKind(null);
  const editingEntry = query.data?.find(entry => entry.layout.kind === editingKind) ?? null;
  const editingLayout = editingEntry ? edits[editingEntry.layout.kind]?.layout ?? editingEntry.layout : null;
  const editingLayoutValid = editingLayout ? !!parseDetailLayout(editingLayout) : false;
  const selectedIndex = editingLayout && selectedSection ? editingLayout.sections.indexOf(selectedSection) : -1;
  const selectedLocked = selectedSection ? ["hero", "navigation", "overview"].includes(selectedSection) : false;
  const availableVariables = editingLayout ? DETAIL_TEMPLATE_VARIABLES[editingLayout.kind] : [];
  const visibleVariables = availableVariables.filter(item => {
    const query = variableSearch.trim().toLocaleLowerCase(lang === "tr" ? "tr-TR" : "en-US");
    if (!query) return true;
    return [detailVariableLabel(item, lang), detailVariableGroup(item, lang), item.key].some(value => value.toLocaleLowerCase(lang === "tr" ? "tr-TR" : "en-US").includes(query));
  });
  const variableGroups = [...new Set(visibleVariables.map(item => item.group))];
  const selectedVariableMeta = availableVariables.find(item => item.key === selectedVariable) ?? null;
  useEffect(() => {
    setSelectedVariable(current => availableVariables.some(item => item.key === current) ? current : availableVariables[0]?.key ?? "");
    setVariableSearch("");
  }, [editingKind]);
  const updateSelectedCopy = (field: "title" | "body", value: string) => {
    if (!editingEntry || !editingLayout || !selectedSection) return;
    const localeCopy = { ...(editingLayout.copy[previewLocale] ?? {}) };
    const sectionCopy = { ...(localeCopy[selectedSection] ?? {}) };
    if (value.trim()) sectionCopy[field] = value; else delete sectionCopy[field];
    if (Object.keys(sectionCopy).length) localeCopy[selectedSection] = sectionCopy; else delete localeCopy[selectedSection];
    const nextCopy = { ...editingLayout.copy };
    if (Object.keys(localeCopy).length) nextCopy[previewLocale] = localeCopy; else delete nextCopy[previewLocale];
    change(editingEntry, { ...editingLayout, copy: nextCopy });
  };
  const insertSelectedVariable = (field: "title" | "body") => {
    if (!editingLayout || !selectedSection || !selectedVariable) return;
    const element = field === "title" ? titleCopyRef.current : bodyCopyRef.current;
    const current = editingLayout.copy[previewLocale]?.[selectedSection]?.[field] ?? "";
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? start;
    const token = `{{${selectedVariable}}}`;
    updateSelectedCopy(field, `${current.slice(0, start)}${token}${current.slice(end)}`);
    requestAnimationFrame(() => {
      const next = field === "title" ? titleCopyRef.current : bodyCopyRef.current;
      next?.focus();
      next?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const moveSelected = (by: -1 | 1) => {
    if (!editingEntry || !editingLayout || selectedIndex < 0) return;
    const target = selectedIndex + by;
    const fixedPrefix = editingLayout.sections.includes("navigation") ? 3 : 2;
    if (target < fixedPrefix || target >= editingLayout.sections.length) return;
    const sections = [...editingLayout.sections];
    [sections[selectedIndex], sections[target]] = [sections[target], sections[selectedIndex]];
    change(editingEntry, { ...editingLayout, sections });
  };
  const checkedPreviewContent = useMemo(() => {
    const parsed = previewContent.data ? parseDetailContent(previewContent.data.content) : null;
    return parsed && parsed.kind === editingKind && String(parsed.entityId) === previewSourceId && parsed.locale === previewLocale ? parsed : null;
  }, [previewContent.data, editingKind, previewSourceId, previewLocale]);
  const onTemplatePreviewReady = useCallback((ready: boolean) => setTemplatePreviewReady(ready), []);
  return <section className="space-y-4 rounded-xl border p-4" aria-labelledby="detail-templates-title" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="detail-templates-title" className="text-xl font-semibold">{copy("Shared detail templates", "Ortak detay şablonları")}</h2>
      <Button variant="outline" disabled={busy || query.isFetching} onClick={() => requestAction(() => void reload())}>{copy("Reload drafts", "Taslakları yenile")}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{copy("Layouts reuse current catalogue data, SEO and Apply. Save a draft, then have a different administrator review and publish. No catalogue records are published by this action.", "Şablonlar mevcut katalog verilerini, SEO ve başvuru akışını kullanır. Taslağı kaydedin; farklı bir yönetici inceleyip yayınlasın. Bu işlem katalog kayıtlarını yayınlamaz.")}</p>
    <p className="text-sm text-muted-foreground">{copy("Hero, page navigation and overview are required. Other sections can be hidden, reordered and given shared presentation defaults; they appear on public pages only when content is available.", "Üst bölüm, bölüm gezinmesi ve genel bakış zorunludur. Diğer bölümler gizlenebilir, sıralanabilir ve ortak görünüm varsayılanları alabilir; halka açık sayfalarda yalnız içerik varsa görünür.")}</p>
    {busy ? <p role="status">{save.isPending ? copy("Saving layout draft…", "Şablon taslağı kaydediliyor…") : copy("Publishing approved layouts…", "Onaylanan şablonlar yayınlanıyor…")}</p>
      : dirty && <p role="status">{copy("You have unsaved layout changes.", "Kaydedilmemiş şablon değişiklikleriniz var.")}</p>}
    {(dirty || busy) && typeof window !== "undefined" && !supportsPageEditorHistoryGuard(window) && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{copy("This browser cannot reliably protect unsaved changes when using Back or Forward. Save your changes before using browser history.", "Bu tarayıcıda Geri/İleri düğmeleri kaydedilmemiş değişiklikleri güvenilir biçimde koruyamaz. Tarayıcı geçmişini kullanmadan önce değişikliklerinizi kaydedin.")}</p>}
    {notice && <p role="status">{notice}</p>}
    {query.isLoading && <p role="status">{copy("Loading templates…", "Şablonlar yükleniyor…")}</p>}
    {(query.isError || reloadError) && <p role="alert">{copy("Could not load templates. Your local edits are preserved.", "Şablonlar yüklenemedi. Yerel düzenlemeleriniz korunuyor.")} <Button variant="outline" disabled={busy || query.isFetching} onClick={() => requestAction(() => void reload())}>{t("common.retry")}</Button></p>}
    <div className="grid gap-4 md:grid-cols-2">{query.data?.map(entry => {
      const layout = edits[entry.layout.kind]?.layout ?? entry.layout;
      const visible = layout.sections.filter(section => !layout.hidden.includes(section));
      return <fieldset key={layout.kind} disabled={busy || query.isFetching} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
        <legend className="px-2 font-semibold">{label(layout.kind)}</legend>
        <div className="flex items-center justify-between gap-3"><div><Badge variant={entry.status === "published" ? "default" : "secondary"}>{label(entry.status)}</Badge><p className="mt-2 text-sm text-muted-foreground">{visible.length}/{layout.sections.length} {copy("sections visible", "bölüm görünür")}</p></div><LayoutTemplate className="h-8 w-8 text-primary" /></div>
        <div className="flex flex-wrap gap-1">{visible.slice(0, 6).map(section => <Badge variant="outline" key={section}>{label(section)}</Badge>)}{visible.length > 6 && <Badge variant="outline">+{visible.length - 6}</Badge>}</div>
        <Button className="w-full" onClick={() => openEditor(entry)}>{copy("Edit template", "Şablonu düzenle")}</Button>
        {entry.pageId && entry.status === "draft" && !dirty && <label className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(entry.pageId)} onChange={e => { setApproved(false); setSelected(old => e.target.checked ? [...old, entry.pageId!] : old.filter(id => id !== entry.pageId)); }} />{copy("Include saved draft in review", "Kaydedilmiş taslağı incelemeye dahil et")}</label>}
      </fieldset>;
    })}</div>
    <Dialog open={!!editingEntry && !!editingLayout} onOpenChange={open => { if (!open) closeEditor(); }}>
      <DialogContent className="flex h-[96dvh] max-h-[96dvh] w-[calc(100%_-_1rem)] max-w-[1500px] flex-col gap-0 overflow-hidden p-0">
        {editingEntry && editingLayout && <>
          <DialogHeader className="shrink-0 border-b bg-card px-4 py-3 pe-12 text-start"><div className="flex flex-wrap items-center justify-between gap-3"><div><DialogTitle>{copy("Shared detail template", "Ortak detay şablonu")} · {label(editingLayout.kind)}</DialogTitle><p className="mt-1 text-xs text-muted-foreground">{copy("Controls shared section order, visibility, presentation and language defaults. Record-specific content stays in each page editor.", "Ortak bölüm sırasını, görünürlüğünü, görünümünü ve dil varsayılanlarını yönetir. Kayda özel içerik her sayfanın kendi editöründe kalır.")}</p></div><div className="flex gap-2"><Button variant="outline" onClick={closeEditor}>{copy("Back", "Geri")}</Button><Button disabled={!edits[editingLayout.kind] || !editingLayoutValid || busy || query.isFetching} onClick={() => { setNotice(""); setReloadError(false); save.mutate({ entry: editingEntry, edit: edits[editingLayout.kind] }); }}>{copy("Save template draft", "Şablon taslağını kaydet")}</Button></div></div></DialogHeader>
          <div className="grid w-full shrink-0 grid-cols-3 gap-2 border-b p-2 lg:hidden">{(["sections", "editor", "preview"] as const).map(pane => <Button key={pane} className="min-w-0 px-2" size="sm" variant={mobilePane === pane ? "default" : "outline"} onClick={() => setMobilePane(pane)}>{pane === "sections" ? copy("Sections", "Bölümler") : pane === "editor" ? copy("Edit section", "Bölümü düzenle") : copy("Preview", "Önizleme")}</Button>)}</div>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <aside className={`${mobilePane === "sections" ? "flex" : "hidden"} w-full shrink-0 flex-col border-e bg-card lg:flex lg:w-72`}><div className="border-b p-3"><h3 className="text-xs font-bold uppercase text-muted-foreground">{copy("Template sections", "Şablon bölümleri")}</h3><p className="mt-1 text-xs text-muted-foreground">{copy("Select a section to configure it.", "Ayarlamak için bir bölüm seçin.")}</p></div><div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">{editingLayout.sections.map((section, index) => {
              const hidden = editingLayout.hidden.includes(section); const locked = ["hero", "navigation", "overview"].includes(section);
              return <button type="button" key={section} onClick={() => { setSelectedSection(section); setMobilePane("editor"); }} className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-start ${selectedSection === section ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"}`}><span className="w-5 text-xs text-muted-foreground">{index + 1}.</span>{locked ? <LockKeyhole className="h-4 w-4 text-muted-foreground" /> : hidden ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-emerald-600" />}<span className="min-w-0 flex-1 truncate text-sm font-medium">{label(section)}</span></button>;
            })}</div></aside>
            <section className={`${mobilePane === "editor" ? "flex" : "hidden"} w-full shrink-0 flex-col border-e bg-background lg:flex lg:w-[440px]`}>
              <div className="border-b p-3"><h3 className="text-xs font-bold uppercase text-muted-foreground">{copy("Edit section", "Bölümü düzenle")}</h3></div>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">{selectedSection && selectedIndex >= 0 ? <div className="space-y-5">
                <div><p className="text-xs text-muted-foreground">{copy("Selected section", "Seçili bölüm")}</p><h4 className="mt-1 text-xl font-semibold">{label(selectedSection)}</h4></div>
                <div className="rounded-xl border p-4"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={!editingLayout.hidden.includes(selectedSection)} disabled={selectedLocked} onChange={event => change(editingEntry, { ...editingLayout, hidden: event.target.checked ? editingLayout.hidden.filter(key => key !== selectedSection) : [...editingLayout.hidden, selectedSection] })} /><span><strong className="block text-sm">{copy("Visible on public pages", "Halka açık sayfalarda görünür")}</strong><span className="text-xs text-muted-foreground">{selectedLocked ? copy("This structural section is required.", "Bu yapısal bölüm zorunludur.") : copy("Hidden sections keep their content but are not rendered.", "Gizlenen bölümlerin içeriği korunur fakat gösterilmez.")}</span></span></label></div>
                <DetailSectionAppearanceFields value={editingLayout.presentation[selectedSection] ?? {}} copy={copy} onChange={next => {
                  const presentation = { ...editingLayout.presentation };
                  if (Object.keys(next).length) presentation[selectedSection] = next;
                  else delete presentation[selectedSection];
                  change(editingEntry, { ...editingLayout, presentation });
                }} />
                <div className="space-y-4 rounded-xl border p-4">
                  <div>
                    <h5 className="text-sm font-semibold">{copy("Shared section text", "Ortak bölüm metni")}</h5>
                    <p className="mt-1 text-xs text-muted-foreground">{copy(
                      `Default text for ${LANGUAGE_META[previewLocale].name}. A page-specific text overrides it; catalogue facts remain live.`,
                      `${LANGUAGE_META[previewLocale].name} için varsayılan metin. Sayfaya özel metin bunun üzerine yazılır; katalog gerçekleri canlı kalır.`,
                    )}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{copy("Text language", "Metin dili")}</Label>
                    <Select value={previewLocale} onValueChange={value => { setPreviewLocale(value as Language); setPreviewSourceId(""); }}><SelectTrigger aria-label={copy("Text language", "Metin dili")}><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_LANGUAGES.map(value => <SelectItem key={value} value={value}>{LANGUAGE_META[value].name}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                    <div className="flex items-start gap-3">
                      <span className="rounded-lg bg-primary/10 p-2 text-primary"><Braces className="h-4 w-4" /></span>
                      <div><h6 className="text-sm font-semibold">{copy("Insert live page data", "Canlı sayfa verisi ekle")}</h6><p className="mt-1 text-xs text-muted-foreground">{copy("Choose what should change automatically from one catalogue page to another. No code knowledge is required.", "Katalog sayfasına göre otomatik değişmesini istediğiniz bilgiyi seçin. Teknik kod bilmeniz gerekmez.")}</p></div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="template-variable-search">{copy("Find a field", "Alan ara")}</Label>
                      <div className="relative"><Search className="absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input id="template-variable-search" className="ps-9" value={variableSearch} onChange={event => setVariableSearch(event.target.value)} placeholder={copy("For example: city, tuition, climate…", "Örneğin: şehir, ücret, iklim…")} /></div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{copy("Information to insert", "Eklenecek bilgi")}</Label>
                      <Select value={selectedVariable} onValueChange={setSelectedVariable}><SelectTrigger aria-label={copy("Information to insert", "Eklenecek bilgi")}><SelectValue /></SelectTrigger><SelectContent>
                        {variableGroups.map((group, groupIndex) => <SelectGroup key={group}>{groupIndex > 0 && <SelectSeparator />}<SelectLabel>{lang === "tr" ? DETAIL_VARIABLE_GROUP_TR[group] ?? group : group}</SelectLabel>{visibleVariables.filter(item => item.group === group).map(item => <SelectItem key={item.key} value={item.key}>{detailVariableLabel(item, lang)}</SelectItem>)}</SelectGroup>)}
                      </SelectContent></Select>
                      {variableSearch && visibleVariables.length === 0 && <p role="status" className="text-xs text-amber-700">{copy("No field matches this search. Clear the search to see every available field.", "Bu aramayla eşleşen alan yok. Tüm alanları görmek için aramayı temizleyin.")}</p>}
                    </div>
                    {selectedVariableMeta && <div className="space-y-2 rounded-lg border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{detailVariableLabel(selectedVariableMeta, lang)}</strong><Badge variant="secondary">{detailVariableGroup(selectedVariableMeta, lang)}</Badge></div>
                      <p className="text-xs text-muted-foreground">{detailVariableHelp(selectedVariableMeta, lang)}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">{copy("Inserted marker:", "Eklenecek işaret:")}</span><code className="rounded bg-muted px-2 py-1 font-mono">{`{{${selectedVariableMeta.key}}}`}</code></div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {selectedSection !== "hero" && <Button type="button" size="sm" variant="outline" onClick={() => insertSelectedVariable("title")}><Braces className="me-2 h-4 w-4" />{copy("Add to title", "Başlığa ekle")}</Button>}
                        <Button type="button" size="sm" onClick={() => insertSelectedVariable("body")}><Braces className="me-2 h-4 w-4" />{copy("Add to text", "Metne ekle")}</Button>
                      </div>
                    </div>}
                    <div className="flex items-start gap-2 rounded-lg bg-muted/70 p-3 text-xs text-muted-foreground"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><p>{copy("If a value may be empty, add fallback text after the marker: {{city.climateSummary|Climate information will be added soon}}.", "Bilgi bazı kayıtlarda boş kalabiliyorsa işaretin sonuna yedek metin ekleyin: {{city.climateSummary|İklim bilgisi yakında eklenecek}}.")}</p></div>
                  </div>
                  {!editingLayoutValid && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{copy("A text contains an incomplete or unsupported variable. Use the picker or correct the {{variable}} syntax before saving.", "Bir metinde eksik veya desteklenmeyen değişken var. Kaydetmeden önce seçiciyi kullanın veya {{değişken}} yazımını düzeltin.")}</p>}
                  {selectedSection !== "hero" && <div className="space-y-1.5">
                    <Label htmlFor="template-section-title">{copy("Default section title", "Varsayılan bölüm başlığı")}</Label>
                    <Input ref={titleCopyRef} id="template-section-title" maxLength={160} value={editingLayout.copy[previewLocale]?.[selectedSection]?.title ?? ""} onChange={event => updateSelectedCopy("title", event.target.value)} />
                  </div>}
                  <div className="space-y-1.5">
                    <Label htmlFor="template-section-body">{selectedSection === "hero" ? copy("Default supporting text", "Varsayılan destek metni") : copy("Default introduction", "Varsayılan giriş metni")}</Label>
                    <Textarea ref={bodyCopyRef} id="template-section-body" rows={5} maxLength={6000} value={editingLayout.copy[previewLocale]?.[selectedSection]?.body ?? ""} onChange={event => updateSelectedCopy("body", event.target.value)} />
                  </div>
                  {selectedSection === "hero" && <p className="text-xs text-muted-foreground">{copy("The page/entity name remains catalogue-authoritative, so the shared template changes only the hero supporting text.", "Sayfa/kayıt adı katalog kaynağı olarak kalır; bu nedenle ortak şablon yalnız hero destek metnini değiştirir.")}</p>}
                </div>
                <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={selectedLocked || selectedIndex <= (editingLayout.sections.includes("navigation") ? 3 : 2)} onClick={() => moveSelected(-1)}><ArrowUp className="me-2 h-4 w-4" />{copy("Move up", "Yukarı taşı")}</Button><Button variant="outline" disabled={selectedLocked || selectedIndex >= editingLayout.sections.length - 1} onClick={() => moveSelected(1)}><ArrowDown className="me-2 h-4 w-4" />{copy("Move down", "Aşağı taşı")}</Button></div>
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{copy("Shared titles and introductions are defaults for this page type and language. Media and record-specific fields remain in each dynamic page editor; catalogue facts are never duplicated here.", "Ortak başlıklar ve giriş metinleri bu sayfa türü ve dil için varsayılandır. Medya ve kayda özel alanlar her dinamik sayfanın editöründe kalır; katalog gerçekleri burada yinelenmez.")}</p>
              </div> : <p className="text-sm text-muted-foreground">{copy("Select a section.", "Bir bölüm seçin.")}</p>}</div>
            </section>
            <section className={`${mobilePane === "preview" ? "flex" : "hidden"} min-w-0 flex-1 flex-col overflow-y-auto bg-muted/30 p-3 sm:p-5 lg:flex`}>
              <div className="mb-4 space-y-4">
                <div><h3 className="font-semibold">{copy("Template structure preview", "Şablon yapı önizlemesi")}</h3><p className="mt-1 text-sm text-muted-foreground">{copy("Choose a real catalogue page. The unsaved template structure and presentation settings are applied immediately without changing that page.", "Gerçek bir katalog sayfası seçin. Kaydedilmemiş şablon yapısı ve görünüm ayarları, sayfayı değiştirmeden anında uygulanır.")}</p></div>
                <div className="grid gap-3 rounded-xl border bg-background p-3 md:grid-cols-3">
                  <div className="space-y-1"><Label>{copy("Preview language", "Önizleme dili")}</Label><Select value={previewLocale} onValueChange={value => { setPreviewLocale(value as Language); setPreviewSourceId(""); }}><SelectTrigger aria-label={copy("Preview language", "Önizleme dili")}><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_LANGUAGES.map(value => <SelectItem key={value} value={value}>{LANGUAGE_META[value].name}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1"><Label htmlFor="template-preview-search">{copy("Find a sample page", "Örnek sayfa bul")}</Label><div className="relative"><Search className="absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input id="template-preview-search" className="ps-9" value={previewSearchInput} maxLength={120} onChange={event => setPreviewSearchInput(event.target.value)} /></div></div>
                  <div className="space-y-1"><Label>{copy("Representative record", "Temsilî kayıt")}</Label><Select value={previewSourceId} onValueChange={setPreviewSourceId} disabled={!previewItems.length}><SelectTrigger aria-label={copy("Representative record", "Temsilî kayıt")}><SelectValue placeholder={copy("Choose a record", "Kayıt seçin")} /></SelectTrigger><SelectContent>{previewItems.map(item => <SelectItem key={item.sourceId} value={String(item.sourceId)}>{item.title}</SelectItem>)}</SelectContent></Select></div>
                </div>
                {previewItem && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3 text-sm"><span className="flex min-w-0 items-center gap-2"><Database className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{previewItem.title} · #{previewItem.sourceId}</span></span><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><a href={previewItem.sourceEditPath} target="_blank" rel="noopener noreferrer">{copy("Source record", "Kaynak kaydı")}</a></Button>{previewItem.canonicalPath && <Button asChild size="sm" variant="outline"><a href={previewItem.canonicalPath} target="_blank" rel="noopener noreferrer">{copy("Open page", "Sayfayı aç")}</a></Button>}</div></div>}
              </div>
              {previewInventory.isLoading || previewContent.isLoading ? <p role="status" className="rounded-xl border bg-background p-6 text-center text-muted-foreground">{copy("Loading real page values…", "Gerçek sayfa değerleri yükleniyor…")}</p>
                : previewInventory.isError || previewContent.isError ? <div role="alert" className="rounded-xl border bg-background p-5"><p>{copy("The representative page could not be loaded. Template edits are preserved.", "Temsilî sayfa yüklenemedi. Şablon değişiklikleri korunuyor.")}</p><Button className="mt-3" variant="outline" onClick={() => { void previewInventory.refetch(); void previewContent.refetch(); }}>{copy("Retry preview", "Önizlemeyi yeniden dene")}</Button></div>
                : checkedPreviewContent && previewItem?.canonicalPath ? <DetailFullPreview target={{ kind: editingLayout.kind, entityId: previewItem.sourceId, locale: previewLocale, canonicalPath: previewItem.canonicalPath }} content={checkedPreviewContent} layoutOverride={editingLayout} copy={copy} onReady={onTemplatePreviewReady} />
                  : <p className="rounded-xl border bg-background p-6 text-center text-muted-foreground">{previewSearch ? copy("No visible matching page is available for this preview.", "Bu önizleme için eşleşen görünür sayfa bulunamadı.") : copy("Choose a visible catalogue page to preview this template with real values.", "Bu şablonu gerçek değerlerle önizlemek için görünür bir katalog sayfası seçin.")}</p>}
            </section>
          </div>
        </>}
      </DialogContent>
    </Dialog>
    {!!selected.length && <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">{copy(`Review ${selected.length} saved templates`, `${selected.length} kaydedilmiş şablonu incele`)}</h3>
      <p className="text-sm">{copy("This affects every public detail page of the selected types. A different administrator must approve.", "Bu işlem seçilen türlerdeki tüm halka açık detay sayfalarını etkiler. Farklı bir yönetici onaylamalıdır.")}</p>
      {query.data?.filter(e => e.pageId && selected.includes(e.pageId)).map(e => <p key={e.pageId} className="break-words text-sm">{label(e.layout.kind)}: {e.layout.sections.filter(s => !e.layout.hidden.includes(s)).map(label).join(" → ")}; {copy("hidden", "gizli")}: {e.layout.hidden.map(label).join(", ") || copy("none", "yok")}</p>)}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={approved} disabled={busy || query.isFetching} onChange={e => setApproved(e.target.checked)} />{copy("I reviewed these exact saved layouts and approve publication.", "Bu kaydedilmiş şablonları inceledim ve yayınlanmalarını onaylıyorum.")}</label>
      <Button disabled={!approved || busy || query.isFetching} onClick={() => publish.mutate()}>{copy("Publish approved layouts", "Onaylanan şablonları yayınla")}</Button>
    </div>}
    {(save.isError || publish.isError) && <p role="alert" className="text-destructive">{copy("Not completed. Your local edits are preserved. Publication requires a different administrator; changed drafts must be reviewed again. Reload the saved state before retrying an unconfirmed operation.", "İşlem tamamlanamadı. Yerel düzenlemeleriniz korunuyor. Yayın için farklı bir yönetici gerekir; değişen taslaklar yeniden incelenmelidir. Sonucu doğrulanamayan işlemi tekrarlamadan önce kaydedilmiş durumu yenileyin.")}</p>}
    {save.isSuccess && !busy && <p role="status">{copy("Layout draft saved. It has not been published.", "Şablon taslağı kaydedildi. Yayınlanmadı.")}</p>}
    {publish.isSuccess && <p role="status">{copy("Approved layouts published.", "Onaylanan şablonlar yayınlandı.")}</p>}
    <AlertDialog open={pendingAction !== null} onOpenChange={open => { if (!open) setPendingAction(null); }}>
      <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); confirmationOpener.current?.focus(); }}>
        <AlertDialogHeader className="text-start"><AlertDialogTitle>{copy("Discard unsaved layout changes?", "Kaydedilmemiş şablon değişiklikleri silinsin mi?")}</AlertDialogTitle>
          <AlertDialogDescription>{copy("Continue to discard your local layout edits. Saved drafts and published layouts will not change.", "Devam ederseniz yerel şablon düzenlemeleriniz silinir. Kaydedilmiş taslaklar ve yayınlanmış şablonlar değişmez.")}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{copy("Keep editing", "Düzenlemeye devam et")}</AlertDialogCancel><AlertDialogAction disabled={busy || query.isFetching} onClick={() => { const action = pendingAction; setPendingAction(null); action?.run(); }}>{copy("Discard and continue", "Değişiklikleri sil ve devam et")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
});

export default DetailTemplates;
