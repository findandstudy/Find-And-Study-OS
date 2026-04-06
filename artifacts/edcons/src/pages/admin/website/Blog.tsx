import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
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
  BookOpen, Plus, Edit, Trash2, Search, Eye, EyeOff, Clock, Tag, FolderOpen, Star,
} from "lucide-react";

interface BlogPost {
  id: number; title: string; slug: string; excerpt: string | null;
  content: any; featuredImageUrl: string | null; status: string;
  authorId: number | null; categoryId: number | null; locale: string;
  metaTitle: string | null; metaDescription: string | null;
  publishedAt: string | null; createdAt: string; updatedAt: string;
}

interface BlogCategory { id: number; name: string; slug: string; description: string | null; sortOrder: number; }
interface BlogTag { id: number; name: string; slug: string; }

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readTime(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

const EMPTY_POST = {
  title: "", slug: "", excerpt: "", body: "", featuredImageUrl: "",
  categoryId: "", locale: "en", metaTitle: "", metaDescription: "",
  featured: false,
};

export default function WebsiteBlog() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("posts");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editPost, setEditPost] = useState<BlogPost | null>(null);
  const [showPostDialog, setShowPostDialog] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_POST });
  const [autoSlug, setAutoSlug] = useState(true);

  const [catDialog, setCatDialog] = useState(false);
  const [editCat, setEditCat] = useState<BlogCategory | null>(null);
  const [catForm, setCatForm] = useState({ name: "", slug: "", description: "" });

  const [tagDialog, setTagDialog] = useState(false);
  const [editTag, setEditTag] = useState<BlogTag | null>(null);
  const [tagForm, setTagForm] = useState({ name: "", slug: "" });

  const { data: posts = [] } = useQuery<BlogPost[]>({ queryKey: ["website-blog-posts"], queryFn: () => customFetch("/api/website/blog-posts") });
  const { data: categories = [] } = useQuery<BlogCategory[]>({ queryKey: ["website-blog-categories"], queryFn: () => customFetch("/api/website/blog-categories") });
  const { data: tags = [] } = useQuery<BlogTag[]>({ queryKey: ["website-blog-tags"], queryFn: () => customFetch("/api/website/blog-tags") });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["users-for-blog"], queryFn: () => customFetch("/api/users").then((r: any) => r.data || r) });

  const saveMut = useMutation({
    mutationFn: (data: any) => {
      if (editPost) return customFetch(`/api/website/blog-posts/${editPost.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      return customFetch("/api/website/blog-posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-posts"] }); setShowPostDialog(false); toast({ title: editPost ? "Post updated" : "Post created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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

  const catMut = useMutation({
    mutationFn: (data: any) => {
      if (editCat) return customFetch(`/api/website/blog-categories/${editCat.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      return customFetch("/api/website/blog-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-categories"] }); setCatDialog(false); toast({ title: editCat ? "Category updated" : "Category created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const catDelMut = useMutation({
    mutationFn: (id: number) => customFetch(`/api/website/blog-categories/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-categories"] }); toast({ title: "Category deleted" }); },
  });

  const tagMut = useMutation({
    mutationFn: (data: any) => {
      if (editTag) return customFetch(`/api/website/blog-tags/${editTag.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      return customFetch("/api/website/blog-tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-tags"] }); setTagDialog(false); toast({ title: editTag ? "Tag updated" : "Tag created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const tagDelMut = useMutation({
    mutationFn: (id: number) => customFetch(`/api/website/blog-tags/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["website-blog-tags"] }); toast({ title: "Tag deleted" }); },
  });

  function openNewPost() {
    setEditPost(null);
    setForm({ ...EMPTY_POST });
    setAutoSlug(true);
    setShowPostDialog(true);
  }

  function openEditPost(p: BlogPost) {
    setEditPost(p);
    const bodyText = typeof p.content === "object" && p.content?.body ? p.content.body : (typeof p.content === "string" ? p.content : "");
    setForm({
      title: p.title, slug: p.slug, excerpt: p.excerpt || "",
      body: bodyText,
      featuredImageUrl: p.featuredImageUrl || "",
      categoryId: p.categoryId ? String(p.categoryId) : "",
      locale: p.locale || "en", metaTitle: p.metaTitle || "",
      metaDescription: p.metaDescription || "",
      featured: !!(p.content as any)?.featured,
    });
    setAutoSlug(false);
    setShowPostDialog(true);
  }

  function handleSavePost() {
    if (!form.title.trim() || !form.slug.trim()) { toast({ title: "Title and slug are required", variant: "destructive" }); return; }
    const rt = readTime(form.body);
    saveMut.mutate({
      title: form.title.trim(),
      slug: form.slug.trim(),
      excerpt: form.excerpt.trim() || null,
      content: { body: form.body, featured: form.featured, readTime: rt },
      featuredImageUrl: form.featuredImageUrl || null,
      categoryId: form.categoryId ? parseInt(form.categoryId) : null,
      locale: form.locale,
      metaTitle: form.metaTitle || null,
      metaDescription: form.metaDescription || null,
    });
  }

  useEffect(() => {
    if (autoSlug && form.title) setForm(f => ({ ...f, slug: slugify(f.title) }));
  }, [form.title, autoSlug]);

  const filtered = posts.filter(p => {
    if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  function getCatName(id: number | null) { return categories.find(c => c.id === id)?.name || "-"; }
  function getAuthorName(id: number | null) {
    if (!id) return "-";
    const u = users.find((u: any) => u.id === id);
    return u ? `${u.firstName} ${u.lastName}` : "-";
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Blog</h1>
            <p className="text-sm text-muted-foreground">Manage blog posts, categories, and tags.</p>
          </div>
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
                  <SelectTrigger className="w-32 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={openNewPost} className="rounded-xl gap-2"><Plus className="w-4 h-4" /> New Post</Button>
            </div>

            <Card className="border-none shadow-lg shadow-black/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/30">
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Title</th>
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Category</th>
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Status</th>
                    <th className="py-3 px-4 text-left font-semibold text-muted-foreground">Date</th>
                    <th className="py-3 px-4 text-right font-semibold text-muted-foreground">Actions</th>
                  </tr></thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={5} className="py-12 text-center text-muted-foreground">No posts found</td></tr>
                    ) : filtered.map(p => (
                      <tr key={p.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                        <td className="py-3 px-4">
                          <div>
                            <p className="font-medium text-foreground">{p.title}</p>
                            <p className="text-xs text-muted-foreground">/{p.slug}</p>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">{getCatName(p.categoryId)}</td>
                        <td className="py-3 px-4">
                          <Badge variant={p.status === "published" ? "default" : "secondary"} className="text-xs">
                            {p.status === "published" ? <Eye className="w-3 h-3 mr-1" /> : <EyeOff className="w-3 h-3 mr-1" />}
                            {p.status}
                          </Badge>
                          {(p.content as any)?.featured && <Badge variant="outline" className="ml-1 text-xs border-amber-300 text-amber-600"><Star className="w-3 h-3 mr-1" />Featured</Badge>}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground text-xs">
                          {p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : new Date(p.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex gap-1 justify-end">
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => openEditPost(p)}><Edit className="w-3.5 h-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => publishMut.mutate({ id: p.id, action: p.status === "published" ? "unpublish" : "publish" })}>
                              {p.status === "published" ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive" onClick={() => { if (confirm("Delete this post?")) deleteMut.mutate(p.id); }}><Trash2 className="w-3.5 h-3.5" /></Button>
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
              <Label>Excerpt</Label>
              <Textarea value={form.excerpt} onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))} className="rounded-xl" rows={2} placeholder="Brief summary of the post" />
            </div>

            <div className="space-y-1.5">
              <Label>Body (Rich Text / HTML)</Label>
              <Textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} className="rounded-xl font-mono text-sm" rows={12} placeholder="Write your blog post content here..." />
              {form.body && <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> ~{readTime(form.body)} min read</p>}
            </div>

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

            <div className="flex items-center gap-3">
              <Switch checked={form.featured} onCheckedChange={v => setForm(f => ({ ...f, featured: v }))} />
              <Label className="flex items-center gap-1.5"><Star className="w-4 h-4 text-amber-500" /> Featured Post</Label>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-semibold text-sm mb-3">SEO Settings</h4>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Meta Title</Label>
                  <Input value={form.metaTitle} onChange={e => setForm(f => ({ ...f, metaTitle: e.target.value }))} className="rounded-xl" placeholder="SEO title" />
                </div>
                <div className="space-y-1.5">
                  <Label>Meta Description</Label>
                  <Input value={form.metaDescription} onChange={e => setForm(f => ({ ...f, metaDescription: e.target.value }))} className="rounded-xl" placeholder="SEO description" />
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
    </DashboardLayout>
  );
}
