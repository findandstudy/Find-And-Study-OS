import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useI18n } from "@/hooks/use-i18n";
import { type DetailLayout } from "@/lib/website/detailLayoutContract";
import { detailTemplateLabel } from "./detailTemplateLabels";
import { installPageEditorNavigationGuard, supportsPageEditorHistoryGuard } from "./pageEditorNavigationGuard";
type Entry = { pageId: number | null; digest: string | null; updatedAt: string | null; status: string; layout: DetailLayout };
type Edit = { layout: DetailLayout; expectedUpdatedAt: string | null };
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
  const confirmationOpener = useRef<HTMLElement | null>(null);
  const query = useQuery<Entry[]>({ queryKey: ["detail-layouts"], queryFn: ({ signal }) => customFetch("/api/website/detail-layouts", { signal }), refetchOnWindowFocus: false, refetchOnReconnect: false });
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
        && [...layout.hidden].sort().join() === [...entry.layout.hidden].sort().join();
      if (unchanged) delete next[layout.kind];
      else next[layout.kind] = { layout, expectedUpdatedAt: old[layout.kind] ? old[layout.kind].expectedUpdatedAt : entry.updatedAt };
      return next;
    });
  };
  return <section className="space-y-4 rounded-xl border p-4" aria-labelledby="detail-templates-title" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="detail-templates-title" className="text-xl font-semibold">{copy("Shared detail templates", "Ortak detay şablonları")}</h2>
      <Button variant="outline" disabled={busy || query.isFetching} onClick={() => requestAction(() => void reload())}>{copy("Reload drafts", "Taslakları yenile")}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{copy("Layouts reuse current catalogue data, SEO and Apply. Save a draft, then have a different administrator review and publish. No catalogue records are published by this action.", "Şablonlar mevcut katalog verilerini, SEO ve başvuru akışını kullanır. Taslağı kaydedin; farklı bir yönetici inceleyip yayınlasın. Bu işlem katalog kayıtlarını yayınlamaz.")}</p>
    <p className="text-sm text-muted-foreground">{copy("Hero, page navigation and overview are required. Other sections can be hidden or reordered; they appear on public pages only when content is available.", "Üst bölüm, bölüm gezinmesi ve genel bakış zorunludur. Diğer bölümler gizlenebilir veya sıralanabilir; halka açık sayfalarda yalnız içerik varsa görünür.")}</p>
    {busy ? <p role="status">{save.isPending ? copy("Saving layout draft…", "Şablon taslağı kaydediliyor…") : copy("Publishing approved layouts…", "Onaylanan şablonlar yayınlanıyor…")}</p>
      : dirty && <p role="status">{copy("You have unsaved layout changes.", "Kaydedilmemiş şablon değişiklikleriniz var.")}</p>}
    {(dirty || busy) && typeof window !== "undefined" && !supportsPageEditorHistoryGuard(window) && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{copy("This browser cannot reliably protect unsaved changes when using Back or Forward. Save your changes before using browser history.", "Bu tarayıcıda Geri/İleri düğmeleri kaydedilmemiş değişiklikleri güvenilir biçimde koruyamaz. Tarayıcı geçmişini kullanmadan önce değişikliklerinizi kaydedin.")}</p>}
    {notice && <p role="status">{notice}</p>}
    {query.isLoading && <p role="status">{copy("Loading templates…", "Şablonlar yükleniyor…")}</p>}
    {(query.isError || reloadError) && <p role="alert">{copy("Could not load templates. Your local edits are preserved.", "Şablonlar yüklenemedi. Yerel düzenlemeleriniz korunuyor.")} <Button variant="outline" disabled={busy || query.isFetching} onClick={() => requestAction(() => void reload())}>{t("common.retry")}</Button></p>}
    <div className="grid gap-4 md:grid-cols-2">{query.data?.map(entry => {
      const layout = edits[entry.layout.kind]?.layout ?? entry.layout;
      return <fieldset key={layout.kind} disabled={busy || query.isFetching} className="min-w-0 space-y-3 rounded-lg border p-4">
        <legend className="px-2 font-semibold">{label(layout.kind)} · {label(entry.status)}</legend>
        {layout.sections.map((section, index) => <div key={section} className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" className="shrink-0" checked={!layout.hidden.includes(section)} disabled={["hero", "navigation", "overview"].includes(section)} onChange={e => change(entry, { ...layout, hidden: e.target.checked ? layout.hidden.filter(x => x !== section) : [...layout.hidden, section] })} />{label(section)}</label>
          <Button size="sm" variant="outline" className="shrink-0" aria-label={copy(`Move ${label(section)} up in ${label(layout.kind)}`, `${label(layout.kind)}: ${label(section)} bölümünü yukarı taşı`)} disabled={index <= (layout.sections.includes("navigation") ? 3 : 2)} onClick={() => { const sections = [...layout.sections]; [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]]; change(entry, { ...layout, sections }); }}>↑</Button>
        </div>)}
        <Button variant="outline" onClick={() => { setNotice(""); setReloadError(false); save.mutate({ entry, edit: edits[layout.kind] }); }}>{copy("Save layout draft", "Şablon taslağını kaydet")}</Button>
        {entry.pageId && entry.status === "draft" && !dirty && <label className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(entry.pageId)} onChange={e => { setApproved(false); setSelected(old => e.target.checked ? [...old, entry.pageId!] : old.filter(id => id !== entry.pageId)); }} />{copy("Include saved draft in review", "Kaydedilmiş taslağı incelemeye dahil et")}</label>}
      </fieldset>;
    })}</div>
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
