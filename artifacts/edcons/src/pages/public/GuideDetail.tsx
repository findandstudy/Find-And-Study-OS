import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { ArrowLeft, BookOpen, Calendar, Clock } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { useSeo } from "@/hooks/use-seo";
import type { Language } from "@/lib/i18n";
import { sanitizePublicRichText } from "@/lib/publicHtmlSanitizer";

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
  related: Array<{
    id: number;
    title: string;
    excerpt: string | null;
    publishedAt: string;
    canonicalPath: string;
  }>;
  meta: {
    title: string;
    description: string;
    indexable: boolean;
    canonicalPath: string;
    alternatePaths: Partial<Record<Language, string>>;
    internalLinkPolicy: "PUBLISHED_INDEXABLE_ONLY" | "DISABLED_OR_EMPTY";
  };
};

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
          dangerouslySetInnerHTML={{ __html: sanitizePublicRichText(guide.data.body) }}
        />
      </article>
      {guide.related.length > 0 ? (
        <section className="mt-16 border-t border-border pt-10" aria-label={t("blog.badge")}>
          <h2 className="font-display text-2xl font-bold">{t("blog.badge")}</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {guide.related.map((item) => (
              <Link
                key={item.id}
                href={item.canonicalPath}
                className="rounded-2xl border border-border/60 bg-card p-5 transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
              >
                <p className="text-xs text-muted-foreground">{new Date(item.publishedAt).toLocaleDateString(lang)}</p>
                <h3 className="mt-2 line-clamp-2 font-bold text-foreground">{item.title}</h3>
                {item.excerpt ? <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{item.excerpt}</p> : null}
                <span className="mt-4 inline-flex items-center text-sm font-semibold text-primary">{t("blog.readMore")}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
