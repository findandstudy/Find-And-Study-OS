import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Save, Upload, Eye, EyeOff, Plus, Trash2, Copy, ChevronUp, ChevronDown,
  Monitor, Tablet, Smartphone, History, ArrowLeft, RotateCcw, RefreshCw, GripVertical, Settings2, GitCompareArrows, Download, Search, ExternalLink, Layers3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { BLOCK_APPEARANCE_KEYS, BLOCK_TYPES, getBlockTypeDef, getDefaultContent, type PageBlock } from "@/lib/website/blockTypes";
import { SUPPORTED_LANGUAGES, LANGUAGE_META, type Language } from "@/lib/i18n";
import DOMPurify from "isomorphic-dompurify";
import { CatalogBlockFields } from "./CatalogBlockFields";
import { CatalogBlockPreview } from "./CatalogBlockPreview";
import { useI18n } from "@/hooks/use-i18n";
import { installPageEditorNavigationGuard, supportsPageEditorHistoryGuard } from "./pageEditorNavigationGuard";
import { pageEditorText } from "./pageEditorCopy";
// Field controls live separately so the editor route stays responsive while sections grow.
import { BlockFieldEditor, GlobalBlockSelector } from "./PageEditorFields";
import { CmsBlock, CmsPageCanvas } from "../../public/PublicPage";
import { isSystemManagedPage, managedPagePublicPath } from "@/lib/website/managedPageRoutes";
import { enrichManagedPageBlocks, managedPageStarterBlocks, managedPageStarterTranslations, MANAGED_HOME_BLOCK_TYPES } from "@/lib/website/managedPageStarters";
import { pageEditorPreviewGeometry, samePageEditorPreviewGeometry } from "./pageEditorPreviewGeometry";
import { SITE_NAME } from "@/hooks/use-json-ld";

const ALLOWED_TAGS = ["p", "br", "b", "i", "u", "strong", "em", "a", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "code", "pre", "span", "div", "img", "hr"];
const ALLOWED_ATTRS = ["href", "target", "rel", "src", "alt", "class", "style"];

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRS,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
    ADD_ATTR: ["target"],
  });
}

interface WebsitePage {
  id: number;
  title: string;
  slug: string;
  status: string;
  template: string;
  locale: string;
  metaTitle: string | null;
  metaDescription: string | null;
  publishedAt: string | null;
  updatedAt: string;
  translationsJson: Record<string, Record<string, string>> | null;
}

interface PageVersion {
  id: number;
  pageId: number;
  versionNumber: number;
  blocksSnapshot: PageBlock[];
  metaSnapshot: Record<string, unknown> | null;
  publishedAt: string | null;
  createdBy: number | null;
  createdAt: string;
  authorFirstName: string | null;
  authorLastName: string | null;
  authorEmail: string | null;
}

type CmsTeamMember = { id: number; name: string; title: string | null; bio: string | null; photoUrl: string | null };
type CmsOffice = { id: number; name: string; city: string | null; country: string | null; address: string | null; phone: string | null; email: string | null };

function hydrateCollectionBlock(block: PageBlock, teamMembers: CmsTeamMember[], offices: CmsOffice[]): PageBlock {
  if (block.blockType === "team_grid") return {
    ...block,
    content: { ...block.content, members: teamMembers.map(member => ({ name: member.name, role: member.title || "", bio: member.bio || "", photo: member.photoUrl || "" })) },
  };
  if (block.blockType === "office_list") return {
    ...block,
    content: { ...block.content, offices: offices.map(office => ({ name: office.name, city: [office.city, office.country].filter(Boolean).join(", "), address: office.address || "", phone: office.phone || "", email: office.email || "" })) },
  };
  return block;
}

function collectionDependency(block: PageBlock): "team" | "offices" | "logos" | null {
  if (block.blockType === "team_grid") return "team";
  if (block.blockType === "office_list") return "offices";
  if (block.blockType === "logo_marquee") return "logos";
  return null;
}

function hasCollectionItems(block: PageBlock): boolean {
  const key = block.blockType === "team_grid" ? "members" : block.blockType === "office_list" ? "offices" : block.blockType === "logo_marquee" ? "items" : null;
  return key === null || (Array.isArray(block.content[key]) && (block.content[key] as unknown[]).length > 0);
}

type PreviewSize = "desktop" | "tablet" | "mobile";
const PREVIEW_WIDTHS: Record<PreviewSize, number> = { desktop: 1280, tablet: 768, mobile: 375 };

const SEO_COMPARISON_FIELDS = [
  ["slug", "Route"], ["metaTitle", "SEO title"], ["metaDescription", "SEO description"],
  ["canonicalUrl", "Canonical"], ["robotsIndex", "Index"], ["robotsFollow", "Follow"],
  ["ogTitle", "OG title"], ["ogDescription", "OG description"], ["ogImageUrl", "OG image"],
  ["twitterTitle", "Twitter title"], ["twitterDescription", "Twitter description"], ["twitterImageUrl", "Twitter image"],
] as const;

function normalizedSnapshotValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : JSON.stringify(value);
}

function snapshotTranslations(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeBlockAppearance(block: PageBlock): PageBlock {
  const content = { ...(block.content || {}) };
  const settings = { ...(block.settings || {}) };
  for (const key of BLOCK_APPEARANCE_KEYS) {
    if (settings[key] === undefined && content[key] !== undefined) settings[key] = content[key];
    delete content[key];
  }
  return { ...block, content, settings };
}

function normalizeBlocks(blocks: PageBlock[]): PageBlock[] {
  return blocks.map(normalizeBlockAppearance);
}

export default function PageEditor({ id }: { id: number }) {
  return <PageEditorSession key={id} id={id} />;
}

interface PublicationPreflight {
  eligible: boolean;
  revision: string;
  digest: string;
  checkedAt: string;
  expiresAt: string;
  publication: { route: string; canonical: string; locale: string; indexable: boolean; sitemapEligible: boolean; invalidationScopes: string[] };
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
}

function PageEditorSession({ id }: { id: number }) {
  const { lang } = useI18n();
  const copy = (en: string, tr?: string) => pageEditorText(lang, en, tr);
  const preflightIssueText = (issue: { code: string; message: string }) => ({
    TITLE_REQUIRED: copy("Page title is required.", "Sayfa başlığı zorunludur."),
    SLUG_REQUIRED: copy("Page address is required.", "Sayfa adresi zorunludur."),
    LOCALE_REQUIRED: copy("Page language is required.", "Sayfa dili zorunludur."),
    VISIBLE_CONTENT_REQUIRED: copy("At least one visible content block is required.", "En az bir görünür içerik bloğu zorunludur."),
    META_TITLE_MISSING: copy("SEO title is empty.", "SEO başlığı boş."),
    META_DESCRIPTION_MISSING: copy("SEO description is empty.", "SEO açıklaması boş."),
    NOINDEX_ENABLED: copy("This page is currently noindex.", "Bu sayfa şu anda noindex."),
    UNSAFE_OR_INVALID_URL: copy(issue.message, "Güvensiz veya geçersiz bir bağlantı bulundu."),
    INSECURE_HTTP_URL: copy(issue.message, "HTTPS kullanmayan bir bağlantı bulundu."),
    MEDIA_LABEL_MISSING: copy(issue.message, "Erişilebilir adı veya alternatif metni olmayan medya bulundu."),
    CONTENT_TOO_COMPLEX: copy(issue.message, "İçerik güvenli yayın kontrolü sınırını aşıyor."),
    TRANSLATION_FACTUAL_OVERRIDE: copy("A translated catalogue fact differs from the source page.", "Çevrilmiş bir katalog bilgisi kaynak sayfadan farklı."),
    CANONICAL_CONFLICT: copy("Another page already uses this canonical URL.", "Bu canonical adresi başka bir sayfa kullanıyor."),
  } as Record<string, string>)[issue.code] ?? issue.message;
  const openPreflightIssue = (issue: { message: string }) => {
    const match = issue.message.match(/^blocks\[(\d+)\]/);
    if (!match) return;
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= blocks.length) return;
    setSelectedBlockIdx(index);
    setMobilePane("editor");
    setPreflightOpen(false);
  };
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);
  const [previewSize, setPreviewSize] = useState<PreviewSize>("desktop");
  const previewHostRef = useRef<HTMLElement | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewHeight, setPreviewHeight] = useState(400);
  const previewGeometryRef = useRef({ scale: 1, height: 400 });
  const [mobilePane, setMobilePane] = useState<"blocks" | "editor" | "preview">("preview");
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [blockSearch, setBlockSearch] = useState("");
  const [blockCategory, setBlockCategory] = useState<"all" | "content" | "media" | "data" | "layout" | "reference">("all");
  const [dirty, setDirty] = useState(false);
  const [starterLoaded, setStarterLoaded] = useState(false);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const serverRevision = useRef<string | null>(null);
  const blockRevision = useRef(0);
  const markDirty = useCallback(() => {
    blockRevision.current += 1;
    setDirty(true);
  }, []);
  const [savedSeo, setSavedSeo] = useState<string | null>(null);
  const blocksInitialized = useRef(false);
  const [editLocale, setEditLocale] = useState("en");
  const defaultBlocksRef = useRef<PageBlock[]>([]);
  const translationsRef = useRef<Record<string, PageBlock[]>>({});
  const managedTranslationsSeeded = useRef<number | null>(null);
  const [, bumpTranslationCoverage] = useState(0);
  const [seoOpen, setSeoOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflight, setPreflight] = useState<PublicationPreflight | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [changeRequest, setChangeRequest] = useState({ reasonCode: "CONTENT", comment: "" });
  const [seo, setSeo] = useState({
    metaTitle: "", metaDescription: "", canonicalUrl: "",
    robotsIndex: true, robotsFollow: true,
    ogTitle: "", ogDescription: "", ogImageUrl: "",
    twitterTitle: "", twitterDescription: "", twitterImageUrl: "",
    slug: "",
  });
  const seoInitialized = useRef(false);
  const seoDirty = savedSeo !== null && JSON.stringify(seo) !== savedSeo;
  const unsavedRef = useRef(false);
  const savingRef = useRef(false);
  unsavedRef.current = dirty || seoDirty;
  const leaveMessageRef = useRef("");
  leaveMessageRef.current = copy("You have unsaved changes. Leave this page and discard them?", "Kaydedilmemiş değişiklikleriniz var. Bu sayfadan ayrılıp değişiklikleri silmek istiyor musunuz?");
  useEffect(() => installPageEditorNavigationGuard(window, () => unsavedRef.current, () => window.confirm(leaveMessageRef.current), () => savingRef.current), []);
  useEffect(() => {
    const host = previewHostRef.current;
    const canvas = previewCanvasRef.current;
    if (!host || !canvas) return;

    let frame: number | null = null;
    const updatePreviewGeometry = () => {
      frame = null;
      const next = pageEditorPreviewGeometry(
        host.getBoundingClientRect().width,
        PREVIEW_WIDTHS[previewSize],
        canvas.scrollHeight,
      );
      if (samePageEditorPreviewGeometry(previewGeometryRef.current, next)) return;
      previewGeometryRef.current = next;
      setPreviewScale(current => Math.abs(current - next.scale) < 0.001 ? current : next.scale);
      setPreviewHeight(current => current === next.height ? current : next.height);
    };
    const schedulePreviewGeometry = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(updatePreviewGeometry);
    };

    const observer = new ResizeObserver(schedulePreviewGeometry);
    observer.observe(host);
    observer.observe(canvas);
    window.addEventListener("resize", schedulePreviewGeometry);
    schedulePreviewGeometry();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedulePreviewGeometry);
    };
  }, [mobilePane, previewSize]);
  function leaveEditor() {
    if (savingRef.current) return;
    if (unsavedRef.current && !window.confirm(leaveMessageRef.current)) return;
    unsavedRef.current = false;
    setLocation("/admin/website/pages");
  }

  const { data: page, isLoading: pageLoading, refetch: reloadPage } = useQuery<WebsitePage>({
    queryKey: ["website-page", id],
    queryFn: () => customFetch(`/api/website/pages/${id}`),
  });
  const sourceLocale = page?.locale || "en";
  useEffect(() => {
    if (page?.updatedAt && serverRevision.current === null) serverRevision.current = page.updatedAt;
  }, [page?.updatedAt]);

  const teamMembersQuery = useQuery<CmsTeamMember[]>({
    queryKey: ["cms-team-members", editLocale],
    queryFn: () => customFetch(`/api/cms/team-members?lang=${encodeURIComponent(editLocale)}`),
    enabled: !!page,
    staleTime: 5 * 60 * 1000,
  });
  const officesQuery = useQuery<CmsOffice[]>({
    queryKey: ["cms-offices", editLocale],
    queryFn: () => customFetch(`/api/cms/offices?lang=${encodeURIComponent(editLocale)}`),
    enabled: !!page,
    staleTime: 5 * 60 * 1000,
  });

  const { data: savedBlocks = [], isSuccess: blocksFetched, isError: blocksError, isFetching: blocksRefreshing, refetch: reloadBlocks } = useQuery<PageBlock[]>({
    queryKey: ["website-page-blocks", id],
    queryFn: () => customFetch(`/api/website/pages/${id}/blocks`),
    enabled: !!page,
  });

  const { data: versions = [] } = useQuery<PageVersion[]>({
    queryKey: ["website-page-versions", id],
    queryFn: () => customFetch(`/api/website/pages/${id}/versions`),
    enabled: !!page,
  });

  useEffect(() => {
    if (blocksInitialized.current) return;
    if (!blocksFetched) return;
    blocksInitialized.current = true;
    setEditLocale(page?.locale || "en");
    const persisted = normalizeBlocks(savedBlocks.map((b, i) => ({
      id: b.id,
      blockType: b.blockType,
      content: (b.content || {}) as Record<string, unknown>,
      settings: (b.settings || {}) as Record<string, unknown>,
      sortOrder: b.sortOrder ?? i,
      isVisible: b.isVisible ?? true,
    })));
    const starter = persisted.length === 0 && page && isSystemManagedPage(page)
      ? normalizeBlocks(managedPageStarterBlocks(page.template, page.locale as Language))
      : [];
    const parsedBase = persisted.length > 0 ? persisted : starter;
    const parsed = page && isSystemManagedPage(page)
      ? normalizeBlocks(enrichManagedPageBlocks(page.template, parsedBase, page.locale as Language))
      : parsedBase;
    const managedStructureEnriched = parsed.length > parsedBase.length;
    setBlocks(parsed);
    defaultBlocksRef.current = JSON.parse(JSON.stringify(parsed));
    if (starter.length > 0 || managedStructureEnriched) {
      setSelectedBlockIdx(0);
      setMobilePane("editor");
      setStarterLoaded(true);
      blockRevision.current += 1;
      setDirty(true);
    }
    if (page?.translationsJson) {
      try {
        const tj = page.translationsJson as Record<string, unknown>;
        for (const [loc, data] of Object.entries(tj)) {
          if (Array.isArray(data)) {
            translationsRef.current[loc] = normalizeBlocks(data as PageBlock[]);
          } else if (data && typeof data === "object" && "blocks" in (data as Record<string, unknown>)) {
            translationsRef.current[loc] = normalizeBlocks((data as { blocks: PageBlock[] }).blocks);
          }
        }
      } catch {}
    }
  }, [blocksFetched, savedBlocks, page]);

  // Hot updates and long-lived editor tabs can retain an older managed-page
  // starter in memory. Upgrade only recognized legacy compositions; custom
  // page structures are intentionally left untouched.
  useEffect(() => {
    if (!blocksInitialized.current || !page || !isSystemManagedPage(page)) return;
    const enriched = normalizeBlocks(enrichManagedPageBlocks(page.template, blocks, page.locale as Language));
    if (enriched.length <= blocks.length) return;
    setBlocks(enriched);
    defaultBlocksRef.current = JSON.parse(JSON.stringify(enriched));
    setStarterLoaded(true);
    setSelectedBlockIdx(current => current ?? 0);
    blockRevision.current += 1;
    setDirty(true);
  }, [blocks, page]);

  useEffect(() => {
    if (!page || !blocksInitialized.current || !isSystemManagedPage(page) || page.template === "home" || managedTranslationsSeeded.current === page.id) return;
    const expected = managedPageStarterBlocks(page.template, page.locale as Language);
    if (expected.length !== blocks.length || expected.some((entry, index) => entry.blockType !== blocks[index]?.blockType)) return;
    managedTranslationsSeeded.current = page.id;
    let active = true;
    void managedPageStarterTranslations(page.template, page.locale as Language).then(starters => {
      if (!active) return;
      let changed = false;
      for (const [locale, value] of Object.entries(starters)) {
        if ((translationsRef.current[locale]?.length ?? 0) > 0) continue;
        translationsRef.current[locale] = normalizeBlocks(value.blocks);
        changed = true;
      }
      if (!changed) return;
      bumpTranslationCoverage(value => value + 1);
      setStarterLoaded(true);
      markDirty();
    });
    return () => { active = false; };
  }, [blocks, markDirty, page]);

  const { data: seoData, isSuccess: seoFetched, isError: seoError, refetch: reloadSeo } = useQuery<Record<string, unknown>>({
    queryKey: ["website-page-seo", id],
    queryFn: () => customFetch(`/api/website/pages/${id}/seo`),
    enabled: !!page,
  });

  const { data: globalSettings } = useQuery<Record<string, unknown>>({
    queryKey: ["global-settings"],
    queryFn: () => customFetch("/api/settings"),
    staleTime: 60_000,
  });
  const globalSeo = {
    metaTitle: (globalSettings?.seoMetaTitle as string) || "",
    metaDescription: (globalSettings?.seoMetaDescription as string) || "",
    ogImageUrl: (globalSettings?.ogImageUrl as string) || "",
    siteName: (globalSettings?.siteName as string) || "",
  };

  useEffect(() => {
    if (seoInitialized.current || !seoData) return;
    seoInitialized.current = true;
    const initialSeo = {
      metaTitle: (seoData.metaTitle as string) || "",
      metaDescription: (seoData.metaDescription as string) || "",
      canonicalUrl: (seoData.canonicalUrl as string) || "",
      robotsIndex: seoData.robotsIndex !== false,
      robotsFollow: seoData.robotsFollow !== false,
      ogTitle: (seoData.ogTitle as string) || "",
      ogDescription: (seoData.ogDescription as string) || "",
      ogImageUrl: (seoData.ogImageUrl as string) || "",
      twitterTitle: (seoData.twitterTitle as string) || "",
      twitterDescription: (seoData.twitterDescription as string) || "",
      twitterImageUrl: (seoData.twitterImageUrl as string) || "",
      slug: (seoData.slug as string) || "",
    };
    setSeo(initialSeo);
    setSavedSeo(JSON.stringify(initialSeo));
  }, [seoData]);

  const saveSeoMutation = useMutation({
    mutationFn: async () => {
      const snapshot = JSON.stringify(seo);
      const result = await customFetch(`/api/website/pages/${id}/seo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: snapshot,
      }) as WebsitePage;
      return { snapshot, result };
    },
    onSuccess: ({ snapshot, result }) => {
      if (result.updatedAt) serverRevision.current = result.updatedAt;
      setSavedSeo(snapshot);
      queryClient.invalidateQueries({ queryKey: ["website-page-seo", id] });
      toast({ title: copy("SEO settings saved", "SEO ayarları kaydedildi") });
      if (JSON.stringify(seo) === snapshot) setSeoOpen(false);
    },
    onError: () => toast({ title: copy("Error", "Hata"), description: copy("Failed to save SEO settings. Your changes are still here.", "SEO ayarları kaydedilemedi. Değişiklikleriniz korunuyor."), variant: "destructive" }),
  });

  function buildTranslationsPayload() {
    const existing = (page?.translationsJson as Record<string, unknown>) || {};
    const result: Record<string, unknown> = { ...existing };
    for (const [loc, blockArr] of Object.entries(translationsRef.current)) {
      const prev = (result[loc] && typeof result[loc] === "object") ? result[loc] as Record<string, unknown> : {};
      result[loc] = { ...prev, blocks: blockArr };
    }
    if (editLocale !== sourceLocale) {
      const prev = (result[editLocale] && typeof result[editLocale] === "object") ? result[editLocale] as Record<string, unknown> : {};
      result[editLocale] = { ...prev, blocks: blocks.map((b, i) => ({ ...b, sortOrder: i })) };
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const revision = blockRevision.current;
      const payload: Record<string, unknown> = {
        expectedUpdatedAt: serverRevision.current,
        blocks: editLocale === sourceLocale ? blocks.map((b, i) => ({ ...b, sortOrder: i })) : defaultBlocksRef.current.map((b, i) => ({ ...b, sortOrder: i })),
      };
      const tx = buildTranslationsPayload();
      if (tx) payload.translationsJson = tx;
      const result = await customFetch(`/api/website/pages/${id}/save-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }) as { page: WebsitePage; blocks: PageBlock[] };
      return { revision, result };
    },
    onSuccess: ({ revision, result }) => {
      serverRevision.current = result.page.updatedAt;
      setRevisionConflict(false);
      queryClient.invalidateQueries({ queryKey: ["website-page", id] });
      queryClient.invalidateQueries({ queryKey: ["website-page-blocks", id] });
      queryClient.invalidateQueries({ queryKey: ["website-page-versions", id] });
      queryClient.invalidateQueries({ queryKey: ["website-pages"] });
      if (blockRevision.current === revision) setDirty(false);
      setStarterLoaded(false);
      toast({ title: copy("Draft saved", "Taslak kaydedildi") });
    },
    onError: (error) => {
      const conflict = error instanceof ApiError && error.status === 409;
      setRevisionConflict(conflict);
      toast({ title: conflict ? copy("A newer version exists", "Daha yeni bir sürüm var") : copy("Error", "Hata"), description: conflict ? copy("Another administrator changed this page. Your edits are preserved; reload the saved version before retrying.", "Başka bir yönetici bu sayfayı değiştirdi. Düzenlemeleriniz korunuyor; yeniden denemeden önce kayıtlı sürümü yenileyin.") : copy("Failed to save draft. Your changes are still here.", "Taslak kaydedilemedi. Değişiklikleriniz korunuyor."), variant: "destructive" });
    },
  });

  const requestReviewMutation = useMutation({
    mutationFn: async () => customFetch(`/api/website/pages/${id}/request-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: serverRevision.current }),
    }) as Promise<WebsitePage>,
    onSuccess: (result) => {
      serverRevision.current = result.updatedAt;
      setRevisionConflict(false);
      queryClient.setQueryData(["website-page", id], result);
      queryClient.invalidateQueries({ queryKey: ["website-pages"] });
      toast({ title: copy("Sent for review", "İncelemeye gönderildi"), description: copy("A different administrator must approve this exact saved revision.", "Bu kayıtlı sürümü farklı bir yönetici onaylamalıdır.") });
    },
    onError: (error) => {
      const conflict = error instanceof ApiError && error.status === 409;
      const blocked = error instanceof ApiError && error.status === 422;
      setRevisionConflict(conflict);
      toast({ title: conflict ? copy("A newer version exists", "Daha yeni bir sürüm var") : blocked ? copy("Publication blockers remain", "Yayın engelleri bulunuyor") : copy("Could not send for review", "İncelemeye gönderilemedi"), description: conflict ? copy("Reload the saved page before retrying.", "Yeniden denemeden önce kayıtlı sayfayı yenileyin.") : blocked ? copy("Run the publication readiness check and resolve its blocking items.", "Yayın öncesi kontrolü çalıştırıp engelleyici maddeleri düzeltin.") : copy("Your draft remains saved.", "Taslağınız kayıtlı kalır."), variant: "destructive" });
    },
  });

  const preflightMutation = useMutation({
    mutationFn: async () => {
      if (dirty || seoDirty) throw new Error("UNSAVED_CHANGES");
      return customFetch(`/api/website/pages/${id}/publication-preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: serverRevision.current }),
      }) as Promise<PublicationPreflight>;
    },
    onSuccess: result => {
      setPreflight(result);
      setPreflightOpen(true);
    },
    onError: error => {
      const conflict = error instanceof ApiError && error.status === 409;
      setRevisionConflict(conflict);
      toast({
        title: conflict ? copy("A newer version exists", "Daha yeni bir sürüm var") : copy("Readiness check failed", "Yayın kontrolü başarısız"),
        description: error instanceof Error && error.message === "UNSAVED_CHANGES" ? copy("Save all changes before the publication check.", "Yayın kontrolünden önce tüm değişiklikleri kaydedin.") : copy("Reload the saved page and retry.", "Kayıtlı sayfayı yenileyip tekrar deneyin."),
        variant: "destructive",
      });
    },
  });

  const downloadPreflightReceipt = () => {
    if (!preflight) return;
    const href = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, pageId: id, ...preflight }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `page-${id}-publication-preflight-${preflight.digest.slice(0, 12)}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (dirty || seoDirty) throw new Error("UNSAVED_CHANGES");
      return customFetch(`/api/website/pages/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true, expectedUpdatedAt: serverRevision.current, preflightDigest: preflight?.digest }),
      }) as Promise<{ page: WebsitePage; version: PageVersion }>;
    },
    onSuccess: (result) => {
      setPreflightOpen(false);
      setPreflight(null);
      serverRevision.current = result.page.updatedAt;
      setRevisionConflict(false);
      queryClient.invalidateQueries({ queryKey: ["website-page", id] });
      queryClient.invalidateQueries({ queryKey: ["website-page-blocks", id] });
      queryClient.invalidateQueries({ queryKey: ["website-page-versions", id] });
      queryClient.invalidateQueries({ queryKey: ["website-pages"] });
      toast({ title: copy("Published!", "Yayınlandı!"), description: copy("Page is now live.", "Sayfa artık yayında.") });
    },
    onError: (error) => {
      const conflict = error instanceof ApiError && error.status === 409;
      const reviewer = error instanceof ApiError && error.status === 403;
      setRevisionConflict(conflict);
      toast({ title: conflict ? copy("A newer version exists", "Daha yeni bir sürüm var") : reviewer ? copy("Different reviewer required", "Farklı bir inceleyen gerekli") : copy("Error", "Hata"), description: conflict ? copy("Another administrator changed this page. Reload before publishing.", "Başka bir yönetici bu sayfayı değiştirdi. Yayınlamadan önce yenileyin.") : reviewer ? copy("The author cannot approve their own revision.", "Yazar kendi sürümünü onaylayamaz.") : error instanceof Error && error.message === "UNSAVED_CHANGES" ? copy("Save the draft before sending it through review.", "İnceleme akışına geçmeden önce taslağı kaydedin.") : copy("Failed to publish.", "Yayınlanamadı."), variant: "destructive" });
    },
  });

  function handleLocaleSwitch(newLocale: string) {
    if (newLocale === editLocale) return;
    if (editLocale === sourceLocale) {
      defaultBlocksRef.current = JSON.parse(JSON.stringify(blocks));
    } else {
      translationsRef.current[editLocale] = JSON.parse(JSON.stringify(blocks));
    }
    if (newLocale === sourceLocale) {
      setBlocks(JSON.parse(JSON.stringify(defaultBlocksRef.current)));
    } else {
      const translated = translationsRef.current[newLocale];
      if (translated && translated.length > 0) {
        setBlocks(JSON.parse(JSON.stringify(translated)));
      } else {
        const clonedBlocks = JSON.parse(JSON.stringify(defaultBlocksRef.current));
        setBlocks(clonedBlocks);
        toast({ title: copy("No translation yet", "Henüz çeviri yok"), description: copy(`Showing source (${sourceLocale}) content. Edit to create translation.`, `Kaynak (${sourceLocale}) içerik gösteriliyor. Çeviri oluşturmak için düzenleyin.`) });
      }
    }
    setEditLocale(newLocale);
    setSelectedBlockIdx(null);
    markDirty();
  }

  const restoreMutation = useMutation({
    mutationFn: async (versionId: number) => {
      const revision = blockRevision.current;
      const result = await customFetch(`/api/website/pages/${id}/restore-version/${versionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }) as { page: WebsitePage; blocks: PageBlock[] };
      return { result, revision };
    },
    onSuccess: ({ result, revision }) => {
      if (blockRevision.current !== revision) {
        toast({ title: copy("Your newer edits are still here", "Yeni düzenlemeleriniz korunuyor"), description: copy("The restored draft was saved, but newer local edits were not replaced. Save them when ready.", "Geri yüklenen taslak kaydedildi; daha yeni yerel düzenlemeleriniz değiştirilmedi. Hazır olduğunuzda kaydedin.") });
        return;
      }
      const restoredBlocks = normalizeBlocks(result.blocks.map((b, i) => ({
        id: b.id,
        blockType: b.blockType,
        content: (b.content || {}) as Record<string, unknown>,
        settings: (b.settings || {}) as Record<string, unknown>,
        sortOrder: b.sortOrder ?? i,
        isVisible: b.isVisible ?? true,
      })));
      setBlocks(restoredBlocks);
      defaultBlocksRef.current = JSON.parse(JSON.stringify(restoredBlocks));
      translationsRef.current = {};
      for (const [locale, value] of Object.entries((result.page?.translationsJson || {}) as Record<string, unknown>)) {
        if (Array.isArray(value)) translationsRef.current[locale] = normalizeBlocks(value as PageBlock[]);
        else if (value && typeof value === "object" && Array.isArray((value as { blocks?: unknown }).blocks)) translationsRef.current[locale] = normalizeBlocks((value as { blocks: PageBlock[] }).blocks);
      }
      setEditLocale(result.page?.locale || sourceLocale);
      setSelectedBlockIdx(null);
      blockRevision.current += 1;
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["website-page", id] });
      queryClient.invalidateQueries({ queryKey: ["website-page-blocks", id] });
      toast({ title: copy("Version restored", "Sürüm geri yüklendi"), description: copy("Loaded as a new draft.", "Yeni taslak olarak yüklendi.") });
    },
    onError: () => toast({ title: copy("Error", "Hata"), description: copy("Failed to restore version.", "Sürüm geri yüklenemedi."), variant: "destructive" }),
  });

  const addBlock = useCallback((blockType: string) => {
    const newBlock: PageBlock = normalizeBlockAppearance({
      blockType,
      content: getDefaultContent(blockType),
      settings: {},
      sortOrder: blocks.length,
      isVisible: true,
    });
    setBlocks(prev => [...prev, newBlock]);
    setSelectedBlockIdx(blocks.length);
    setMobilePane("editor");
    setShowAddBlock(false);
    setBlockSearch("");
    setBlockCategory("all");
    markDirty();
  }, [blocks.length, markDirty]);

  const removeBlock = useCallback((idx: number) => {
    setBlocks(prev => prev.filter((_, i) => i !== idx));
    if (selectedBlockIdx === idx) setSelectedBlockIdx(null);
    else if (selectedBlockIdx !== null && selectedBlockIdx > idx) setSelectedBlockIdx(selectedBlockIdx - 1);
    markDirty();
  }, [selectedBlockIdx, markDirty]);

  const duplicateBlock = useCallback((idx: number) => {
    setBlocks(prev => {
      const copy = { ...prev[idx], content: { ...prev[idx].content }, settings: { ...prev[idx].settings }, id: undefined };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    markDirty();
  }, [markDirty]);

  const moveBlock = useCallback((idx: number, dir: -1 | 1) => {
    setBlocks(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    if (selectedBlockIdx === idx) setSelectedBlockIdx(idx + dir);
    markDirty();
  }, [selectedBlockIdx, markDirty]);

  const toggleVisibility = useCallback((idx: number) => {
    setBlocks(prev => prev.map((b, i) => i === idx ? { ...b, isVisible: !b.isVisible } : b));
    markDirty();
  }, [markDirty]);

  const updateBlockContent = useCallback((idx: number, key: string, value: unknown) => {
    setBlocks(prev => prev.map((b, i) => i === idx ? { ...b, content: { ...b.content, [key]: value } } : b));
    markDirty();
  }, [markDirty]);

  const updateBlockAppearance = useCallback((idx: number, key: string, value: unknown) => {
    const apply = (items: PageBlock[]) => items.map((block, index) => index === idx
      ? { ...block, settings: { ...block.settings, [key]: value } }
      : block);
    setBlocks(apply);
    defaultBlocksRef.current = apply(defaultBlocksRef.current);
    for (const locale of Object.keys(translationsRef.current)) {
      translationsRef.current[locale] = apply(translationsRef.current[locale]);
    }
    markDirty();
  }, [markDirty]);

  const selectedBlock = selectedBlockIdx !== null ? blocks[selectedBlockIdx] : null;
  const selectedTypeDef = selectedBlock ? getBlockTypeDef(selectedBlock.blockType) : null;
  const latestPublished = versions.find(version => Boolean(version.publishedAt));
  const publishedBlocks = Array.isArray(latestPublished?.blocksSnapshot) ? latestPublished.blocksSnapshot : [];
  const compareRows = Array.from({ length: Math.max(blocks.length, publishedBlocks.length) }, (_, index) => {
    const draftBlock = blocks[index]; const publishedBlock = publishedBlocks[index];
    const status = !publishedBlock ? "added" : !draftBlock ? "removed" : JSON.stringify({ type: draftBlock.blockType, content: draftBlock.content, settings: draftBlock.settings, visible: draftBlock.isVisible }) === JSON.stringify({ type: publishedBlock.blockType, content: publishedBlock.content, settings: publishedBlock.settings, visible: publishedBlock.isVisible }) ? "unchanged" : "changed";
    return { index, draftBlock, publishedBlock, status };
  });
  const publishedMeta = latestPublished?.metaSnapshot ?? {};
  const seoCompareRows = SEO_COMPARISON_FIELDS.map(([key, label]) => ({
    key,
    label,
    published: normalizedSnapshotValue(publishedMeta[key]),
    draft: normalizedSnapshotValue(seo[key]),
  })).filter(row => row.published !== row.draft);
  const publishedTranslations = snapshotTranslations(publishedMeta.translationsJson);
  const translationCompareRows = SUPPORTED_LANGUAGES.map(locale => {
    const draftValue = locale === sourceLocale ? blocks : translationsRef.current[locale];
    const publishedValue = locale === sourceLocale ? publishedBlocks : publishedTranslations[locale];
    const draftAvailable = locale === sourceLocale || (Array.isArray(draftValue) && draftValue.length > 0);
    const publishedAvailable = locale === sourceLocale || (Array.isArray(publishedValue) && publishedValue.length > 0);
    const changed = normalizedSnapshotValue(draftValue) !== normalizedSnapshotValue(publishedValue);
    return { locale, draftAvailable, publishedAvailable, changed };
  }).filter(row => row.changed || row.draftAvailable !== row.publishedAvailable);

  const requestChangesMutation = useMutation({
    mutationFn: async () => customFetch(`/api/website/pages/${id}/request-changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: serverRevision.current, ...changeRequest }),
    }) as Promise<{ page: WebsitePage; receipt: PageVersion }>,
    onSuccess: result => {
      serverRevision.current = result.page.updatedAt;
      setChangesOpen(false);
      setChangeRequest({ reasonCode: "CONTENT", comment: "" });
      queryClient.setQueryData(["website-page", id], result.page);
      queryClient.invalidateQueries({ queryKey: ["website-page-versions", id] });
      queryClient.invalidateQueries({ queryKey: ["website-pages"] });
      toast({ title: copy("Changes requested", "Değişiklik istendi"), description: copy("The review receipt was saved and the page returned to draft.", "İnceleme makbuzu kaydedildi ve sayfa taslağa döndürüldü.") });
    },
    onError: error => {
      const conflict = error instanceof ApiError && error.status === 409;
      const reviewer = error instanceof ApiError && error.status === 403;
      setRevisionConflict(conflict);
      toast({ title: conflict ? copy("A newer version exists", "Daha yeni bir sürüm var") : reviewer ? copy("Different reviewer required", "Farklı bir inceleyen gerekli") : copy("Could not request changes", "Değişiklik talebi kaydedilemedi"), variant: "destructive" });
    },
  });
  const saving = saveDraftMutation.isPending || requestReviewMutation.isPending || preflightMutation.isPending || publishMutation.isPending || requestChangesMutation.isPending || saveSeoMutation.isPending || restoreMutation.isPending;
  savingRef.current = saving;
  const changedCount = compareRows.filter(row => row.status !== "unchanged").length + seoCompareRows.length + translationCompareRows.length;
  const translatedLocaleCount = SUPPORTED_LANGUAGES.filter(locale => locale === sourceLocale || (translationsRef.current[locale]?.length ?? 0) > 0).length;

  if (pageLoading) {
    return (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
    );
  }

  if (!page) {
    return (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-muted-foreground">{copy("Page not found.", "Sayfa bulunamadı.")}</p>
          <Button variant="link" onClick={leaveEditor}>
            {copy("Back to Pages", "Sayfalara dön")}
          </Button>
        </div>
    );
  }

  async function refreshEditorContent() {
    if (savingRef.current) return;
    if (unsavedRef.current && !window.confirm(copy("Reload the saved page and discard unsaved changes in this editor?", "Kayıtlı sayfa yeniden yüklensin ve bu editördeki kaydedilmemiş değişiklikler silinsin mi?"))) return;
    const [pageResult, blockResult] = await Promise.all([reloadPage(), reloadBlocks()]);
    const latestPage = pageResult.data || page;
    if (!latestPage || blockResult.error || !Array.isArray(blockResult.data)) {
      toast({ title: copy("Content could not be refreshed", "İçerik yenilenemedi"), description: copy("Your current editor content is still available.", "Mevcut editör içeriğiniz korunuyor."), variant: "destructive" });
      return;
    }
    const persisted = normalizeBlocks(blockResult.data.map((entry, index) => ({
      id: entry.id,
      blockType: entry.blockType,
      content: (entry.content || {}) as Record<string, unknown>,
      settings: (entry.settings || {}) as Record<string, unknown>,
      sortOrder: entry.sortOrder ?? index,
      isVisible: entry.isVisible ?? true,
    })));
    const starter = persisted.length === 0 && isSystemManagedPage(latestPage)
      ? normalizeBlocks(managedPageStarterBlocks(latestPage.template, latestPage.locale as Language))
      : [];
    const base = persisted.length > 0 ? persisted : starter;
    const refreshed = isSystemManagedPage(latestPage)
      ? normalizeBlocks(enrichManagedPageBlocks(latestPage.template, base, latestPage.locale as Language))
      : base;
    const generatedStructure = starter.length > 0 || refreshed.length > persisted.length;
    setBlocks(refreshed);
    defaultBlocksRef.current = JSON.parse(JSON.stringify(refreshed));
    translationsRef.current = {};
    for (const [locale, value] of Object.entries((latestPage.translationsJson || {}) as Record<string, unknown>)) {
      if (Array.isArray(value)) translationsRef.current[locale] = normalizeBlocks(value as PageBlock[]);
      else if (value && typeof value === "object" && Array.isArray((value as { blocks?: unknown }).blocks)) translationsRef.current[locale] = normalizeBlocks((value as { blocks: PageBlock[] }).blocks);
    }
    serverRevision.current = latestPage.updatedAt;
    setEditLocale(latestPage.locale || "en");
    setSelectedBlockIdx(refreshed.length > 0 ? 0 : null);
    setStarterLoaded(generatedStructure);
    setRevisionConflict(false);
    blockRevision.current += 1;
    setDirty(generatedStructure);
    toast({ title: copy("Page content refreshed", "Sayfa içeriği yenilendi"), description: generatedStructure ? copy("The complete editable Home structure is ready. Save it to keep the new sections.", "Home sayfasının tüm düzenlenebilir yapısı hazır. Yeni bölümleri korumak için kaydedin.") : copy("The latest saved content is now open.", "En son kaydedilen içerik açıldı.") });
  }

  if (!blocksInitialized.current) {
    return <div className="p-6 space-y-3" role={blocksError ? "alert" : "status"}>
      <p>{blocksError ? copy("Page content could not be loaded. Retry before editing.", "Sayfa içeriği yüklenemedi. Düzenlemeden önce yeniden deneyin.") : copy("Loading page content...", "Sayfa içeriği yükleniyor...")}</p>
      {blocksError && <Button onClick={() => reloadBlocks()}>{copy("Retry", "Yeniden dene")}</Button>}
      <Button variant="outline" onClick={leaveEditor}>{copy("Back to Pages", "Sayfalara dön")}</Button>
    </div>;
  }

  return (
      <div className="flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden bg-muted/20">
        {starterLoaded && <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-950">
          <div><strong>{copy("Current page structure loaded", "Mevcut sayfa yapısı yüklendi")}</strong><span className="ms-2">{copy("Every section below is now editable. Save the draft to keep this CMS version; the public page is unchanged until the governed publication step is completed.", "Aşağıdaki her bölüm artık düzenlenebilir. Bu CMS sürümünü korumak için taslağı kaydedin; kontrollü yayın adımı tamamlanana kadar public sayfa değişmez.")}</span></div>
          <Button size="sm" onClick={() => saveDraftMutation.mutate()} disabled={saving}>{copy("Save editable structure", "Düzenlenebilir yapıyı kaydet")}</Button>
        </div>}
        {blocksError && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>{copy("Page content could not be refreshed. Your current edits are preserved.", "Sayfa içeriği yenilenemedi. Mevcut düzenlemeleriniz korunuyor.")}</p>
          <Button variant="outline" size="sm" disabled={blocksRefreshing} onClick={() => reloadBlocks()}>{copy("Retry content loading", "İçeriği yeniden yükle")}</Button>
        </div>}
        {revisionConflict && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-red-300 bg-red-50 p-3 text-sm text-red-950">
          <div>
            <p className="font-semibold">{copy("A newer saved version exists", "Daha yeni kaydedilmiş bir sürüm var")}</p>
            <p>{copy("Your local edits have not been overwritten. Open the saved page in another tab to compare, then reload only when you are ready.", "Yerel düzenlemelerinizin üzerine yazılmadı. Karşılaştırmak için kayıtlı sayfayı başka sekmede açın; yalnız hazır olduğunuzda bu sayfayı yenileyin.")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => window.open(`/admin/website/pages/${id}/edit`, "_blank", "noopener,noreferrer")}>{copy("Open saved copy", "Kayıtlı kopyayı aç")}</Button>
            <Button variant="destructive" size="sm" onClick={() => { if (window.confirm(copy("Reload and discard the local edits in this tab?", "Bu sekmedeki yerel düzenlemeler silinerek sayfa yenilensin mi?"))) window.location.reload(); }}>{copy("Reload this editor", "Bu editörü yenile")}</Button>
          </div>
        </div>}
        {(dirty || seoDirty || saving) && typeof window !== "undefined" && !supportsPageEditorHistoryGuard(window) && <div role="alert" className="border-b border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          {copy("This browser cannot reliably protect unsaved changes when using Back or Forward. Save your changes before using browser history.", "Bu tarayıcıda Geri/İleri düğmeleri kaydedilmemiş değişiklikleri güvenilir biçimde koruyamaz. Tarayıcı geçmişini kullanmadan önce değişikliklerinizi kaydedin.")}
        </div>}
        <div className="min-h-16 border-b bg-card/95 backdrop-blur flex flex-wrap gap-3 items-center justify-between px-4 py-3 shrink-0 shadow-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Button aria-label={copy("Back to pages", "Sayfalara dön")} disabled={saving} variant="ghost" size="icon" className="h-8 w-8" onClick={leaveEditor}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary"><Layers3 className="h-3 w-3" />{copy("Managed page editor", "Yönetilen sayfa editörü")}</p>
              <h2 className="mt-0.5 truncate text-base font-semibold">{page.title}</h2>
            </div>
            <Badge variant={page.status === "published" ? "default" : "secondary"} className="text-xs">
              {page.status === "published" ? copy("Published", "Yayında") : page.status === "draft" ? copy("Draft", "Taslak") : page.status === "in_review" ? copy("Awaiting review", "İnceleme bekliyor") : page.status}
            </Badge>
            {(dirty || seoDirty) && <Badge variant="outline" role="status" className="text-xs text-amber-600 border-amber-300">{copy("Unsaved", "Kaydedilmedi")}{seoDirty ? " (SEO)" : ""}</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={editLocale} onValueChange={handleLocaleSwitch}>
              <SelectTrigger aria-label={copy("Editing language", "İçerik dili")} className="h-7 w-[100px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map(code => (
                  <SelectItem key={code} value={code}>{LANGUAGE_META[code].flag} {LANGUAGE_META[code].nativeName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Sheet open={translationsOpen} onOpenChange={setTranslationsOpen}>
              <SheetTrigger asChild><Button variant="outline" size="sm" className="h-7 text-xs">{copy("Languages", "Diller")} {translatedLocaleCount}/{SUPPORTED_LANGUAGES.length}</Button></SheetTrigger>
              <SheetContent className="w-full sm:max-w-md">
                <SheetHeader><SheetTitle>{copy("Translation coverage", "Çeviri kapsamı")}</SheetTitle></SheetHeader>
                <p className="mt-3 text-sm text-muted-foreground">{copy("Missing languages show source content as fallback and must remain noindex until translated and reviewed.", "Eksik diller kaynak içeriği fallback olarak gösterir; çevrilip incelenene kadar noindex kalmalıdır.")}</p>
                <ScrollArea className="mt-4 h-[calc(100dvh-130px)] pe-3"><div className="space-y-2 pb-8">{SUPPORTED_LANGUAGES.map(locale => {
                  const source = locale === sourceLocale;
                  const hasTranslation = source || (translationsRef.current[locale]?.length ?? 0) > 0;
                  return <button type="button" key={locale} className="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-start hover:border-primary" onClick={() => { handleLocaleSwitch(locale); setTranslationsOpen(false); }}><span><strong className="text-sm">{LANGUAGE_META[locale].flag} {LANGUAGE_META[locale].nativeName}</strong><span className="mt-0.5 block text-xs text-muted-foreground">{source ? copy("Source language", "Kaynak dil") : hasTranslation ? copy("Translation draft available", "Çeviri taslağı var") : copy("Source fallback · noindex", "Kaynak fallback · noindex")}</span></span><Badge variant={source ? "default" : hasTranslation ? "secondary" : "outline"}>{source ? copy("Source", "Kaynak") : hasTranslation ? copy("Draft", "Taslak") : copy("Missing", "Eksik")}</Badge></button>;
                })}</div></ScrollArea>
              </SheetContent>
            </Sheet>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center border rounded-md">
              {(["desktop", "tablet", "mobile"] as PreviewSize[]).map(size => (
                <Button
                  key={size}
                  aria-label={copy(`${size} preview width`, `${size === "desktop" ? "Masaüstü" : size === "tablet" ? "Tablet" : "Mobil"} önizleme genişliği`)}
                  aria-pressed={previewSize === size}
                  variant={previewSize === size ? "default" : "ghost"}
                  size="icon"
                  className="h-7 w-7 rounded-none first:rounded-l-md last:rounded-r-md"
                  onClick={() => setPreviewSize(size)}
                >
                  {size === "desktop" ? <Monitor className="w-3.5 h-3.5" /> : size === "tablet" ? <Tablet className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
                </Button>
              ))}
            </div>
            <Button asChild variant="outline" size="sm" className="h-7 gap-1 text-xs">
              <a href={managedPagePublicPath({ ...page, locale: editLocale, slug: seo.slug || page.slug })} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" />{copy("Open page", "Sayfayı aç")}</a>
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={blocksRefreshing || saving} onClick={refreshEditorContent}>
              <RefreshCw className={`h-3.5 w-3.5 ${blocksRefreshing ? "animate-spin" : ""}`} />{copy("Refresh content", "İçeriği yenile")}
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <Sheet open={seoOpen} onOpenChange={setSeoOpen}>
              <SheetTrigger asChild>
                <Button disabled={!seoFetched} variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <Settings2 className="w-3.5 h-3.5" /> SEO
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>{copy("Page SEO Settings", "Sayfa SEO ayarları")}</SheetTitle>
                </SheetHeader>
                <ScrollArea className="h-[calc(100vh-80px)] mt-4 pr-2">
                <div className="space-y-4 pb-6">
                  <div className="space-y-1.5">
                    <Label htmlFor="page-seo-slug" className="text-xs font-medium">{copy("URL Slug", "Sayfa adresi")}</Label>
                    <Input id="page-seo-slug" value={seo.slug} onChange={e => setSeo(s => ({ ...s, slug: e.target.value }))} placeholder={copy("page-url-slug", "sayfa-adresi")} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="page-seo-title" className="text-xs font-medium">{copy("Meta Title", "SEO başlığı")}</Label>
                    <Input id="page-seo-title" value={seo.metaTitle} onChange={e => setSeo(s => ({ ...s, metaTitle: e.target.value }))} placeholder={copy("SEO page title", "SEO sayfa başlığı")} className="h-8 text-sm" />
                    <p className="text-[10px] text-muted-foreground">{seo.metaTitle.length}/60 {copy("characters", "karakter")}</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="page-seo-description" className="text-xs font-medium">{copy("Meta Description", "SEO açıklaması")}</Label>
                    <Textarea id="page-seo-description" value={seo.metaDescription} onChange={e => setSeo(s => ({ ...s, metaDescription: e.target.value }))} placeholder={copy("SEO description", "SEO açıklaması")} rows={3} className="text-sm" />
                    <p className="text-[10px] text-muted-foreground">{seo.metaDescription.length}/160 {copy("characters", "karakter")}</p>
                  </div>
                  <div className="rounded border p-3 bg-muted/30">
                    <p className="text-[10px] text-muted-foreground mb-1">{copy("Google Search Preview", "Google arama önizlemesi")}</p>
                    <p className="text-sm text-blue-700 truncate">{seo.metaTitle || page?.title || globalSeo.metaTitle || "Page Title"}</p>
                    <p className="text-xs text-green-700 truncate">{globalSeo.siteName ? globalSeo.siteName.toLowerCase().replace(/\s+/g, '') + '.com' : 'findandstudy.com'}/{seo.slug || page?.slug || ""}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{seo.metaDescription || globalSeo.metaDescription || copy("No description set", "Açıklama eklenmedi")}</p>
                    {!seo.metaTitle && !seo.metaDescription && globalSeo.metaTitle && (
                      <p className="text-[10px] text-amber-600 mt-1">{copy("Using global SEO defaults from Settings.", "Ayarlar bölümündeki genel SEO değerleri kullanılıyor.")}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="page-seo-canonical" className="text-xs font-medium">{copy("Canonical URL", "Kanonik adres")}</Label>
                    <Input id="page-seo-canonical" value={seo.canonicalUrl} onChange={e => setSeo(s => ({ ...s, canonicalUrl: e.target.value }))} placeholder="https://..." className="h-8 text-sm" />
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch id="page-seo-index" checked={seo.robotsIndex} onCheckedChange={v => setSeo(s => ({ ...s, robotsIndex: v }))} />
                      <Label htmlFor="page-seo-index" className="text-xs">{copy("Index", "Dizine ekle")}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch id="page-seo-follow" checked={seo.robotsFollow} onCheckedChange={v => setSeo(s => ({ ...s, robotsFollow: v }))} />
                      <Label htmlFor="page-seo-follow" className="text-xs">{copy("Follow", "Bağlantıları takip et")}</Label>
                    </div>
                  </div>
                  <Separator />
                  <h4 className="text-xs font-bold uppercase text-muted-foreground">Open Graph</h4>
                  <div className="space-y-1.5">
                    <Label htmlFor="page-seo-og-title" className="text-xs font-medium">{copy("OG Title", "Paylaşım başlığı (OG)")}</Label>
                    <Input id="page-seo-og-title" value={seo.ogTitle} onChange={e => setSeo(s => ({ ...s, ogTitle: e.target.value }))} placeholder={copy("Social share title", "Sosyal paylaşım başlığı")} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="page-seo-og-description" className="text-xs font-medium">{copy("OG Description", "Paylaşım açıklaması (OG)")}</Label>
                    <Textarea id="page-seo-og-description" value={seo.ogDescription} onChange={e => setSeo(s => ({ ...s, ogDescription: e.target.value }))} placeholder={copy("Social share description", "Sosyal paylaşım açıklaması")} rows={2} className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="page-seo-og-image" className="text-xs font-medium">{copy("OG Image URL", "Paylaşım görseli adresi (OG)")}</Label>
                    <Input id="page-seo-og-image" value={seo.ogImageUrl} onChange={e => setSeo(s => ({ ...s, ogImageUrl: e.target.value }))} placeholder="https://..." className="h-8 text-sm" />
                  </div>
                  {(seo.ogTitle || seo.ogDescription || seo.ogImageUrl || globalSeo.ogImageUrl) && (
                    <div className="rounded border p-3 bg-muted/30">
                      <p className="text-[10px] text-muted-foreground mb-1">{copy("Social Share Preview", "Sosyal paylaşım önizlemesi")}</p>
                      {(seo.ogImageUrl || globalSeo.ogImageUrl) && <div className="w-full h-24 bg-muted rounded mb-2 flex items-center justify-center text-xs text-muted-foreground overflow-hidden"><img src={seo.ogImageUrl || globalSeo.ogImageUrl} alt="OG" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none" }} /></div>}
                      <p className="text-sm font-medium truncate">{seo.ogTitle || seo.metaTitle || page?.title || globalSeo.metaTitle || "Title"}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">{seo.ogDescription || seo.metaDescription || globalSeo.metaDescription || ""}</p>
                    </div>
                  )}
                  <Separator />
                  <h4 className="text-xs font-bold uppercase text-muted-foreground">{copy("Twitter Card", "Twitter kartı")}</h4>
                  <div className="space-y-1.5">
                    <Label htmlFor="page-seo-twitter-title" className="text-xs font-medium">{copy("Twitter Title", "Twitter başlığı")}</Label>
                    <Input id="page-seo-twitter-title" value={seo.twitterTitle} onChange={e => setSeo(s => ({ ...s, twitterTitle: e.target.value }))} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="page-seo-twitter-description" className="text-xs font-medium">{copy("Twitter Description", "Twitter açıklaması")}</Label>
                    <Textarea id="page-seo-twitter-description" value={seo.twitterDescription} onChange={e => setSeo(s => ({ ...s, twitterDescription: e.target.value }))} rows={2} className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="page-seo-twitter-image" className="text-xs font-medium">{copy("Twitter Image URL", "Twitter görseli adresi")}</Label>
                    <Input id="page-seo-twitter-image" value={seo.twitterImageUrl} onChange={e => setSeo(s => ({ ...s, twitterImageUrl: e.target.value }))} placeholder="https://..." className="h-8 text-sm" />
                  </div>
                  <Button onClick={() => saveSeoMutation.mutate()} disabled={saveSeoMutation.isPending} className="w-full">
                    {saveSeoMutation.isPending ? copy("Saving...", "Kaydediliyor...") : copy("Save SEO Settings", "SEO ayarlarını kaydet")}
                  </Button>
                </div>
                </ScrollArea>
              </SheetContent>
            </Sheet>
            {seoError && <Button variant="outline" size="sm" onClick={() => reloadSeo()}>{copy("Retry SEO loading", "SEO yüklemeyi yeniden dene")}</Button>}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <History className="w-3.5 h-3.5" /> {copy("Versions", "Sürümler")} ({versions.length})
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>{copy("Version History", "Sürüm geçmişi")}</SheetTitle>
                </SheetHeader>
                <div className="mt-4 space-y-3">
                  {versions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{copy("No published versions yet.", "Henüz yayınlanmış sürüm yok.")}</p>
                  ) : (
                    versions.map(v => {
                      const authorName = v.authorFirstName
                        ? `${v.authorFirstName} ${v.authorLastName || ""}`.trim()
                        : v.authorEmail || "Unknown";
                      const review = v.metaSnapshot?.review && typeof v.metaSnapshot.review === "object" ? v.metaSnapshot.review as { outcome?: string; reasonCode?: string; comment?: string } : null;
                      const revision = v.metaSnapshot?.revision && typeof v.metaSnapshot.revision === "object" ? v.metaSnapshot.revision as { kind?: string } : null;
                      return (
                      <Card key={v.id}>
                        <CardContent className="p-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{review?.outcome === "CHANGES_REQUESTED" ? copy("Changes requested", "Değişiklik istendi") : revision?.kind === "DRAFT_SAVED" ? `${copy("Saved draft", "Kaydedilen taslak")} · ${copy("Version", "Sürüm")} ${v.versionNumber}` : `${copy("Published version", "Yayınlanan sürüm")} ${v.versionNumber}`}</p>
                            <p className="text-xs text-muted-foreground">
                              {v.publishedAt ? new Date(v.publishedAt).toLocaleString() : new Date(v.createdAt).toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">by {authorName}</p>
                            {review && <p className="mt-1 max-w-48 text-xs text-muted-foreground">{review.reasonCode}: {review.comment}</p>}
                          </div>
                          {!review && <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              if (dirty && !window.confirm(copy("Restore this version and replace unsaved block edits?", "Bu sürüm geri yüklenip kaydedilmemiş blok değişiklikleri silinsin mi?"))) return;
                              restoreMutation.mutate(v.id);
                            }}
                            disabled={saving}
                          >
                            <RotateCcw className="w-3 h-3" /> {revision?.kind === "DRAFT_SAVED" ? copy("Restore draft", "Taslağı geri yükle") : copy("Restore", "Geri yükle")}
                          </Button>}
                        </CardContent>
                      </Card>
                      );
                    })
                  )}
                </div>
              </SheetContent>
            </Sheet>
            <Sheet open={compareOpen} onOpenChange={setCompareOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={!latestPublished}>
                  <GitCompareArrows className="w-3.5 h-3.5" /> {copy("Compare", "Karşılaştır")}{latestPublished ? ` (${changedCount})` : ""}
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-xl">
                <SheetHeader><SheetTitle>{copy("Draft compared with published version", "Taslak ve yayındaki sürüm karşılaştırması")}</SheetTitle></SheetHeader>
                {!latestPublished ? <p className="mt-6 text-sm text-muted-foreground">{copy("There is no published version to compare yet.", "Henüz karşılaştırılabilecek yayınlanmış sürüm yok.")}</p> : <ScrollArea className="mt-4 h-[calc(100dvh-90px)] pe-3">
                  <div className="space-y-4 pb-8">
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                      <p className="font-medium">{copy(`Version ${latestPublished.versionNumber}`, `Sürüm ${latestPublished.versionNumber}`)}</p>
                      <p className="text-muted-foreground">{changedCount === 0 ? copy("No content, SEO, or translation changes.", "İçerik, SEO veya çeviri değişikliği yok.") : copy(`${changedCount} content, SEO, or translation differences.`, `${changedCount} içerik, SEO veya çeviri farkı.`)}</p>
                    </div>
                    {seoCompareRows.length > 0 && <section aria-labelledby="seo-comparison-title" className="space-y-2">
                      <h3 id="seo-comparison-title" className="text-sm font-semibold">{copy("SEO and route changes", "SEO ve adres değişiklikleri")}</h3>
                      {seoCompareRows.map(row => <div key={row.key} className="rounded-lg border p-3 text-xs">
                        <strong>{copy(row.label, row.label === "Route" ? "Sayfa adresi" : row.label)}</strong>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2"><div className="rounded bg-muted p-2"><span className="font-medium">{copy("Published", "Yayındaki")}</span><p className="mt-1 break-all text-muted-foreground">{row.published || copy("Empty", "Boş")}</p></div><div className="rounded bg-primary/5 p-2"><span className="font-medium">{copy("Draft", "Taslak")}</span><p className="mt-1 break-all text-muted-foreground">{row.draft || copy("Empty", "Boş")}</p></div></div>
                      </div>)}
                    </section>}
                    {translationCompareRows.length > 0 && <section aria-labelledby="translation-comparison-title" className="space-y-2">
                      <h3 id="translation-comparison-title" className="text-sm font-semibold">{copy("Translation changes", "Çeviri değişiklikleri")}</h3>
                      {translationCompareRows.map(row => <div key={row.locale} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs"><span><strong>{LANGUAGE_META[row.locale].flag} {LANGUAGE_META[row.locale].nativeName}</strong><span className="mt-0.5 block text-muted-foreground">{copy(`Published: ${row.publishedAvailable ? "available" : "fallback"} · Draft: ${row.draftAvailable ? "available" : "fallback"}`, `Yayındaki: ${row.publishedAvailable ? "mevcut" : "fallback"} · Taslak: ${row.draftAvailable ? "mevcut" : "fallback"}`)}</span></span><Badge variant="outline">{copy("Changed", "Değişti")}</Badge></div>)}
                    </section>}
                    {compareRows.map(row => <div key={row.index} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-3"><strong className="text-sm">#{row.index + 1} · {row.draftBlock?.blockType || row.publishedBlock?.blockType || copy("Unknown", "Bilinmiyor")}</strong><Badge variant={row.status === "unchanged" ? "secondary" : row.status === "removed" ? "destructive" : "outline"}>{row.status === "added" ? copy("Added", "Eklendi") : row.status === "removed" ? copy("Removed", "Kaldırıldı") : row.status === "changed" ? copy("Changed", "Değişti") : copy("Unchanged", "Değişmedi")}</Badge></div>
                      {row.status === "changed" && <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div className="rounded bg-muted p-2"><span className="font-medium">{copy("Published", "Yayındaki")}</span><p className="mt-1 text-muted-foreground">{row.publishedBlock?.blockType} · {row.publishedBlock?.isVisible === false ? copy("Hidden", "Gizli") : copy("Visible", "Görünür")}</p></div><div className="rounded bg-primary/5 p-2"><span className="font-medium">{copy("Draft", "Taslak")}</span><p className="mt-1 text-muted-foreground">{row.draftBlock?.blockType} · {row.draftBlock?.isVisible === false ? copy("Hidden", "Gizli") : copy("Visible", "Görünür")}</p></div></div>}
                    </div>)}
                  </div>
                </ScrollArea>}
              </SheetContent>
            </Sheet>
            <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{copy("Publication readiness", "Yayın öncesi kontrol")}</DialogTitle></DialogHeader>
                {preflight && <div className="space-y-4">
                  <div className={`rounded-lg border p-3 text-sm ${preflight.eligible ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-destructive/40 bg-destructive/5"}`}>
                    <strong>{preflight.eligible ? copy("Ready for approval", "Onay için hazır") : copy("Publication is blocked", "Yayın engellendi")}</strong>
                    <p className="mt-1 opacity-80">{preflight.eligible ? copy("No blocking content issues were found. Review the warnings before approving.", "Engelleyici içerik sorunu bulunmadı. Onaylamadan önce uyarıları inceleyin.") : copy("Resolve the blocking items, save the draft, and run the check again.", "Engelleyici maddeleri düzeltin, taslağı kaydedin ve kontrolü yeniden çalıştırın.")}</p>
                  </div>
                  <dl className="grid gap-2 rounded-lg border p-3 text-xs sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">{copy("Public route", "Public adres")}</dt><dd className="mt-1 break-all font-medium">{preflight.publication.route}</dd></div>
                    <div><dt className="text-muted-foreground">Canonical</dt><dd className="mt-1 break-all font-medium">{preflight.publication.canonical}</dd></div>
                    <div><dt className="text-muted-foreground">{copy("Search visibility", "Arama görünürlüğü")}</dt><dd className="mt-1 font-medium">{preflight.publication.indexable ? copy("Indexable", "İndekslenebilir") : "Noindex"}</dd></div>
                    <div><dt className="text-muted-foreground">Sitemap</dt><dd className="mt-1 font-medium">{preflight.publication.sitemapEligible ? copy("Eligible", "Uygun") : copy("Excluded", "Hariç")}</dd></div>
                    <div><dt className="text-muted-foreground">{copy("Revision", "Sürüm")}</dt><dd className="mt-1 break-all font-mono">{preflight.digest.slice(0, 16)}</dd></div>
                    <div><dt className="text-muted-foreground">{copy("Valid until", "Geçerlilik sonu")}</dt><dd className="mt-1 font-medium">{new Date(preflight.expiresAt).toLocaleString(lang)}</dd></div>
                  </dl>
                  {preflight.blockers.length > 0 && <section><h3 className="text-sm font-semibold">{copy("Blocking issues", "Engelleyici sorunlar")}</h3><ul className="mt-2 list-disc space-y-1 ps-5 text-sm">{preflight.blockers.map((issue, index) => <li key={`${issue.code}-${index}`}>{preflightIssueText(issue)} {/^blocks\[\d+\]/.test(issue.message) && <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={() => openPreflightIssue(issue)}>{copy("Open block", "Bloğu aç")}</button>}</li>)}</ul></section>}
                  {preflight.warnings.length > 0 && <section><h3 className="text-sm font-semibold">{copy("Warnings", "Uyarılar")}</h3><ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">{preflight.warnings.map((issue, index) => <li key={`${issue.code}-${index}`}>{preflightIssueText(issue)} {/^blocks\[\d+\]/.test(issue.message) && <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={() => openPreflightIssue(issue)}>{copy("Open block", "Bloğu aç")}</button>}</li>)}</ul></section>}
                  {preflight.blockers.length === 0 && preflight.warnings.length === 0 && <p className="text-sm text-muted-foreground">{copy("All current checks passed.", "Mevcut kontrollerin tamamı geçti.")}</p>}
                  <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={downloadPreflightReceipt}><Download className="me-2 h-4 w-4" />{copy("Download receipt", "Makbuzu indir")}</Button><Button variant="outline" onClick={() => setPreflightOpen(false)}>{copy("Close", "Kapat")}</Button><Button onClick={() => publishMutation.mutate()} disabled={!preflight.eligible || publishMutation.isPending}>{publishMutation.isPending ? copy("Publishing...", "Yayınlanıyor...") : copy("Approve and publish", "Onayla ve yayınla")}</Button></div>
                </div>}
              </DialogContent>
            </Dialog>
            <Dialog open={changesOpen} onOpenChange={setChangesOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{copy("Request changes", "Değişiklik iste")}</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">{copy("The exact reviewed revision and your reason will be kept in version history. The page returns to draft; published content is not changed.", "İncelenen exact sürüm ve nedeniniz sürüm geçmişinde saklanır. Sayfa taslağa döner; yayındaki içerik değişmez.")}</p>
                <div className="space-y-2"><Label htmlFor="change-reason">{copy("Reason", "Neden")}</Label><Select value={changeRequest.reasonCode} onValueChange={reasonCode => setChangeRequest(value => ({ ...value, reasonCode }))}><SelectTrigger id="change-reason"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CONTENT">{copy("Content", "İçerik")}</SelectItem><SelectItem value="SEO">SEO</SelectItem><SelectItem value="TRANSLATION">{copy("Translation", "Çeviri")}</SelectItem><SelectItem value="MEDIA">{copy("Media", "Medya")}</SelectItem><SelectItem value="LEGAL">{copy("Legal / compliance", "Hukuk / uyum")}</SelectItem><SelectItem value="OTHER">{copy("Other", "Diğer")}</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor="change-comment">{copy("What needs to change?", "Nelerin değişmesi gerekiyor?")}</Label><Textarea id="change-comment" maxLength={1000} rows={5} value={changeRequest.comment} onChange={event => setChangeRequest(value => ({ ...value, comment: event.target.value }))} /></div>
                <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setChangesOpen(false)}>{copy("Cancel", "İptal")}</Button><Button variant="destructive" disabled={changeRequest.comment.trim().length < 3 || requestChangesMutation.isPending} onClick={() => requestChangesMutation.mutate()}>{requestChangesMutation.isPending ? copy("Saving...", "Kaydediliyor...") : copy("Return to draft", "Taslağa geri gönder")}</Button></div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => saveDraftMutation.mutate()} disabled={saveDraftMutation.isPending || publishMutation.isPending || restoreMutation.isPending}>
              <Save className="w-3.5 h-3.5" /> {saveDraftMutation.isPending ? copy("Saving...", "Kaydediliyor...") : copy("Save Draft", "Taslağı kaydet")}
            </Button>
            {page.status !== "in_review" ? <Button size="sm" className="h-7 text-xs gap-1" onClick={() => requestReviewMutation.mutate()} disabled={dirty || seoDirty || requestReviewMutation.isPending || saveDraftMutation.isPending || restoreMutation.isPending}>
              <Upload className="w-3.5 h-3.5" /> {requestReviewMutation.isPending ? copy("Sending...", "Gönderiliyor...") : copy("Send for review", "İncelemeye gönder")}
            </Button> : <><Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setChangesOpen(true)} disabled={requestChangesMutation.isPending || publishMutation.isPending}>{copy("Request changes", "Değişiklik iste")}</Button><Button size="sm" className="h-7 text-xs gap-1" onClick={() => preflightMutation.mutate()} disabled={preflightMutation.isPending || publishMutation.isPending || saveDraftMutation.isPending || restoreMutation.isPending}>
              <Upload className="w-3.5 h-3.5" /> {preflightMutation.isPending ? copy("Checking...", "Kontrol ediliyor...") : copy("Review and publish", "İncele ve yayınla")}
            </Button></>}
          </div>
        </div>

        <nav aria-label={copy("Editor panels", "Editör panelleri")} className="grid w-full grid-cols-3 gap-2 border-b p-2 lg:hidden">
          {(["blocks", "editor", "preview"] as const).map(pane => <Button key={pane} className="min-w-0 px-2" size="sm" variant={mobilePane === pane ? "default" : "outline"} aria-pressed={mobilePane === pane} onClick={() => setMobilePane(pane)}>{pane === "blocks" ? (isSystemManagedPage(page) ? copy("Sections", "Bölümler") : copy("Blocks", "Bloklar")) : pane === "editor" ? (isSystemManagedPage(page) ? copy("Edit section", "Bölümü düzenle") : copy("Edit block", "Bloğu düzenle")) : copy("Preview", "Önizleme")}</Button>)}
        </nav>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className={`${mobilePane === "blocks" ? "flex" : "hidden"} min-h-0 w-full lg:w-72 border-e bg-card lg:flex flex-col shrink-0 overflow-hidden`}>
            <div className="p-3 border-b flex items-start justify-between gap-2">
              <div><div className="flex items-center gap-2"><h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{isSystemManagedPage(page) ? copy("Page sections", "Sayfa bölümleri") : copy("Blocks", "Bloklar")}</h3><Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{blocks.length}</Badge></div>{isSystemManagedPage(page) && <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{copy("Build the page, change its order and inspect every section.", "Sayfayı oluşturun, sıralamayı değiştirin ve her bölümü inceleyin.")}</p>}</div>
              <Dialog open={showAddBlock} onOpenChange={setShowAddBlock}>
                <DialogTrigger asChild>
                  <Button aria-label={copy("Add section", "Bölüm ekle")} size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs">
                    <Plus className="w-3.5 h-3.5" />{copy("Add", "Ekle")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
                  <DialogHeader>
                    <div className="border-b px-6 py-5">
                      <DialogTitle>{copy("Section library", "Bölüm kütüphanesi")}</DialogTitle>
                      <p className="mt-1 text-sm text-muted-foreground">{copy("Choose a responsive section. It is added to the end of the page and opens ready to edit.", "Responsive bir bölüm seçin. Sayfanın sonuna eklenir ve düzenlemeye hazır açılır.")}</p>
                    </div>
                  </DialogHeader>
                  <div className="border-b bg-muted/30 px-6 py-4">
                    <div className="relative"><Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={blockSearch} onChange={event => setBlockSearch(event.target.value)} placeholder={copy("Search sections...", "Bölümlerde ara...")} className="ps-9" /></div>
                    <div className="mt-3 flex flex-wrap gap-2">{(["all", "content", "media", "data", "layout", "reference"] as const).map(category => <Button key={category} type="button" size="sm" variant={blockCategory === category ? "default" : "outline"} className="h-7 rounded-full text-xs" onClick={() => setBlockCategory(category)}>{category === "all" ? copy("All", "Tümü") : copy(category[0].toUpperCase() + category.slice(1))}</Button>)}</div>
                  </div>
                  <div className="grid max-h-[58vh] grid-cols-1 gap-3 overflow-y-auto p-6 sm:grid-cols-2 lg:grid-cols-3">
                    {BLOCK_TYPES.filter(bt => (blockCategory === "all" || bt.category === blockCategory) && (!blockSearch.trim() || `${bt.label} ${bt.category}`.toLowerCase().includes(blockSearch.trim().toLowerCase()))).map(bt => (
                      <button
                        key={bt.type}
                        onClick={() => addBlock(bt.type)}
                        className="group flex min-h-28 flex-col items-start rounded-2xl border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
                      >
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-xl transition group-hover:bg-primary group-hover:text-primary-foreground">{bt.icon}</span>
                        <p className="mt-3 text-sm font-semibold">{copy(bt.label)}</p>
                        <p className="mt-1 text-[11px] capitalize text-muted-foreground">{copy(bt.category)} · {bt.fields.length} {copy("settings", "ayar")}</p>
                      </button>
                    ))}
                    {BLOCK_TYPES.filter(bt => (blockCategory === "all" || bt.category === blockCategory) && (!blockSearch.trim() || `${bt.label} ${bt.category}`.toLowerCase().includes(blockSearch.trim().toLowerCase()))).length === 0 && <div className="col-span-full rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">{copy("No section matches this search.", "Bu aramayla eşleşen bölüm yok.")}</div>}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <ScrollArea className="min-h-0 flex-1 overscroll-contain">
              <div className="p-2 space-y-1">
                {blocks.map((block, idx) => {
                  const def = getBlockTypeDef(block.blockType);
                  const hydratedBlock = hydrateCollectionBlock(block, teamMembersQuery.data || [], officesQuery.data || []);
                  const dependency = collectionDependency(hydratedBlock);
                  const dependencyLoading = dependency === "team" ? teamMembersQuery.isLoading : dependency === "offices" ? officesQuery.isLoading : false;
                  const waitingForData = !!dependency && !dependencyLoading && !hasCollectionItems(hydratedBlock);
                  return (
                    <div
                      key={idx}
                      className={`group mb-1.5 flex items-center gap-1 rounded-xl border p-1.5 cursor-pointer transition-all text-sm ${
                        selectedBlockIdx === idx ? "border-primary bg-primary/10 shadow-sm" : "border-transparent hover:border-border hover:bg-secondary/70"
                      } ${!block.isVisible ? "opacity-50" : ""}`}
                    >
                      <GripVertical className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-muted-foreground">{idx + 1}</span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${block.isVisible ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                      <button className="min-w-0 flex-1 py-1.5 text-start" onClick={() => { setSelectedBlockIdx(idx); setMobilePane("editor"); }}><span className="block truncate text-xs font-semibold">{String(block.content.title || block.content.badge || copy(def?.label || block.blockType))}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{copy(def?.label || block.blockType)} · {block.isVisible ? copy("Visible", "Görünür") : copy("Hidden", "Gizli")}{dependencyLoading ? ` · ${copy("Loading data", "Veri yükleniyor")}` : waitingForData ? ` · ${copy("Waiting for collection data", "Koleksiyon verisi bekleniyor")}` : ""}</span></button>
                      <div className="flex items-center gap-0.5">
                        <button aria-label={copy("Move block up")} onClick={e => { e.stopPropagation(); moveBlock(idx, -1); }} className="p-1 hover:bg-secondary rounded" disabled={idx === 0}>
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button aria-label={copy("Move block down")} onClick={e => { e.stopPropagation(); moveBlock(idx, 1); }} className="p-1 hover:bg-secondary rounded" disabled={idx === blocks.length - 1}>
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        <button aria-label={copy(block.isVisible ? "Hide block" : "Show block")} onClick={e => { e.stopPropagation(); toggleVisibility(idx); }} className="p-1 hover:bg-secondary rounded">
                          {block.isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        </button>
                        <button aria-label={copy("Duplicate block")} onClick={e => { e.stopPropagation(); duplicateBlock(idx); }} className="p-1 hover:bg-secondary rounded">
                          <Copy className="w-3 h-3" />
                        </button>
                        <button aria-label={copy("Remove block")} onClick={e => { e.stopPropagation(); removeBlock(idx); }} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 rounded">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {blocks.length === 0 && (
                  <div className="text-center py-8 text-xs text-muted-foreground">
                    <p>{copy("No blocks yet.", "Henüz blok yok.")}</p>
                    <p>{copy("Click + to add your first block.", "İlk bloğu eklemek için + düğmesine basın.")}</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </aside>

          <section className={`${mobilePane === "editor" ? "flex" : "hidden"} min-h-0 w-full lg:w-[420px] border-e bg-background lg:flex flex-col shrink-0 overflow-hidden`}>
            <div className="border-b bg-card/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{selectedBlockIdx !== null ? `${copy("Section", "Bölüm")} ${selectedBlockIdx + 1}` : copy("Section editor", "Bölüm editörü")}</p>
              <h3 className="mt-1 text-sm font-bold">
                {selectedBlock ? `${copy("Edit", "Düzenle")}: ${copy(selectedTypeDef?.label || selectedBlock.blockType)}` : copy("Block Editor", "Blok editörü")}
              </h3>
              {selectedBlock && <p className="mt-1 text-[11px] text-muted-foreground">{copy("Changes appear instantly in the draft preview.", "Değişiklikler taslak önizlemede anında görünür.")}</p>}
            </div>
            {editLocale !== sourceLocale && (
              <div className="mx-3 mt-2 p-2 rounded-lg bg-blue-50 border border-blue-200 text-xs">
                <p className="font-medium text-blue-800 flex items-center gap-1">
                  {LANGUAGE_META[editLocale as keyof typeof LANGUAGE_META]?.flag} {copy("Editing language:", "Düzenleme dili:")} {LANGUAGE_META[editLocale as keyof typeof LANGUAGE_META]?.nativeName || editLocale}
                </p>
                <p className="text-blue-600 mt-0.5">{copy("Content entered here is for this locale's translation.", "Buraya girilen içerik, seçilen dilin çevirisine aittir.")}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={() => {
                    const defaultBlocks = defaultBlocksRef.current;
                    setBlocks(JSON.parse(JSON.stringify(defaultBlocks)));
                    markDirty();
                    toast({ title: copy(`Copied blocks from ${sourceLocale}`, `${sourceLocale} dilindeki bloklar kopyalandı`) });
                  }}>{copy("Copy without translating", "Çevirmeden kopyala")}</Button>
                </div>
              </div>
            )}
            <ScrollArea className="min-h-0 flex-1 overscroll-contain">
              <div className="p-4 space-y-4">
                {!selectedBlock ? (
                  <p className="text-sm text-muted-foreground text-center py-8">{copy("Select a block to edit its content.", "İçeriğini düzenlemek için bir blok seçin.")}</p>
                ) : selectedBlock.blockType === "global_block" ? (
                  <GlobalBlockSelector
                    content={selectedBlock.content}
                    onChange={(key, value) => updateBlockContent(selectedBlockIdx!, key, value)}
                  />
                ) : (
                  <>
                    <BlockFieldEditor
                      fields={selectedBlock.blockType === "catalog_grid" ? (selectedTypeDef?.fields || []).filter(f => !["country", "city", "limit"].includes(f.key)) : selectedTypeDef?.fields || []}
                      content={{ ...selectedBlock.content, ...selectedBlock.settings }}
                      onChange={(key, value) => {
                        if (BLOCK_APPEARANCE_KEYS.has(key)) updateBlockAppearance(selectedBlockIdx!, key, value);
                        else updateBlockContent(selectedBlockIdx!, key, value);
                        if (selectedBlock.blockType === "catalog_grid" && key === "source") for (const filter of ["country", "city", "countryId", "cityId", "universityId", "degree", "language", "institutionType"]) updateBlockContent(selectedBlockIdx!, filter, "");
                      }}
                      variableContext={{ siteName: SITE_NAME, pageTitle: page.title, pageSlug: seo.slug || page.slug, pageLocale: editLocale }}
                    />
                    {selectedBlock.blockType === "catalog_grid" && <CatalogBlockFields content={selectedBlock.content} locale={editLocale} onChange={(key, value) => updateBlockContent(selectedBlockIdx!, key, value)} />}
                  </>
                )}
              </div>
            </ScrollArea>
          </section>

          <section ref={previewHostRef} style={{ scrollbarGutter: "stable" }} className={`${mobilePane === "preview" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.08),transparent_38%)] lg:flex flex-col items-center p-4 overflow-auto overscroll-contain`}>
            <div className="mb-3 flex w-full max-w-7xl shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/95 p-3 text-xs shadow-sm" role="status" aria-label={copy("Preview context", "Önizleme bağlamı")}>
              <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{LANGUAGE_META[editLocale as keyof typeof LANGUAGE_META]?.flag} {editLocale.toUpperCase()}</Badge><span>{copy("DRAFT PREVIEW", "TASLAK ÖNİZLEME")}</span><span className="text-muted-foreground">{editLocale === sourceLocale ? copy("Native source", "Kaynak dil") : (translationsRef.current[editLocale]?.length ?? 0) > 0 ? copy("Translation draft", "Çeviri taslağı") : copy("Source fallback · noindex", "Kaynak fallback · noindex")}</span></div>
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground"><span className="truncate">{managedPagePublicPath({ ...page, locale: editLocale, slug: seo.slug || page.slug })}</span><span>{previewSize}</span><span>{copy("Not public", "Public değil")}</span></div>
            </div>
            <div
              className="relative shrink-0 transition-[width,height] duration-300"
              style={{ width: PREVIEW_WIDTHS[previewSize] * previewScale, height: previewHeight * previewScale }}
            >
              <div
                ref={previewCanvasRef}
                className="cms-preview-viewport absolute left-0 top-0 bg-white dark:bg-card rounded-lg shadow-lg border overflow-hidden"
                data-preview-size={previewSize}
                style={{ width: PREVIEW_WIDTHS[previewSize], minHeight: "400px", transform: `scale(${previewScale})`, transformOrigin: "top left" }}
              >
                <BlockPreview blocks={blocks} locale={editLocale} template={page.template} pageTitle={page.title} pageSlug={seo.slug || page.slug} teamMembers={teamMembersQuery.data || []} offices={officesQuery.data || []} collectionsLoading={teamMembersQuery.isLoading || officesQuery.isLoading} />
              </div>
            </div>
          </section>
        </div>
      </div>
  );
}

function BlockPreview({ blocks, locale, template, pageTitle, pageSlug, teamMembers, offices, collectionsLoading }: { blocks: PageBlock[]; locale: string; template?: string | null; pageTitle: string; pageSlug: string; teamMembers: CmsTeamMember[]; offices: CmsOffice[]; collectionsLoading: boolean }) {
  const visibleBlocks = blocks.filter(b => b.isVisible).map(block => hydrateCollectionBlock(block, teamMembers, offices));

  if (visibleBlocks.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground text-sm">
        Add blocks to see a preview
      </div>
    );
  }

  const preview = <div dir={["ar", "fa", "ur"].includes(locale) ? "rtl" : "ltr"} lang={locale}>
      {visibleBlocks.map((block, idx) => (
        <div key={idx} className="relative">
          <div className="absolute top-1 right-1 z-10">
            <Badge variant="outline" className="text-[9px] bg-white/80 dark:bg-card/80">
              {getBlockTypeDef(block.blockType)?.label || block.blockType}
            </Badge>
          </div>
          {collectionDependency(block) && !hasCollectionItems(block) ? (
            <div role="status" className="m-4 rounded-xl border border-dashed border-amber-400 bg-amber-50 p-5 text-sm text-amber-900">
              {collectionsLoading ? "Collection data is loading…" : `This visible ${getBlockTypeDef(block.blockType)?.label || block.blockType} section is not rendered publicly until its collection contains data.`}
            </div>
          ) : block.blockType === "catalog_grid"
            ? <CatalogBlockPreview content={block.content} locale={locale} />
            : <CmsBlock block={block} index={idx} variables={{ siteName: SITE_NAME, pageTitle, pageSlug, pageLocale: locale }} />}
        </div>
      ))}
    </div>;
  const isExactHome = template === "home" && visibleBlocks.every(block => MANAGED_HOME_BLOCK_TYPES.has(block.blockType));
  const managedTemplate = ["about", "countries", "programs", "blog", "contact"].includes(String(template || ""))
    ? String(template)
    : null;
  return isExactHome
    ? <div className="home-future-page">{preview}</div>
    : <CmsPageCanvas className={`cms-editor-preview${managedTemplate ? ` managed-agency-page managed-agency-page--${managedTemplate}` : ""}`}>
        <div data-managed-template={managedTemplate || undefined}>{preview}</div>
      </CmsPageCanvas>;
}
