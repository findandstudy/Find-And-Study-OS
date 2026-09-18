import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  Globe2,
  History,
  Languages,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/hooks/use-i18n";

type QueueItem = {
  id: number;
  title: string;
  slug: string;
  locale: string;
  status: string;
  robotsIndex: boolean;
  seoScore: number;
  translationCoveragePercent: number;
  translatedLocaleCount: number;
  totalLocaleCount: number;
  blockers: string[];
  priority: "CRITICAL" | "HIGH" | "NORMAL";
  updatedAt: string;
};

type PublicationCenterResponse = {
  schemaVersion: 1;
  generatedAt: string;
  foundation: {
    state: "DEFAULT_UNWIRED";
    mutationsEnabled: false;
    indexAutomationEnabled: false;
  };
  summary: {
    totalPages: number;
    publishedPages: number;
    draftPages: number;
    indexablePublishedPages: number;
    seoReadyPages: number;
    translationCompletePages: number;
    criticalPages: number;
    totalBlogPosts: number;
    publishedBlogPosts: number;
    blogSeoReady: number;
    recentVersionCount: number;
  };
  localeCoverage: Array<{ locale: string; pages: number; coveragePercent: number }>;
  queue: QueueItem[];
  recentVersions: Array<{
    id: number;
    pageId: number;
    versionNumber: number;
    publishedAt: string | null;
    createdAt: string;
  }>;
};

const BLOCKER_LABELS: Record<string, { en: string; tr: string }> = {
  META_TITLE_INVALID: { en: "Meta title", tr: "Meta başlık" },
  META_DESCRIPTION_INVALID: { en: "Meta description", tr: "Meta açıklama" },
  CANONICAL_INVALID: { en: "Canonical URL", tr: "Canonical URL" },
  SOCIAL_IMAGE_MISSING: { en: "Social image", tr: "Sosyal görsel" },
  TRANSLATIONS_INCOMPLETE: { en: "Translations", tr: "Çeviriler" },
  NOT_PUBLISHED: { en: "Not published", tr: "Yayında değil" },
  NOINDEX: { en: "Noindex", tr: "Noindex" },
  PUBLISH_RECEIPT_MISSING: { en: "Publish evidence", tr: "Yayın kanıtı" },
};

function formatDate(value: string, tr: boolean) {
  return new Intl.DateTimeFormat(tr ? "tr-TR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function WebsitePublishHistory() {
  const { lang } = useI18n();
  const tr = lang === "tr";
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const query = useQuery<PublicationCenterResponse>({
    queryKey: ["website-publication-center"],
    queryFn: () => customFetch("/api/website/publication-center"),
  });

  const visibleQueue = useMemo(() => {
    const term = search.trim().toLocaleLowerCase(tr ? "tr" : "en");
    return (query.data?.queue ?? []).filter((item) => {
      if (filter === "critical" && item.priority !== "CRITICAL") return false;
      if (filter === "published" && item.status !== "published") return false;
      if (filter === "draft" && item.status !== "draft") return false;
      return !term || `${item.title} ${item.slug} ${item.locale}`.toLocaleLowerCase(tr ? "tr" : "en").includes(term);
    });
  }, [filter, query.data?.queue, search, tr]);

  const summary = query.data?.summary;
  const cards = [
    { label: tr ? "Toplam sayfa" : "Total pages", value: summary?.totalPages, icon: FileText, tone: "text-blue-600 bg-blue-50" },
    { label: tr ? "Yayındaki sayfa" : "Published pages", value: summary?.publishedPages, icon: FileCheck2, tone: "text-emerald-600 bg-emerald-50" },
    { label: tr ? "İndekslenebilir" : "Index eligible", value: summary?.indexablePublishedPages, icon: Globe2, tone: "text-cyan-600 bg-cyan-50" },
    { label: tr ? "SEO hazır" : "SEO ready", value: summary?.seoReadyPages, icon: CheckCircle2, tone: "text-violet-600 bg-violet-50" },
    { label: tr ? "Çevirisi tamam" : "Translation complete", value: summary?.translationCompletePages, icon: Languages, tone: "text-indigo-600 bg-indigo-50" },
    { label: tr ? "Kritik kontrol" : "Critical review", value: summary?.criticalPages, icon: AlertTriangle, tone: "text-amber-600 bg-amber-50" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <History className="h-6 w-6 text-primary" />
              {tr ? "Yayın ve İçerik Merkezi" : "Publication & Content Center"}
            </h1>
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
              {tr ? "Kontrollü pilot kapalı" : "Governed pilot off"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr
              ? "Sayfa, SEO, indeks, çeviri ve yayın kanıtlarını tek çalışma kuyruğunda izleyin."
              : "Monitor page, SEO, index, translation and publication evidence in one work queue."}
          </p>
        </div>
        <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          {tr ? "Yenile" : "Refresh"}
        </Button>
      </div>

      <Card className="border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/20">
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <div className="text-sm">
            <p className="font-semibold text-blue-950 dark:text-blue-100">
              {tr ? "Salt-okunur geçiş görünümü" : "Read-only transition view"}
            </p>
            <p className="mt-1 text-blue-800 dark:text-blue-200">
              {tr
                ? "Mevcut CMS verisi burada denetlenir. Yeni maker-checker yayın komutları, active-context ve ayrı executor rollout'u açılmadan bu ekran değişiklik yapmaz."
                : "Current CMS data is inspected here. This screen makes no changes until the new maker-checker commands, active context and dedicated executor rollout are enabled."}
            </p>
          </div>
        </CardContent>
      </Card>

      {query.isError ? (
        <Card className="border-red-200">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="h-8 w-8 text-red-500" />
            <div>
              <p className="font-semibold">{tr ? "Yayın görünümü yüklenemedi" : "Publication view could not load"}</p>
              <p className="text-sm text-muted-foreground">{tr ? "Veri değiştirilmedi. Yeniden deneyebilirsiniz." : "No data was changed. You can retry safely."}</p>
            </div>
            <Button variant="outline" onClick={() => void query.refetch()}>{tr ? "Tekrar dene" : "Try again"}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {cards.map(({ label, value, icon: Icon, tone }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-bold">{query.isLoading ? "—" : value ?? 0}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Card>
              <CardHeader className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">{tr ? "İçerik kontrol kuyruğu" : "Content review queue"}</CardTitle>
                  <Badge variant="secondary">{visibleQueue.length}</Badge>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr ? "Sayfa veya slug ara" : "Search page or slug"} />
                  </div>
                  <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tr ? "Tümü" : "All"}</SelectItem>
                      <SelectItem value="critical">{tr ? "Kritik" : "Critical"}</SelectItem>
                      <SelectItem value="published">{tr ? "Yayında" : "Published"}</SelectItem>
                      <SelectItem value="draft">{tr ? "Taslak" : "Draft"}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {visibleQueue.map((item) => (
                  <div key={item.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <a href={`/admin/website/pages/${item.id}/edit`} className="truncate font-semibold hover:text-primary hover:underline">{item.title}</a>
                          <Badge variant={item.priority === "CRITICAL" ? "destructive" : item.priority === "HIGH" ? "default" : "secondary"}>{item.priority}</Badge>
                          <Badge variant="outline">{item.locale.toUpperCase()}</Badge>
                          <Badge variant="outline">{item.status}</Badge>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">/{item.slug} · {formatDate(item.updatedAt, tr)}</p>
                      </div>
                      <div className="grid min-w-52 grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="mb-1 flex justify-between"><span>SEO</span><b>{item.seoScore}%</b></div>
                          <Progress value={item.seoScore} />
                        </div>
                        <div>
                          <div className="mb-1 flex justify-between"><span>{tr ? "Dil" : "Locales"}</span><b>{item.translatedLocaleCount}/{item.totalLocaleCount}</b></div>
                          <Progress value={item.translationCoveragePercent} />
                        </div>
                      </div>
                    </div>
                    {item.blockers.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.blockers.map((blocker) => <Badge key={blocker} variant="outline" className="text-[11px]">{BLOCKER_LABELS[blocker]?.[tr ? "tr" : "en"] ?? blocker}</Badge>)}
                      </div>
                    ) : (
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{tr ? "Görünür kalite engeli yok" : "No visible quality blocker"}</p>
                    )}
                  </div>
                ))}
                {!query.isLoading && visibleQueue.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{tr ? "Bu filtrede kayıt yok." : "No records match this filter."}</p>}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Languages className="h-4 w-4 text-primary" />{tr ? "Dil kapsamı" : "Locale coverage"}</CardTitle></CardHeader>
                <CardContent className="max-h-80 space-y-3 overflow-y-auto pr-3">
                  {(query.data?.localeCoverage ?? []).map((row) => (
                    <div key={row.locale}>
                      <div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium">{row.locale.toUpperCase()}</span><span>{row.pages} · {row.coveragePercent}%</span></div>
                      <Progress value={row.coveragePercent} />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-primary" />{tr ? "Son sürümler" : "Recent versions"}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(query.data?.recentVersions ?? []).slice(0, 8).map((version) => (
                    <a key={version.id} href={`/admin/website/pages/${version.pageId}/edit`} className="flex items-center justify-between rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50">
                      <span className="font-medium">#{version.pageId} · v{version.versionNumber}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(version.createdAt, tr)}</span>
                    </a>
                  ))}
                  {!query.isLoading && (query.data?.recentVersions.length ?? 0) === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{tr ? "Sürüm kaydı yok." : "No version record."}</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
