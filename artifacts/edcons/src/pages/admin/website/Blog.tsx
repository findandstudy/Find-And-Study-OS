import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen, Plus, Edit, Trash2, Search, Eye, EyeOff, Clock, Tag, FolderOpen, Star, Archive, User, Sparkles, ExternalLink, LayoutTemplate, Monitor,
} from "lucide-react";
import { AiAssistantPanel, AiFieldButton } from "@/components/AiAssistantPanel";
import { SUPPORTED_LANGUAGES, LANGUAGE_META } from "@/lib/i18n";
import { sanitizePublicHtmlContent } from "@/lib/publicHtmlSanitizer";
import "@/pages/public/guideEditorial.css";

interface BlogPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  content: BlogPostContent;
  featuredImageUrl: string | null;
  status: string;
  authorId: number | null;
  categoryId: number | null;
  locale: string;
  metaTitle: string | null;
  metaDescription: string | null;
  translationsJson: Record<string, unknown> | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BlogPostContent {
  body?: string;
  featured?: boolean;
  readTime?: number;
  ogImageUrl?: string;
  seo?: {
    canonicalUrl?: string;
    robotsIndex?: boolean;
    robotsFollow?: boolean;
    ogTitle?: string;
    ogDescription?: string;
    ogImageUrl?: string;
    twitterTitle?: string;
    twitterDescription?: string;
    twitterImageUrl?: string;
  };
  sources?: Array<{ url: string; title?: string }>;
  aiGeneration?: { provider?: string; sourceCount?: number; generatedAt?: string };
}

interface BlogCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
}

interface BlogTag {
  id: number;
  name: string;
  slug: string;
}

interface BlogPostTag {
  id: number;
  postId: number;
  tagId: number;
}

interface UserSummary {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

interface UsersResponse {
  data?: UserSummary[];
}

interface WebsitePageSummary {
  id: number;
  template: string;
  locale: string;
}

interface PostFormData {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  featuredImageUrl: string;
  categoryId: string;
  authorId: string;
  locale: string;
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  robotsIndex: boolean;
  robotsFollow: boolean;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
  twitterTitle: string;
  twitterDescription: string;
  twitterImageUrl: string;
  featured: boolean;
  selectedTagIds: number[];
  status: string;
  publishDate: string;
}

interface CategoryFormData {
  name: string;
  slug: string;
  description: string;
}

interface TagFormData {
  name: string;
  slug: string;
}

interface BlogPostPayload {
  title: string;
  slug: string;
  excerpt: string | null;
  content: BlogPostContent;
  featuredImageUrl: string | null;
  categoryId: number | null;
  authorId: number | null;
  locale: string;
  metaTitle: string | null;
  metaDescription: string | null;
  status: string;
  publishedAt: string | null;
}

interface CategoryPayload {
  name: string;
  slug: string;
  description: string | null;
}

interface TagPayload {
  name: string;
  slug: string;
}

interface AiBlogBrief {
  topic: string;
  sourceUrls: string;
  sourceNotes: string;
  audience: string;
  instructions: string;
  locale: string;
  tone: "authoritative" | "helpful" | "practical" | "inspiring";
  length: "short" | "standard" | "deep";
}

interface AiBlogGenerationResponse {
  post: BlogPost;
  draft: {
    tagIds: number[];
    categoryId: number | null;
    authorId: number | null;
  };
  sources: Array<{ url: string; title: string; used: boolean; warning?: string }>;
  provider: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readTime(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

const EMPTY_FORM: PostFormData = {
  title: "", slug: "", excerpt: "", body: "", featuredImageUrl: "",
  categoryId: "", authorId: "", locale: "en", metaTitle: "", metaDescription: "",
  canonicalUrl: "", robotsIndex: true, robotsFollow: true,
  ogTitle: "", ogDescription: "", ogImageUrl: "",
  twitterTitle: "", twitterDescription: "", twitterImageUrl: "",
  featured: false, selectedTagIds: [], status: "draft", publishDate: "",
};

const EMPTY_AI_BRIEF: AiBlogBrief = {
  topic: "",
  sourceUrls: "",
  sourceNotes: "",
  audience: "Prospective international students and their families",
  instructions: "",
  locale: "en",
  tone: "helpful",
  length: "standard",
};

export default function WebsiteBlog({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("posts");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editPost, setEditPost] = useState<BlogPost | null>(null);
  const [showPostDialog, setShowPostDialog] = useState(false);
  const [form, setForm] = useState<PostFormData>({ ...EMPTY_FORM });
  const [autoSlug, setAutoSlug] = useState(true);
  const [editLocale, setEditLocale] = useState("en");
  const defaultFormRef = useRef<PostFormData>({ ...EMPTY_FORM });
  const blogTranslationsRef = useRef<Record<string, Partial<PostFormData>>>({});

  const [catDialog, setCatDialog] = useState(false);
  const [editCat, setEditCat] = useState<BlogCategory | null>(null);
  const [catForm, setCatForm] = useState<CategoryFormData>({ name: "", slug: "", description: "" });

  const [tagDialog, setTagDialog] = useState(false);
  const [editTag, setEditTag] = useState<BlogTag | null>(null);
  const [tagForm, setTagForm] = useState<TagFormData>({ name: "", slug: "" });
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [aiBrief, setAiBrief] = useState<AiBlogBrief>({ ...EMPTY_AI_BRIEF });

  const { data: posts = [] } = useQuery<BlogPost[]>({
    queryKey: ["website-blog-posts"],
    queryFn: () => customFetch("/api/website/blog-posts"),
  });

  const { data: categories = [] } = useQuery<BlogCategory[]>({
    queryKey: ["website-blog-categories"],
    queryFn: () => customFetch("/api/website/blog-categories"),
  });

  const { data: tags = [] } = useQuery<BlogTag[]>({
    queryKey: ["website-blog-tags"],
    queryFn: () => customFetch("/api/website/blog-tags"),
  });

  const { data: postTags = [] } = useQuery<BlogPostTag[]>({
    queryKey: ["website-blog-post-tags"],
    queryFn: () => customFetch("/api/website/blog-post-tags"),
  });

  const { data: users = [] } = useQuery<UserSummary[]>({
    queryKey: ["users-for-blog"],
    queryFn: async () => {
      const res: UserSummary[] | UsersResponse = await customFetch("/api/users");
      if (Array.isArray(res)) return res;
      return res.data ?? [];
    },
  });

  const { data: managedPages = [] } = useQuery<WebsitePageSummary[]>({
    queryKey: ["website-pages-for-blog-workspace"],
    queryFn: () => customFetch("/api/website/pages"),
  });
  const blogLanding = managedPages.find(page => page.template === "blog" && page.locale === "en")
    ?? managedPages.find(page => page.template === "blog");
  const { data: aiStatus } = useQuery<{ configured: boolean; provider: string | null }>({
    queryKey: ["/api/website/ai/status"],
    queryFn: () => customFetch("/api/website/ai/status"),
    staleTime: 60_000,
  });

  const saveMut = useMutation({
    mutationFn: (data: BlogPostPayload) => {
      if (editPost) return customFetch(`/api/website/blog-posts/${editPost.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      return customFetch("/api/website/blog-posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["website-blog-posts"] });
      setShowPostDialog(false);
      toast({ title: editPost ? "Post updated" : "Post created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => customFetch(`/api/website/blog-posts/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-posts"] }); toast({ title: "Post deleted" }); },
  });

  const publishMut = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "publish" | "unpublish" }) =>
      customFetch(`/api/website/blog-posts/${id}/${action}`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-posts"] }); toast({ title: "Status updated" }); },
  });

  const archiveMut = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/website/blog-posts/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "archived" }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-posts"] }); toast({ title: "Post archived" }); },
  });

  const postTagMut = useMutation({
    mutationFn: (data: { postId: number; tagId: number }) =>
      customFetch("/api/website/blog-post-tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website-blog-post-tags"] }),
  });

  const postTagDelMut = useMutation({
    mutationFn: (id: number) => customFetch(`/api/website/blog-post-tags/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website-blog-post-tags"] }),
  });

  const catMut = useMutation({
    mutationFn: (data: CategoryPayload) => {
      if (editCat) return customFetch(`/api/website/blog-categories/${editCat.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      return customFetch("/api/website/blog-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-categories"] }); setCatDialog(false); toast({ title: editCat ? "Category updated" : "Category created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const catDelMut = useMutation({
    mutationFn: (id: number) => customFetch(`/api/website/blog-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-categories"] }); toast({ title: "Category deleted" }); },
  });

  const tagMut = useMutation({
    mutationFn: (data: TagPayload) => {
      if (editTag) return customFetch(`/api/website/blog-tags/${editTag.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      return customFetch("/api/website/blog-tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-tags"] }); setTagDialog(false); toast({ title: editTag ? "Tag updated" : "Tag created" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const tagDelMut = useMutation({
    mutationFn: (id: number) => customFetch(`/api/website/blog-tags/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-tags"] }); toast({ title: "Tag deleted" }); },
  });

  const generatePostMut = useMutation({
    mutationFn: () => customFetch("/api/website/ai/generate-blog-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...aiBrief,
        sourceUrls: aiBrief.sourceUrls.split(/\r?\n/).map(url => url.trim()).filter(Boolean),
      }),
    }) as Promise<AiBlogGenerationResponse>,
    onSuccess: data => {
      qc.invalidateQueries({ queryKey: ["website-blog-posts"] });
      qc.invalidateQueries({ queryKey: ["website-blog-post-tags"] });
      setShowAiGenerator(false);
      setAiBrief({ ...EMPTY_AI_BRIEF });
      openEditPost(data.post);
      setEditLocale(data.post.locale || "en");
      setForm(current => ({ ...current, selectedTagIds: data.draft.tagIds }));
      const used = data.sources.filter(source => source.used).length;
      const unavailable = data.sources.length - used;
      toast({
        title: "AI draft created",
        description: `${used} web source${used === 1 ? "" : "s"} used${unavailable ? `; ${unavailable} could not be read` : ""}. Review before publishing.`,
      });
    },
    onError: (error: Error) => toast({ title: "AI draft could not be created", description: error.message, variant: "destructive" }),
  });

  function openNewPost() {
    setEditPost(null);
    setForm({ ...EMPTY_FORM });
    defaultFormRef.current = { ...EMPTY_FORM };
    blogTranslationsRef.current = {};
    setEditLocale("en");
    setAutoSlug(true);
    setShowPostDialog(true);
  }

  function openEditPost(p: BlogPost) {
    setEditPost(p);
    const content = p.content ?? {};
    const bodyText = content.body ?? "";
    const assignedTagIds = postTags.filter(pt => pt.postId === p.id).map(pt => pt.tagId);
    const pubDate = p.publishedAt ? new Date(p.publishedAt).toISOString().slice(0, 16) : "";
    const formData: PostFormData = {
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt ?? "",
      body: bodyText,
      featuredImageUrl: p.featuredImageUrl ?? "",
      categoryId: p.categoryId ? String(p.categoryId) : "",
      authorId: p.authorId ? String(p.authorId) : "",
      locale: p.locale || "en",
      metaTitle: p.metaTitle ?? "",
      metaDescription: p.metaDescription ?? "",
      canonicalUrl: content.seo?.canonicalUrl ?? "",
      robotsIndex: content.seo?.robotsIndex !== false,
      robotsFollow: content.seo?.robotsFollow !== false,
      ogTitle: content.seo?.ogTitle ?? "",
      ogDescription: content.seo?.ogDescription ?? "",
      ogImageUrl: content.seo?.ogImageUrl ?? content.ogImageUrl ?? "",
      twitterTitle: content.seo?.twitterTitle ?? "",
      twitterDescription: content.seo?.twitterDescription ?? "",
      twitterImageUrl: content.seo?.twitterImageUrl ?? "",
      featured: !!content.featured,
      selectedTagIds: assignedTagIds,
      status: p.status,
      publishDate: pubDate,
    };
    setForm(formData);
    defaultFormRef.current = { ...formData };
    setEditLocale("en");
    blogTranslationsRef.current = {};
    if (p.translationsJson && typeof p.translationsJson === "object") {
      for (const [loc, data] of Object.entries(p.translationsJson as Record<string, unknown>)) {
        if (data && typeof data === "object") {
          blogTranslationsRef.current[loc] = data as Partial<PostFormData>;
        }
      }
    }
    setAutoSlug(false);
    setShowPostDialog(true);
  }

  async function handleSavePost() {
    if (!form.title.trim() || !form.slug.trim()) {
      toast({ title: "Title and slug are required", variant: "destructive" });
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim())) {
      toast({ title: "Invalid slug", description: "Use lowercase letters, numbers and single hyphens.", variant: "destructive" });
      return;
    }
    if (form.status === "published" && !form.body.trim()) {
      toast({ title: "Published articles need content", variant: "destructive" });
      return;
    }
    if (form.canonicalUrl.trim()) {
      const expected = editPost ? new RegExp(`^/${form.locale}/guides/[a-z0-9-]+-${editPost.id}$`) : null;
      if (!expected?.test(form.canonicalUrl.trim())) {
        toast({ title: "Canonical path is not valid", description: editPost ? `Use /${form.locale}/guides/article-slug-${editPost.id}, or leave it empty.` : "Save the new article first, then add a canonical override if needed.", variant: "destructive" });
        return;
      }
    }

    const rt = readTime(form.body);
    const publishedAt = form.status === "published" && form.publishDate
      ? new Date(form.publishDate).toISOString()
      : form.status === "published" ? new Date().toISOString() : null;

    const TRANSLATABLE_BLOG = ["title", "excerpt", "body", "metaTitle", "metaDescription", "ogTitle", "ogDescription", "twitterTitle", "twitterDescription"] as const;
    if (editLocale !== "en") {
      const partial: Record<string, string> = {};
      for (const f of TRANSLATABLE_BLOG) partial[f] = form[f];
      blogTranslationsRef.current[editLocale] = partial as Partial<PostFormData>;
    }

    const baseForm = editLocale === "en" ? form : defaultFormRef.current;
    const translationsPayload = Object.keys(blogTranslationsRef.current).length > 0
      ? blogTranslationsRef.current : undefined;

    const payload: BlogPostPayload & { translationsJson?: unknown } = {
      title: baseForm.title.trim(),
      slug: baseForm.slug.trim(),
      excerpt: baseForm.excerpt.trim() || null,
      content: {
        body: baseForm.body,
        featured: baseForm.featured,
        readTime: rt,
        seo: {
          canonicalUrl: baseForm.canonicalUrl.trim() || undefined,
          robotsIndex: baseForm.robotsIndex,
          robotsFollow: baseForm.robotsFollow,
          ogTitle: baseForm.ogTitle.trim() || undefined,
          ogDescription: baseForm.ogDescription.trim() || undefined,
          ogImageUrl: baseForm.ogImageUrl.trim() || undefined,
          twitterTitle: baseForm.twitterTitle.trim() || undefined,
          twitterDescription: baseForm.twitterDescription.trim() || undefined,
          twitterImageUrl: baseForm.twitterImageUrl.trim() || undefined,
        },
      },
      featuredImageUrl: baseForm.featuredImageUrl || null,
      categoryId: baseForm.categoryId ? parseInt(baseForm.categoryId) : null,
      authorId: baseForm.authorId ? parseInt(baseForm.authorId) : null,
      locale: baseForm.locale,
      metaTitle: baseForm.metaTitle || null,
      metaDescription: baseForm.metaDescription || null,
      status: baseForm.status,
      publishedAt,
    };
    if (translationsPayload) payload.translationsJson = translationsPayload;

    saveMut.mutate(payload, {
      onSuccess: async (savedPost: BlogPost) => {
        const postId = editPost?.id ?? savedPost?.id;
        if (!postId) return;

        const currentAssigned = postTags.filter(pt => pt.postId === postId);
        const toRemove = currentAssigned.filter(pt => !form.selectedTagIds.includes(pt.tagId));
        const toAdd = form.selectedTagIds.filter(tid => !currentAssigned.some(pt => pt.tagId === tid));

        for (const pt of toRemove) {
          await customFetch(`/api/website/blog-post-tags/${pt.id}`, { method: "DELETE" });
        }
        for (const tid of toAdd) {
          await customFetch("/api/website/blog-post-tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId, tagId: tid }) });
        }
        qc.invalidateQueries({ queryKey: ["website-blog-post-tags"] });
      },
    });
  }

  function toggleTag(tagId: number) {
    setForm(f => ({
      ...f,
      selectedTagIds: f.selectedTagIds.includes(tagId)
        ? f.selectedTagIds.filter(id => id !== tagId)
        : [...f.selectedTagIds, tagId],
    }));
  }

  useEffect(() => {
    if (autoSlug && form.title) setForm(f => ({ ...f, slug: slugify(f.title) }));
  }, [form.title, autoSlug]);

  const filtered = posts.filter(p => {
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  function getCatName(id: number | null): string {
    return categories.find(c => c.id === id)?.name ?? "-";
  }

  function getAuthorName(id: number | null): string {
    if (!id) return "-";
    const u = users.find(u => u.id === id);
    return u ? `${u.firstName} ${u.lastName}` : "-";
  }

  function getPostTagNames(postId: number): string[] {
    const tagIds = postTags.filter(pt => pt.postId === postId).map(pt => pt.tagId);
    return tags.filter(t => tagIds.includes(t.id)).map(t => t.name);
  }

  const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    published: { label: "Published", variant: "default" },
    draft: { label: "Draft", variant: "secondary" },
    archived: { label: "Archived", variant: "outline" },
  };

  return (
    <>
      <div className={embedded ? "space-y-6" : "max-w-6xl mx-auto p-6 space-y-6"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-primary" />
            <div>
            <h1 className="text-2xl font-bold">Blog</h1>
              <p className="text-sm text-muted-foreground">Create articles, translations and article SEO. The managed Blog page controls the listing layout.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {blogLanding && <Button asChild variant="outline"><a href={`/admin/website/pages/${blogLanding.id}/edit`}><LayoutTemplate className="me-2 h-4 w-4" />Edit blog page</a></Button>}
            <Button asChild variant="outline"><a href="/en/blog" target="_blank" rel="noopener noreferrer"><ExternalLink className="me-2 h-4 w-4" />Open public blog</a></Button>
            <Button variant="outline" onClick={() => setShowAiGenerator(true)}><Sparkles className="me-2 h-4 w-4 text-violet-600" />Create with AI</Button>
            <Button onClick={openNewPost}><Plus className="me-2 h-4 w-4" />New post</Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Card className="border-primary/15 bg-primary/[0.035] p-4">
            <p className="flex items-center gap-2 font-semibold"><LayoutTemplate className="h-4 w-4 text-primary" />Blog listing page</p>
            <p className="mt-1 text-sm text-muted-foreground">Hero, filters, cards slot and supporting sections are edited from the managed Blog page.</p>
          </Card>
          <Card className="border-primary/15 bg-primary/[0.035] p-4">
            <p className="flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4 text-primary" />Blog articles</p>
            <p className="mt-1 text-sm text-muted-foreground">Title, body/HTML, media, categories, translations, publishing and article-level SEO are managed here.</p>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="rounded-xl bg-secondary/50 p-1">
            <TabsTrigger value="posts" className="rounded-lg gap-2"><BookOpen className="w-4 h-4" /> Posts ({posts.length})</TabsTrigger>
            <TabsTrigger value="categories" className="rounded-lg gap-2"><FolderOpen className="w-4 h-4" /> Categories ({categories.length})</TabsTrigger>
            <TabsTrigger value="tags" className="rounded-lg gap-2"><Tag className="w-4 h-4" /> Tags ({tags.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="mt-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex gap-3 flex-1 items-center">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search posts..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 rounded-xl" />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setShowAiGenerator(true)} className="rounded-xl gap-2"><Sparkles className="w-4 h-4 text-violet-600" /> Create with AI</Button>
                <Button onClick={openNewPost} className="rounded-xl gap-2"><Plus className="w-4 h-4" /> New Post</Button>
              </div>
            </div>

            <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/30">
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Title</th>
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Author</th>
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Category</th>
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Tags</th>
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Status</th>
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Date</th>
                    <th className="py-3 px-4 text-right font-semibold text-muted-foreground">Actions</th>
                  </tr></thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">No posts found</td></tr>
                    ) : filtered.map(p => (
                      <tr key={p.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                        <td className="py-3 px-4">
                          <div>
                            <p className="font-medium text-foreground">{p.title}</p>
                            <p className="text-xs text-muted-foreground">/{p.slug}</p>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground text-xs">{getAuthorName(p.authorId)}</td>
                        <td className="py-3 px-4 text-muted-foreground text-xs">{getCatName(p.categoryId)}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {getPostTagNames(p.id).map(tn => (
                              <Badge key={tn} variant="outline" className="text-[10px]">{tn}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {(() => {
                            const sb = STATUS_BADGE[p.status] ?? { label: p.status, variant: "secondary" as const };
                            return <Badge variant={sb.variant} className="text-xs">{sb.label}</Badge>;
                          })()}
                          {p.content?.featured && <Badge variant="outline" className="ml-1 text-xs border-amber-300 text-amber-600"><Star className="w-3 h-3 mr-1" />Featured</Badge>}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground text-xs">
                          {p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : new Date(p.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex gap-1 justify-end">
                            <Button size="icon" variant="ghost" className="w-7 h-7" title="Edit" onClick={() => openEditPost(p)}><Edit className="w-3.5 h-3.5" /></Button>
                            {p.status === "published" && <Button asChild size="icon" variant="ghost" className="w-7 h-7" title="Open public article"><a href={`/${p.locale}/guides/${p.slug}-${p.id}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5" /></a></Button>}
                            {p.status !== "archived" && (
                              <Button size="icon" variant="ghost" className="w-7 h-7" title={p.status === "published" ? "Unpublish" : "Publish"}
                                onClick={() => publishMut.mutate({ id: p.id, action: p.status === "published" ? "unpublish" : "publish" })}>
                                {p.status === "published" ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </Button>
                            )}
                            {p.status !== "archived" && (
                              <Button size="icon" variant="ghost" className="w-7 h-7" title="Archive" onClick={() => { if (confirm("Archive this post?")) archiveMut.mutate(p.id); }}>
                                <Archive className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive" title="Delete" onClick={() => { if (confirm("Delete this post?")) deleteMut.mutate(p.id); }}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="categories" className="mt-6 space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-muted-foreground text-sm">Organize your blog posts with categories.</p>
              <Button onClick={() => { setEditCat(null); setCatForm({ name: "", slug: "", description: "" }); setCatDialog(true); }} className="rounded-xl gap-2"><Plus className="w-4 h-4" /> Add Category</Button>
            </div>
            <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/30">
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Name</th>
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Slug</th>
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Description</th>
                    <th className="py-3 px-4 text-right font-semibold text-muted-foreground">Actions</th>
                  </tr></thead>
                  <tbody>
                    {categories.length === 0 ? (
                      <tr><td colSpan={4} className="py-12 text-center text-muted-foreground">No categories yet</td></tr>
                    ) : categories.map(c => (
                      <tr key={c.id} className="border-b border-border/30 hover:bg-secondary/30">
                        <td className="py-3 px-4 font-medium">{c.name}</td>
                        <td className="py-3 px-4 text-muted-foreground">{c.slug}</td>
                        <td className="py-3 px-4 text-muted-foreground text-xs">{c.description || "-"}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex gap-1 justify-end">
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => { setEditCat(c); setCatForm({ name: c.name, slug: c.slug, description: c.description || "" }); setCatDialog(true); }}><Edit className="w-3.5 h-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive" onClick={() => { if (confirm("Delete?")) catDelMut.mutate(c.id); }}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="tags" className="mt-6 space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-muted-foreground text-sm">Add tags for flexible post filtering.</p>
              <Button onClick={() => { setEditTag(null); setTagForm({ name: "", slug: "" }); setTagDialog(true); }} className="rounded-xl gap-2"><Plus className="w-4 h-4" /> Add Tag</Button>
            </div>
            <div className="flex flex-wrap gap-3">
              {tags.length === 0 ? (
                <p className="text-muted-foreground text-sm py-8 text-center w-full">No tags yet</p>
              ) : tags.map(t => (
                <Card key={t.id} className="flex items-center gap-2 px-4 py-2 border-none shadow-md">
                  <Tag className="w-3.5 h-3.5 text-primary" />
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">({t.slug})</span>
                  <Button size="icon" variant="ghost" className="w-6 h-6 ml-1" onClick={() => { setEditTag(t); setTagForm({ name: t.name, slug: t.slug }); setTagDialog(true); }}><Edit className="w-3 h-3" /></Button>
                  <Button size="icon" variant="ghost" className="w-6 h-6 text-destructive" onClick={() => { if (confirm("Delete?")) tagDelMut.mutate(t.id); }}><Trash2 className="w-3 h-3" /></Button>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={showAiGenerator} onOpenChange={setShowAiGenerator}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-600" />Create a sourced article with AI</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 text-sm text-violet-950">
              <p className="font-semibold">One action creates a complete draft</p>
              <p className="mt-1 text-violet-900/70">The system reads the supplied public sources, creates the article HTML, fills SEO and social fields, selects existing categories and tags, and saves the result as a draft. Nothing is published automatically.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Article topic *</Label>
              <Input value={aiBrief.topic} onChange={event => setAiBrief(value => ({ ...value, topic: event.target.value }))} placeholder="Example: A practical guide to UK student visa documents" className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label>Public source URLs</Label>
              <Textarea value={aiBrief.sourceUrls} onChange={event => setAiBrief(value => ({ ...value, sourceUrls: event.target.value }))} rows={4} className="rounded-xl font-mono text-xs" placeholder={"https://official-source.example/page\nhttps://university.example/requirements"} />
              <p className="text-xs text-muted-foreground">One HTTPS URL per line, maximum four. Private/local addresses, oversized pages and unsupported files are rejected.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Pasted source notes</Label>
              <Textarea value={aiBrief.sourceNotes} onChange={event => setAiBrief(value => ({ ...value, sourceNotes: event.target.value }))} rows={5} className="rounded-xl" placeholder="Paste verified notes, facts or a source excerpt here..." />
              <p className="text-xs text-muted-foreground">At least one URL or a source note is required. Source content is treated as evidence, never as an instruction.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Audience</Label>
                <Input value={aiBrief.audience} onChange={event => setAiBrief(value => ({ ...value, audience: event.target.value }))} className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Select value={aiBrief.locale} onValueChange={locale => setAiBrief(value => ({ ...value, locale }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>{SUPPORTED_LANGUAGES.map(code => <SelectItem key={code} value={code}>{LANGUAGE_META[code].flag} {LANGUAGE_META[code].name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Tone</Label>
                <Select value={aiBrief.tone} onValueChange={tone => setAiBrief(value => ({ ...value, tone: tone as AiBlogBrief["tone"] }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="helpful">Helpful</SelectItem><SelectItem value="practical">Practical</SelectItem><SelectItem value="authoritative">Authoritative</SelectItem><SelectItem value="inspiring">Inspiring</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Article depth</Label>
                <Select value={aiBrief.length} onValueChange={length => setAiBrief(value => ({ ...value, length: length as AiBlogBrief["length"] }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="short">Short · 700–900 words</SelectItem><SelectItem value="standard">Standard · 1,000–1,400</SelectItem><SelectItem value="deep">Deep guide · 1,600–2,200</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Additional editorial direction</Label>
              <Textarea value={aiBrief.instructions} onChange={event => setAiBrief(value => ({ ...value, instructions: event.target.value }))} rows={3} className="rounded-xl" placeholder="Optional: sections to include, questions to answer, facts to avoid..." />
            </div>
            {!aiStatus?.configured && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Connect and enable OpenAI or Anthropic in Settings → Integrations first.</p>}
            <div className="flex flex-wrap justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAiGenerator(false)} className="rounded-xl">Cancel</Button>
              <Button
                onClick={() => generatePostMut.mutate()}
                disabled={generatePostMut.isPending || !aiStatus?.configured || !aiBrief.topic.trim() || (!aiBrief.sourceUrls.trim() && !aiBrief.sourceNotes.trim())}
                className="rounded-xl gap-2 bg-violet-600 hover:bg-violet-700"
              >
                <Sparkles className={`h-4 w-4 ${generatePostMut.isPending ? "animate-pulse" : ""}`} />
                {generatePostMut.isPending ? "Reading sources and creating..." : "Create complete draft"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showPostDialog} onOpenChange={setShowPostDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editPost ? "Edit Post" : "New Post"}</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Title *</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="rounded-xl" placeholder="Post title" />
              </div>
              <div className="space-y-1.5">
                <Label>Slug *</Label>
                <div className="flex gap-2">
                  <Input value={form.slug} onChange={e => { setAutoSlug(false); setForm(f => ({ ...f, slug: e.target.value })); }} className="rounded-xl flex-1" placeholder="post-slug" />
                  {!autoSlug && <Button variant="ghost" size="sm" onClick={() => { setAutoSlug(true); setForm(f => ({ ...f, slug: slugify(f.title) })); }}>Auto</Button>}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Excerpt</Label>
                <AiFieldButton action="generateExcerpt" context={form.body || form.title} locale={form.locale} onResult={r => setForm(f => ({ ...f, excerpt: r }))} label="Generate" />
              </div>
              <Textarea value={form.excerpt} onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))} className="rounded-xl" rows={2} placeholder="Brief summary of the post" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Body (Rich Text / HTML)</Label>
                <div className="flex gap-1">
                  <AiFieldButton action="expandText" context={form.body || form.title} locale={form.locale} onResult={r => setForm(f => ({ ...f, body: r }))} label="Expand" />
                  <AiFieldButton action="improveTone" context={form.body} locale={form.locale} onResult={r => setForm(f => ({ ...f, body: r }))} label="Improve" />
                </div>
              </div>
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} className="rounded-xl font-mono text-sm" rows={12} placeholder="Write your blog post content here..." />
              <p className="text-xs text-muted-foreground">Semantic HTML is supported. Reusable layout classes: <code>blog-html-section</code>, <code>blog-html-section--surface</code>, <code>blog-html-grid</code>, <code>blog-html-card</code>, <code>blog-html-timeline</code>, <code>blog-html-table</code>, <code>blog-html-faq</code> and <code>blog-html-cta</code>. Scripts, inline styles, embeds and forms are removed.</p>
              {form.body && <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> ~{readTime(form.body)} min read</p>}
            </div>

            {editPost?.content?.sources?.length ? (
              <Card className="border-violet-200 bg-violet-50/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-600" />AI source record</p>
                  {editPost.content.aiGeneration?.provider ? <Badge variant="outline">{editPost.content.aiGeneration.provider}</Badge> : null}
                </div>
                <ul className="mt-3 space-y-2 text-xs">
                  {editPost.content.sources.map((source, index) => <li key={`${source.url}-${index}`} className="flex gap-2"><span className="text-violet-600">{index + 1}.</span><a href={source.url} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{source.title || source.url}</a></li>)}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">These references were used to prepare the draft. Always review time-sensitive requirements before publishing.</p>
              </Card>
            ) : null}

            <Card className="overflow-hidden border-dashed">
              <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold"><Monitor className="h-4 w-4 text-primary" />Live article preview</p>
                <span className="text-xs text-muted-foreground">Sanitized public output</span>
              </div>
              <article className="mx-auto max-w-2xl p-5 sm:p-7">
                {form.featuredImageUrl && <img src={form.featuredImageUrl} alt="" className="mb-6 h-48 w-full rounded-2xl object-cover" />}
                <h2 className="font-display text-3xl font-bold leading-tight">{form.title || "Article title"}</h2>
                {form.excerpt && <p className="mt-4 text-lg text-muted-foreground">{form.excerpt}</p>}
                {form.body ? <div className="guide-html prose prose-slate mt-7 max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizePublicHtmlContent(form.body) }} /> : <p className="mt-7 text-sm text-muted-foreground">Start writing to preview the article body.</p>}
              </article>
            </Card>

            <AiAssistantPanel
              context={form.body || form.excerpt || form.title}
              locale={form.locale}
              onResult={(action, result) => {
                if (action === "generateExcerpt") setForm(f => ({ ...f, excerpt: result }));
                else if (action === "generateMetaTitle") setForm(f => ({ ...f, metaTitle: result }));
                else if (action === "generateMetaDescription") setForm(f => ({ ...f, metaDescription: result }));
                else if (action === "generateBlogOutline" || action === "expandText") setForm(f => ({ ...f, body: result }));
                else if (action === "improveTone" || action === "shortenText") setForm(f => ({ ...f, body: result }));
                else if (action === "generateFAQItems") setForm(f => ({ ...f, body: f.body + "\n\n## FAQ\n" + result }));
                else if (action === "generateHeroTitle") setForm(f => ({ ...f, title: result }));
                else if (action === "generateCTAText" || action === "generateAltText") setForm(f => ({ ...f, body: f.body + "\n\n" + result }));
                else if (action === "generateOGText") {
                  try {
                    const og = JSON.parse(result);
                    setForm(f => ({ ...f, metaTitle: og.title || f.metaTitle, metaDescription: og.description || f.metaDescription }));
                  } catch { setForm(f => ({ ...f, metaDescription: result })); }
                }
              }}
            />

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Cover Image URL</Label>
                <Input value={form.featuredImageUrl} onChange={e => setForm(f => ({ ...f, featuredImageUrl: e.target.value }))} className="rounded-xl" placeholder="https://..." />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.categoryId || "__none__"} onValueChange={v => setForm(f => ({ ...f, categoryId: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Author</Label>
                <Select value={form.authorId || "__none__"} onValueChange={v => setForm(f => ({ ...f, authorId: v === "__none__" ? "" : v }))}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select author" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {users.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.firstName} {u.lastName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Editing Locale</Label>
                <Select value={editLocale} onValueChange={v => {
                  const TRANSLATABLE = ["title", "excerpt", "body", "metaTitle", "metaDescription", "ogTitle", "ogDescription", "twitterTitle", "twitterDescription"] as const;
                  if (editLocale === "en") {
                    defaultFormRef.current = { ...form };
                  } else {
                    const partial: Record<string, string> = {};
                    for (const f of TRANSLATABLE) partial[f] = form[f];
                    blogTranslationsRef.current[editLocale] = partial as Partial<PostFormData>;
                  }
                  if (v === "en") {
                    setForm({ ...defaultFormRef.current });
                  } else {
                    const base = { ...defaultFormRef.current };
                    const tr = blogTranslationsRef.current[v];
                    if (tr && Object.values(tr).some(val => val && String(val).trim())) {
                      setForm({ ...base, ...tr });
                    } else {
                      setForm(base);
                      toast({ title: "No translation yet", description: "Showing default content. Edit to create translation." });
                    }
                  }
                  setEditLocale(v);
                }}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map(code => (
                      <SelectItem key={code} value={code}>{LANGUAGE_META[code].flag} {LANGUAGE_META[code].name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-0.5 mt-1">
                  {SUPPORTED_LANGUAGES.filter(l => l !== "en").slice(0, 5).map(l => {
                    const tr = blogTranslationsRef.current[l];
                    const has = tr && Object.values(tr).some(v => v && String(v).trim());
                    return <span key={l} className={`text-[9px] ${has ? "text-green-600" : "text-muted-foreground/40"}`} title={`${LANGUAGE_META[l].name}: ${has ? "translated" : "not translated"}`}>{has ? "●" : "○"}</span>;
                  })}
                </div>
                {editLocale !== "en" && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-blue-600">Editing translation for {LANGUAGE_META[editLocale as keyof typeof LANGUAGE_META]?.name}.</p>
                    <Button type="button" variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => {
                      const base = defaultFormRef.current;
                      const TRANSLATABLE = ["title", "excerpt", "body", "metaTitle", "metaDescription", "ogTitle", "ogDescription", "twitterTitle", "twitterDescription"] as const;
                      const copy: Record<string, string> = {};
                      for (const f of TRANSLATABLE) copy[f] = base[f];
                      setForm(f => ({ ...f, ...copy }));
                      toast({ title: "Copied from default (English)" });
                    }}>Copy from English</Button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {tags.map(t => (
                    <Badge
                      key={t.id}
                      variant={form.selectedTagIds.includes(t.id) ? "default" : "outline"}
                      className="cursor-pointer text-xs"
                      onClick={() => toggleTag(t.id)}
                    >
                      <Tag className="w-3 h-3 mr-1" />{t.name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No tags created yet. Add tags from the Tags tab first.</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={form.featured} onCheckedChange={v => setForm(f => ({ ...f, featured: v }))} />
              <Label className="flex items-center gap-1.5"><Star className="w-4 h-4 text-amber-500" /> Featured Post</Label>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-semibold text-sm mb-3">Publishing</h4>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Publish Date {form.status === "published" && "(auto-set if empty)"}</Label>
                  <Input type="datetime-local" value={form.publishDate} onChange={e => setForm(f => ({ ...f, publishDate: e.target.value }))} className="rounded-xl" />
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">SEO Settings <AiFieldButton action="generateMetaTitle" context={form.title + " " + (form.excerpt || form.body.slice(0, 200))} locale={form.locale} onResult={r => setForm(f => ({ ...f, metaTitle: r }))} label="AI Meta Title" /> <AiFieldButton action="generateMetaDescription" context={form.title + " " + (form.excerpt || form.body.slice(0, 300))} locale={form.locale} onResult={r => setForm(f => ({ ...f, metaDescription: r }))} label="AI Meta Desc" /></h4>
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Meta Title <span className="text-muted-foreground">({form.metaTitle.length}/60)</span></Label>
                    <Input maxLength={70} value={form.metaTitle} onChange={e => setForm(f => ({ ...f, metaTitle: e.target.value }))} className="rounded-xl" placeholder="SEO title" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Meta Description <span className="text-muted-foreground">({form.metaDescription.length}/160)</span></Label>
                    <Textarea maxLength={170} value={form.metaDescription} onChange={e => setForm(f => ({ ...f, metaDescription: e.target.value }))} className="rounded-xl" rows={3} placeholder="SEO description" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Canonical path</Label>
                  <Input dir="ltr" value={form.canonicalUrl} onChange={e => setForm(f => ({ ...f, canonicalUrl: e.target.value }))} className="rounded-xl" placeholder={`/${form.locale}/guides/${form.slug || "article"}-${editPost?.id || "id"}`} />
                  <p className="text-xs text-muted-foreground">Leave empty to use the generated locale-aware article URL. A custom path is accepted only when it keeps this article ID.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between rounded-xl border p-3 text-sm"><span><strong className="block">Search indexing</strong><span className="text-xs text-muted-foreground">Allow this published article in search results</span></span><Switch checked={form.robotsIndex} onCheckedChange={value => setForm(f => ({ ...f, robotsIndex: value }))} /></label>
                  <label className="flex items-center justify-between rounded-xl border p-3 text-sm"><span><strong className="block">Follow links</strong><span className="text-xs text-muted-foreground">Allow crawlers to follow article links</span></span><Switch checked={form.robotsFollow} onCheckedChange={value => setForm(f => ({ ...f, robotsFollow: value }))} /></label>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Open Graph title</Label><Input value={form.ogTitle} onChange={e => setForm(f => ({ ...f, ogTitle: e.target.value }))} className="rounded-xl" placeholder="Defaults to meta title" /></div>
                  <div className="space-y-1.5"><Label>Open Graph description</Label><Input value={form.ogDescription} onChange={e => setForm(f => ({ ...f, ogDescription: e.target.value }))} className="rounded-xl" placeholder="Defaults to meta description" /></div>
                </div>
                <div className="space-y-1.5">
                  <Label>OG Image URL</Label>
                  <Input value={form.ogImageUrl} onChange={e => setForm(f => ({ ...f, ogImageUrl: e.target.value }))} className="rounded-xl" placeholder="https://... (Open Graph image)" />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label>Twitter title</Label><Input value={form.twitterTitle} onChange={e => setForm(f => ({ ...f, twitterTitle: e.target.value }))} className="rounded-xl" placeholder="Defaults to Open Graph title" /></div>
                  <div className="space-y-1.5"><Label>Twitter description</Label><Input value={form.twitterDescription} onChange={e => setForm(f => ({ ...f, twitterDescription: e.target.value }))} className="rounded-xl" placeholder="Defaults to Open Graph description" /></div>
                </div>
                <div className="space-y-1.5"><Label>Twitter image URL</Label><Input value={form.twitterImageUrl} onChange={e => setForm(f => ({ ...f, twitterImageUrl: e.target.value }))} className="rounded-xl" placeholder="Defaults to Open Graph image" /></div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border bg-white p-4 text-slate-900"><p className="text-xs text-emerald-700">findandstudy.com</p><p className="mt-1 truncate text-lg text-blue-700">{form.metaTitle || form.title || "Article title"}</p><p className="mt-1 line-clamp-2 text-sm text-slate-600">{form.metaDescription || form.excerpt || "Add a meta description for the search preview."}</p></div>
                  <div className="overflow-hidden rounded-xl border bg-white text-slate-900">{form.ogImageUrl ? <img src={form.ogImageUrl} alt="" className="h-28 w-full object-cover" /> : <div className="flex h-28 items-center justify-center bg-slate-100 text-xs text-slate-500">Social image preview</div>}<div className="p-3"><p className="truncate font-semibold">{form.ogTitle || form.metaTitle || form.title || "Article title"}</p><p className="line-clamp-2 text-xs text-slate-600">{form.ogDescription || form.metaDescription || form.excerpt || "Social description"}</p></div></div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowPostDialog(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={handleSavePost} disabled={saveMut.isPending} className="rounded-xl">{saveMut.isPending ? "Saving..." : editPost ? "Update Post" : "Create Post"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={catDialog} onOpenChange={setCatDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editCat ? "Edit Category" : "New Category"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={catForm.name} onChange={e => { setCatForm(f => ({ ...f, name: e.target.value, slug: editCat ? f.slug : slugify(e.target.value) })); }} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label>Slug *</Label>
              <Input value={catForm.slug} onChange={e => setCatForm(f => ({ ...f, slug: e.target.value }))} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={catForm.description} onChange={e => setCatForm(f => ({ ...f, description: e.target.value }))} className="rounded-xl" rows={2} />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setCatDialog(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={() => catMut.mutate({ name: catForm.name, slug: catForm.slug, description: catForm.description || null })} disabled={catMut.isPending} className="rounded-xl">
                {editCat ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={tagDialog} onOpenChange={setTagDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editTag ? "Edit Tag" : "New Tag"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={tagForm.name} onChange={e => setTagForm(f => ({ ...f, name: e.target.value, slug: editTag ? f.slug : slugify(e.target.value) }))} className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label>Slug *</Label>
              <Input value={tagForm.slug} onChange={e => setTagForm(f => ({ ...f, slug: e.target.value }))} className="rounded-xl" />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setTagDialog(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={() => tagMut.mutate({ name: tagForm.name, slug: tagForm.slug })} disabled={tagMut.isPending} className="rounded-xl">
                {editTag ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
