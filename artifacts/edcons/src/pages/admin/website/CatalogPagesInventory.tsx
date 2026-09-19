import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ExternalLink, Search, RefreshCw, ChevronLeft, ChevronRight, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGE_META, SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { useI18n } from "@/hooks/use-i18n";

type Kind = "country" | "city" | "university" | "program";
type Item = {
  kind: Kind; sourceId: number; title: string; sourceTitle: string; canonicalPath: string | null; sourceEditPath: string; locale: string;
  sourceUpdatedAt: string; visible: boolean; admissionsOpen: boolean | null; contentDelivery: string; issues: string[];
  publication: { status: string; revisionNumber: number | null; qualityStatus: string | null; translationStatus: string | null }; seo: string;
};
type Inventory = { items: Item[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; publicationEvaluated: boolean };

const labels: Record<string, [string, string]> = {
  country: ["Countries", "Ülkeler"], city: ["Cities", "Şehirler"], university: ["Universities", "Üniversiteler"], program: ["Programs", "Programlar"],
  SOURCE_INACTIVE: ["Source inactive", "Kaynak pasif"], PARENT_INACTIVE: ["Parent inactive", "Üst kayıt pasif"], CATALOG_POLICY_HIDDEN: ["Hidden by catalogue policy", "Katalog kuralıyla gizli"],
  COUNTRY_ROUTE_UNAVAILABLE: ["No public country route / eligible institutions", "Ülke rotası / uygun kurum yok"], DESCRIPTION_MISSING: ["Description missing", "Açıklama eksik"], MEDIA_MISSING: ["Source media missing", "Kaynak medya eksik"], TRANSLATION_FALLBACK: ["Source-language fallback", "Kaynak dil gösteriliyor"],
  SOURCE_CATALOG: ["Catalogue source", "Katalog kaynağı"], SOURCE_FALLBACK: ["Source-language fallback", "Kaynak dil gösteriliyor"], PUBLISHED_TRANSLATION: ["Published programme translation", "Yayınlanmış program çevirisi"], PUBLISHED_REVISION: ["Published content revision", "Yayınlanmış içerik sürümü"],
  NOT_EVALUATED: ["Not evaluated · publication rollout off", "Değerlendirilmedi · yayın sistemi kapalı"], NO_CONTENT_RECORD: ["No governed content record", "Yönetilen içerik kaydı yok"], NO_PUBLICATION_STATE: ["No publication state", "Yayın durumu yok"],
  PUBLISHED: ["Published", "Yayında"], DRAFT: ["Draft", "Taslak"], INDEX_ELIGIBLE: ["Index eligible", "İndekslemeye uygun"], NOINDEX: ["Not index eligible", "İndekslemeye uygun değil"],
  PENDING_REVIEW: ["Awaiting review", "İnceleme bekliyor"], APPROVED: ["Approved", "Onaylandı"], STALE: ["Needs a new review", "Yeniden inceleme gerekiyor"], RETIRED: ["Retired", "Yayından kaldırıldı"],
  AMBIGUOUS_CONTENT_LINK: ["Multiple destination records · review required", "Birden çok destinasyon kaydı · inceleme gerekli"],
};

export default function CatalogPagesInventory() {
  const { lang, t } = useI18n();
  const tr = lang === "tr";
  const sharedLabels: Record<string, string> = { country: "adminCatalog.tabCountries", city: "adminCatalog.tabCities", university: "adminCatalog.tabUniversities", program: "adminCatalog.tabPrograms", APPROVED: "common.approved" };
  const label = (key: string) => sharedLabels[key] ? t(sharedLabels[key]) : labels[key]?.[tr ? 1 : 0] ?? t("common.unknown");
  const [kind, setKind] = useState<Kind>("program");
  const [locale, setLocale] = useState<string>(lang);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const query = useQuery<Inventory>({
    queryKey: ["website-catalog-pages", kind, locale, debounced, page],
    queryFn: ({ signal }) => customFetch(`/api/website/catalog-pages?${new URLSearchParams({ kind, locale, q: debounced, page: String(page), pageSize: "12" })}`, { signal }),
    staleTime: 0,
  });
  const pagination = query.data?.pagination;
  return <section aria-labelledby="catalog-pages-title" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="catalog-pages-title" className="flex items-center gap-2 text-xl font-semibold"><Database className="h-5 w-5 text-primary" />{tr ? "Dinamik katalog sayfaları" : "Dynamic catalogue pages"}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{tr ? "Mevcut katalogdan üretilen sayfalar. Kaynak kaydı düzenleyin veya canlı görünümü açın; burada kopya sayfa oluşturulmaz ve içerik yayınlanmaz." : "Pages rendered from existing catalogue records. Edit the source or open the public view; this inventory creates no duplicate pages and publishes no content."}</p></div>
      <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className="me-2 h-4 w-4" />{tr ? "Yenile" : "Refresh"}</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
      <div className="space-y-1"><Label htmlFor="catalog-page-kind">{tr ? "Sayfa türü" : "Page type"}</Label><Select value={kind} onValueChange={value => { setKind(value as Kind); setPage(1); }}><SelectTrigger id="catalog-page-kind"><SelectValue /></SelectTrigger><SelectContent>{(["country", "city", "university", "program"] as const).map(value => <SelectItem value={value} key={value}>{label(value)}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="catalog-page-locale">{tr ? "Görüntüleme dili" : "Display language"}</Label><Select value={locale} onValueChange={value => { setLocale(value); setPage(1); }}><SelectTrigger id="catalog-page-locale"><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_LANGUAGES.map(value => <SelectItem key={value} value={value}>{LANGUAGE_META[value].name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="catalog-page-search">{tr ? "Kaynak adı veya ID" : "Source title or ID"}</Label><div className="relative"><Search className="absolute start-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="catalog-page-search" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} className="ps-9" /></div></div>
    </div>
    {query.isError ? <div role="alert" className="rounded-lg border border-destructive/30 p-4"><p>{tr ? "Envanter yüklenemedi. Mevcut kayıtlar değiştirilmedi." : "Inventory could not load. Existing records were not changed."}</p><Button variant="outline" className="mt-3" onClick={() => void query.refetch()}>{t("common.retry")}</Button></div>
      : query.isLoading ? <p role="status" className="py-8 text-center text-muted-foreground">{t("common.loading")}</p>
        : <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p aria-live="polite">{pagination?.total ?? 0} {tr ? "kaynak kayıt" : "source records"}</p><p className="text-muted-foreground">{tr ? "Görünürlük ≠ başvuru açıklığı ≠ yayın/indeks onayı" : "Visibility ≠ open admissions ≠ publication/index approval"}</p></div>
          {query.data && !query.data.publicationEvaluated && <p className="rounded-lg bg-muted p-3 text-sm">{tr ? "Yayın kapsamı etkin değil; yayın ve SEO durumları değerlendirilmedi. Katalog görünürlüğü ayrı olarak gösterilir." : "Publication scope is not enabled; publication and SEO states have not been evaluated. Catalogue visibility is shown separately."}</p>}
          {!query.data?.items.length && <p className="py-8 text-center text-muted-foreground">{tr ? "Bu filtreyle eşleşen kaynak kayıt yok." : "No source records match these filters."}</p>}
          <div className="space-y-3">{query.data?.items.map(item => <article key={`${item.kind}-${item.sourceId}`} className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{item.title}</h3><p className="text-xs text-muted-foreground">{label(item.kind)} · #{item.sourceId} · {item.locale.toUpperCase()} · {label(item.contentDelivery)}</p>{item.title !== item.sourceTitle && <p className="mt-1 break-words text-xs text-muted-foreground">{tr ? "Kaynak" : "Source"}: {item.sourceTitle}</p>}</div><Badge variant={item.visible ? "secondary" : "outline"}>{item.visible ? (tr ? "Katalogda görünür" : "Catalogue visible") : (tr ? "Gizli / rota yok" : "Hidden / no route")}</Badge></div>
            <p className="break-all font-mono text-xs text-muted-foreground" dir="ltr">{item.canonicalPath ?? (tr ? "Halka açık adres yok" : "No public address")}</p>
            <dl className="grid gap-2 text-xs sm:grid-cols-3"><div><dt className="text-muted-foreground">{tr ? "İçerik yayını" : "Content publication"}</dt><dd className="mt-1 font-medium">{label(item.publication.status)}{item.publication.revisionNumber !== null ? ` · v${item.publication.revisionNumber}` : ""}</dd></div><div><dt className="text-muted-foreground">SEO</dt><dd className="mt-1 font-medium">{label(item.seo)}</dd></div><div><dt className="text-muted-foreground">{tr ? "Yeni başvuru" : "New applications"}</dt><dd className="mt-1 font-medium">{item.admissionsOpen === null ? "—" : item.admissionsOpen ? (tr ? "Açık" : "Open") : (tr ? "Kapalı" : "Closed")}</dd></div></dl>
            {!!item.issues.length && <div className="flex flex-wrap gap-1.5">{item.issues.map(issue => <Badge key={issue} variant="outline" className="font-normal">{label(issue)}</Badge>)}</div>}
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{tr ? "Kaynak güncellemesi" : "Source updated"}: {new Date(item.sourceUpdatedAt).toLocaleString(locale)}</p><div className="flex gap-2"><Button asChild variant="outline" size="sm"><a href={item.sourceEditPath}>{tr ? "Kaynağı düzenle" : "Edit source"}</a></Button>{item.visible && item.canonicalPath ? <Button asChild variant="outline" size="sm"><a href={item.canonicalPath} target="_blank" rel="noopener noreferrer"><ExternalLink className="me-1.5 h-4 w-4" />{tr ? "Önizle" : "Preview"}</a></Button> : <Button size="sm" variant="outline" disabled>{tr ? "Önizleme yok" : "Preview unavailable"}</Button>}</div></div>
          </article>)}</div>
          <div className="flex items-center justify-between gap-2 border-t pt-4"><Button variant="outline" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}><ChevronLeft className="me-1 h-4 w-4" />{t("common.previous")}</Button><p className="text-sm">{page} / {Math.max(1, pagination?.totalPages ?? 1)}</p><Button variant="outline" size="sm" disabled={page >= (pagination?.totalPages ?? 0) || query.isFetching} onClick={() => setPage(value => value + 1)}>{t("common.next")}<ChevronRight className="ms-1 h-4 w-4" /></Button></div>
        </>}
  </section>;
}
