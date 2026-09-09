import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { ArrowLeft, FileText } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { useSeo } from "@/hooks/use-seo";
import type { Language } from "@/lib/i18n";
import { sanitizePublicRichText } from "@/lib/publicHtmlSanitizer";

type PageBlock = {
  blockType: string;
  content: Record<string, unknown>;
  settings: Record<string, unknown>;
  sortOrder: number;
};

type PageResponse = {
  data: {
    id: number;
    title: string;
    slug: string;
    versionNumber: number;
    publishedAt: string;
    blocks: PageBlock[];
  };
  meta: {
    title: string;
    description: string;
    indexable: boolean;
    canonicalPath: string;
    alternatePaths: Partial<Record<Language, string>>;
  };
};

function text(value: unknown, maximum = 2_000): string {
  return String(typeof value === "string" || typeof value === "number" ? value : "")
    .slice(0, maximum)
    .trim();
}

function items(value: unknown, maximum = 24): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.slice(0, maximum).filter((item): item is Record<string, unknown> => (
      item !== null && typeof item === "object" && !Array.isArray(item)
    ))
    : [];
}

function safeUrl(value: unknown): string | null {
  const url = text(value, 2_048);
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return null;
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("..")) return url;
  if (url.startsWith("#")) return url;
  try {
    return ["https:", "mailto:", "tel:"].includes(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

function safeImageUrl(value: unknown): string | null {
  const url = safeUrl(value);
  return url && !url.startsWith("mailto:") && !url.startsWith("tel:") && !url.startsWith("#")
    ? url
    : null;
}

function ActionLink({ href, label, secondary = false }: { href: unknown; label: unknown; secondary?: boolean }) {
  const safeHref = safeUrl(href);
  const safeLabel = text(label, 200);
  if (!safeHref || !safeLabel) return null;
  return (
    <a
      href={safeHref}
      rel={safeHref.startsWith("http") ? "noopener noreferrer" : undefined}
      className={secondary
        ? "inline-flex rounded-full border border-current px-6 py-3 font-semibold"
        : "inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground"}
    >
      {safeLabel}
    </a>
  );
}

function Block({ block }: { block: PageBlock }) {
  const content = block.content;
  switch (block.blockType) {
    case "hero": {
      const background = safeImageUrl(content.backgroundImage);
      return (
        <section className="relative overflow-hidden px-4 py-24 text-center">
          {background ? <img src={background} alt="" className="absolute inset-0 h-full w-full object-cover opacity-15" loading="eager" /> : null}
          <div className="relative mx-auto max-w-5xl">
            {content.badge ? <p className="text-sm font-semibold text-primary">{text(content.badge, 200)}</p> : null}
            <h1 className="mt-3 font-display text-4xl font-bold md:text-6xl">{text(content.title, 500)}</h1>
            {content.subtitle ? <p className="mx-auto mt-5 max-w-3xl text-lg text-muted-foreground">{text(content.subtitle)}</p> : null}
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ActionLink href={content.ctaUrl} label={content.ctaLabel} />
              <ActionLink href={content.secondaryUrl} label={content.secondaryLabel} secondary />
            </div>
          </div>
        </section>
      );
    }
    case "rich_text":
      return <section className="prose prose-slate mx-auto max-w-3xl px-4 py-12 dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizePublicRichText(content.content) }} />;
    case "stats_strip":
      return (
        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-12 text-center sm:grid-cols-2 lg:grid-cols-4">
          {items(content.stats, 12).map((stat, index) => <div key={index} className="rounded-2xl border bg-card p-6"><p className="text-3xl font-bold text-primary">{text(stat.value, 100)}</p><p className="mt-2 text-sm text-muted-foreground">{text(stat.label, 200)}</p></div>)}
        </section>
      );
    case "feature_cards":
    case "icon_cards":
      return (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-center font-display text-3xl font-bold">{text(content.title, 500)}</h2>
          {content.subtitle ? <p className="mt-3 text-center text-muted-foreground">{text(content.subtitle)}</p> : null}
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {items(content.cards).map((card, index) => {
              const href = safeUrl(card.linkUrl);
              const cardBody = <><h3 className="text-xl font-semibold">{text(card.title, 300)}</h3><p className="mt-2 text-muted-foreground">{text(card.description)}</p>{card.linkLabel ? <p className="mt-4 font-medium text-primary">{text(card.linkLabel, 200)}</p> : null}</>;
              return <article key={index} className="rounded-2xl border bg-card p-6 shadow-sm">{href ? <a href={href}>{cardBody}</a> : cardBody}</article>;
            })}
          </div>
        </section>
      );
    case "cta_banner":
      return <section className="mx-auto my-12 max-w-6xl rounded-3xl bg-primary px-6 py-16 text-center text-primary-foreground"><h2 className="text-3xl font-bold">{text(content.title, 500)}</h2><p className="mx-auto mt-3 max-w-2xl opacity-85">{text(content.subtitle)}</p><div className="mt-8 flex flex-wrap justify-center gap-3"><ActionLink href={content.ctaUrl} label={content.ctaLabel} secondary /><ActionLink href={content.secondaryUrl} label={content.secondaryLabel} secondary /></div></section>;
    case "faq":
      return <section className="mx-auto max-w-3xl px-4 py-14"><h2 className="text-3xl font-bold">{text(content.title, 500)}</h2>{content.subtitle ? <p className="mt-3 text-muted-foreground">{text(content.subtitle)}</p> : null}<div className="mt-8 space-y-3">{items(content.items, 50).map((item, index) => <details key={index} className="rounded-xl border p-5"><summary className="cursor-pointer font-semibold">{text(item.question, 500)}</summary><p className="mt-3 text-muted-foreground">{text(item.answer, 4_000)}</p></details>)}</div></section>;
    case "team_grid":
      return <section className="mx-auto max-w-6xl px-4 py-14"><h2 className="text-center text-3xl font-bold">{text(content.title, 500)}</h2><div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{items(content.members).map((member, index) => { const photo = safeImageUrl(member.photo); return <article key={index} className="rounded-2xl border p-5 text-center">{photo ? <img src={photo} alt={text(member.name, 200)} className="mx-auto h-24 w-24 rounded-full object-cover" loading="lazy" /> : null}<h3 className="mt-4 font-semibold">{text(member.name, 200)}</h3><p className="text-sm text-primary">{text(member.role, 200)}</p><p className="mt-2 text-sm text-muted-foreground">{text(member.bio)}</p></article>; })}</div></section>;
    case "office_list":
      return <section className="mx-auto max-w-6xl px-4 py-14"><h2 className="text-center text-3xl font-bold">{text(content.title, 500)}</h2><div className="mt-8 grid gap-5 md:grid-cols-2">{items(content.offices).map((office, index) => <article key={index} className="rounded-2xl border p-6"><h3 className="text-xl font-semibold">{text(office.name, 300)}</h3><p className="mt-1 text-primary">{text(office.city, 200)}</p><p className="mt-3 text-muted-foreground">{text(office.address)}</p><p className="mt-3 text-sm">{text(office.phone, 100)} {text(office.email, 320)}</p></article>)}</div></section>;
    case "logo_grid":
      return <section className="mx-auto max-w-6xl px-4 py-14"><h2 className="text-center text-3xl font-bold">{text(content.title, 500)}</h2><div className="mt-8 flex flex-wrap items-center justify-center gap-8">{items(content.logos, 40).map((logo, index) => { const image = safeImageUrl(logo.imageUrl); const href = safeUrl(logo.linkUrl); const visual = image ? <img src={image} alt={text(logo.name, 200)} className="h-16 w-32 object-contain" loading="lazy" /> : <span>{text(logo.name, 200)}</span>; return href ? <a key={index} href={href} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}>{visual}</a> : <div key={index}>{visual}</div>; })}</div></section>;
    case "testimonials":
      return <section className="mx-auto max-w-6xl px-4 py-14"><h2 className="text-center text-3xl font-bold">{text(content.title, 500)}</h2><div className="mt-8 grid gap-5 md:grid-cols-2">{items(content.items).map((item, index) => <blockquote key={index} className="rounded-2xl border bg-card p-6"><p className="text-lg">“{text(item.content, 4_000)}”</p><footer className="mt-4 text-sm text-muted-foreground">{text(item.name, 200)}{item.role ? ` · ${text(item.role, 200)}` : ""}</footer></blockquote>)}</div></section>;
    case "section_title":
      return <section className="mx-auto max-w-6xl px-4 py-10 text-center"><h2 className="text-3xl font-bold">{text(content.title, 500)}</h2>{content.subtitle ? <p className="mt-3 text-muted-foreground">{text(content.subtitle)}</p> : null}</section>;
    case "spacer_divider": {
      const height = Math.min(160, Math.max(8, Number(content.height) || 48));
      return <div aria-hidden="true" style={{ height }} className="mx-auto max-w-6xl px-4">{content.showDivider ? <hr /> : null}</div>;
    }
    default:
      return null;
  }
}

export default function PublicPage({ slug }: { slug: string }) {
  const { lang, localePath } = useI18n();
  const [page, setPage] = useState<PageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setPage(null);
    customFetch<PageResponse>(`/api/public/web/pages/${encodeURIComponent(slug)}?locale=${encodeURIComponent(lang)}`, { method: "GET" })
      .then((value) => { if (active) setPage(value); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [lang, slug]);

  useSeo({
    title: page?.meta.title || SITE_NAME,
    description: page?.meta.description || "",
    canonical: page ? `${SITE_URL}${page.meta.canonicalPath}` : undefined,
    noindex: !page?.meta.indexable,
    lang,
    alternates: page?.meta.alternatePaths,
  });
  const schema = useMemo(() => page ? [{
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}${page.meta.canonicalPath}#webpage`,
    name: page.data.title,
    description: page.meta.description,
    url: `${SITE_URL}${page.meta.canonicalPath}`,
    datePublished: page.data.publishedAt,
    inLanguage: lang,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_URL },
  }] : [], [lang, page]);
  useJsonLd(schema);

  if (loading) return <main className="mx-auto max-w-6xl px-4 py-28"><div className="h-12 w-2/3 animate-pulse rounded bg-secondary" /><div className="mt-8 h-80 animate-pulse rounded-3xl bg-secondary" /></main>;
  if (failed || !page) {
    return <main className="mx-auto max-w-3xl px-4 py-28 text-center"><FileText className="mx-auto h-14 w-14 text-muted-foreground/30" /><h1 className="mt-5 text-2xl font-bold">Page not found</h1><p className="mt-2 text-muted-foreground">This page is unavailable or has not been published in this language.</p><Button asChild variant="outline" className="mt-7 rounded-full"><Link href={localePath("")}><ArrowLeft className="mr-2 h-4 w-4" />{SITE_NAME}</Link></Button></main>;
  }
  return <main data-public-page-version={page.data.versionNumber}>{page.data.blocks.map((block, index) => <Block key={`${block.blockType}-${block.sortOrder}-${index}`} block={block} />)}</main>;
}
