import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Edit, Search, Globe, Eye, EyeOff, Plus, Download, X, Bookmark, Trash2, ExternalLink, List, Table2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SUPPORTED_LANGUAGES, LANGUAGE_META } from "@/lib/i18n";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { useLocation } from "wouter";
import DetailTemplates, { type DetailTemplatesHandle } from "./DetailTemplates";
import CatalogPagesInventory from "./CatalogPagesInventory";
import { canOpenManagedPage, isInternalWebsitePage, isSystemManagedPage, managedPagePublicPath } from "@/lib/website/managedPageRoutes";

const WebsiteBlog = lazy(() => import("./Blog"));

interface WebsitePage {
  id: number;
  title: string;
  slug: string;
  status: string;
  template: string;
  locale: string;
  publishedAt: string | null;
  updatedAt: string;
  sortOrder: number;
}

interface SavedCmsView {
  id: string;
  name: string;
  searchTerm: string;
  statusFilter: string;
  localeFilter: string;
  templateFilter: string;
  cmsSort: string;
  cmsPageSize: number;
}

const SAVED_VIEWS_KEY = "findandstudy.website-pages.saved-views.v1";

const STATUS_BADGE: Record<string, { label: [string, string]; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  published: { label: ["Published", "Yayında"], variant: "default" },
  draft: { label: ["Draft", "Taslak"], variant: "secondary" },
  in_review: { label: ["Awaiting review", "İnceleme bekliyor"], variant: "outline" },
  archived: { label: ["Archived", "Arşivlendi"], variant: "outline" },
};

const TEMPLATE_ICONS: Record<string, string> = {
  home: "🏠", about: "📖", countries: "🌍", programs: "📚", blog: "✍️", contact: "📧",
};

export default function WebsitePages() {
  const { lang, t } = useI18n();
  const copy = (en: string, tr: string) => lang === "tr" ? tr : en;
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const templates = useRef<DetailTemplatesHandle>(null);
  const requestLeave = (action: () => void) => templates.current ? templates.current.requestLeave(action) : action();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [localeFilter, setLocaleFilter] = useState("all");
  const [templateFilter, setTemplateFilter] = useState("all");
  const [cmsSort, setCmsSort] = useState("updated_desc");
  const [cmsPage, setCmsPage] = useState(1);
  const [cmsPageSize, setCmsPageSize] = useState(25);
  const [cmsView, setCmsView] = useState<"list" | "table">("list");
  const [selectedCmsPages, setSelectedCmsPages] = useState<number[]>([]);
  const [area, setArea] = useState<"dynamic" | "managed" | "blog" | "templates">("dynamic");
  const [createOpen, setCreateOpen] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [savedViews, setSavedViews] = useState<SavedCmsView[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(SAVED_VIEWS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter(view => view && typeof view.id === "string" && typeof view.name === "string").slice(0, 12) : [];
    } catch { return []; }
  });
  const [draft, setDraft] = useState({ title: "", slug: "", locale: lang as string, starter: "blank", country: "", city: "" });
  const templateLabel = (template: string) => ({ home: copy("Home", "Ana sayfa"), about: copy("About", "Hakkımızda"), countries: copy("Countries", "Ülkeler"), programs: copy("Programs", "Programlar"), blog: copy("Blog", "Blog"), contact: copy("Contact", "İletişim"), default: copy("Default", "Varsayılan") })[template] ?? template;

  const { data: pages = [], isLoading, isError, refetch } = useQuery<WebsitePage[]>({
    queryKey: ["website-pages"],
    queryFn: () => customFetch("/api/website/pages"),
  });

  const createMutation = useMutation({
    mutationFn: () => customFetch<WebsitePage>("/api/website/pages/drafts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
    }),
    onSuccess: page => {
      queryClient.invalidateQueries({ queryKey: ["website-pages"] });
      setCreateOpen(false);
      setLocation(`/admin/website/pages/${page.id}/edit`);
    },
  });

  const filtered = pages.filter(p => {
    if (isInternalWebsitePage(p)) return false;
    if (searchTerm && !p.title.toLowerCase().includes(searchTerm.toLowerCase()) && !p.slug.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (localeFilter !== "all" && p.locale !== localeFilter) return false;
    if (templateFilter !== "all" && p.template !== templateFilter) return false;
    return true;
  }).sort((a, b) => {
    if (cmsSort === "title_asc") return a.title.localeCompare(b.title, lang);
    if (cmsSort === "title_desc") return b.title.localeCompare(a.title, lang);
    if (cmsSort === "updated_asc") return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const cmsPages = pages.filter(page => !isInternalWebsitePage(page));
  const cmsTemplates = Array.from(new Set(cmsPages.map(page => page.template).filter(Boolean))).sort();
  const cmsTotalPages = Math.max(1, Math.ceil(filtered.length / cmsPageSize));
  const pagedCmsPages = filtered.slice((cmsPage - 1) * cmsPageSize, cmsPage * cmsPageSize);
  const allFilteredSelected = pagedCmsPages.length > 0 && pagedCmsPages.every(page => selectedCmsPages.includes(page.id));
  useEffect(() => { setCmsPage(1); setSelectedCmsPages([]); }, [searchTerm, statusFilter, localeFilter, templateFilter, cmsSort, cmsPageSize]);
  useEffect(() => { if (cmsPage > cmsTotalPages) setCmsPage(cmsTotalPages); }, [cmsPage, cmsTotalPages]);
  const clearCmsFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setLocaleFilter("all");
    setTemplateFilter("all");
  };
  const persistSavedViews = (views: SavedCmsView[]) => {
    setSavedViews(views);
    if (typeof window !== "undefined") window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  };
  const saveCurrentView = () => {
    const name = viewName.trim().slice(0, 60);
    if (!name) return;
    const next: SavedCmsView = { id: crypto.randomUUID(), name, searchTerm, statusFilter, localeFilter, templateFilter, cmsSort, cmsPageSize };
    persistSavedViews([next, ...savedViews].slice(0, 12));
    setViewName("");
    setSaveViewOpen(false);
  };
  const applySavedView = (id: string) => {
    const view = savedViews.find(item => item.id === id);
    if (!view) return;
    setSearchTerm(view.searchTerm); setStatusFilter(view.statusFilter); setLocaleFilter(view.localeFilter); setTemplateFilter(view.templateFilter); setCmsSort(view.cmsSort); setCmsPageSize([25, 50, 100].includes(view.cmsPageSize) ? view.cmsPageSize : 25);
    setSelectedCmsPages([]);
  };
  const exportCmsCsv = () => {
    const selected = selectedCmsPages.length > 0 ? filtered.filter(page => selectedCmsPages.includes(page.id)) : filtered;
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [
      ["id", "title", "locale", "slug", "status", "template", "updatedAt"].join(","),
      ...selected.map(page => [page.id, page.title, page.locale, page.slug, page.status, page.template, page.updatedAt].map(escape).join(",")),
    ].join("\r\n");
    const href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `cms-pages-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(href);
  };
  const CmsActions = ({ page }: { page: WebsitePage }) => <div className="flex flex-wrap justify-end gap-1.5">
    <Button size="sm" onClick={() => requestLeave(() => setLocation(`/admin/website/pages/${page.id}/edit`))} aria-label={copy(`Edit ${page.title}`, `${page.title} sayfasını düzenle`)}><Edit className="me-1 h-4 w-4" />{copy("Edit page", "Düzenle")}</Button>
    {page.template === "blog" && <Button size="sm" variant="secondary" onClick={() => requestLeave(() => setArea("blog"))}><FileText className="me-1 h-4 w-4" />{copy("Manage posts", "Yazıları yönet")}</Button>}
    {canOpenManagedPage(page) ? <Button asChild size="sm" variant="outline"><a href={managedPagePublicPath(page)} target="_blank" rel="noopener noreferrer" aria-label={copy(`Open ${page.title} in a new tab`, `${page.title} sayfasını yeni sekmede aç`)}><ExternalLink className="me-1 h-4 w-4" />{copy("Open", "Aç")}</a></Button> : <Button size="sm" variant="outline" disabled title={copy("Publish this custom page before opening its public route.", "Bu özel sayfanın public adresini açmak için önce yayınlayın.")}><ExternalLink className="me-1 h-4 w-4" />{copy("Not public", "Public değil")}</Button>}
  </div>;

  return (
      <div className="mx-auto w-full min-w-0 max-w-[1680px] space-y-5 overflow-x-clip">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{copy("Pages", "Sayfalar")}</h1>
              <p className="text-sm text-muted-foreground">{copy("Manage your website pages and their content.", "Web sitesi sayfalarını ve içeriklerini yönetin.")}</p>
            </div>
          </div>
          {area === "managed" && <Button onClick={() => requestLeave(() => { createMutation.reset(); setCreateOpen(true); })}><Plus className="w-4 h-4 me-2" />{copy("New page", "Yeni sayfa")}</Button>}
        </div>

        <Dialog open={createOpen} onOpenChange={open => { if (!createMutation.isPending) setCreateOpen(open); }}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{copy("Create page draft", "Sayfa taslağı oluştur")}</DialogTitle>
              <DialogDescription>{copy("Start blank or use a live catalogue layout. No catalogue facts are copied. Nothing is published automatically.", "Boş bir sayfayla veya güncel katalog düzeniyle başlayın. Katalog bilgileri kopyalanmaz. Hiçbir içerik otomatik yayınlanmaz.")}</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!createMutation.isPending) createMutation.mutate(); }}>
              <div className="space-y-2"><Label htmlFor="new-page-title">{copy("Title", "Başlık")}</Label><Input id="new-page-title" required maxLength={200} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="new-page-slug">{copy("Page address", "Sayfa adresi")}</Label><Input id="new-page-slug" required maxLength={150} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="study-in-turkiye" value={draft.slug} onChange={event => setDraft({ ...draft, slug: event.target.value })} aria-describedby="new-page-url" /><p id="new-page-url" className="text-xs text-muted-foreground"><span dir="ltr">/{draft.locale}/{draft.slug || "your-page"}</span> — {copy("existing system addresses cannot be replaced.", "mevcut sistem adresleri değiştirilemez.")}</p></div>
              <div className="space-y-2"><Label htmlFor="new-page-locale">{copy("Source language", "Kaynak dil")}</Label><Select value={draft.locale} onValueChange={locale => setDraft({ ...draft, locale })}><SelectTrigger id="new-page-locale"><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_LANGUAGES.map(locale => <SelectItem key={locale} value={locale}>{LANGUAGE_META[locale].nativeName}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="new-page-starter">{copy("Starting layout", "Başlangıç düzeni")}</Label><Select value={draft.starter} onValueChange={starter => setDraft({ ...draft, starter })}><SelectTrigger id="new-page-starter"><SelectValue /></SelectTrigger><SelectContent>{[["blank", copy("Blank page", "Boş sayfa")], ["programs", copy("Live programs", "Güncel programlar")], ["universities", copy("Live universities", "Güncel üniversiteler")], ["destinations", copy("Live destinations", "Güncel destinasyonlar")], ["cities", copy("Live cities", "Güncel şehirler")]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              {draft.starter !== "blank" && <>
                <div className="space-y-2"><Label htmlFor="new-page-country">{copy("Country filter (optional)", "Ülke filtresi (isteğe bağlı)")}</Label><Input id="new-page-country" maxLength={120} value={draft.country} onChange={event => setDraft({ ...draft, country: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="new-page-city">{copy("City filter (optional)", "Şehir filtresi (isteğe bağlı)")}</Label><Input id="new-page-city" maxLength={120} value={draft.city} onChange={event => setDraft({ ...draft, city: event.target.value })} /></div>
              </>}
              {createMutation.isError && <p role="alert" className="text-sm text-destructive">{copy("Could not create the draft. Check the address is unique and not reserved, then retry. Your entries are preserved.", "Taslak oluşturulamadı. Adresin başka bir sayfada kullanılmadığını veya ayrılmış bir sistem adresi olmadığını kontrol edip yeniden deneyin. Girdileriniz korunuyor.")}</p>}
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={createMutation.isPending} onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button><Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? copy("Creating…", "Oluşturuluyor…") : copy("Create draft", "Taslak oluştur")}</Button></div>
            </form>
          </DialogContent>
        </Dialog>

        <nav className="grid gap-2 rounded-xl border bg-card p-2 sm:grid-cols-2 xl:grid-cols-4" aria-label={copy("Pages workspace", "Sayfalar çalışma alanı")}>
          {(["dynamic", "managed", "blog", "templates"] as const).map(value => <Button key={value} variant={area === value ? "default" : "ghost"} aria-current={area === value ? "page" : undefined} onClick={() => requestLeave(() => setArea(value))}>
            {value === "dynamic" ? copy("Dynamic pages", "Dinamik sayfalar") : value === "managed" ? copy("Managed pages", "Yönetilen sayfalar") : value === "blog" ? copy("Blog content", "Blog içerikleri") : copy("Templates & review", "Şablonlar ve inceleme")}
          </Button>)}
        </nav>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button type="button" onClick={() => setArea("dynamic")} className="rounded-xl border bg-card p-4 text-start hover:border-primary"><span className="text-sm text-muted-foreground">{copy("Catalogue-driven", "Katalog kaynaklı")}</span><strong className="mt-1 block text-2xl">4</strong><span className="text-xs text-muted-foreground">{copy("page types", "sayfa türü")}</span></button>
          <button type="button" onClick={() => { setArea("managed"); setStatusFilter("in_review"); }} className="rounded-xl border bg-card p-4 text-start hover:border-primary"><span className="text-sm text-muted-foreground">{copy("Managed pages", "Yönetilen sayfalar")}</span><strong className="mt-1 block text-2xl">{cmsPages.length}</strong><span className="text-xs text-muted-foreground">{pages.filter(value => value.status === "in_review").length} {copy("awaiting review — open queue", "inceleme bekliyor — kuyruğu aç")}</span></button>
          <button type="button" onClick={() => setArea("blog")} className="rounded-xl border bg-card p-4 text-start hover:border-primary"><span className="text-sm text-muted-foreground">{copy("Blog workspace", "Blog çalışma alanı")}</span><strong className="mt-1 block text-2xl">CMS</strong><span className="text-xs text-muted-foreground">{copy("articles, translations and SEO", "yazılar, çeviriler ve SEO")}</span></button>
          <button type="button" onClick={() => setArea("templates")} className="rounded-xl border bg-card p-4 text-start hover:border-primary"><span className="text-sm text-muted-foreground">{copy("Shared templates", "Ortak şablonlar")}</span><strong className="mt-1 block text-2xl">4</strong><span className="text-xs text-muted-foreground">{copy("governed detail layouts", "kontrollü detay düzeni")}</span></button>
        </div>

        {area === "dynamic" && <CatalogPagesInventory />}
        {area === "blog" && (
          <Suspense fallback={<div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground" role="status">{copy("Loading blog workspace…", "Blog çalışma alanı yükleniyor…")}</div>}>
            <WebsiteBlog embedded />
          </Suspense>
        )}
        {area === "templates" && <DetailTemplates ref={templates} />}
        {area === "managed" && <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{copy("CMS pages", "CMS sayfaları")}</h2>
            <p className="text-sm text-muted-foreground">{copy("Find, review and export manually managed pages.", "Elle yönetilen sayfaları bulun, inceleyin ve dışa aktarın.")}</p>
          </div>
          <Button variant="outline" onClick={exportCmsCsv} disabled={filtered.length === 0}>
            <Download className="w-4 h-4 me-2" />
            {selectedCmsPages.length > 0 ? copy(`Export selected (${selectedCmsPages.length})`, `Seçilenleri aktar (${selectedCmsPages.length})`) : copy("Export results", "Sonuçları aktar")}
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              aria-label={copy("Search pages", "Sayfa ara")}
              placeholder={copy("Search pages...", "Sayfa ara...")}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="ps-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[160px]" aria-label={copy("Filter status", "Duruma göre filtrele")}>
              <SelectValue placeholder={copy("Filter status", "Duruma göre filtrele")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy("All Statuses", "Tüm durumlar")}</SelectItem>
              <SelectItem value="published">{copy("Published", "Yayında")}</SelectItem>
              <SelectItem value="draft">{copy("Draft", "Taslak")}</SelectItem>
              <SelectItem value="in_review">{copy("Awaiting review", "İnceleme bekliyor")}</SelectItem>
              <SelectItem value="archived">{copy("Archived", "Arşivlendi")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={localeFilter} onValueChange={setLocaleFilter}>
            <SelectTrigger aria-label={copy("Filter language", "Dile göre filtrele")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy("All languages", "Tüm diller")}</SelectItem>
              {SUPPORTED_LANGUAGES.map(locale => <SelectItem key={locale} value={locale}>{LANGUAGE_META[locale].nativeName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={templateFilter} onValueChange={setTemplateFilter}>
            <SelectTrigger aria-label={copy("Filter template", "Şablona göre filtrele")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy("All templates", "Tüm şablonlar")}</SelectItem>
              {cmsTemplates.map(template => <SelectItem key={template} value={template}>{templateLabel(template)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={cmsSort} onValueChange={setCmsSort}>
            <SelectTrigger aria-label={copy("Sort pages", "Sayfaları sırala")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="updated_desc">{copy("Recently updated", "Son güncellenen")}</SelectItem>
              <SelectItem value="updated_asc">{copy("Oldest update", "En eski güncelleme")}</SelectItem>
              <SelectItem value="title_asc">{copy("Title A–Z", "Başlık A–Z")}</SelectItem>
              <SelectItem value="title_desc">{copy("Title Z–A", "Başlık Z–A")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select onValueChange={applySavedView}>
            <SelectTrigger className="w-full sm:w-[240px]" aria-label={copy("Open saved view", "Kayıtlı görünümü aç")}><SelectValue placeholder={copy("Saved views", "Kayıtlı görünümler")} /></SelectTrigger>
            <SelectContent>{savedViews.length === 0 ? <SelectItem value="none" disabled>{copy("No saved views", "Kayıtlı görünüm yok")}</SelectItem> : savedViews.map(view => <SelectItem key={view.id} value={view.id}>{view.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" variant="outline" onClick={() => setSaveViewOpen(true)}><Bookmark className="me-2 h-4 w-4" />{copy("Save current view", "Mevcut görünümü kaydet")}</Button>
          {savedViews.length > 0 && <span className="text-xs text-muted-foreground">{copy("Saved on this device", "Bu cihazda saklanır")}</span>}
        </div>

        <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{copy("Save filtered view", "Filtreli görünümü kaydet")}</DialogTitle><DialogDescription>{copy("Stores the current search, filters and sorting on this device. It does not change any page.", "Mevcut arama, filtre ve sıralamayı bu cihazda saklar. Hiçbir sayfayı değiştirmez.")}</DialogDescription></DialogHeader>
            <div className="space-y-2"><Label htmlFor="saved-view-name">{copy("View name", "Görünüm adı")}</Label><Input id="saved-view-name" maxLength={60} value={viewName} onChange={event => setViewName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") saveCurrentView(); }} /></div>
            {savedViews.length > 0 && <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-2">{savedViews.map(view => <div key={view.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{view.name}</span><Button type="button" size="icon" variant="ghost" aria-label={copy(`Delete ${view.name}`, `${view.name} görünümünü sil`)} onClick={() => persistSavedViews(savedViews.filter(item => item.id !== view.id))}><Trash2 className="h-4 w-4" /></Button></div>)}</div>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSaveViewOpen(false)}>{t("common.cancel")}</Button><Button disabled={!viewName.trim()} onClick={saveCurrentView}>{copy("Save view", "Görünümü kaydet")}</Button></div>
          </DialogContent>
        </Dialog>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
          <span><strong>{cmsPages.length}</strong> {copy("CMS pages", "CMS sayfası")}</span>
          <span className="text-muted-foreground">·</span>
          <span><strong>{filtered.length}</strong> {copy("matching", "eşleşen")}</span>
          {selectedCmsPages.length > 0 && <><span className="text-muted-foreground">·</span><span><strong>{selectedCmsPages.length}</strong> {copy("selected", "seçili")}</span></>}
          <div className="ms-auto flex items-center gap-1 rounded-md border bg-card p-1" role="group" aria-label={copy("Managed pages view", "Yönetilen sayfalar görünümü")}><Button type="button" size="sm" variant={cmsView === "list" ? "default" : "ghost"} aria-pressed={cmsView === "list"} onClick={() => setCmsView("list")}><List className="me-1 h-4 w-4" />{copy("List", "Liste")}</Button><Button type="button" size="sm" variant={cmsView === "table" ? "default" : "ghost"} aria-pressed={cmsView === "table"} onClick={() => setCmsView("table")}><Table2 className="me-1 h-4 w-4" />{copy("Table", "Tablo")}</Button></div>
          {(searchTerm || statusFilter !== "all" || localeFilter !== "all" || templateFilter !== "all") && <Button size="sm" variant="ghost" onClick={clearCmsFilters}><X className="w-4 h-4 me-1" />{copy("Clear filters", "Filtreleri temizle")}</Button>}
        </div>

        {isError ? <div role="alert" className="rounded-lg border p-6">{copy("Pages could not be loaded.", "Sayfalar yüklenemedi.")} <Button variant="outline" onClick={() => refetch()}>{t("common.retry")}</Button></div> : isLoading ? (
          <div className="flex items-center justify-center py-20" role="status" aria-label={t("common.loading")}>
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Globe className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{copy("No pages found.", "Sayfa bulunamadı.")}</p>
          </div>
        ) : cmsView === "list" ? (
          <div className="space-y-2" aria-label={copy("CMS pages list", "CMS sayfaları listesi")}>
            {pagedCmsPages.map(page => {
              const badge = STATUS_BADGE[page.status] || STATUS_BADGE.draft;
              const icon = TEMPLATE_ICONS[page.template] || "📄";
              return <article key={page.id} className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm transition-colors hover:border-primary/40 sm:flex-row sm:items-center">
                <input type="checkbox" className="h-4 w-4 shrink-0" aria-label={copy(`Select ${page.title}`, `${page.title} sayfasını seç`)} checked={selectedCmsPages.includes(page.id)} onChange={event => setSelectedCmsPages(event.target.checked ? [...selectedCmsPages, page.id] : selectedCmsPages.filter(id => id !== page.id))} />
                <div aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">{icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{page.title}</h3><Badge variant={badge.variant} className="text-xs">{page.status === "published" ? <Eye className="me-1 h-3 w-3" /> : <EyeOff className="me-1 h-3 w-3" />}{copy(...badge.label)}</Badge></div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground"><span dir="ltr">{managedPagePublicPath(page)}</span><span aria-hidden>·</span><span>{copy("Template", "Şablon")}: {templateLabel(page.template)}</span>{isSystemManagedPage(page) && <><span aria-hidden>·</span><span>{copy("Live system route", "Canlı sistem rotası")}</span></>}{page.publishedAt && <><span aria-hidden>·</span><span>{copy("Published", "Yayın tarihi")}: {new Date(page.publishedAt).toLocaleDateString(lang)}</span></>}</div>
                </div>
                <CmsActions page={page} />
              </article>;
            })}
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-lg border" tabIndex={0} aria-label={copy("Scrollable managed pages table", "Kaydırılabilir yönetilen sayfalar tablosu")}>
            <table className="w-full min-w-[720px] text-sm 2xl:min-w-[900px]">
              <thead className="bg-muted/50 text-start">
                <tr>
                  <th className="w-12 p-3"><input type="checkbox" aria-label={copy("Select all pages on this result page", "Bu sonuç sayfasındaki tüm sayfaları seç")} checked={allFilteredSelected} onChange={event => setSelectedCmsPages(event.target.checked ? Array.from(new Set([...selectedCmsPages, ...pagedCmsPages.map(page => page.id)])) : selectedCmsPages.filter(id => !pagedCmsPages.some(page => page.id === id)))} /></th>
                  <th className="sticky start-0 z-20 min-w-[230px] border-e bg-muted p-3 text-start shadow-sm 2xl:min-w-[250px]">{copy("Actions", "İşlemler")}</th>
                  <th className="p-3 text-start">{copy("Page", "Sayfa")}</th>
                  <th className="p-3 text-start">{copy("Status", "Durum")}</th>
                  <th className="p-3 text-start">{copy("Language", "Dil")}</th>
                  <th className="hidden p-3 text-start xl:table-cell">{copy("Template", "Şablon")}</th>
                  <th className="hidden p-3 text-start 2xl:table-cell">{copy("Updated", "Güncellendi")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pagedCmsPages.map(page => {
                  const badge = STATUS_BADGE[page.status] || STATUS_BADGE.draft;
                  const icon = TEMPLATE_ICONS[page.template] || "📄";
                  return <tr key={page.id} className="hover:bg-muted/20">
                    <td className="p-3"><input type="checkbox" aria-label={copy(`Select ${page.title}`, `${page.title} sayfasını seç`)} checked={selectedCmsPages.includes(page.id)} onChange={event => setSelectedCmsPages(event.target.checked ? [...selectedCmsPages, page.id] : selectedCmsPages.filter(id => id !== page.id))} /></td>
                    <td className="sticky start-0 z-10 min-w-[230px] border-e bg-card p-3 shadow-sm 2xl:min-w-[250px]"><CmsActions page={page} /></td>
                    <td className="p-3"><div className="flex items-start gap-3"><span aria-hidden className="text-lg">{icon}</span><div><div className="font-medium">{page.title}</div><div className="max-w-[340px] break-all text-xs text-muted-foreground" dir="ltr">{managedPagePublicPath(page)}</div>{isSystemManagedPage(page) && <div className="text-xs text-muted-foreground">{copy("Live system route", "Canlı sistem rotası")}</div>}</div></div></td>
                    <td className="p-3"><Badge variant={badge.variant} className="text-xs">{page.status === "published" ? <Eye className="w-3 h-3 me-1" /> : <EyeOff className="w-3 h-3 me-1" />}{copy(...badge.label)}</Badge></td>
                    <td className="p-3">{LANGUAGE_META[page.locale as keyof typeof LANGUAGE_META]?.nativeName || page.locale || "—"}</td>
                    <td className="hidden p-3 xl:table-cell">{templateLabel(page.template)}</td>
                    <td className="hidden whitespace-nowrap p-3 2xl:table-cell">{new Date(page.updatedAt).toLocaleDateString(lang)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm"><Label htmlFor="cms-page-size">{copy("Per page", "Sayfa başına")}</Label><Select value={String(cmsPageSize)} onValueChange={value => setCmsPageSize(Number(value))}><SelectTrigger id="cms-page-size" className="h-9 w-24"><SelectValue /></SelectTrigger><SelectContent>{[25, 50, 100].map(value => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={cmsPage <= 1} onClick={() => setCmsPage(value => value - 1)}>{copy("Previous", "Önceki")}</Button><span className="min-w-24 text-center text-sm" aria-live="polite">{cmsPage} / {cmsTotalPages}</span><Button variant="outline" size="sm" disabled={cmsPage >= cmsTotalPages} onClick={() => setCmsPage(value => value + 1)}>{copy("Next", "Sonraki")}</Button></div>
        </div>}
        </>}
      </div>
  );
}
