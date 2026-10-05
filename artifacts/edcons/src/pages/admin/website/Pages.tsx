import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Edit, Search, Globe, Eye, EyeOff, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SUPPORTED_LANGUAGES, LANGUAGE_META } from "@/lib/i18n";
import { useRef, useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { useLocation } from "wouter";
import DetailTemplates, { type DetailTemplatesHandle } from "./DetailTemplates";
import CatalogPagesInventory from "./CatalogPagesInventory";

interface WebsitePage {
  id: number;
  title: string;
  slug: string;
  status: string;
  template: string;
  publishedAt: string | null;
  updatedAt: string;
  sortOrder: number;
}

const STATUS_BADGE: Record<string, { label: [string, string]; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  published: { label: ["Published", "Yayında"], variant: "default" },
  draft: { label: ["Draft", "Taslak"], variant: "secondary" },
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
  const [createOpen, setCreateOpen] = useState(false);
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
    if (p.template?.startsWith("detail:")) return false;
    if (searchTerm && !p.title.toLowerCase().includes(searchTerm.toLowerCase()) && !p.slug.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  return (
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{copy("Pages", "Sayfalar")}</h1>
              <p className="text-sm text-muted-foreground">{copy("Manage your website pages and their content.", "Web sitesi sayfalarını ve içeriklerini yönetin.")}</p>
            </div>
          </div>
          <Button onClick={() => requestLeave(() => { createMutation.reset(); setCreateOpen(true); })}><Plus className="w-4 h-4 me-2" />{copy("New page", "Yeni sayfa")}</Button>
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

        <CatalogPagesInventory />
        <DetailTemplates ref={templates} />
        <h2 className="text-xl font-semibold">{copy("CMS pages", "CMS sayfaları")}</h2>
        <div className="flex flex-col sm:flex-row gap-3">
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
              <SelectItem value="archived">{copy("Archived", "Arşivlendi")}</SelectItem>
            </SelectContent>
          </Select>
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
        ) : (
          <div className="space-y-3">
            {filtered.map(page => {
              const badge = STATUS_BADGE[page.status] || STATUS_BADGE.draft;
              const icon = TEMPLATE_ICONS[page.template] || "📄";
              return (
                <Card key={page.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-4 flex flex-wrap items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-xl shrink-0">
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words font-semibold text-foreground">{page.title}</h3>
                        <Badge variant={badge.variant} className="text-xs">
                          {page.status === "published" ? <Eye className="w-3 h-3 me-1" /> : <EyeOff className="w-3 h-3 me-1" />}
                          {copy(...badge.label)}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span className="break-all" dir="ltr">/{page.slug}</span>
                        <span>·</span>
                        <span>{copy("Template", "Şablon")}: {templateLabel(page.template)}</span>
                        {page.publishedAt && (
                          <>
                            <span>·</span>
                            <span>{copy("Published", "Yayın tarihi")}: {new Date(page.publishedAt).toLocaleDateString(lang)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => requestLeave(() => setLocation(`/admin/website/pages/${page.id}/edit`))}
                    >
                      <Edit className="w-4 h-4 me-1" />{t("common.edit")}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
  );
}
