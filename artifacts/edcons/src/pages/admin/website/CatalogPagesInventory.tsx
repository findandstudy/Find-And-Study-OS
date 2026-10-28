import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  FileText,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/hooks/use-i18n";
import { LANGUAGE_META, SUPPORTED_LANGUAGES } from "@/lib/i18n";
import DetailContentEditor, {
  type DetailContentTarget,
} from "./DetailContentEditor";

type Kind = "country" | "city" | "university" | "program";
type Sort =
  | "title_asc"
  | "title_desc"
  | "updated_desc"
  | "updated_asc"
  | "id_desc"
  | "id_asc";
type EditorialStatus = "LIVE" | "LIVE_WITH_DRAFT" | "DRAFT" | "TEMPLATE_ONLY";
type EditorialState = {
  status: EditorialStatus;
  pageId: number | null;
  publishedVersionNumber: number | null;
  publishedAt: string | null;
  updatedAt: string | null;
};
type Item = {
  kind: Kind;
  sourceId: number;
  title: string;
  sourceTitle: string;
  canonicalPath: string | null;
  sourceEditPath: string;
  locale: string;
  sourceUpdatedAt: string;
  visible: boolean;
  admissionsOpen: boolean | null;
  contentDelivery: string;
  issues: string[];
  publication: {
    status: string;
    revisionNumber: number | null;
    qualityStatus: string | null;
    translationStatus: string | null;
  };
  editorial?: EditorialState;
  seo: string;
};
type Inventory = {
  items: Item[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  publicationEvaluated: boolean;
};

const labels: Record<string, [string, string]> = {
  country: ["Countries", "Ülkeler"],
  city: ["Cities", "Şehirler"],
  university: ["Universities", "Üniversiteler"],
  program: ["Programs", "Programlar"],
  SOURCE_INACTIVE: ["Source inactive", "Kaynak pasif"],
  PARENT_INACTIVE: ["Parent inactive", "Üst kayıt pasif"],
  CATALOG_POLICY_HIDDEN: [
    "Hidden by catalogue policy",
    "Katalog kuralıyla gizli",
  ],
  COUNTRY_ROUTE_UNAVAILABLE: ["No public route", "Halka açık rota yok"],
  PUBLIC_OFFERINGS_UNAVAILABLE: [
    "No public institutions yet",
    "Henüz public kurum yok",
  ],
  DESCRIPTION_MISSING: ["Description missing", "Açıklama eksik"],
  MEDIA_MISSING: ["Media missing", "Medya eksik"],
  TRANSLATION_FALLBACK: ["Source-language fallback", "Kaynak dil gösteriliyor"],
  SOURCE_CATALOG: ["Catalogue source", "Katalog kaynağı"],
  SOURCE_FALLBACK: ["Source-language fallback", "Kaynak dil gösteriliyor"],
  PUBLISHED_TRANSLATION: ["Published translation", "Yayınlanmış çeviri"],
  PUBLISHED_REVISION: ["Published revision", "Yayınlanmış sürüm"],
  NOT_EVALUATED: ["Not evaluated", "Değerlendirilmedi"],
  NO_CONTENT_RECORD: ["No content record", "İçerik kaydı yok"],
  NO_PUBLICATION_STATE: ["No publication state", "Yayın durumu yok"],
  PUBLISHED: ["Published", "Yayında"],
  DRAFT: ["Draft", "Taslak"],
  INDEX_ELIGIBLE: ["Index eligible", "İndekslemeye uygun"],
  NOINDEX: ["Noindex", "Noindex"],
  PENDING_REVIEW: ["Awaiting review", "İnceleme bekliyor"],
  APPROVED: ["Approved", "Onaylandı"],
  STALE: ["Review again", "Yeniden incele"],
  RETIRED: ["Retired", "Yayından kaldırıldı"],
  AMBIGUOUS_CONTENT_LINK: [
    "Ambiguous destination",
    "Belirsiz destinasyon eşleşmesi",
  ],
  LIVE: ["Live", "Canlı"],
  LIVE_WITH_DRAFT: ["Live · changes pending", "Canlı · değişiklik bekliyor"],
  TEMPLATE_ONLY: ["Template only", "Yalnız şablon"],
};
const kinds: Kind[] = ["country", "city", "university", "program"];
const sorts: Sort[] = [
  "title_asc",
  "title_desc",
  "updated_desc",
  "updated_asc",
  "id_desc",
  "id_asc",
];
const urlParams = () =>
  typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
const csv = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
export default function CatalogPagesInventory() {
  const { lang, t } = useI18n();
  const tr = lang === "tr";
  const initial = useMemo(urlParams, []);
  const label = (key: string) =>
    labels[key]?.[tr ? 1 : 0] ?? t("common.unknown");
  const [kind, setKind] = useState<Kind>(
    kinds.includes(initial.get("pageType") as Kind)
      ? (initial.get("pageType") as Kind)
      : "program",
  );
  const [locale, setLocale] = useState(
    (SUPPORTED_LANGUAGES as readonly string[]).includes(
      initial.get("pageLocale") || "",
    )
      ? initial.get("pageLocale")!
      : lang,
  );
  const [search, setSearch] = useState(initial.get("pageQuery") || "");
  const [debounced, setDebounced] = useState(search);
  const [sort, setSort] = useState<Sort>(
    sorts.includes(initial.get("pageSort") as Sort)
      ? (initial.get("pageSort") as Sort)
      : "title_asc",
  );
  const [pageSize, setPageSize] = useState(
    [12, 25, 50].includes(Number(initial.get("pageSize")))
      ? Number(initial.get("pageSize"))
      : 25,
  );
  const [page, setPage] = useState(
    Math.max(1, Number(initial.get("page")) || 1),
  );
  const [jump, setJump] = useState(String(page));
  const [view, setView] = useState<"table" | "cards">(
    initial.get("pageView") === "cards" ? "cards" : "table",
  );
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<DetailContentTarget | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setJump(String(page));
    setSelected([]);
  }, [page, kind, locale, debounced, sort, pageSize]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = new URLSearchParams(window.location.search);
    [
      ["pageType", kind],
      ["pageLocale", locale],
      ["pageQuery", debounced],
      ["pageSort", sort],
      ["pageSize", String(pageSize)],
      ["page", String(page)],
      ["pageView", view],
    ].forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${next}`,
    );
  }, [kind, locale, debounced, sort, pageSize, page, view]);
  const query = useQuery<Inventory>({
    queryKey: [
      "website-catalog-pages",
      kind,
      locale,
      debounced,
      sort,
      pageSize,
      page,
    ],
    queryFn: ({ signal }) =>
      customFetch(
        `/api/website/catalog-pages?${new URLSearchParams({ kind, locale, q: debounced, sort, page: String(page), pageSize: String(pageSize) })}`,
        { signal },
      ),
    staleTime: 0,
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 5_000),
    refetchOnReconnect: true,
    // The application-wide default disables focus refetches. This inventory is
    // deliberately different: catalogue records are commonly edited in a
    // second tab, so returning to Pages must reconcile with the source without
    // requiring a manual reload.
    refetchOnWindowFocus: true,
  });
  const pagination = query.data?.pagination;
  // Keep the inventory usable during a rolling/local API restart. The server's
  // authoritative CMS state replaces this conservative fallback as soon as it
  // is available.
  const rows = (query.data?.items ?? []).map((item) => ({
    ...item,
    editorial: item.editorial ?? {
      status:
        item.publication.status === "PUBLISHED"
          ? ("LIVE" as const)
          : item.publication.status === "DRAFT"
            ? ("DRAFT" as const)
            : ("TEMPLATE_ONLY" as const),
      pageId: null,
      publishedVersionNumber: item.publication.revisionNumber,
      publishedAt: null,
      updatedAt: null,
    },
  }));
  const selectedRows = rows.filter((item) => selected.includes(item.sourceId));
  const allSelected =
    rows.length > 0 && rows.every((item) => selected.includes(item.sourceId));
  const toggle = (id: number) =>
    setSelected((old) =>
      old.includes(id) ? old.filter((value) => value !== id) : [...old, id],
    );
  const jumpTo = (event: FormEvent) => {
    event.preventDefault();
    setPage(
      Math.min(
        Math.max(1, Number(jump) || 1),
        Math.max(1, pagination?.totalPages ?? 1),
      ),
    );
  };
  const exportRows = () => {
    const data = selectedRows.length ? selectedRows : rows;
    if (!data.length) return;
    const header = [
      "type",
      "id",
      "title",
      "locale",
      "public_route",
      "admissions",
      "editorial_status",
      "seo",
      "issues",
      "canonical",
    ];
    const body = data.map((item) =>
      [
        item.kind,
        item.sourceId,
        item.title,
        item.locale,
        item.visible,
        item.admissionsOpen,
        item.editorial?.status ?? "TEMPLATE_ONLY",
        item.seo,
        item.issues.join("|"),
        item.canonicalPath,
      ]
        .map(csv)
        .join(","),
    );
    const url = URL.createObjectURL(
      new Blob([[header.join(","), ...body].join("\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `page-inventory-${kind}-${locale}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const edit = (item: Item) =>
    setEditing({
      kind: item.kind === "country" ? "destination" : item.kind,
      entityId: item.sourceId,
      locale: item.locale,
      title: item.title,
      sourceEditPath: item.sourceEditPath,
      canonicalPath: item.canonicalPath,
    });
  const editorialFor = (item: Item): EditorialState =>
    item.editorial ?? {
      status:
        item.publication.status === "PUBLISHED"
          ? "LIVE"
          : item.publication.status === "DRAFT"
            ? "DRAFT"
            : "TEMPLATE_ONLY",
      pageId: null,
      publishedVersionNumber: item.publication.revisionNumber,
      publishedAt: null,
      updatedAt: null,
    };
  const primaryActionLabel = (item: Item) =>
    editorialFor(item).status === "LIVE"
      ? tr
        ? "Canlı sayfayı düzenle"
        : "Edit live page"
      : editorialFor(item).status === "LIVE_WITH_DRAFT"
        ? tr
          ? "Değişiklikleri incele"
          : "Review changes"
        : editorialFor(item).status === "DRAFT"
          ? tr
            ? "İncele ve yayınla"
            : "Review & publish"
          : tr
            ? "Sayfayı oluştur"
            : "Create page";
  const Actions = ({ item }: { item: Item }) => (
    <div className="flex min-w-[238px] items-center gap-1.5">
      <Button
        className="min-w-0 flex-1"
        variant="default"
        size="sm"
        aria-label={`${item.title} ${primaryActionLabel(item)}`}
        onClick={() => edit(item)}
      >
        <Pencil className="me-1.5 h-4 w-4 shrink-0" />
        <span className="truncate">{primaryActionLabel(item)}</span>
      </Button>
      {item.visible && item.canonicalPath ? (
        <Button
          asChild
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
        >
          <a
            href={item.canonicalPath}
            aria-label={`${item.title} ${tr ? "canlı sayfayı aç" : "open public page"}`}
            title={tr ? "Sayfayı aç" : "Open page"}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled
          title={tr ? "Public rota görünür değil" : "Public route is hidden"}
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label={`${item.title} ${tr ? "diğer işlemler" : "more actions"}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem asChild>
            <a
              href={item.sourceEditPath}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Database className="me-2 h-4 w-4" />
              {tr ? "Katalog kaydını düzenle" : "Edit catalogue record"}
            </a>
          </DropdownMenuItem>
          {item.visible && item.canonicalPath && (
            <DropdownMenuItem asChild>
              <a
                href={`${item.canonicalPath}${item.canonicalPath.includes("?") ? "&" : "?"}templatePreview=1`}
              >
                <LayoutGrid className="me-2 h-4 w-4" />
                {tr ? "Şablon önizlemesi" : "Template preview"}
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const issueCount = rows.filter((item) => item.issues.length).length;
  const liveCount = rows.filter(
    (item) =>
      editorialFor(item).status === "LIVE" ||
      editorialFor(item).status === "LIVE_WITH_DRAFT",
  ).length;
  const needsPublicationCount = rows.filter(
    (item) => editorialFor(item).status !== "LIVE",
  ).length;
  const statusBadges = (item: Item) => (
    <div className="flex min-w-[120px] flex-col items-start gap-1.5 2xl:min-w-[150px]">
      <Badge
        variant="outline"
        className={
          editorialFor(item).status === "LIVE"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
            : editorialFor(item).status === "LIVE_WITH_DRAFT"
              ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              : editorialFor(item).status === "DRAFT"
                ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
                : ""
        }
      >
        {label(editorialFor(item).status)}
      </Badge>
      <span
        className={`inline-flex items-center gap-1 text-xs ${item.visible ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${item.visible ? "bg-emerald-500" : "bg-muted-foreground"}`}
        />
        {item.visible
          ? tr
            ? "Public rota açık"
            : "Public route open"
          : tr
            ? "Public rota gizli"
            : "Public route hidden"}
      </span>
      {item.admissionsOpen !== null && (
        <span
          className={`inline-flex items-center gap-1 text-xs ${item.admissionsOpen ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${item.admissionsOpen ? "bg-emerald-500" : "bg-muted-foreground"}`}
          />
          {item.admissionsOpen
            ? tr
              ? "Başvuru açık"
              : "Admissions open"
            : tr
              ? "Başvuru kapalı"
              : "Admissions closed"}
        </span>
      )}
    </div>
  );

  return (
    <section
      aria-labelledby="catalog-pages-title"
      className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <div className="border-b bg-gradient-to-br from-primary/[0.08] via-background to-background p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Database className="h-3.5 w-3.5" />
              {tr ? "Katalog bağlantılı" : "Catalogue connected"}
            </div>
            <h2
              id="catalog-pages-title"
              className="text-2xl font-semibold tracking-tight"
            >
              {tr ? "Dinamik sayfa envanteri" : "Dynamic page inventory"}
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              {tr
                ? "Katalog kayıtlarından üretilen sayfaları tek yerden bulun, kontrol edin ve düzenleyin."
                : "Find, review and edit every catalogue-generated page from one workspace."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-background/80"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw
                className={`me-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`}
              />
              {tr ? "Yenile" : "Refresh"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-background/80"
              disabled={!rows.length}
              onClick={exportRows}
            >
              <Download className="me-2 h-4 w-4" />
              {selectedRows.length
                ? `${selectedRows.length} ${tr ? "seçileni aktar" : "selected"}`
                : tr
                  ? "Dışa aktar"
                  : "Export"}
            </Button>
          </div>
        </div>
        <div
          className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4"
          aria-label={tr ? "Sayfa türleri" : "Page types"}
        >
          {kinds.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                setPage(1);
              }}
              className={`group flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-start transition-all ${kind === value ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/15" : "bg-background/80 hover:border-primary/40 hover:bg-background"}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kind === value ? "bg-white/15" : "bg-primary/10 text-primary"}`}
              >
                <FileText className="h-4 w-4" />
              </span>
              <span>
                <strong className="block text-sm">{label(value)}</strong>
                <span
                  className={`text-xs ${kind === value ? "text-primary-foreground/75" : "text-muted-foreground"}`}
                >
                  {value === "country"
                    ? tr
                      ? "Destinasyon"
                      : "Destination"
                    : value === "city"
                      ? tr
                        ? "Şehir rehberi"
                        : "City guide"
                      : value === "university"
                        ? tr
                          ? "Kurum profili"
                          : "Institution"
                        : tr
                          ? "Eğitim programı"
                          : "Study program"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        <div className="rounded-xl border bg-muted/20 p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            {tr ? "Ara ve filtrele" : "Search and filter"}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
              <Label htmlFor="page-search">
                {tr ? "Sayfa adı veya kaynak ID" : "Page name or source ID"}
              </Label>
              <div className="relative">
                <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="page-search"
                  className="h-10 bg-background ps-9 pe-9"
                  maxLength={120}
                  placeholder={
                    tr
                      ? "Örn. İstanbul veya #142"
                      : "For example, Istanbul or #142"
                  }
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    className="absolute end-2 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-muted"
                    aria-label={tr ? "Aramayı temizle" : "Clear search"}
                    onClick={() => setSearch("")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="page-locale">{tr ? "Dil" : "Language"}</Label>
              <Select
                value={locale}
                onValueChange={(value) => {
                  setLocale(value);
                  setPage(1);
                }}
              >
                <SelectTrigger id="page-locale" className="h-10 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {LANGUAGE_META[value].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="page-sort">{tr ? "Sıralama" : "Sort"}</Label>
              <Select
                value={sort}
                onValueChange={(value) => {
                  setSort(value as Sort);
                  setPage(1);
                }}
              >
                <SelectTrigger id="page-sort" className="h-10 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="title_asc">
                    {tr ? "Ad A–Z" : "Title A–Z"}
                  </SelectItem>
                  <SelectItem value="title_desc">
                    {tr ? "Ad Z–A" : "Title Z–A"}
                  </SelectItem>
                  <SelectItem value="updated_desc">
                    {tr ? "En yeni" : "Recently updated"}
                  </SelectItem>
                  <SelectItem value="updated_asc">
                    {tr ? "En eski" : "Oldest updated"}
                  </SelectItem>
                  <SelectItem value="id_desc">
                    {tr ? "En yüksek ID" : "Highest ID"}
                  </SelectItem>
                  <SelectItem value="id_asc">
                    {tr ? "En düşük ID" : "Lowest ID"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="page-size">
                {tr ? "Sayfa başına" : "Per page"}
              </Label>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
              >
                <SelectTrigger id="page-size" className="h-10 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[12, 25, 50].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {query.isError ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"
          >
            <p>
              {tr
                ? "Envanter yüklenemedi. Kayıtlar değiştirilmedi."
                : "Inventory could not load. Records were not changed."}
            </p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void query.refetch()}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : query.isLoading ? (
          <div role="status" className="grid gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((value) => (
              <div
                key={value}
                className="h-24 animate-pulse rounded-xl bg-muted"
              />
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border bg-background p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {tr ? "Toplam sonuç" : "Total results"}
                </p>
                <div className="mt-2 flex items-end justify-between">
                  <strong className="text-2xl">
                    {pagination?.total.toLocaleString(locale) ?? 0}
                  </strong>
                  <Database className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="rounded-xl border bg-background p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {tr ? "Şu anda canlı" : "Live now"}
                </p>
                <div className="mt-2 flex items-end justify-between">
                  <strong className="text-2xl">
                    {liveCount}
                    <span className="text-sm font-normal text-muted-foreground">
                      /{rows.length}
                    </span>
                  </strong>
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                </div>
              </div>
              <div className="rounded-xl border bg-background p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {tr ? "Yayın işlemi gereken" : "Needs publishing action"}
                </p>
                <div className="mt-2 flex items-end justify-between">
                  <strong className="text-2xl">{needsPublicationCount}</strong>
                  <FileText
                    className={`h-5 w-5 ${needsPublicationCount ? "text-sky-500" : "text-muted-foreground"}`}
                  />
                </div>
              </div>
              <div className="rounded-xl border bg-background p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {tr ? "İçerik sorunu" : "Content issues"}
                </p>
                <div className="mt-2 flex items-end justify-between">
                  <strong className="text-2xl">{issueCount}</strong>
                  <AlertTriangle
                    className={`h-5 w-5 ${issueCount ? "text-amber-500" : "text-muted-foreground"}`}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-h-9 flex-wrap items-center gap-2">
                {selected.length > 0 ? (
                  <>
                    <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                      <strong>{selected.length}</strong>{" "}
                      {tr ? "sayfa seçildi" : "pages selected"}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2"
                        onClick={() => setSelected([])}
                      >
                        {tr ? "Temizle" : "Clear"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {tr
                      ? "Bir sayfayı düzenlemek veya önizlemek için satırdaki işlemleri kullanın."
                      : "Use the row actions to edit or preview a page."}
                  </p>
                )}
              </div>
              <div
                className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1"
                role="group"
                aria-label={tr ? "Görünüm" : "View"}
              >
                <Button
                  size="sm"
                  variant={view === "table" ? "default" : "ghost"}
                  aria-pressed={view === "table"}
                  aria-label={tr ? "Tablo görünümü" : "Table view"}
                  onClick={() => setView("table")}
                >
                  <List className="me-1 h-4 w-4" />
                  {tr ? "Tablo" : "Table"}
                </Button>
                <Button
                  size="sm"
                  variant={view === "cards" ? "default" : "ghost"}
                  aria-pressed={view === "cards"}
                  aria-label={tr ? "Kart görünümü" : "Card view"}
                  onClick={() => setView("cards")}
                >
                  <LayoutGrid className="me-1 h-4 w-4" />
                  {tr ? "Kartlar" : "Cards"}
                </Button>
              </div>
            </div>

            {query.data && !query.data.publicationEvaluated && (
              <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3.5 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  <strong className="block">
                    {tr
                      ? "Canlılık durumu CMS kaydından okunuyor"
                      : "Live status comes from the CMS record"}
                  </strong>
                  <span className="text-sky-800 dark:text-sky-200">
                    {tr
                      ? "Canlı, taslak ve bekleyen değişiklik bilgileri günceldir. Yalnız gelişmiş SEO kalite değerlendirmesi henüz etkin değildir."
                      : "Live, draft and pending-change states are current. Only the advanced SEO quality evaluation is not enabled yet."}
                  </span>
                </p>
              </div>
            )}

            {!rows.length ? (
              <div className="rounded-xl border border-dashed py-16 text-center">
                <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="font-medium">
                  {tr ? "Eşleşen sayfa bulunamadı" : "No matching pages"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tr
                    ? "Arama kelimesini veya filtreleri değiştirin."
                    : "Try changing the search or filters."}
                </p>
              </div>
            ) : view === "table" ? (
              <div
                className="max-w-full overflow-x-auto rounded-xl border bg-background"
                tabIndex={0}
                aria-label={
                  tr
                    ? "Kaydırılabilir dinamik sayfalar tablosu"
                    : "Scrollable dynamic pages table"
                }
              >
                <table className="w-full min-w-[760px] table-fixed text-sm 2xl:min-w-[1120px]">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="w-12 p-3">
                        <input
                          type="checkbox"
                          aria-label={
                            tr
                              ? "Bu sayfadakilerin tümünü seç"
                              : "Select all on this page"
                          }
                          checked={allSelected}
                          onChange={() =>
                            setSelected(
                              allSelected
                                ? []
                                : rows.map((item) => item.sourceId),
                            )
                          }
                        />
                      </th>
                      <th className="w-[34%] min-w-[230px] p-3 text-start 2xl:sticky 2xl:start-0 2xl:z-20 2xl:w-[260px] 2xl:border-e 2xl:bg-muted 2xl:shadow-[4px_0_12px_-8px_rgba(15,23,42,0.45)]">
                        {tr ? "Sayfa" : "Page"}
                      </th>
                      <th className="w-[170px] p-3 text-start">
                        {tr ? "Canlılık durumu" : "Live status"}
                      </th>
                      <th className="hidden p-3 text-start xl:table-cell xl:w-[180px]">
                        {tr ? "SEO ve içerik" : "SEO & content"}
                      </th>
                      <th className="hidden p-3 text-start 2xl:table-cell 2xl:w-[230px]">
                        {tr ? "İçerik kontrolü" : "Content check"}
                      </th>
                      <th className="hidden p-3 text-start 2xl:table-cell 2xl:w-[130px]">
                        {tr ? "Güncellendi" : "Updated"}
                      </th>
                  <th className="sticky end-0 z-20 w-[290px] border-s bg-muted p-3 text-start shadow-[-4px_0_12px_-8px_rgba(15,23,42,0.45)]">
                        {tr ? "İşlemler" : "Actions"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((item) => (
                      <tr
                        key={`${item.kind}-${item.sourceId}`}
                        className="group align-middle transition-colors hover:bg-primary/[0.035]"
                      >
                        <td className="p-3 align-top">
                          <input
                            type="checkbox"
                            aria-label={`${item.title} ${tr ? "seç" : "select"}`}
                            checked={selected.includes(item.sourceId)}
                            onChange={() => toggle(item.sourceId)}
                          />
                        </td>
                        <td className="p-3.5 align-top 2xl:sticky 2xl:start-0 2xl:z-10 2xl:border-e 2xl:bg-background 2xl:shadow-[4px_0_12px_-8px_rgba(15,23,42,0.45)] 2xl:group-hover:bg-[#f8faff] dark:2xl:group-hover:bg-[#111827]">
                          <div className="flex gap-3">
                            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                              <FileText className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">
                                {item.title}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {label(item.kind)} · #{item.sourceId} ·{" "}
                                {item.locale.toUpperCase()}
                              </p>
                              <p
                                dir="ltr"
                                className="mt-1 max-w-[190px] truncate text-xs text-primary/80"
                                title={item.canonicalPath || undefined}
                              >
                                {item.canonicalPath ||
                                  (tr ? "Public rota yok" : "No public route")}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3.5 align-top">
                          {statusBadges(item)}
                        </td>
                        <td className="hidden p-3.5 align-top xl:table-cell">
                          <p className="font-medium">SEO · {label(item.seo)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {label(item.contentDelivery)}
                          </p>
                          {item.editorial.publishedVersionNumber && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {tr ? "Canlı sürüm" : "Live version"} · v
                              {item.editorial.publishedVersionNumber}
                            </p>
                          )}
                        </td>
                        <td className="hidden max-w-[240px] p-3.5 align-top 2xl:table-cell">
                          {item.issues.length ? (
                            <div className="flex flex-wrap gap-1">
                              {item.issues.map((issue) => (
                                <Badge
                                  key={issue}
                                  variant="outline"
                                  className="border-amber-200 bg-amber-50 font-normal text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                                >
                                  {label(issue)}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                              <CheckCircle2 className="h-4 w-4" />
                              {tr ? "Sorun görünmüyor" : "No issues"}
                            </span>
                          )}
                        </td>
                        <td className="hidden whitespace-nowrap p-3.5 align-top text-xs text-muted-foreground 2xl:table-cell">
                          {new Date(
                            item.editorial.updatedAt || item.sourceUpdatedAt,
                          ).toLocaleDateString(locale, { dateStyle: "medium" })}
                          <span className="mt-1 block">
                            {new Date(
                              item.editorial.updatedAt || item.sourceUpdatedAt,
                            ).toLocaleTimeString(locale, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </td>
                        <td className="sticky end-0 z-10 border-s bg-background p-3.5 align-top shadow-[-4px_0_12px_-8px_rgba(15,23,42,0.45)] group-hover:bg-[#f8faff] dark:group-hover:bg-[#111827]">
                          <Actions item={item} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {rows.map((item) => (
                  <article
                    key={`${item.kind}-${item.sourceId}`}
                    className="min-w-0 rounded-2xl border bg-background p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                  >
                    <div className="flex min-w-0 flex-wrap items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-3"
                        aria-label={`${item.title} ${tr ? "seç" : "select"}`}
                        checked={selected.includes(item.sourceId)}
                        onChange={() => toggle(item.sourceId)}
                      />
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <FileText className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold">{item.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {label(item.kind)} · #{item.sourceId} ·{" "}
                          {item.locale.toUpperCase()}
                        </p>
                        <p
                          dir="ltr"
                          className="mt-1 truncate text-xs text-primary/80"
                        >
                          {item.canonicalPath || "—"}
                        </p>
                      </div>
                      {statusBadges(item)}
                    </div>
                    <div className="my-4 grid grid-cols-2 gap-3 rounded-xl bg-muted/30 p-3 text-xs">
                      <div>
                        <span className="text-muted-foreground">
                          {tr ? "Canlılık" : "Live status"}
                        </span>
                        <strong className="mt-1 block">
                          {label(item.editorial.status)}
                        </strong>
                      </div>
                      <div>
                        <span className="text-muted-foreground">SEO</span>
                        <strong className="mt-1 block">
                          {label(item.seo)}
                        </strong>
                      </div>
                    </div>
                    {item.issues.length > 0 && (
                      <div className="mb-4 flex flex-wrap gap-1">
                        {item.issues.map((issue) => (
                          <Badge
                            key={issue}
                            variant="outline"
                            className="font-normal"
                          >
                            {label(issue)}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="border-t pt-3">
                      <Actions item={item} />
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || query.isFetching}
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft className="me-1 h-4 w-4" />
                {t("common.previous")}
              </Button>
              <form className="flex items-center gap-2" onSubmit={jumpTo}>
                <Label htmlFor="page-jump">{tr ? "Sayfa" : "Page"}</Label>
                <Input
                  id="page-jump"
                  inputMode="numeric"
                  className="h-9 w-20 bg-background text-center"
                  value={jump}
                  onChange={(event) =>
                    setJump(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
                <span className="text-sm text-muted-foreground">
                  / {Math.max(1, pagination?.totalPages ?? 1)}
                </span>
                <Button type="submit" size="sm" variant="outline">
                  {tr ? "Git" : "Go"}
                </Button>
              </form>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  page >= (pagination?.totalPages ?? 0) || query.isFetching
                }
                onClick={() => setPage((value) => value + 1)}
              >
                {t("common.next")}
                <ChevronRight className="ms-1 h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
      {editing && (
        <DetailContentEditor
          key={`${editing.kind}:${editing.entityId}:${editing.locale}`}
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void query.refetch();
          }}
        />
      )}
    </section>
  );
}
