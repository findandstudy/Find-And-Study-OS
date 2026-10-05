import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
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
  Monitor, Tablet, Smartphone, History, ArrowLeft, RotateCcw, GripVertical, Sparkles, Settings2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AiAssistantPanel } from "@/components/AiAssistantPanel";
import { useLocation } from "wouter";
import { BLOCK_TYPES, getBlockTypeDef, getDefaultContent, type PageBlock, type BlockFieldDef } from "@/lib/website/blockTypes";
import { SUPPORTED_LANGUAGES, LANGUAGE_META } from "@/lib/i18n";
import DOMPurify from "isomorphic-dompurify";
import { CatalogBlockPreview } from "./CatalogBlockPreview";
import { CatalogBlockFields } from "./CatalogBlockFields";
import { useI18n } from "@/hooks/use-i18n";
import { installPageEditorNavigationGuard, supportsPageEditorHistoryGuard } from "./pageEditorNavigationGuard";
import { pageEditorText } from "./pageEditorCopy";

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
  translationsJson: Record<string, Record<string, string>> | null;
}

interface PageVersion {
  id: number;
  pageId: number;
  versionNumber: number;
  blocksSnapshot: PageBlock[];
  metaSnapshot: Record<string, string> | null;
  publishedAt: string | null;
  createdBy: number | null;
  createdAt: string;
  authorFirstName: string | null;
  authorLastName: string | null;
  authorEmail: string | null;
}

type PreviewSize = "desktop" | "tablet" | "mobile";
const PREVIEW_WIDTHS: Record<PreviewSize, string> = { desktop: "100%", tablet: "768px", mobile: "375px" };

export default function PageEditor({ id }: { id: number }) {
  return <PageEditorSession key={id} id={id} />;
}

function PageEditorSession({ id }: { id: number }) {
  const { lang } = useI18n();
  const copy = (en: string, tr?: string) => pageEditorText(lang, en, tr);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);
  const [previewSize, setPreviewSize] = useState<PreviewSize>("desktop");
  const [mobilePane, setMobilePane] = useState<"blocks" | "editor" | "preview">("preview");
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [dirty, setDirty] = useState(false);
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
  const [seoOpen, setSeoOpen] = useState(false);
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
  function leaveEditor() {
    if (savingRef.current) return;
    if (unsavedRef.current && !window.confirm(leaveMessageRef.current)) return;
    unsavedRef.current = false;
    setLocation("/admin/website/pages");
  }

  const { data: page, isLoading: pageLoading } = useQuery<WebsitePage>({
    queryKey: ["website-page", id],
    queryFn: () => customFetch(`/api/website/pages/${id}`),
  });
  const sourceLocale = page?.locale || "en";

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
    const parsed = savedBlocks.map((b, i) => ({
      id: b.id,
      blockType: b.blockType,
      content: (b.content || {}) as Record<string, unknown>,
      settings: (b.settings || {}) as Record<string, unknown>,
      sortOrder: b.sortOrder ?? i,
      isVisible: b.isVisible ?? true,
    }));
    setBlocks(parsed);
    defaultBlocksRef.current = JSON.parse(JSON.stringify(parsed));
    if (page?.translationsJson) {
      try {
        const tj = page.translationsJson as Record<string, unknown>;
        for (const [loc, data] of Object.entries(tj)) {
          if (Array.isArray(data)) {
            translationsRef.current[loc] = data as PageBlock[];
          } else if (data && typeof data === "object" && "blocks" in (data as Record<string, unknown>)) {
            translationsRef.current[loc] = (data as { blocks: PageBlock[] }).blocks;
          }
        }
      } catch {}
    }
  }, [blocksFetched, savedBlocks, page]);

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
      await customFetch(`/api/website/pages/${id}/seo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: snapshot,
      });
      return snapshot;
    },
    onSuccess: (snapshot) => {
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
        blocks: editLocale === sourceLocale ? blocks.map((b, i) => ({ ...b, sortOrder: i })) : defaultBlocksRef.current.map((b, i) => ({ ...b, sortOrder: i })),
      };
      const tx = buildTranslationsPayload();
      if (tx) payload.translationsJson = tx;
      await customFetch(`/api/website/pages/${id}/save-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return revision;
    },
    onSuccess: (revision) => {
      queryClient.invalidateQueries({ queryKey: ["website-page", id] });
      queryClient.invalidateQueries({ queryKey: ["website-page-blocks", id] });
      queryClient.invalidateQueries({ queryKey: ["website-pages"] });
      if (blockRevision.current === revision) setDirty(false);
      toast({ title: copy("Draft saved", "Taslak kaydedildi") });
    },
    onError: () => toast({ title: copy("Error", "Hata"), description: copy("Failed to save draft. Your changes are still here.", "Taslak kaydedilemedi. Değişiklikleriniz korunuyor."), variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const revision = blockRevision.current;
      if (blocks.some(b => b.blockType === "global_block" && !b.content.globalComponentId)) {
        if (!window.confirm(copy("An unbound Global Block will be skipped on the public page. Publish anyway?", "Bağlanmamış ortak blok, herkese açık sayfada gösterilmeyecek. Yine de yayınlansın mı?"))) throw new Error("Publication cancelled");
      }
      const payload: Record<string, unknown> = {
        blocks: editLocale === sourceLocale ? blocks.map((b, i) => ({ ...b, sortOrder: i })) : defaultBlocksRef.current.map((b, i) => ({ ...b, sortOrder: i })),
      };
      const tx = buildTranslationsPayload();
      if (tx) payload.translationsJson = tx;
      await customFetch(`/api/website/pages/${id}/save-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await customFetch(`/api/website/pages/${id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return revision;
    },
    onSuccess: (revision) => {
      queryClient.invalidateQueries({ queryKey: ["website-page", id] });
      queryClient.invalidateQueries({ queryKey: ["website-page-blocks", id] });
      queryClient.invalidateQueries({ queryKey: ["website-page-versions", id] });
      queryClient.invalidateQueries({ queryKey: ["website-pages"] });
      if (blockRevision.current === revision) setDirty(false);
      toast({ title: copy("Published!", "Yayınlandı!"), description: copy("Page is now live.", "Sayfa artık yayında.") });
    },
    onError: () => toast({ title: copy("Error", "Hata"), description: copy("Failed to publish.", "Yayınlanamadı."), variant: "destructive" }),
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
      const restoredBlocks = result.blocks.map((b, i) => ({
        id: b.id,
        blockType: b.blockType,
        content: (b.content || {}) as Record<string, unknown>,
        settings: (b.settings || {}) as Record<string, unknown>,
        sortOrder: b.sortOrder ?? i,
        isVisible: b.isVisible ?? true,
      }));
      setBlocks(restoredBlocks);
      defaultBlocksRef.current = JSON.parse(JSON.stringify(restoredBlocks));
      translationsRef.current = {};
      for (const [locale, value] of Object.entries((result.page?.translationsJson || {}) as Record<string, unknown>)) {
        if (Array.isArray(value)) translationsRef.current[locale] = value as PageBlock[];
        else if (value && typeof value === "object" && Array.isArray((value as { blocks?: unknown }).blocks)) translationsRef.current[locale] = (value as { blocks: PageBlock[] }).blocks;
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
    const newBlock: PageBlock = {
      blockType,
      content: getDefaultContent(blockType),
      settings: {},
      sortOrder: blocks.length,
      isVisible: true,
    };
    setBlocks(prev => [...prev, newBlock]);
    setSelectedBlockIdx(blocks.length);
    setMobilePane("editor");
    setShowAddBlock(false);
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

  const selectedBlock = selectedBlockIdx !== null ? blocks[selectedBlockIdx] : null;
  const selectedTypeDef = selectedBlock ? getBlockTypeDef(selectedBlock.blockType) : null;
  const saving = saveDraftMutation.isPending || publishMutation.isPending || saveSeoMutation.isPending || restoreMutation.isPending;
  savingRef.current = saving;

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

  if (!blocksInitialized.current) {
    return <div className="p-6 space-y-3" role={blocksError ? "alert" : "status"}>
      <p>{blocksError ? copy("Page content could not be loaded. Retry before editing.", "Sayfa içeriği yüklenemedi. Düzenlemeden önce yeniden deneyin.") : copy("Loading page content...", "Sayfa içeriği yükleniyor...")}</p>
      {blocksError && <Button onClick={() => reloadBlocks()}>{copy("Retry", "Yeniden dene")}</Button>}
      <Button variant="outline" onClick={leaveEditor}>{copy("Back to Pages", "Sayfalara dön")}</Button>
    </div>;
  }

  return (
      <div className="flex min-w-0 flex-col h-[calc(100dvh-3.5rem)]">
        {blocksError && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>{copy("Page content could not be refreshed. Your current edits are preserved.", "Sayfa içeriği yenilenemedi. Mevcut düzenlemeleriniz korunuyor.")}</p>
          <Button variant="outline" size="sm" disabled={blocksRefreshing} onClick={() => reloadBlocks()}>{copy("Retry content loading", "İçeriği yeniden yükle")}</Button>
        </div>}
        {(dirty || seoDirty || saving) && typeof window !== "undefined" && !supportsPageEditorHistoryGuard(window) && <div role="alert" className="border-b border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          {copy("This browser cannot reliably protect unsaved changes when using Back or Forward. Save your changes before using browser history.", "Bu tarayıcıda Geri/İleri düğmeleri kaydedilmemiş değişiklikleri güvenilir biçimde koruyamaz. Tarayıcı geçmişini kullanmadan önce değişikliklerinizi kaydedin.")}
        </div>}
        <div className="min-h-12 border-b bg-card flex flex-wrap gap-3 items-center justify-between px-4 py-2 shrink-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Button aria-label={copy("Back to pages", "Sayfalara dön")} disabled={saving} variant="ghost" size="icon" className="h-8 w-8" onClick={leaveEditor}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <h2 className="font-semibold text-sm">{page.title}</h2>
            <Badge variant={page.status === "published" ? "default" : "secondary"} className="text-xs">
              {page.status === "published" ? copy("Published", "Yayında") : page.status === "draft" ? copy("Draft", "Taslak") : page.status}
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
            <div className="flex gap-0.5">
              {SUPPORTED_LANGUAGES.filter(l => l !== sourceLocale).slice(0, 5).map(l => {
                const trBlocks = translationsRef.current[l];
                const has = trBlocks && trBlocks.length > 0;
                return <span key={l} className={`text-[9px] ${has ? "text-green-600" : "text-muted-foreground/40"}`} title={`${LANGUAGE_META[l].name}: ${has ? "translated" : "not translated"}`}>{has ? "●" : "○"}</span>;
              })}
            </div>
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
                      return (
                      <Card key={v.id}>
                        <CardContent className="p-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{copy("Version", "Sürüm")} {v.versionNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              {v.publishedAt ? new Date(v.publishedAt).toLocaleString() : new Date(v.createdAt).toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">by {authorName}</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              if (dirty && !window.confirm(copy("Restore this version and replace unsaved block edits?", "Bu sürüm geri yüklenip kaydedilmemiş blok değişiklikleri silinsin mi?"))) return;
                              restoreMutation.mutate(v.id);
                            }}
                            disabled={saving}
                          >
                            <RotateCcw className="w-3 h-3" /> {copy("Restore", "Geri yükle")}
                          </Button>
                        </CardContent>
                      </Card>
                      );
                    })
                  )}
                </div>
              </SheetContent>
            </Sheet>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => saveDraftMutation.mutate()} disabled={saveDraftMutation.isPending || publishMutation.isPending || restoreMutation.isPending}>
              <Save className="w-3.5 h-3.5" /> {saveDraftMutation.isPending ? copy("Saving...", "Kaydediliyor...") : copy("Save Draft", "Taslağı kaydet")}
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending || saveDraftMutation.isPending || restoreMutation.isPending}>
              <Upload className="w-3.5 h-3.5" /> {publishMutation.isPending ? copy("Publishing...", "Yayınlanıyor...") : copy("Publish", "Yayınla")}
            </Button>
          </div>
        </div>

        <nav aria-label={copy("Editor panels", "Editör panelleri")} className="flex gap-2 border-b p-2 lg:hidden">
          {(["blocks", "editor", "preview"] as const).map(pane => <Button key={pane} size="sm" variant={mobilePane === pane ? "default" : "outline"} aria-pressed={mobilePane === pane} onClick={() => setMobilePane(pane)}>{pane === "blocks" ? copy("Blocks", "Bloklar") : pane === "editor" ? copy("Edit block", "Bloğu düzenle") : copy("Preview", "Önizleme")}</Button>)}
        </nav>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className={`${mobilePane === "blocks" ? "flex" : "hidden"} w-full lg:w-64 border-e bg-card lg:flex flex-col shrink-0`}>
            <div className="p-3 border-b flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase text-muted-foreground">{copy("Blocks", "Bloklar")}</h3>
              <Dialog open={showAddBlock} onOpenChange={setShowAddBlock}>
                <DialogTrigger asChild>
                  <Button aria-label={copy("Add block", "Blok ekle")} variant="outline" size="icon" className="h-8 w-8">
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{copy("Add Block", "Blok ekle")}</DialogTitle>
                  </DialogHeader>
                  <div className="grid grid-cols-2 gap-2 mt-2 max-h-[60vh] overflow-y-auto">
                    {BLOCK_TYPES.map(bt => (
                      <button
                        key={bt.type}
                        onClick={() => addBlock(bt.type)}
                        className="flex items-center gap-2 p-3 rounded-lg border hover:border-primary hover:bg-primary/5 transition-colors text-left"
                      >
                        <span className="text-lg">{bt.icon}</span>
                        <div>
                          <p className="text-sm font-medium">{copy(bt.label)}</p>
                          <p className="text-[10px] text-muted-foreground capitalize">{copy(bt.category)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {blocks.map((block, idx) => {
                  const def = getBlockTypeDef(block.blockType);
                  return (
                    <div
                      key={idx}
                      className={`group flex items-center gap-1 p-2 rounded-lg cursor-pointer transition-colors text-sm ${
                        selectedBlockIdx === idx ? "bg-primary/10 border border-primary/30" : "hover:bg-secondary"
                      } ${!block.isVisible ? "opacity-50" : ""}`}
                    >
                      <GripVertical className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-sm shrink-0">{def?.icon || "📦"}</span>
                      <button className="min-w-0 flex-1 truncate py-2 text-start text-xs font-medium" onClick={() => { setSelectedBlockIdx(idx); setMobilePane("editor"); }}>{copy(def?.label || block.blockType)}</button>
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
          </div>

          <div className={`${mobilePane === "editor" ? "flex" : "hidden"} w-full lg:w-80 border-e bg-background lg:flex flex-col shrink-0`}>
            <div className="p-3 border-b">
              <h3 className="text-xs font-bold uppercase text-muted-foreground">
                {selectedBlock ? `${copy("Edit", "Düzenle")}: ${copy(selectedTypeDef?.label || selectedBlock.blockType)}` : copy("Block Editor", "Blok editörü")}
              </h3>
            </div>
            {editLocale !== sourceLocale && (
              <div className="mx-3 mt-2 p-2 rounded-lg bg-blue-50 border border-blue-200 text-xs">
                <p className="font-medium text-blue-800 flex items-center gap-1">
                  {LANGUAGE_META[editLocale as keyof typeof LANGUAGE_META]?.flag} {copy("Editing language:", "Düzenleme dili:")} {LANGUAGE_META[editLocale as keyof typeof LANGUAGE_META]?.nativeName || editLocale}
                </p>
                <p className="text-blue-600 mt-0.5">{copy("Content entered here is for this locale's translation.", "Buraya girilen içerik, seçilen dilin çevirisine aittir.")}</p>
                <Button type="button" variant="outline" size="sm" className="h-5 text-[10px] px-2 mt-1" onClick={() => {
                  const defaultBlocks = defaultBlocksRef.current;
                  setBlocks(defaultBlocks.map(b => ({ ...b })));
                  markDirty();
                  toast({ title: copy(`Copied blocks from ${sourceLocale}`, `${sourceLocale} dilindeki bloklar kopyalandı`) });
                }}>{copy("Copy blocks from source language", "Kaynak dildeki blokları kopyala")}</Button>
              </div>
            )}
            <ScrollArea className="flex-1">
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
                      content={selectedBlock.content}
                      onChange={(key, value) => {
                        updateBlockContent(selectedBlockIdx!, key, value);
                        if (selectedBlock.blockType === "catalog_grid" && key === "source") for (const filter of ["country", "city", "countryId", "cityId", "universityId", "degree", "language", "institutionType"]) updateBlockContent(selectedBlockIdx!, filter, "");
                      }}
                    />
                    {selectedBlock.blockType === "catalog_grid" && <CatalogBlockFields content={selectedBlock.content} locale={editLocale} onChange={(key, value) => updateBlockContent(selectedBlockIdx!, key, value)} />}
                    <AiAssistantPanel
                      context={Object.values(selectedBlock.content).filter(v => typeof v === "string").join(" ").slice(0, 500)}
                      locale={editLocale}
                      onResult={(action, result) => {
                        const fieldMap: Record<string, string> = {
                          generateMetaTitle: "title",
                          generateMetaDescription: "subtitle",
                          generateHeroTitle: "heading",
                          generateCTAText: "buttonText",
                          generateOGText: "description",
                          improveTone: "body",
                          shortenText: "body",
                          expandText: "body",
                          generateExcerpt: "description",
                          generateAltText: "altText",
                        };
                        const targetField = fieldMap[action];
                        if (targetField && selectedBlockIdx !== null) {
                          updateBlockContent(selectedBlockIdx, targetField, result);
                        }
                      }}
                    />
                  </>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className={`${mobilePane === "preview" ? "flex" : "hidden"} min-w-0 flex-1 bg-secondary/30 lg:flex flex-col items-center p-4 overflow-auto`}>
            <div
              className="bg-white dark:bg-card rounded-lg shadow-lg border overflow-hidden transition-all duration-300"
              style={{ width: PREVIEW_WIDTHS[previewSize], maxWidth: "100%", minHeight: "400px" }}
            >
              <BlockPreview blocks={blocks} locale={editLocale} />
            </div>
          </div>
        </div>
      </div>
  );
}

function BlockFieldEditor({
  fields,
  content,
  onChange,
}: {
  fields: BlockFieldDef[];
  content: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const { lang } = useI18n();
  const copy = (value: string) => pageEditorText(lang, value);
  return (
    <div className="space-y-4">
      {fields.map(field => (
        <div key={field.key} className="space-y-1.5">
          <Label className="text-xs font-medium">{copy(field.label)}</Label>
          {field.type === "text" && (
            <Input
              aria-label={copy(field.label)}
              value={(content[field.key] as string) || ""}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="h-8 text-sm"
            />
          )}
          {field.type === "textarea" && (
            <Textarea
              aria-label={copy(field.label)}
              value={(content[field.key] as string) || ""}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={3}
              className="text-sm"
            />
          )}
          {field.type === "richtext" && (
            <Textarea
              aria-label={copy(field.label)}
              value={(content[field.key] as string) || ""}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              rows={6}
              className="text-sm font-mono"
            />
          )}
          {field.type === "url" && (
            <Input
              aria-label={copy(field.label)}
              value={(content[field.key] as string) || ""}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={field.placeholder || "https://..."}
              className="h-8 text-sm"
            />
          )}
          {field.type === "image" && (
            <Input
              aria-label={copy(field.label)}
              value={(content[field.key] as string) || ""}
              onChange={e => onChange(field.key, e.target.value)}
              placeholder={copy("Image URL")}
              className="h-8 text-sm"
            />
          )}
          {field.type === "number" && (
            <Input
              aria-label={copy(field.label)}
              type="number"
              value={(content[field.key] as number) ?? field.defaultValue ?? ""}
              onChange={e => onChange(field.key, e.target.value ? Number(e.target.value) : "")}
              className="h-8 text-sm"
            />
          )}
          {field.type === "color" && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded border relative overflow-hidden" style={{ backgroundColor: (content[field.key] as string) || "#e5e7eb" }}>
                <input
                  aria-label={copy(field.label)}
                  type="color"
                  value={(content[field.key] as string) || "#e5e7eb"}
                  onChange={e => onChange(field.key, e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </div>
              <Input
                aria-label={copy(field.label)}
                value={(content[field.key] as string) || ""}
                onChange={e => onChange(field.key, e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
          )}
          {field.type === "toggle" && (
            <Switch
              aria-label={copy(field.label)}
              checked={!!content[field.key]}
              onCheckedChange={val => onChange(field.key, val)}
            />
          )}
          {field.type === "select" && field.options && (
            <Select value={(content[field.key] as string) || ""} onValueChange={v => onChange(field.key, v)}>
              <SelectTrigger aria-label={copy(field.label)} className="h-8 text-sm"><SelectValue placeholder={copy("Select...")} /></SelectTrigger>
              <SelectContent>
                {field.options.map(o => <SelectItem key={o.value} value={o.value}>{copy(o.label)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {field.type === "items" && field.itemFields && (
            <ItemsEditor
              items={(content[field.key] as Record<string, unknown>[]) || []}
              itemFields={field.itemFields}
              onChange={newItems => onChange(field.key, newItems)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ItemsEditor({
  items,
  itemFields,
  onChange,
}: {
  items: Record<string, unknown>[];
  itemFields: BlockFieldDef[];
  onChange: (items: Record<string, unknown>[]) => void;
}) {
  const { lang } = useI18n();
  const copy = (value: string) => pageEditorText(lang, value);
  const addItem = () => {
    const defaults: Record<string, unknown> = {};
    itemFields.forEach(f => { defaults[f.key] = f.defaultValue ?? ""; });
    onChange([...items, defaults]);
  };

  const removeItem = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, key: string, value: unknown) => {
    onChange(items.map((item, i) => i === idx ? { ...item, [key]: value } : item));
  };

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <Card key={idx} className="bg-secondary/30">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{copy("Item")} {idx + 1}</span>
              <Button aria-label={`${copy("Remove item")} ${idx + 1}`} variant="ghost" size="icon" className="h-5 w-5 text-red-500" onClick={() => removeItem(idx)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
            {itemFields.map(f => (
              <div key={f.key} className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">{copy(f.label)}</Label>
                {(f.type === "text" || f.type === "url" || f.type === "image") && (
                  <Input
                    aria-label={`${copy(f.label)} ${idx + 1}`}
                    value={(item[f.key] as string) || ""}
                    onChange={e => updateItem(idx, f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="h-7 text-xs"
                  />
                )}
                {f.type === "textarea" && (
                  <Textarea
                    aria-label={`${copy(f.label)} ${idx + 1}`}
                    value={(item[f.key] as string) || ""}
                    onChange={e => updateItem(idx, f.key, e.target.value)}
                    rows={2}
                    className="text-xs"
                  />
                )}
                {f.type === "number" && (
                  <Input
                    aria-label={`${copy(f.label)} ${idx + 1}`}
                    type="number"
                    value={(item[f.key] as number) ?? ""}
                    onChange={e => updateItem(idx, f.key, Number(e.target.value))}
                    className="h-7 text-xs"
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={addItem}>
        <Plus className="w-3 h-3 mr-1" /> {copy("Add Item")}
      </Button>
    </div>
  );
}

function GlobalBlockSelector({
  content,
  onChange,
}: {
  content: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const { data: globalComponents = [] } = useQuery<{ id: number; name: string; slug: string; componentType: string; isActive: boolean }[]>({
    queryKey: ["website-global-components"],
    queryFn: () => customFetch("/api/website/global-components"),
  });

  const activeComponents = globalComponents.filter(c => c.isActive);
  const selectedId = content.globalComponentId as number | null;
  const selectedComp = activeComponents.find(c => c.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Global Component</Label>
        {activeComponents.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No active global components. Create one in Website &gt; Global Components first.
          </p>
        ) : (
          <Select
            value={selectedId ? String(selectedId) : ""}
            onValueChange={v => {
              const comp = activeComponents.find(c => c.id === Number(v));
              if (comp) {
                onChange("globalComponentId", comp.id);
                onChange("globalComponentSlug", comp.slug);
              }
            }}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select a component..." />
            </SelectTrigger>
            <SelectContent>
              {activeComponents.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name} ({c.componentType.replace(/_/g, " ")})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {selectedComp && (
        <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
          <p className="text-xs font-medium text-purple-700 dark:text-purple-300">{selectedComp.name}</p>
          <p className="text-[10px] text-purple-500 dark:text-purple-400 mt-0.5">
            Type: {selectedComp.componentType.replace(/_/g, " ")} | Slug: {selectedComp.slug}
          </p>
        </div>
      )}
    </div>
  );
}

function GlobalBlockPreview({ componentId, slug }: { componentId: number | null; slug: string }) {
  const { data: globalComponents } = useQuery<{ id: number; name: string; slug: string; componentType: string; content: Record<string, unknown>; isActive: boolean }[]>({
    queryKey: ["website-global-components"],
    queryFn: () => customFetch("/api/website/global-components"),
  });

  if (!componentId && !slug) {
    return (
      <div className="py-4 px-6 text-center bg-purple-50 dark:bg-purple-950/20 border-2 border-dashed border-purple-200 dark:border-purple-800">
        <p className="text-xs text-purple-500 font-medium">No global component selected</p>
      </div>
    );
  }

  const comp = globalComponents?.find(c => c.id === componentId || c.slug === slug);
  if (!comp) {
    return (
      <div className="py-4 px-6 text-center bg-amber-50 dark:bg-amber-950/20 border-2 border-dashed border-amber-300 dark:border-amber-700">
        <p className="text-xs text-amber-600 font-medium">Component not found: {slug || `ID ${componentId}`}</p>
      </div>
    );
  }

  if (!comp.isActive) {
    return (
      <div className="py-4 px-6 text-center bg-amber-50 dark:bg-amber-950/20 border-2 border-dashed border-amber-300 dark:border-amber-700">
        <p className="text-xs text-amber-600 font-medium">Inactive component: {comp.name}</p>
      </div>
    );
  }

  const raw = (comp.content || {}) as Record<string, unknown>;
  const s = (k: string) => (raw[k] as string) || "";

  switch (comp.componentType) {
    case "cta_banner":
      return (
        <div className="relative py-10 px-8 text-center text-white" style={{ backgroundColor: s("backgroundColor") || "#2563eb" }}>
          {s("backgroundImage") && (
            <div className="absolute inset-0 bg-cover bg-center opacity-30" style={{ backgroundImage: `url(${s("backgroundImage")})` }} />
          )}
          <div className="relative z-10">
            <h2 className="text-2xl font-bold mb-2">{s("heading") || "CTA Heading"}</h2>
            {s("body") && <p className="text-sm opacity-90 mb-4 max-w-lg mx-auto">{s("body")}</p>}
            {s("buttonText") && (
              <span className="inline-block px-5 py-2 bg-white text-blue-600 rounded-lg font-medium text-sm">
                {s("buttonText")}
              </span>
            )}
          </div>
        </div>
      );

    case "stats_strip": {
      const items = (raw.items as { value: string; label: string }[]) || [];
      return (
        <div className="py-6 px-4 bg-gray-50 dark:bg-gray-900">
          <div className="flex justify-center gap-8 flex-wrap">
            {items.map((item, i) => (
              <div key={i} className="text-center">
                <div className="text-2xl font-bold text-primary">{item.value || "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">{item.label || "Label"}</div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "testimonials": {
      const items = (raw.items as { quote: string; author: string; role: string; avatar?: string }[]) || [];
      return (
        <div className="py-6 px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.slice(0, 4).map((item, i) => (
              <div key={i} className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border">
                <p className="text-sm italic text-muted-foreground mb-3">"{item.quote || "Quote..."}"</p>
                <div className="flex items-center gap-2">
                  {item.avatar && <img src={item.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />}
                  <div>
                    <p className="text-xs font-medium">{item.author || "Author"}</p>
                    {item.role && <p className="text-[10px] text-muted-foreground">{item.role}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "contact_strip":
      return (
        <div className="py-6 px-6 bg-gray-50 dark:bg-gray-900">
          <div className="flex flex-wrap justify-center gap-6 text-sm">
            {s("phone") && <span>Tel: {s("phone")}</span>}
            {s("email") && <span>Email: {s("email")}</span>}
            {s("whatsapp") && <span>WhatsApp: {s("whatsapp")}</span>}
            {s("address") && <span>{s("address")}</span>}
          </div>
        </div>
      );

    case "logo_grid": {
      const items = (raw.items as { name: string; imageUrl: string }[]) || [];
      const cols = (raw.columns as number) || 4;
      return (
        <div className="py-6 px-6">
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {items.map((item, i) => (
              <div key={i} className="flex items-center justify-center p-3 border rounded-lg bg-white dark:bg-gray-900 min-h-[60px]">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className="max-h-10 max-w-full object-contain" />
                ) : (
                  <span className="text-xs text-muted-foreground">{item.name || "Logo"}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "custom_html":
      return (
        <div className="py-4 px-6 bg-gray-50 dark:bg-gray-900 border-l-4 border-purple-400">
          <p className="text-[10px] text-purple-500 font-medium mb-1">Custom HTML: {comp.name}</p>
          <div className="text-xs text-muted-foreground truncate">{s("html").slice(0, 120) || "(empty)"}...</div>
        </div>
      );

    default:
      return (
        <div className="py-4 px-6 text-center bg-purple-50 dark:bg-purple-950/20 border-2 border-dashed border-purple-200 dark:border-purple-800">
          <p className="text-xs text-purple-600 font-medium">{comp.name} ({comp.componentType})</p>
        </div>
      );
  }
}

function BlockPreview({ blocks, locale }: { blocks: PageBlock[]; locale: string }) {
  const visibleBlocks = blocks.filter(b => b.isVisible);

  if (visibleBlocks.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground text-sm">
        Add blocks to see a preview
      </div>
    );
  }

  return (
    <div className="divide-y" dir={["ar", "fa", "ur"].includes(locale) ? "rtl" : "ltr"} lang={locale}>
      {visibleBlocks.map((block, idx) => (
        <div key={idx} className="relative">
          <div className="absolute top-1 right-1 z-10">
            <Badge variant="outline" className="text-[9px] bg-white/80 dark:bg-card/80">
              {getBlockTypeDef(block.blockType)?.label || block.blockType}
            </Badge>
          </div>
          {block.blockType === "catalog_grid" ? <CatalogBlockPreview content={block.content} locale={locale} /> : <BlockPreviewItem block={block} />}
        </div>
      ))}
    </div>
  );
}

function BlockPreviewItem({ block }: { block: PageBlock }) {
  const c = block.content as Record<string, string | number | boolean | Record<string, unknown>[] | null>;

  switch (block.blockType) {
    case "hero":
      return (
        <div className="relative py-16 px-6 text-center bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
          {c.badge && <span className="inline-block px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-medium mb-4">{c.badge as string}</span>}
          <h1 className="text-2xl font-bold mb-2">{(c.title as string) || "Hero Title"}</h1>
          {c.subtitle && <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{c.subtitle as string}</p>}
          <div className="flex gap-2 justify-center">
            {c.ctaLabel && <span className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium">{c.ctaLabel as string}</span>}
            {c.secondaryLabel && <span className="inline-block px-4 py-2 border rounded-lg text-xs font-medium">{c.secondaryLabel as string}</span>}
          </div>
        </div>
      );

    case "rich_text":
      return (
        <div className="p-6 prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizeHtml((c.content as string) || "") }} />
      );

    case "stats_strip":
      return (
        <div className={`py-8 px-6 ${c.bgColor === "primary" ? "bg-blue-600 text-white" : "bg-gray-50 dark:bg-gray-900"}`}>
          <div className="grid grid-cols-4 gap-4 text-center">
            {((c.stats as { value: string; label: string }[]) || []).map((s, i) => (
              <div key={i}>
                <p className="text-xl font-bold">{s.value}</p>
                <p className={`text-xs ${c.bgColor === "primary" ? "text-white/70" : "text-gray-500"}`}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      );

    case "feature_cards":
    case "icon_cards":
      return (
        <div className="py-8 px-6">
          {c.title && <h2 className="text-lg font-bold text-center mb-1">{c.title as string}</h2>}
          {c.subtitle && <p className="text-sm text-gray-500 text-center mb-4">{c.subtitle as string}</p>}
          <div className={`grid gap-3 ${c.columns === "2" ? "grid-cols-2" : c.columns === "4" ? "grid-cols-4" : "grid-cols-3"}`}>
            {((c.cards as { title: string; description: string }[]) || []).map((card, i) => (
              <div key={i} className="p-4 rounded-xl border bg-white dark:bg-card">
                <h3 className="text-sm font-semibold mb-1">{card.title}</h3>
                <p className="text-xs text-gray-500">{card.description}</p>
              </div>
            ))}
          </div>
        </div>
      );

    case "cta_banner":
      return (
        <div className={`py-10 px-6 text-center ${c.bgStyle === "gradient" ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white" : c.bgStyle === "solid" ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}>
          <h2 className="text-lg font-bold mb-2">{(c.title as string) || "CTA Title"}</h2>
          {c.subtitle && <p className={`text-sm mb-4 ${c.bgStyle !== "image" ? "text-white/80" : "text-gray-600"}`}>{c.subtitle as string}</p>}
          <div className="flex gap-2 justify-center">
            {c.ctaLabel && <span className="inline-block px-4 py-2 bg-white text-blue-600 rounded-lg text-xs font-medium">{c.ctaLabel as string}</span>}
          </div>
        </div>
      );

    case "faq":
      return (
        <div className="py-8 px-6">
          {c.title && <h2 className="text-lg font-bold text-center mb-4">{c.title as string}</h2>}
          <div className="space-y-2 max-w-xl mx-auto">
            {((c.items as { question: string; answer: string }[]) || []).map((item, i) => (
              <div key={i} className="p-3 rounded-lg border">
                <p className="text-sm font-medium">{item.question}</p>
                <p className="text-xs text-gray-500 mt-1">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      );

    case "team_grid":
      return (
        <div className="py-8 px-6">
          {c.title && <h2 className="text-lg font-bold text-center mb-4">{c.title as string}</h2>}
          <div className="grid grid-cols-4 gap-3">
            {((c.members as { name: string; role: string }[]) || []).map((m, i) => (
              <div key={i} className="text-center p-3">
                <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 mx-auto mb-2 flex items-center justify-center text-sm font-bold text-blue-600">{m.name?.[0]}</div>
                <p className="text-xs font-medium">{m.name}</p>
                <p className="text-[10px] text-gray-500">{m.role}</p>
              </div>
            ))}
            {((c.members as unknown[]) || []).length === 0 && <p className="col-span-4 text-center text-xs text-gray-400">Team members from collections</p>}
          </div>
        </div>
      );

    case "office_list":
      return (
        <div className="py-8 px-6">
          {c.title && <h2 className="text-lg font-bold text-center mb-4">{c.title as string}</h2>}
          <div className="grid grid-cols-2 gap-3">
            {((c.offices as { name: string; city: string; address: string }[]) || []).map((o, i) => (
              <div key={i} className="p-3 rounded-lg border">
                <p className="text-sm font-semibold">{o.name}</p>
                <p className="text-xs text-gray-500">{o.city}</p>
              </div>
            ))}
            {((c.offices as unknown[]) || []).length === 0 && <p className="col-span-2 text-center text-xs text-gray-400">Offices from collections</p>}
          </div>
        </div>
      );

    case "logo_grid":
      return (
        <div className="py-8 px-6">
          {c.title && <h2 className="text-lg font-bold text-center mb-4">{c.title as string}</h2>}
          <div className="flex flex-wrap gap-4 justify-center">
            {((c.logos as { name: string; imageUrl: string }[]) || []).map((l, i) => (
              <div key={i} className="w-20 h-12 rounded border flex items-center justify-center text-xs text-gray-400 bg-gray-50 dark:bg-gray-800">
                {l.imageUrl ? <img src={l.imageUrl} alt={l.name} className="max-h-10 max-w-16 object-contain" /> : l.name}
              </div>
            ))}
            {((c.logos as unknown[]) || []).length === 0 && <p className="text-xs text-gray-400">Add logos to display</p>}
          </div>
        </div>
      );

    case "testimonials":
      return (
        <div className="py-8 px-6">
          {c.title && <h2 className="text-lg font-bold text-center mb-4">{c.title as string}</h2>}
          <div className={c.layout === "grid" ? "grid grid-cols-2 gap-3" : "space-y-3"}>
            {((c.items as { name: string; content: string; role: string }[]) || []).map((t, i) => (
              <div key={i} className="p-3 rounded-lg border bg-white dark:bg-card">
                <p className="text-xs italic text-gray-600 dark:text-gray-400 mb-2">"{t.content}"</p>
                <p className="text-xs font-medium">{t.name}</p>
                {t.role && <p className="text-[10px] text-gray-500">{t.role}</p>}
              </div>
            ))}
            {((c.items as unknown[]) || []).length === 0 && <p className="text-center text-xs text-gray-400">Testimonials from collections</p>}
          </div>
        </div>
      );

    case "section_title": {
      const alignCls = c.alignment === "left" ? "text-left" : c.alignment === "right" ? "text-right" : "text-center";
      return (
        <div className={`py-6 px-6 ${alignCls}`}>
          <h2 className={`font-bold ${c.size === "lg" ? "text-2xl" : c.size === "sm" ? "text-base" : "text-lg"}`}>{(c.title as string) || "Section Title"}</h2>
          {c.subtitle && <p className="text-sm text-gray-500 mt-1">{c.subtitle as string}</p>}
        </div>
      );
    }

    case "spacer_divider":
      return (
        <div style={{ height: `${(c.height as number) || 48}px` }} className="flex items-center justify-center">
          {c.showDivider && <hr className="w-full border-t" style={{ borderColor: (c.dividerColor as string) || "#e5e7eb" }} />}
        </div>
      );

    case "global_block":
      return <GlobalBlockPreview componentId={c.globalComponentId as number | null} slug={c.globalComponentSlug as string} />;

    default:
      return (
        <div className="py-6 px-6 text-center text-sm text-gray-400">
          Unknown block type: {block.blockType}
        </div>
      );
  }
}
