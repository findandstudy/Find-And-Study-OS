import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Globe, Eye, Pencil, Check, Loader2, ExternalLink, Image,
  AlertTriangle, CheckCircle2, Info,
} from "lucide-react";

interface PageSeo {
  id: number;
  title: string;
  slug: string;
  status: string;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
  ogTitle: string | null;
  ogDescription: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImageUrl: string | null;
  issues?: string[];
}

interface SeoHealthOverview {
  generatedAt: string;
  readiness: "ELIGIBLE" | "LIMITED" | "BLOCKED" | "UNKNOWN";
  managed: { total: number; published: number; indexable: number; missingTitle: number; missingDescription: number };
  dynamic: { published: number; indexable: number; seoPass: number; seoPending: number; seoFail: number; schemaPass: number; schemaFail: number; duplicateTitles: number; duplicateDescriptions: number };
  discovery: { publishedMode: boolean; llmsTxtAvailable: boolean; oaiSearchBot: string; gptBot: string; googleExtended: string; indexNow: string; maxSnippet: number; maxImagePreview: string; xDefaultLocale: string };
}

interface GlobalSeo {
  seoMetaTitle?: string;
  seoMetaDescription?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImageUrl?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImageUrl?: string;
  canonicalBaseUrl?: string;
  siteName?: string;
  siteTitleTemplate?: string;
}

interface SeoFormData {
  metaTitle: string;
  metaDescription: string;
  slug: string;
  canonicalUrl: string;
  robotsIndex: boolean;
  robotsFollow: boolean;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
  twitterTitle: string;
  twitterDescription: string;
  twitterImageUrl: string;
}

function seoReadiness(page: PageSeo): { level: "ready" | "warning" | "blocked"; label: string; color: string } {
  const issues = page.issues ?? [];
  const blocked = issues.some(issue => issue.includes("CANONICAL_") || issue === "SEO_TITLE_MISSING" || issue === "SEO_DESCRIPTION_MISSING");
  if (blocked) return { level: "blocked", label: "Blocked", color: "text-red-600" };
  if (issues.length) return { level: "warning", label: "Warning", color: "text-amber-600" };
  return { level: "ready", label: "Ready", color: "text-green-600" };
}

function GooglePreview({ title, description, slug, baseUrl }: { title: string; description: string; slug: string; baseUrl: string }) {
  const displayUrl = `${baseUrl}/${slug}`;
  return (
    <>
    <div className="bg-white rounded-xl border border-border p-4 space-y-1">
      <p className="text-xs text-muted-foreground font-medium mb-2 flex items-center gap-1"><Search className="w-3 h-3" /> Google Search Preview</p>
      <p className="text-sm text-green-700 truncate">{displayUrl}</p>
      <p className="text-lg text-blue-700 hover:underline cursor-pointer truncate">{title || "Page Title"}</p>
      <p className="text-sm text-gray-600 line-clamp-2">{description || "No meta description set. Search engines will use page content."}</p>
    </div>
    </>
  );
}

function SocialPreview({ title, description, image, siteName }: { title: string; description: string; image: string; siteName: string }) {
  return (
    <>
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <p className="text-xs text-muted-foreground font-medium px-4 pt-3 pb-2 flex items-center gap-1"><Globe className="w-3 h-3" /> Social Share Preview</p>
      <div className="bg-gray-100 dark:bg-gray-800/60 h-36 flex items-center justify-center">
        {image ? (
          <img src={image} alt="OG" className="w-full h-full object-cover" />
        ) : (
          <div className="text-muted-foreground text-sm flex items-center gap-2"><Image className="w-5 h-5" /> No image set</div>
        )}
      </div>
      <div className="p-3 border-t">
        <p className="text-xs text-muted-foreground uppercase">{siteName || "findandstudy.com"}</p>
        <p className="text-sm font-semibold text-foreground truncate">{title || "Page Title"}</p>
        <p className="text-xs text-muted-foreground line-clamp-2">{description || "No description"}</p>
      </div>
    </div>
    </>
  );
}

export default function WebsiteSeoOverrides() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PageSeo | null>(null);
  const [form, setForm] = useState<SeoFormData>({
    metaTitle: "", metaDescription: "", slug: "", canonicalUrl: "",
    robotsIndex: true, robotsFollow: true,
    ogTitle: "", ogDescription: "", ogImageUrl: "",
    twitterTitle: "", twitterDescription: "", twitterImageUrl: "",
  });

  const { data: pages = [], isLoading } = useQuery<PageSeo[]>({
    queryKey: ["/api/website/seo-overview"],
    queryFn: () => customFetch("/api/website/seo-overview"),
  });

  const { data: globalSeo } = useQuery<GlobalSeo>({
    queryKey: ["/api/settings/seo-global"],
    queryFn: () => customFetch("/api/settings"),
  });
  const { data: health, isLoading: healthLoading } = useQuery<SeoHealthOverview>({
    queryKey: ["/api/website/seo-health"],
    queryFn: () => customFetch("/api/website/seo-health"),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { id: number; data: Partial<SeoFormData> }) =>
      customFetch(`/api/website/pages/${payload.id}/seo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/website/seo-overview"] });
      qc.invalidateQueries({ queryKey: ["/api/website/seo-health"] });
      setEditing(null);
      toast({ title: "SEO settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openEditor(page: PageSeo) {
    setEditing(page);
    setForm({
      metaTitle: page.metaTitle || "",
      metaDescription: page.metaDescription || "",
      slug: page.slug || "",
      canonicalUrl: page.canonicalUrl || "",
      robotsIndex: page.robotsIndex,
      robotsFollow: page.robotsFollow,
      ogTitle: page.ogTitle || "",
      ogDescription: page.ogDescription || "",
      ogImageUrl: page.ogImageUrl || "",
      twitterTitle: page.twitterTitle || "",
      twitterDescription: page.twitterDescription || "",
      twitterImageUrl: page.twitterImageUrl || "",
    });
  }

  const baseUrl = globalSeo?.canonicalBaseUrl || "https://findandstudy.com";
  const siteName = globalSeo?.siteName || "Find And Study OS";

  return (
    <>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Search className="w-6 h-6 text-primary" /> SEO & AI Discovery</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage page metadata and review technical search, schema and answer-engine readiness.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Answer-engine readiness</p>
            <div className="mt-2 flex items-center gap-2">
              {healthLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : health?.readiness === "ELIGIBLE" ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
              <p className="text-xl font-bold">{health?.readiness ?? "Unknown"}</p>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Technical eligibility only; not a ranking guarantee.</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Published dynamic pages</p>
            <p className="mt-2 text-xl font-bold">{health?.dynamic.published ?? "—"}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{health?.dynamic.indexable ?? 0} indexable · {health?.dynamic.seoFail ?? 0} SEO failures</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium text-muted-foreground">Structured data</p>
            <p className="mt-2 text-xl font-bold">{health?.dynamic.schemaPass ?? "—"} pass</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{health?.dynamic.schemaFail ?? 0} fail · visible-content parity required</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium text-muted-foreground">AI crawler policy</p>
            <p className="mt-2 text-sm font-semibold">Search: {health?.discovery.oaiSearchBot ?? "—"}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Training: {health?.discovery.gptBot ?? "—"} · llms.txt {health?.discovery.llmsTxtAvailable ? "available" : "off"}</p>
          </Card>
        </div>

        {health && (health.dynamic.duplicateTitles > 0 || health.dynamic.duplicateDescriptions > 0 || health.dynamic.schemaFail > 0) && (
          <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Technical issues require attention</p>
            <p className="mt-1">{health.dynamic.duplicateTitles} duplicate titles · {health.dynamic.duplicateDescriptions} duplicate descriptions · {health.dynamic.schemaFail} structured-data failures.</p>
          </Card>
        )}

        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium">How SEO overrides work</p>
              <p className="mt-1">Each page can override global SEO defaults. If a field is empty, the global default from Settings &gt; SEO &amp; Social is used. Page-level values always take priority over global defaults.</p>
            </div>
          </div>
        </Card>

        {isLoading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : pages.length === 0 ? (
          <Card className="p-10 text-center">
            <Globe className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-lg font-semibold">No pages found</p>
            <p className="text-muted-foreground text-sm">Create pages in Website &gt; Pages first.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {pages.map(page => {
              const readiness = seoReadiness(page);
              return (
                <Card key={page.id} className="p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => openEditor(page)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${readiness.level === "ready" ? "bg-green-100 dark:bg-green-900/40" : readiness.level === "warning" ? "bg-yellow-100 dark:bg-yellow-900/40" : "bg-red-100 dark:bg-red-900/40"}`}>
                        {readiness.level === "ready" ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <AlertTriangle className={`w-5 h-5 ${readiness.level === "blocked" ? "text-red-600" : "text-yellow-600"}`} />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm truncate">{page.title}</p>
                          <Badge variant={page.status === "published" ? "default" : "secondary"} className="text-[10px] shrink-0">{page.status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">/{page.slug}</p>
                        {!!page.issues?.length && <p className="mt-1 text-[10px] text-amber-700 line-clamp-1">{page.issues.slice(0, 3).join(" · ")}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className={`text-xs font-semibold ${readiness.color}`}>{readiness.label}</p>
                        <div className="flex gap-1 mt-1">
                          <div className={`h-1 w-6 rounded-full ${page.metaTitle ? "bg-green-500" : "bg-gray-200"}`} title="Meta Title" />
                          <div className={`h-1 w-6 rounded-full ${page.metaDescription ? "bg-green-500" : "bg-gray-200"}`} title="Meta Description" />
                          <div className={`h-1 w-6 rounded-full ${page.ogTitle || page.ogDescription ? "bg-green-500" : "bg-gray-200"}`} title="OG Tags" />
                          <div className={`h-1 w-6 rounded-full ${page.ogImageUrl ? "bg-green-500" : "bg-gray-200"}`} title="OG Image" />
                        </div>
                      </div>
                      <Button variant="ghost" size="sm"><Pencil className="w-4 h-4" /></Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="w-5 h-5" /> SEO Settings: {editing?.title}
            </DialogTitle>
          </DialogHeader>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-5">
              <div className="space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-1.5">Search Engine</h3>
                <div>
                  <Label className="text-xs">SEO Title <span className="text-muted-foreground">({form.metaTitle.length}/60)</span></Label>
                  <Input value={form.metaTitle} onChange={e => setForm(f => ({ ...f, metaTitle: e.target.value }))}
                    placeholder={globalSeo?.seoMetaTitle || "Uses global default"} maxLength={70} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Meta Description <span className="text-muted-foreground">({form.metaDescription.length}/160)</span></Label>
                  <Textarea value={form.metaDescription} onChange={e => setForm(f => ({ ...f, metaDescription: e.target.value }))}
                    placeholder={globalSeo?.seoMetaDescription || "Uses global default"} maxLength={170} rows={3} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">URL Slug</Label>
                  <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
                    className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Canonical URL</Label>
                  <Input value={form.canonicalUrl} onChange={e => setForm(f => ({ ...f, canonicalUrl: e.target.value }))}
                    placeholder={`${baseUrl}/${form.slug}`} className="mt-1" />
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch checked={form.robotsIndex} onCheckedChange={v => setForm(f => ({ ...f, robotsIndex: v }))} />
                    <Label className="text-xs">Index</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.robotsFollow} onCheckedChange={v => setForm(f => ({ ...f, robotsFollow: v }))} />
                    <Label className="text-xs">Follow</Label>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-sm">Open Graph</h3>
                <div>
                  <Label className="text-xs">OG Title</Label>
                  <Input value={form.ogTitle} onChange={e => setForm(f => ({ ...f, ogTitle: e.target.value }))}
                    placeholder={form.metaTitle || globalSeo?.ogTitle || "Falls back to SEO title"} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">OG Description</Label>
                  <Textarea value={form.ogDescription} onChange={e => setForm(f => ({ ...f, ogDescription: e.target.value }))}
                    placeholder={form.metaDescription || globalSeo?.ogDescription || "Falls back to meta description"} rows={2} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">OG Image URL</Label>
                  <Input value={form.ogImageUrl} onChange={e => setForm(f => ({ ...f, ogImageUrl: e.target.value }))}
                    placeholder={globalSeo?.ogImageUrl || "https://..."} className="mt-1" />
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-sm">Twitter Card</h3>
                <div>
                  <Label className="text-xs">Twitter Title</Label>
                  <Input value={form.twitterTitle} onChange={e => setForm(f => ({ ...f, twitterTitle: e.target.value }))}
                    placeholder={form.ogTitle || "Falls back to OG title"} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Twitter Description</Label>
                  <Textarea value={form.twitterDescription} onChange={e => setForm(f => ({ ...f, twitterDescription: e.target.value }))}
                    placeholder={form.ogDescription || "Falls back to OG description"} rows={2} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Twitter Image URL</Label>
                  <Input value={form.twitterImageUrl} onChange={e => setForm(f => ({ ...f, twitterImageUrl: e.target.value }))}
                    placeholder={form.ogImageUrl || "Falls back to OG image"} className="mt-1" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <GooglePreview
                title={form.metaTitle || globalSeo?.seoMetaTitle || editing?.title || ""}
                description={form.metaDescription || globalSeo?.seoMetaDescription || ""}
                slug={form.slug}
                baseUrl={baseUrl}
              />
              <SocialPreview
                title={form.ogTitle || form.metaTitle || globalSeo?.ogTitle || editing?.title || ""}
                description={form.ogDescription || form.metaDescription || globalSeo?.ogDescription || ""}
                image={form.ogImageUrl || globalSeo?.ogImageUrl || ""}
                siteName={siteName}
              />
              <Card className="p-3 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground mb-1">Robots Directive</p>
                <code className="text-xs font-mono">
                  {form.robotsIndex ? "index" : "noindex"}, {form.robotsFollow ? "follow" : "nofollow"}
                </code>
              </Card>
              {form.canonicalUrl && (
                <Card className="p-3 bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Canonical URL</p>
                  <p className="text-xs font-mono truncate">{form.canonicalUrl}</p>
                </Card>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editing && saveMutation.mutate({ id: editing.id, data: form })} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              Save SEO Settings
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
