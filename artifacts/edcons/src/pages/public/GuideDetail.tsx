import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import DOMPurify from "isomorphic-dompurify";
import { ArrowLeft, BookOpen, Calendar, Clock } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { useSeo } from "@/hooks/use-seo";
import type { Language } from "@/lib/i18n";

type GuideResponse = {
  data: {
    id: number;
    title: string;
    excerpt: string | null;
    body: string;
    publishedAt: string;
    updatedAt: string;
    readTime: number | null;
  };
  meta: {
    title: string;
    description: string;
    indexable: boolean;
    canonicalPath: string;
    alternatePaths: Partial<Record<Language, string>>;
  };
};

const GUIDE_ALLOWED_TAGS = [
  "p", "br", "strong", "em", "b", "i", "u", "a", "ul", "ol", "li",
  "h2", "h3", "h4", "blockquote", "code", "pre", "span", "hr",
];

function safeGuideHtml(value: string): string {
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: GUIDE_ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "target", "rel"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });
}

export default function GuideDetail({ routeKey }: { routeKey: string }) {
  const { t, lang, localePath } = useI18n();
  const [guide, setGuide] = useState<GuideResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoading(true);
    setFailed(false);
    customFetch<GuideResponse>(
      `/api/public/web/guides/${encodeURIComponent(routeKey)}?locale=${encodeURIComponent(lang)}`,
      { method: "GET" },
    )
      .then(setGuide)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [lang, routeKey]);

  useSeo({
    title: guide?.meta.title || t("blog.badge"),
    description: guide?.meta.description || t("seo.blogDesc"),
    canonical: guide ? `${SITE_URL}${guide.meta.canonicalPath}` : undefined,
    noindex: !guide?.meta.indexable,
    ogType: "article",
    lang,
    alternates: guide?.meta.alternatePaths,
  });

  useJsonLd(guide ? [{
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${SITE_URL}${guide.meta.canonicalPath}#article`,
    headline: guide.data.title,
    description: guide.meta.description,
    url: `${SITE_URL}${guide.meta.canonicalPath}`,
    datePublished: guide.data.publishedAt,
    dateModified: guide.data.updatedAt,
    inLanguage: lang,
    publisher: {
      "@type": "EducationalOrganization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  }] : []);

  if (loading) {
    return <main className="mx-auto max-w-3xl px-4 py-28"><div className="h-10 w-3/4 animate-pulse rounded bg-secondary" /><div className="mt-8 h-72 animate-pulse rounded-2xl bg-secondary" /></main>;
  }
  if (failed || !guide) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-28 text-center">
        <BookOpen className="mx-auto h-14 w-14 text-muted-foreground/30" />
        <h1 className="mt-5 text-2xl font-bold">{t("blog.noArticles")}</h1>
        <p className="mt-2 text-muted-foreground">{t("blog.tryAdjusting")}</p>
        <Button asChild variant="outline" className="mt-7 rounded-full">
          <Link href={localePath("/blog")}><ArrowLeft className="mr-2 h-4 w-4" />{t("blog.badge")}</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
      <Link href={localePath("/blog")} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />{t("blog.badge")}
      </Link>
      <article className="mt-8">
        <header>
          <h1 className="font-display text-4xl font-bold leading-tight text-foreground md:text-5xl">{guide.data.title}</h1>
          <div className="mt-5 flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2"><Calendar className="h-4 w-4" />{new Date(guide.data.publishedAt).toLocaleDateString(lang)}</span>
            {guide.data.readTime ? <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4" />{guide.data.readTime} {t("blog.minRead")}</span> : null}
          </div>
          {guide.data.excerpt ? <p className="mt-7 text-xl leading-8 text-muted-foreground">{guide.data.excerpt}</p> : null}
        </header>
        <div
          className="prose prose-slate mt-10 max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: safeGuideHtml(guide.data.body) }}
        />
      </article>
    </main>
  );
}
