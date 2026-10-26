import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowRight, BookOpen, Calendar, Clock, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/hooks/use-i18n";
import { useJsonLd, SITE_NAME, SITE_URL } from "@/hooks/use-json-ld";
import { useSeo } from "@/hooks/use-seo";
import { ManagedPublicPage } from "./ManagedPublicPage";
import { useTemplatePage, useTemplatePageSeo } from "./useTemplatePage";

type Guide = {
  id: number;
  title: string;
  category?: string | null;
  excerpt?: string | null;
  summary?: string | null;
  featuredImageUrl?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  canonicalPath: string;
};

export default function Blog() {
  const { t, lang } = useI18n();
  const page = useTemplatePage("blog", lang);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const { data: postsResponse, isLoading } = useQuery<{ data?: Guide[] }>({
    queryKey: ["public-web-guides", lang],
    queryFn: () => customFetch(`/api/public/web/guides?locale=${encodeURIComponent(lang)}&limit=24`, { cache: "no-store" }),
  });
  const posts = Array.isArray(postsResponse?.data) ? postsResponse.data : [];
  const categories = [
    ["All", t("blog.all")],
    ["University Guide", t("blog.universityGuide")],
    ["Visa Tips", t("blog.visaTips")],
    ["Scholarships", t("blog.scholarships")],
    ["Student Life", t("blog.studentLife")],
    ["Career Advice", t("blog.careerAdvice")],
  ];
  const filtered = posts.filter(post => (!search || post.title.toLowerCase().includes(search.toLowerCase())) && (category === "All" || post.category === category));

  useSeo({ title: page?.meta.title || t("seo.blogTitle"), description: page?.meta.description || t("seo.blogDesc"), lang,
    noindex: page ? !page.meta.indexable : false, alternates: page?.meta.alternatePaths });
  useTemplatePageSeo(page);
  useJsonLd({
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${SITE_URL}/en/blog#blog`,
    name: `${SITE_NAME} Blog`,
    url: `${SITE_URL}/en/blog`,
    description: "International education guides, application advice, scholarship information, and student stories.",
  });

  const liveBlog = <section id="articles" className="scroll-mt-28 py-14">
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl rounded-[1.5rem] border bg-card/90 p-3 shadow-lg shadow-slate-950/5">
        <div className="relative"><Search className="absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="blog-search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("blog.searchPlaceholder")} aria-label={t("blog.searchPlaceholder")} className="h-12 rounded-xl border-0 ps-12 shadow-none" /></div>
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-3" role="group" aria-label={t("blog.filterByCategory")}>
        {categories.map(([key, label]) => <button key={key} type="button" onClick={() => setCategory(key)} aria-pressed={category === key} className={`rounded-full px-5 py-2 text-sm font-medium transition ${category === key ? "bg-primary text-primary-foreground shadow-md" : "bg-secondary text-muted-foreground hover:text-primary"}`}>{label}</button>)}
      </div>
      {isLoading ? <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-80 animate-pulse rounded-3xl bg-secondary" />)}</div>
        : filtered.length === 0 ? <div className="py-24 text-center"><BookOpen className="mx-auto mb-4 h-16 w-16 text-muted-foreground/30" /><h2 className="text-xl font-bold">{t("blog.noArticles")}</h2><p className="mt-2 text-muted-foreground">{t("blog.tryAdjusting")}</p></div>
        : <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-3">{filtered.map(post => <article key={post.id} className="group flex flex-col overflow-hidden rounded-[1.75rem] border border-border/50 bg-card shadow-lg shadow-slate-950/5 transition duration-300 hover:-translate-y-1 hover:shadow-xl"><div className="relative h-48 overflow-hidden bg-gradient-to-br from-accent/20 via-primary/10 to-accent/5">{post.featuredImageUrl ? <img src={post.featuredImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" /> : <BookOpen className="absolute inset-0 m-auto h-16 w-16 text-accent/30" />}{post.category ? <Badge className="absolute start-4 top-4 bg-accent text-white">{post.category}</Badge> : null}</div><div className="flex flex-1 flex-col p-6"><div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">{post.publishedAt ? <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(post.publishedAt).toLocaleDateString(lang, { month: "short", day: "numeric", year: "numeric" })}</span> : null}<span className="flex items-center gap-1"><Clock className="h-3 w-3" />5 {t("blog.minRead")}</span></div><h2 className="font-display text-xl font-bold leading-snug transition-colors group-hover:text-primary"><Link href={post.canonicalPath}>{post.title}</Link></h2>{post.excerpt ? <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{post.excerpt}</p> : null}<Link href={post.canonicalPath} aria-label={`${t("blog.readMore")} — ${post.title}`} className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-semibold text-primary">{t("blog.readMore")} <ArrowRight className="h-4 w-4" /></Link></div></article>)}</div>}
    </div>
  </section>;

  return <ManagedPublicPage template="blog" lang={lang} page={page} slotBlockType="carousel_box" slotContent={liveBlog} />;
}
