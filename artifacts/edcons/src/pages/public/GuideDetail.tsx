import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, BookOpen, Calendar, Clock } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { useSeo } from "@/hooks/use-seo";
import type { Language } from "@/lib/i18n";
import { sanitizePublicHtmlContent } from "@/lib/publicHtmlSanitizer";
import "./guideEditorial.css";
import "./innerPagesVistara.css";

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
    robotsFollow?: boolean;
    ogTitle?: string | null;
    ogDescription?: string | null;
    ogImageUrl?: string | null;
    twitterTitle?: string | null;
    twitterDescription?: string | null;
    twitterImageUrl?: string | null;
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
      { method: "GET", cache: "no-store" },
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
    nofollow: guide?.meta.robotsFollow === false,
    ogType: "article",
    ogTitle: guide?.meta.ogTitle || undefined,
    ogDescription: guide?.meta.ogDescription || undefined,
    ogImage: guide?.meta.ogImageUrl || undefined,
    twitterTitle: guide?.meta.twitterTitle || undefined,
    twitterDescription: guide?.meta.twitterDescription || undefined,
    twitterImage: guide?.meta.twitterImageUrl || undefined,
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

  const heroImage = "/images/auth-bg.png";
  return (
    <main className="inner-guide-page">
      <header className="inner-guide-hero">
        <img src={heroImage} alt="" aria-hidden="true" />
        <div className="inner-guide-hero-overlay" />
        <div className="inner-guide-hero-content">
          <nav className="inner-guide-breadcrumb" aria-label="Breadcrumb">
            <Link href={localePath("/")}>{t("nav.home")}</Link><ArrowRight aria-hidden="true" />
            <Link href={localePath("/blog")}>{t("blog.badge")}</Link><ArrowRight aria-hidden="true" />
            <span>{guide.data.title}</span>
          </nav>
          <h1>{guide.data.title}</h1>
          <div className="inner-guide-meta">
            <span><Calendar aria-hidden="true" />{new Date(guide.data.publishedAt).toLocaleDateString(lang)}</span>
            {guide.data.readTime ? <span><Clock aria-hidden="true" />{guide.data.readTime} {t("blog.minRead")}</span> : null}
          </div>
        </div>
      </header>
      <div className="inner-guide-stage">
        {guide.meta.ogImageUrl ? <figure className="inner-guide-cover"><img src={guide.meta.ogImageUrl} alt="" /></figure> : null}
        <article className="inner-guide-article">
          {guide.data.excerpt ? <p className="inner-guide-lead">{guide.data.excerpt}</p> : null}
          <div className="guide-html prose prose-slate max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizePublicHtmlContent(guide.data.body) }} />
        </article>
        {guide.related.length > 0 ? (
          <section className="inner-guide-related" aria-label={t("blog.badge")}>
            <div className="inner-guide-related-heading"><span>{t("blog.badge")}</span><h2>{t("blog.readMore")}</h2></div>
            <div className="inner-guide-related-grid">
              {guide.related.map((item) => (
                <Link key={item.id} href={item.canonicalPath} className="inner-guide-related-card">
                  <p>{new Date(item.publishedAt).toLocaleDateString(lang)}</p>
                  <h3>{item.title}</h3>
                  {item.excerpt ? <span>{item.excerpt}</span> : null}
                  <strong>{t("blog.readMore")}<ArrowRight aria-hidden="true" /></strong>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        <Link href={localePath("/blog")} className="inner-guide-back"><ArrowLeft aria-hidden="true" />{t("blog.badge")}</Link>
      </div>
    </main>
  );
}
