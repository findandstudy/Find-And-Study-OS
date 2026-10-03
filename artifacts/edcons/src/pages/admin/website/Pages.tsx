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
import { useState } from "react";
import { useLocation } from "wouter";
import DetailTemplates from "./DetailTemplates";
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

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  published: { label: "Published", variant: "default" },
  draft: { label: "Draft", variant: "secondary" },
  archived: { label: "Archived", variant: "outline" },
};

const TEMPLATE_ICONS: Record<string, string> = {
  home: "🏠", about: "📖", countries: "🌍", programs: "📚", blog: "✍️", contact: "📧",
};

export default function WebsitePages() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ title: "", slug: "", locale: "en", starter: "blank", country: "", city: "" });

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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Pages</h1>
              <p className="text-sm text-muted-foreground">Manage your website pages and their content.</p>
            </div>
          </div>
          <Button onClick={() => { createMutation.reset(); setCreateOpen(true); }}><Plus className="w-4 h-4 me-2" />New page</Button>
        </div>

        <Dialog open={createOpen} onOpenChange={open => { if (!createMutation.isPending) setCreateOpen(open); }}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create page draft</DialogTitle>
              <DialogDescription>Start blank or use a live catalogue layout. No catalogue facts are copied. Nothing is published automatically.</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!createMutation.isPending) createMutation.mutate(); }}>
              <div className="space-y-2"><Label htmlFor="new-page-title">Title</Label><Input id="new-page-title" required maxLength={200} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="new-page-slug">Page address</Label><Input id="new-page-slug" required maxLength={150} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="study-in-turkiye" value={draft.slug} onChange={event => setDraft({ ...draft, slug: event.target.value })} aria-describedby="new-page-url" /><p id="new-page-url" className="text-xs text-muted-foreground">/{draft.locale}/{draft.slug || "your-page"} — existing system addresses cannot be replaced.</p></div>
              <div className="space-y-2"><Label htmlFor="new-page-locale">Source language</Label><Select value={draft.locale} onValueChange={locale => setDraft({ ...draft, locale })}><SelectTrigger id="new-page-locale"><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_LANGUAGES.map(locale => <SelectItem key={locale} value={locale}>{LANGUAGE_META[locale].name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="new-page-starter">Starting layout</Label><Select value={draft.starter} onValueChange={starter => setDraft({ ...draft, starter })}><SelectTrigger id="new-page-starter"><SelectValue /></SelectTrigger><SelectContent>{[["blank", "Blank page"], ["programs", "Live programs"], ["universities", "Live universities"], ["destinations", "Live destinations"], ["cities", "Live cities"]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              {draft.starter !== "blank" && <>
                <div className="space-y-2"><Label htmlFor="new-page-country">Country filter (optional)</Label><Input id="new-page-country" maxLength={120} value={draft.country} onChange={event => setDraft({ ...draft, country: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="new-page-city">City filter (optional)</Label><Input id="new-page-city" maxLength={120} value={draft.city} onChange={event => setDraft({ ...draft, city: event.target.value })} /></div>
              </>}
              {createMutation.isError && <p role="alert" className="text-sm text-destructive">Could not create the draft. Check the address is unique and not reserved, then retry. Your entries are preserved.</p>}
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={createMutation.isPending} onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Creating…" : "Create draft"}</Button></div>
            </form>
          </DialogContent>
        </Dialog>

        <CatalogPagesInventory />
        <DetailTemplates />
        <h2 className="text-xl font-semibold">CMS pages</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search pages..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isError ? <div role="alert" className="rounded-lg border p-6">Pages could not be loaded. <Button variant="outline" onClick={() => refetch()}>Retry</Button></div> : isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Globe className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No pages found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(page => {
              const badge = STATUS_BADGE[page.status] || STATUS_BADGE.draft;
              const icon = TEMPLATE_ICONS[page.template] || "📄";
              return (
                <Card key={page.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-xl shrink-0">
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">{page.title}</h3>
                        <Badge variant={badge.variant} className="text-xs">
                          {page.status === "published" ? <Eye className="w-3 h-3 mr-1" /> : <EyeOff className="w-3 h-3 mr-1" />}
                          {badge.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span>/{page.slug}</span>
                        <span>·</span>
                        <span>Template: {page.template}</span>
                        {page.publishedAt && (
                          <>
                            <span>·</span>
                            <span>Published: {new Date(page.publishedAt).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setLocation(`/admin/website/pages/${page.id}/edit`)}
                    >
                      <Edit className="w-4 h-4 mr-1" /> Edit
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
