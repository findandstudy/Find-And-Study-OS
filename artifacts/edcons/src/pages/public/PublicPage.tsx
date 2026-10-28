import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Compass, FileText, Globe2, Map, MessageCircle, Search, ShieldCheck, Sparkles, Star } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { SITE_NAME, SITE_URL, useJsonLd } from "@/hooks/use-json-ld";
import { useSeo } from "@/hooks/use-seo";
import type { Language } from "@/lib/i18n";
import { sanitizePublicHtmlContent, sanitizePublicRichText } from "@/lib/publicHtmlSanitizer";
import { catalogLayoutClass } from "@/lib/website/catalogPresentation";
import { resolveCmsValue, type CmsTextVariableValues } from "@/lib/website/cmsTextVariables";
import "./cmsEditorial.css";

export type PageBlock = {
  blockType: string;
  content: Record<string, unknown>;
  settings: Record<string, unknown>;
  sortOrder: number;
};

export type PageResponse = {
  data: {
    id: number;
    title: string;
    slug: string;
    versionNumber: number;
    publishedAt: string;
    blocks: PageBlock[];
    seo?: Record<string, string | boolean>;
  };
  meta: {
    title: string;
    description: string;
    indexable: boolean;
    canonicalPath: string;
    alternatePaths: Partial<Record<Language, string>>;
  };
};

type CmsStyle = CSSProperties & Record<`--cms-${string}`, string>;
function safeColor(value: unknown): string | null { const color = text(value, 32); return /^#[0-9a-f]{6}$/i.test(color) ? color : null; }
function colorLuminance(color: string): number {
  const channels = color.slice(1).match(/.{2}/g)?.map(channel => Number.parseInt(channel, 16) / 255) || [0, 0, 0];
  return channels.reduce((sum, channel, index) => {
    const linear = channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    return sum + linear * [.2126, .7152, .0722][index];
  }, 0);
}
function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [colorLuminance(first), colorLuminance(second)].sort((a, b) => b - a);
  return (lighter + .05) / (darker + .05);
}
function safeHeroTextColor(start: string, end: string, requested: string | null): string {
  const score = (candidate: string) => Math.min(contrastRatio(candidate, start), contrastRatio(candidate, end));
  if (requested && score(requested) >= 4.5) return requested;
  return ["#ffffff", "#071321"].sort((first, second) => score(second) - score(first))[0];
}
function safeSurfaceTextColor(background: string, requested: string | null): string {
  if (requested && contrastRatio(requested, background) >= 4.5) return requested;
  return ["#ffffff", "#071321"].sort((first, second) => contrastRatio(second, background) - contrastRatio(first, background))[0];
}
function safeNumberToken(value: unknown, minimum: number, maximum: number): string | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? String(parsed) : null;
}
function themeStyle(tokens: Record<string, string> | undefined): CmsStyle {
  const colors: Record<string, string> = { "colors.primary": "--cms-blue", "colors.secondary": "--cms-secondary", "colors.accent": "--cms-accent", "colors.background": "--cms-paper", "colors.card": "--cms-white", "colors.border": "--cms-line", "colors.text": "--cms-ink", "colors.muted": "--cms-muted", "colors.heroStart": "--cms-hero-start", "colors.heroEnd": "--cms-hero-end", "colors.heroText": "--cms-hero-text", "colors.heroOverlay": "--cms-hero-overlay", "buttons.primaryBg": "--cms-button-bg", "buttons.primaryText": "--cms-button-text" };
  const style: CmsStyle = {};
  for (const [key, variable] of Object.entries(colors)) {
    const value = safeColor(tokens?.[key]);
    if (value) style[variable as `--cms-${string}`] = value;
  }
  const heroStart = safeColor(tokens?.["colors.heroStart"]);
  const heroEnd = safeColor(tokens?.["colors.heroEnd"]);
  const requestedHeroText = safeColor(tokens?.["colors.heroText"]);
  if (heroStart || heroEnd || requestedHeroText) {
    style["--cms-hero-text"] = safeHeroTextColor(heroStart || "#081727", heroEnd || "#102b48", requestedHeroText);
  }
  const secondary = safeColor(tokens?.["colors.secondary"]);
  if (secondary) style["--cms-secondary-text"] = safeSurfaceTextColor(secondary, null);
  const accent = safeColor(tokens?.["colors.accent"]);
  if (accent) style["--cms-accent-text"] = safeSurfaceTextColor(accent, null);
  const buttonBackground = safeColor(tokens?.["buttons.primaryBg"]);
  const requestedButtonText = safeColor(tokens?.["buttons.primaryText"]);
  if (buttonBackground || requestedButtonText) {
    style["--cms-button-text"] = safeSurfaceTextColor(buttonBackground || "#174a7e", requestedButtonText);
  }
  const allowedFonts = new Set(["Inter", "Poppins", "Roboto", "Open Sans", "Lato", "Montserrat", "Playfair Display", "Merriweather", "Nunito", "Raleway", "Source Sans Pro", "DM Sans"]);
  const headingFont = text(tokens?.["typography.headingFont"], 40);
  const bodyFont = text(tokens?.["typography.bodyFont"], 40);
  if (allowedFonts.has(headingFont)) style["--cms-heading-font"] = `"${headingFont}"`;
  if (allowedFonts.has(bodyFont)) style["--cms-body-font"] = `"${bodyFont}"`;
  const numeric: Array<[string, `--cms-${string}`, number, number, string]> = [
    ["typography.fontScale", "--cms-font-scale", .75, 1.5, ""],
    ["buttons.borderRadius", "--cms-button-radius", 0, 9999, "px"],
    ["buttons.fontWeight", "--cms-button-weight", 300, 900, ""],
    ["spacing.sectionPadding", "--cms-default-section-padding", 0, 160, "px"],
    ["spacing.cardPadding", "--cms-card-padding", 0, 96, "px"],
    ["spacing.containerMax", "--cms-container-max", 640, 1920, "px"],
    ["spacing.gridGap", "--cms-grid-gap", 0, 80, "px"],
  ];
  for (const [key, variable, min, max, unit] of numeric) {
    const value = safeNumberToken(tokens?.[key], min, max);
    if (value) style[variable] = `${value}${unit}`;
  }
  return style;
}
function blockStyle(block: PageBlock): CmsStyle {
  const style: CmsStyle = {};
  const appearance = { ...block.content, ...block.settings };
  if (block.blockType === "cta_banner" && appearance.useThemeColors !== false) {
    style["--cms-section-bg"] = "linear-gradient(125deg, var(--cms-hero-start), var(--cms-hero-end))";
    style["--cms-section-text"] = "#ffffff";
  }
  if (appearance.useThemeColors === false) {
    const pairs: Array<[string, unknown]> = [["--cms-section-bg", appearance.sectionBackgroundColor], ["--cms-section-text", appearance.sectionTextColor], ["--cms-section-accent", appearance.sectionAccentColor], ["--cms-card-bg", appearance.cardBackgroundColor], ["--cms-section-border", appearance.sectionBorderColor], ["--cms-section-button-bg", appearance.sectionButtonColor], ["--cms-section-button-text", appearance.sectionButtonTextColor]];
    Object.assign(style, Object.fromEntries(pairs.flatMap(([key, value]) => safeColor(value) ? [[key, safeColor(value)!]] : [])));
    const width = text(appearance.sectionWidth, 16);
    if (["760px", "960px", "1260px", "100%"].includes(width)) style["--cms-section-max"] = width;
    const padding = Number(appearance.sectionPadding);
    if (Number.isFinite(padding)) style["--cms-section-padding"] = `${Math.min(160, Math.max(0, padding))}px`;
    if (block.blockType === "cta_banner") {
      const background = safeColor(appearance.sectionBackgroundColor);
      const buttonBackground = safeColor(appearance.sectionButtonColor);
      if (background) style["--cms-section-text"] = safeSurfaceTextColor(background, safeColor(appearance.sectionTextColor));
      if (buttonBackground) style["--cms-section-button-text"] = safeSurfaceTextColor(buttonBackground, safeColor(appearance.sectionButtonTextColor));
    }
  }
  if (!["hero", "home_fallback_hero"].includes(block.blockType)) return style;
  if (appearance.useThemeColors !== false) return appearance.overlay === false ? { ...style, "--cms-hero-overlay-opacity": "0" } : style;
  const heroStart = safeColor(appearance.backgroundColor) || "#071321";
  const heroEnd = safeColor(appearance.gradientColor) || "#0b2a44";
  const heroText = safeHeroTextColor(heroStart, heroEnd, safeColor(appearance.textColor));
  const pairs: Array<[string, unknown]> = [["--cms-hero-start", heroStart], ["--cms-hero-end", heroEnd], ["--cms-hero-text", heroText], ["--cms-hero-overlay", appearance.overlayColor], ["--cms-button-bg", appearance.primaryButtonColor], ["--cms-button-text", appearance.primaryButtonTextColor]];
  Object.assign(style, Object.fromEntries(pairs.flatMap(([key, value]) => safeColor(value) ? [[key, safeColor(value)!]] : [])));
  const opacity = appearance.overlay === false ? 0 : Number(appearance.overlayOpacity);
  if (Number.isFinite(opacity)) style["--cms-hero-overlay-opacity"] = String(Math.min(100, Math.max(0, opacity)) / 100);
  return style;
}
export function CmsPageCanvas({ children, className = "" }: { children: ReactNode; className?: string }) {
  const query = useQuery<{ tokens: Record<string, string> }>({ queryKey: ["public-cms-theme"], queryFn: () => customFetch("/api/public/web/theme"), staleTime: 30_000, retry: false });
  return <main className={`public-cms-page ${className}`.trim()} style={themeStyle(query.data?.tokens)}>{children}</main>;
}
export function CmsBlock({ block, index, variables }: { block: PageBlock; index: number; variables?: CmsTextVariableValues }) {
  const resolved = variables ? { ...block, content: resolveCmsValue(block.content, variables) } : block;
  return <div className="cms-editorial-block" data-cms-block={resolved.blockType} data-cms-index={index} style={blockStyle(resolved)}><Block block={resolved} index={index} /></div>;
}

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

function spacerHeightClass(value: unknown): string {
  // Literal classes keep all supported sizes in the generated stylesheet.
  // Match the SSR renderer without requiring inline styles in its strict CSP.
  const classes = [
    "h-[8px]", "h-[16px]", "h-[24px]", "h-[32px]", "h-[40px]",
    "h-[48px]", "h-[56px]", "h-[64px]", "h-[72px]", "h-[80px]",
    "h-[88px]", "h-[96px]", "h-[104px]", "h-[112px]", "h-[120px]",
    "h-[128px]", "h-[136px]", "h-[144px]", "h-[152px]", "h-[160px]",
  ];
  const requestedHeight = Number(value);
  const height = Math.min(160, Math.max(8, Number.isFinite(requestedHeight) ? requestedHeight : 48));
  return classes[Math.round(height / 8) - 1];
}

function responsiveColumns(value: unknown): string {
  const columns = text(value, 8);
  if (columns === "2") return "sm:grid-cols-2";
  if (columns === "4") return "sm:grid-cols-2 lg:grid-cols-4";
  return "sm:grid-cols-2 lg:grid-cols-3";
}

function progressValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
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
        ? "inline-flex rounded-full border border-current px-6 py-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        : "inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"}
    >
      {safeLabel}
    </a>
  );
}

export function Block({ block, index }: { block: PageBlock; index: number }) {
  const content = block.content;
  switch (block.blockType) {
    case "home_fallback_hero": {
      const primaryHref = safeUrl(content.ctaUrl);
      const secondaryHref = safeUrl(content.secondaryUrl);
      const signals = items(content.signals, 5);
      const journeySignals = signals.length ? signals : [{ label: "Explore", detail: "Destinations and programs" }, { label: "Prepare", detail: "Requirements and documents" }, { label: "Progress", detail: "Milestones and next actions" }];
      return (
        <section className="home-future-hero relative overflow-hidden">
          <div className="home-future-aurora" aria-hidden="true" />
          <div className="home-future-hero-grid relative z-10 mx-auto grid max-w-7xl items-center gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[1.08fr_.92fr] lg:px-8 lg:py-28">
            <div className="home-future-hero-copy">
              {content.badge ? <div className="home-future-badge"><Sparkles className="h-4 w-4" />{text(content.badge, 200)}</div> : null}
              <h1 className="font-display text-5xl font-bold leading-[1.02] tracking-[-.055em] sm:text-6xl lg:text-7xl">{text(content.title, 500)}</h1>
              {content.subtitle ? <p className="mt-7 max-w-2xl text-lg leading-8 text-white/70 sm:text-xl">{text(content.subtitle)}</p> : null}
              <div className="cms-action-row mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              {primaryHref && content.ctaLabel ? <Button size="lg" className="rounded-full px-8 h-14 text-base shadow-xl shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-1 transition-all duration-300" asChild><Link href={primaryHref}>{text(content.ctaLabel, 200)} <ArrowRight className="ms-2 w-5 h-5" /></Link></Button> : null}
              {secondaryHref && content.secondaryLabel ? <Button size="lg" variant="outline" className="rounded-full border-white/25 bg-white/5 px-8 h-14 text-base text-white backdrop-blur hover:bg-white/10 hover:text-white transition-all duration-300" asChild><Link href={secondaryHref}>{text(content.secondaryLabel, 200)}</Link></Button> : null}
              </div>
            </div>
            <aside className="home-journey-console" aria-label={text(content.signalTitle, 300) || "Student journey"}>
              <div className="home-console-orbit" aria-hidden="true"><span /><span /><span /></div>
              <div className="home-console-head"><div className="home-console-mark"><Compass className="h-5 w-5" /></div><div><p>{text(content.signalTitle, 300)}</p>{content.signalSubtitle ? <span>{text(content.signalSubtitle, 500)}</span> : null}</div></div>
              <div className="home-console-flow">
                {journeySignals.map((signal, signalIndex) => <article key={signalIndex}><span>{String(signalIndex + 1).padStart(2, "0")}</span><div><strong>{text(signal.label, 120)}</strong><p>{text(signal.detail, 240)}</p></div>{signalIndex < journeySignals.length - 1 ? <i aria-hidden="true" /> : null}</article>)}
              </div>
              <p className="home-console-foot"><span aria-hidden="true" /> Human guidance, connected to one clear view</p>
            </aside>
          </div>
        </section>
      );
    }
    case "home_fallback_stats":
      return (
        <section className="home-proof-rail">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="cms-responsive-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 text-center">
              {items(content.stats, 12).map((stat, statIndex) => (
                <div key={statIndex} className="home-proof-item">
                  <span>{String(statIndex + 1).padStart(2, "0")}</span>
                  <h3>{text(stat.value, 100)}</h3>
                  <p>{text(stat.label, 200)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    case "home_fallback_features": {
      const iconByName = { Globe2, FileText, ShieldCheck } as const;
      return (
        <section className="home-bento-section">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="home-section-intro mx-auto mb-14 max-w-3xl text-center">
              <p className="home-section-kicker">Built around your next decision</p>
              <h2 className="text-3xl md:text-4xl font-bold font-display mb-4">{text(content.title, 500)}</h2>
              {content.subtitle ? <p className="text-lg text-muted-foreground">{text(content.subtitle)}</p> : null}
            </div>
            <div className="cms-responsive-grid grid md:grid-cols-3 gap-8">
              {items(content.cards).map((card, cardIndex) => {
                const iconName = text(card.icon, 32) as keyof typeof iconByName;
                const Icon = iconByName[iconName] || Globe2;
                const href = safeUrl(card.linkUrl);
                const body = <><div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 group-hover:bg-primary transition-colors duration-300"><Icon className="w-7 h-7 text-primary group-hover:text-white transition-colors duration-300" /></div><h3 className="text-xl font-bold font-display mb-3">{text(card.title, 300)}</h3><p className="text-muted-foreground leading-relaxed">{text(card.description)}</p></>;
                return <article key={cardIndex} className="home-bento-card group">{href ? <a className="block h-full" href={href}>{body}</a> : body}</article>;
              })}
            </div>
          </div>
        </section>
      );
    }
    case "hero": {
      const background = safeImageUrl(content.backgroundImage);
      return (
        <section className="relative overflow-hidden px-4 py-24 text-center">
          {background ? <img src={background} alt="" className="absolute inset-0 h-full w-full object-cover opacity-15" loading="eager" /> : null}
          <div className="relative mx-auto max-w-5xl">
            {content.badge ? <p className="text-sm font-semibold text-primary">{text(content.badge, 200)}</p> : null}
            <h1 className="mt-3 font-display text-4xl font-bold md:text-6xl">{text(content.title, 500)}</h1>
            {content.subtitle ? <p className="mx-auto mt-5 max-w-3xl text-lg text-muted-foreground">{text(content.subtitle)}</p> : null}
            <div className="cms-action-row mt-8 flex flex-wrap justify-center gap-3">
              <ActionLink href={content.ctaUrl} label={content.ctaLabel} />
              <ActionLink href={content.secondaryUrl} label={content.secondaryLabel} secondary />
            </div>
          </div>
        </section>
      );
    }
    case "rich_text":
      return <section className="prose prose-slate mx-auto max-w-3xl px-4 py-12 dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizePublicRichText(content.content) }} />;
    case "html_content": {
      const html = sanitizePublicHtmlContent(content.html);
      if (!html && !text(content.title, 500)) return null;
      return <section className="cms-layout-section cms-html-content-section">{content.title ? <h2 className="cms-html-content-title">{text(content.title, 500)}</h2> : null}<div className="cms-html-content" dangerouslySetInnerHTML={{ __html: html }} /></section>;
    }
    case "stats_strip":
      return (
        <section className="cms-responsive-grid mx-auto grid max-w-6xl gap-6 px-4 py-12 text-center sm:grid-cols-2 lg:grid-cols-4">
          {items(content.stats, 12).map((stat, index) => <div key={index} className="rounded-2xl border bg-card p-6"><p className="text-3xl font-bold text-primary">{text(stat.value, 100)}</p><p className="mt-2 text-sm text-muted-foreground">{text(stat.label, 200)}</p></div>)}
        </section>
      );
    case "catalog_grid": {
      const sourceLabels: Record<string, string> = {
        programs: "Programs",
        universities: "Universities",
        destinations: "Destinations",
        cities: "Cities",
      };
      const source = text(content.source, 32).toLowerCase();
      const liveCards = items(content.items, 12);
      const cards = liveCards.length ? liveCards : items(content.fallbackItems, 12);
      const headingId = `catalog-grid-title-${index}`;
      return (
        <section className="home-live-catalog mx-auto max-w-6xl px-4 py-14" aria-labelledby={headingId}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id={headingId} className="font-display text-3xl font-bold">{text(content.title, 500)}</h2>
              {content.subtitle ? <p className="mt-3 text-muted-foreground">{text(content.subtitle)}</p> : null}
            </div>
            {sourceLabels[source] ? <span className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">{sourceLabels[source]} · {liveCards.length ? "live" : "start here"}</span> : null}
          </div>
          {cards.length > 0 ? (
            <div className={`cms-responsive-grid mt-8 ${catalogLayoutClass(content)}`} tabIndex={content.layout === "carousel" ? 0 : undefined} aria-label={text(content.title, 500)}>
              {cards.map((item, index) => {
                const href = safeUrl(item.canonicalPath);
                const card = <><h3 className="text-xl font-semibold">{text(item.title, 500)}</h3>{item.description ? <p className="mt-2 text-muted-foreground">{text(item.description)}</p> : null}</>;
                return <article key={text(item.id, 64) || index} className="home-catalog-card rounded-2xl border bg-card p-6 shadow-sm"><span className="home-card-index">{String(index + 1).padStart(2, "0")}</span>{href ? <a href={href} rel={href.startsWith("http") ? "noopener noreferrer" : undefined} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{card}<ArrowRight className="mt-6 h-5 w-5" aria-hidden="true" /></a> : card}</article>;
              })}
            </div>
          ) : (
            <p className="mt-8 rounded-2xl border border-dashed p-8 text-center text-muted-foreground">No published catalogue entries are available yet.</p>
          )}
        </section>
      );
    }
    case "feature_cards":
    case "icon_cards":
      {
      const featureIcons = { Map, Search, MessageCircle, Globe2, FileText, ShieldCheck, Star } as const;
      return (
        <section className="home-pathways mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-center font-display text-3xl font-bold">{text(content.title, 500)}</h2>
          {content.subtitle ? <p className="mt-3 text-center text-muted-foreground">{text(content.subtitle)}</p> : null}
          <div className="cms-responsive-grid mt-8 grid gap-5 md:grid-cols-3">
            {items(content.cards).map((card, index) => {
              const href = safeUrl(card.linkUrl);
              const Icon = featureIcons[text(card.icon, 32) as keyof typeof featureIcons] || Star;
              const cardBody = <><div className="home-pathway-icon"><Icon className="h-5 w-5" /></div><span className="home-card-index">{String(index + 1).padStart(2, "0")}</span><h3 className="text-xl font-semibold">{text(card.title, 300)}</h3><p className="mt-2 text-muted-foreground">{text(card.description)}</p>{card.linkLabel ? <p className="mt-5 inline-flex items-center gap-2 font-medium text-primary">{text(card.linkLabel, 200)}<ArrowRight className="h-4 w-4" /></p> : null}</>;
              return <article key={index} className="rounded-2xl border bg-card p-6 shadow-sm">{href ? <a href={href}>{cardBody}</a> : cardBody}</article>;
            })}
          </div>
        </section>
      );
      }
    case "media_text": {
      const image = safeImageUrl(content.imageUrl);
      const href = safeUrl(content.ctaUrl);
      const imageFirst = content.imagePosition !== "right";
      const media = <div className="overflow-hidden rounded-3xl bg-secondary/60">{image ? <img src={image} alt={text(content.altText, 300)} className="h-full min-h-80 w-full object-cover" loading="lazy" /> : <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">Image</div>}</div>;
      const editorial = <div className="flex flex-col justify-center py-4">{content.eyebrow ? <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{text(content.eyebrow, 200)}</p> : null}<h2 className="mt-3 font-display text-3xl font-bold md:text-5xl">{text(content.title, 500)}</h2>{content.body ? <p className="mt-5 text-lg leading-8 text-muted-foreground">{text(content.body, 4_000)}</p> : null}{href && content.ctaLabel ? <p className="mt-7"><a href={href} className="inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground">{text(content.ctaLabel, 200)}</a></p> : null}</div>;
      return <section className="cms-responsive-grid mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:items-stretch">{imageFirst ? <>{media}{editorial}</> : <>{editorial}{media}</>}</section>;
    }
    case "image_gallery": {
      const columnClass = content.columns === "2" ? "sm:grid-cols-2" : content.columns === "4" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
      return <section className="mx-auto max-w-6xl px-4 py-16"><div className="max-w-3xl"><h2 className="font-display text-3xl font-bold md:text-4xl">{text(content.title, 500)}</h2>{content.subtitle ? <p className="mt-3 text-lg text-muted-foreground">{text(content.subtitle)}</p> : null}</div><div className={`cms-responsive-grid mt-8 grid gap-5 ${columnClass}`}>{items(content.images, 24).map((item, galleryIndex) => { const image = safeImageUrl(item.imageUrl); const href = safeUrl(item.linkUrl); const visual = <figure className="group overflow-hidden rounded-2xl border bg-card"><div className="aspect-[4/3] overflow-hidden bg-secondary/60">{image ? <img src={image} alt={text(item.altText, 300)} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" /> : null}</div>{item.caption ? <figcaption className="p-4 text-sm font-medium">{text(item.caption, 300)}</figcaption> : null}</figure>; return href ? <a key={galleryIndex} href={href}>{visual}</a> : <div key={galleryIndex}>{visual}</div>; })}</div></section>;
    }
    case "process_steps":
      return <section className="home-timeline px-4 py-20"><div className="mx-auto max-w-6xl"><div className="max-w-3xl"><p className="home-section-kicker">A clearer way forward</p><h2 className="font-display text-3xl font-bold md:text-5xl">{text(content.title, 500)}</h2>{content.subtitle ? <p className="mt-4 text-lg leading-8 text-muted-foreground">{text(content.subtitle)}</p> : null}</div><ol className="cms-responsive-grid mt-12 grid gap-5 md:grid-cols-3">{items(content.steps, 12).map((step, stepIndex) => <li key={stepIndex} className="home-timeline-step"><span>{text(step.number, 32) || String(stepIndex + 1).padStart(2, "0")}</span><i aria-hidden="true" /><h3>{text(step.title, 300)}</h3><p>{text(step.description, 2_000)}</p></li>)}</ol></div></section>;
    case "quote_banner": {
      const portrait = safeImageUrl(content.imageUrl);
      return <section className="mx-auto max-w-6xl px-4 py-16"><blockquote className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-8 py-12 text-white md:px-14"><div className="absolute -end-8 -top-16 text-[14rem] font-serif leading-none text-white/5" aria-hidden="true">“</div><div className="relative flex flex-col gap-8 md:flex-row md:items-center">{portrait ? <img src={portrait} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover ring-4 ring-white/10" loading="lazy" /> : null}<div><p className="max-w-4xl font-display text-2xl font-semibold leading-relaxed md:text-4xl">“{text(content.quote, 4_000)}”</p>{content.author || content.role ? <footer className="mt-6 text-sm text-white/70"><strong className="text-white">{text(content.author, 200)}</strong>{content.role ? ` · ${text(content.role, 300)}` : ""}</footer> : null}</div></div></blockquote></section>;
    }
    case "cta_banner":
      return <section className="home-future-cta mx-auto my-12 max-w-6xl overflow-hidden rounded-[2rem] px-6 py-16 text-center"><Sparkles className="mx-auto mb-6 h-7 w-7" /><h2 className="text-3xl font-bold md:text-5xl">{text(content.title, 500)}</h2><p className="mx-auto mt-5 max-w-2xl text-lg">{text(content.subtitle)}</p><div className="cms-action-row mt-9 flex flex-wrap justify-center gap-3"><ActionLink href={content.ctaUrl} label={content.ctaLabel} secondary /><ActionLink href={content.secondaryUrl} label={content.secondaryLabel} secondary /></div></section>;
    case "faq":
      return <section className="mx-auto max-w-3xl px-4 py-14"><h2 className="text-3xl font-bold">{text(content.title, 500)}</h2>{content.subtitle ? <p className="mt-3 text-muted-foreground">{text(content.subtitle)}</p> : null}<div className="mt-8 space-y-3">{items(content.items, 50).map((item, index) => <details key={index} className="rounded-xl border p-5"><summary className="cursor-pointer font-semibold">{text(item.question, 500)}</summary><p className="mt-3 text-muted-foreground">{text(item.answer, 4_000)}</p></details>)}</div></section>;
    case "team_grid": {
      const members = items(content.members);
      if (!members.length) return null;
      return <section className="mx-auto max-w-6xl px-4 py-14"><h2 className="text-center text-3xl font-bold">{text(content.title, 500)}</h2><div className="cms-responsive-grid mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{members.map((member, index) => { const photo = safeImageUrl(member.photo); return <article key={index} className="rounded-2xl border p-5 text-center">{photo ? <img src={photo} alt={text(member.name, 200)} className="mx-auto h-24 w-24 rounded-full object-cover" loading="lazy" /> : null}<h3 className="mt-4 font-semibold">{text(member.name, 200)}</h3><p className="text-sm text-primary">{text(member.role, 200)}</p><p className="mt-2 text-sm text-muted-foreground">{text(member.bio)}</p></article>; })}</div></section>;
    }
    case "office_list": {
      const offices = items(content.offices);
      if (!offices.length) return null;
      return <section id="offices" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-14"><h2 className="text-center text-3xl font-bold">{text(content.title, 500)}</h2><div className="cms-responsive-grid mt-8 grid gap-5 md:grid-cols-2">{offices.map((office, index) => <article key={index} className="rounded-2xl border p-6"><h3 className="text-xl font-semibold">{text(office.name, 300)}</h3><p className="mt-1 text-primary">{text(office.city, 200)}</p><p className="mt-3 text-muted-foreground">{text(office.address)}</p><p className="mt-3 text-sm">{text(office.phone, 100)} {text(office.email, 320)}</p></article>)}</div></section>;
    }
    case "logo_grid": {
      const logos = items(content.logos, 40);
      if (!logos.length) return null;
      return <section className="mx-auto max-w-6xl px-4 py-14"><h2 className="text-center text-3xl font-bold">{text(content.title, 500)}</h2><div className="mt-8 flex flex-wrap items-center justify-center gap-8">{logos.map((logo, index) => { const image = safeImageUrl(logo.imageUrl); const href = safeUrl(logo.linkUrl); const visual = image ? <img src={image} alt={text(logo.name, 200)} className="h-16 w-32 object-contain" loading="lazy" /> : <span>{text(logo.name, 200)}</span>; return href ? <a key={index} href={href} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}>{visual}</a> : <div key={index}>{visual}</div>; })}</div></section>;
    }
    case "testimonials": {
      const testimonials = items(content.items);
      if (!testimonials.length) return null;
      return <section className="mx-auto max-w-6xl px-4 py-14"><h2 className="text-center text-3xl font-bold">{text(content.title, 500)}</h2><div className="cms-responsive-grid mt-8 grid gap-5 md:grid-cols-2">{testimonials.map((item, index) => <blockquote key={index} className="rounded-2xl border bg-card p-6"><p className="text-lg">“{text(item.content, 4_000)}”</p><footer className="mt-4 text-sm text-muted-foreground">{text(item.name, 200)}{item.role ? ` · ${text(item.role, 200)}` : ""}</footer></blockquote>)}</div></section>;
    }
    case "grid_box":
      return <section className="cms-layout-section"><div className="cms-section-heading">{content.eyebrow ? <p className="cms-section-eyebrow">{text(content.eyebrow, 200)}</p> : null}<h2>{text(content.title, 500)}</h2>{content.subtitle ? <p>{text(content.subtitle)}</p> : null}</div><div className={`cms-responsive-grid cms-grid-box-grid ${responsiveColumns(content.columns)}`}>{items(content.cards, 24).map((card, cardIndex) => { const image = safeImageUrl(card.imageUrl); const href = safeUrl(card.linkUrl); const body = <><div className="cms-grid-box-media">{image ? <img src={image} alt="" loading="lazy" /> : <span aria-hidden="true">{String(cardIndex + 1).padStart(2, "0")}</span>}</div><div className="cms-grid-box-copy"><h3>{text(card.title, 300)}</h3>{card.description ? <p>{text(card.description, 2_000)}</p> : null}{href && card.linkLabel ? <span className="cms-inline-link">{text(card.linkLabel, 200)} <ArrowRight className="h-4 w-4" aria-hidden="true" /></span> : null}</div></>; return <article key={cardIndex} className="cms-grid-box-card">{href ? <a href={href} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}>{body}</a> : body}</article>; })}</div></section>;
    case "scroll_box": {
      const cardSize = ["compact", "wide"].includes(text(content.cardSize, 16)) ? text(content.cardSize, 16) : "standard";
      return <section className="cms-layout-section cms-scroll-section"><div className="cms-section-heading"><h2>{text(content.title, 500)}</h2>{content.subtitle ? <p>{text(content.subtitle)}</p> : null}</div><div className="cms-horizontal-scroll" data-card-size={cardSize} tabIndex={0} aria-label={text(content.title, 500) || "Scrollable content"}>{items(content.items, 30).map((item, itemIndex) => { const image = safeImageUrl(item.imageUrl); const href = safeUrl(item.linkUrl); const body = <>{image ? <img src={image} alt="" loading="lazy" /> : null}<div><span>{String(itemIndex + 1).padStart(2, "0")}</span><h3>{text(item.title, 300)}</h3>{item.description ? <p>{text(item.description, 2_000)}</p> : null}{href && item.linkLabel ? <strong className="cms-inline-link">{text(item.linkLabel, 200)} <ArrowRight className="h-4 w-4" aria-hidden="true" /></strong> : null}</div></>; return <article key={itemIndex} className="cms-scroll-card">{href ? <a href={href} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}>{body}</a> : body}</article>; })}</div></section>;
    }
    case "carousel_box":
      return <section className="cms-layout-section cms-carousel-section"><div className="cms-section-heading"><h2>{text(content.title, 500)}</h2>{content.subtitle ? <p>{text(content.subtitle)}</p> : null}</div><div className="cms-carousel-track" tabIndex={0} aria-label={text(content.title, 500) || "Featured content carousel"}>{items(content.slides, 20).map((slide, slideIndex) => { const image = safeImageUrl(slide.imageUrl); const href = safeUrl(slide.linkUrl); return <article key={slideIndex} className="cms-carousel-slide">{image ? <img src={image} alt="" loading="lazy" /> : <div className="cms-carousel-placeholder" aria-hidden="true" />}<div className="cms-carousel-copy">{slide.eyebrow ? <p className="cms-section-eyebrow">{text(slide.eyebrow, 200)}</p> : null}<h3>{text(slide.title, 300)}</h3>{slide.description ? <p>{text(slide.description, 2_000)}</p> : null}{href && slide.linkLabel ? <a className="cms-carousel-link" href={href} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}>{text(slide.linkLabel, 200)} <ArrowRight className="h-4 w-4" aria-hidden="true" /></a> : null}</div></article>; })}</div></section>;
    case "column_layout":
      return <section className="cms-layout-section"><div className="cms-section-heading"><h2>{text(content.title, 500)}</h2>{content.subtitle ? <p>{text(content.subtitle)}</p> : null}</div><div className={`cms-responsive-grid cms-column-layout-grid ${responsiveColumns(content.columns)}`}>{items(content.items, 16).map((item, itemIndex) => { const href = safeUrl(item.linkUrl); return <article key={itemIndex}><span className="cms-column-number">{String(itemIndex + 1).padStart(2, "0")}</span>{item.eyebrow ? <p className="cms-section-eyebrow">{text(item.eyebrow, 200)}</p> : null}<h3>{text(item.title, 300)}</h3>{item.body ? <p>{text(item.body, 3_000)}</p> : null}{href && item.linkLabel ? <a className="cms-inline-link" href={href} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}>{text(item.linkLabel, 200)} <ArrowRight className="h-4 w-4" aria-hidden="true" /></a> : null}</article>; })}</div></section>;
    case "progress_bars":
      return <section className="cms-layout-section cms-progress-section"><div className="cms-section-heading"><h2>{text(content.title, 500)}</h2>{content.subtitle ? <p>{text(content.subtitle)}</p> : null}</div><div className="cms-progress-list">{items(content.items, 20).map((item, itemIndex) => { const value = progressValue(item.value); return <div key={itemIndex} className="cms-progress-item"><div className="cms-progress-label"><div><strong>{text(item.label, 300)}</strong>{item.note ? <small>{text(item.note, 500)}</small> : null}</div><span>{value}%</span></div><progress max={100} value={value} aria-label={text(item.label, 300)}>{value}%</progress></div>; })}</div></section>;
    case "counter_grid":
      return <section className="cms-layout-section cms-counter-section"><div className="cms-section-heading"><h2>{text(content.title, 500)}</h2>{content.subtitle ? <p>{text(content.subtitle)}</p> : null}</div><div className={`cms-responsive-grid cms-counter-grid ${responsiveColumns(content.columns)}`}>{items(content.items, 16).map((item, itemIndex) => <article key={itemIndex}><p className="cms-counter-value"><span>{text(item.prefix, 40)}</span>{text(item.value, 80)}<span>{text(item.suffix, 40)}</span></p><h3>{text(item.label, 300)}</h3>{item.description ? <p>{text(item.description, 1_000)}</p> : null}</article>)}</div></section>;
    case "logo_marquee": {
      const logos = items(content.items, 40);
      if (!logos.length) return null;
      return <section className="cms-layout-section cms-logo-marquee-section"><div className="cms-section-heading"><h2>{text(content.title, 500)}</h2>{content.subtitle ? <p>{text(content.subtitle)}</p> : null}</div><div className="cms-logo-marquee" tabIndex={0} aria-label={text(content.title, 500) || "Partner logos"}>{logos.map((item, itemIndex) => { const image = safeImageUrl(item.imageUrl); const href = safeUrl(item.linkUrl); const logo = <>{image ? <img src={image} alt={text(item.name, 200)} loading="lazy" /> : <strong>{text(item.name, 200)}</strong>}</>; return href ? <a key={itemIndex} href={href} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}>{logo}</a> : <div key={itemIndex}>{logo}</div>; })}</div></section>;
    }
    case "section_title":
      return <section className="mx-auto max-w-6xl px-4 py-10 text-center"><h2 className="text-3xl font-bold">{text(content.title, 500)}</h2>{content.subtitle ? <p className="mt-3 text-muted-foreground">{text(content.subtitle)}</p> : null}</section>;
    case "spacer_divider": {
      return <div aria-hidden="true" className={`mx-auto max-w-6xl px-4 ${spacerHeightClass(content.height)}`}>{content.showDivider ? <hr /> : null}</div>;
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
    ogTitle: typeof page?.data.seo?.ogTitle === "string" ? page.data.seo.ogTitle : undefined,
    ogDescription: typeof page?.data.seo?.ogDescription === "string" ? page.data.seo.ogDescription : undefined,
    ogImage: typeof page?.data.seo?.ogImageUrl === "string" ? page.data.seo.ogImageUrl : undefined,
    twitterTitle: typeof page?.data.seo?.twitterTitle === "string" ? page.data.seo.twitterTitle : undefined,
    twitterDescription: typeof page?.data.seo?.twitterDescription === "string" ? page.data.seo.twitterDescription : undefined,
    twitterImage: typeof page?.data.seo?.twitterImageUrl === "string" ? page.data.seo.twitterImageUrl : undefined,
  });
  const schema = useMemo(() => {
    if (!page) return [];
    const webPage = {
      "@type": "WebPage",
      "@id": `${SITE_URL}${page.meta.canonicalPath}#webpage`,
      name: page.data.title,
      description: page.meta.description,
      url: `${SITE_URL}${page.meta.canonicalPath}`,
      datePublished: page.data.publishedAt,
      inLanguage: lang,
      isPartOf: { "@type": "WebSite", name: SITE_NAME, url: SITE_URL },
    };
    const catalogueLists = page.meta.indexable ? page.data.blocks.flatMap((block) => {
      if (block.blockType !== "catalog_grid") return [];
      const entries = items(block.content.items, 12).flatMap((item) => {
        const href = safeUrl(item.canonicalPath);
        const name = text(item.title, 500);
        return href && name ? [{ "@type": "ListItem", url: href.startsWith("/") ? `${SITE_URL}${href}` : href, name }] : [];
      });
      if (entries.length === 0) return [];
      return [{
        "@type": "ItemList",
        name: text(block.content.title, 500) || "Catalogue",
        numberOfItems: entries.length,
        itemListElement: entries.map((entry, index) => ({ ...entry, position: index + 1 })),
      }];
    }) : [];
    return { "@context": "https://schema.org", "@graph": [webPage, ...catalogueLists] };
  }, [lang, page]);
  useJsonLd(schema);

  if (loading) return <main className="mx-auto max-w-6xl px-4 py-28" aria-busy="true" aria-live="polite"><div role="status" aria-label="Loading page" className="h-12 w-2/3 animate-pulse rounded bg-secondary" /><div className="mt-8 h-80 animate-pulse rounded-3xl bg-secondary" /></main>;
  if (failed || !page) {
    return <main className="mx-auto max-w-3xl px-4 py-28 text-center"><FileText className="mx-auto h-14 w-14 text-muted-foreground/30" /><h1 className="mt-5 text-2xl font-bold">Page not found</h1><p className="mt-2 text-muted-foreground">This page is unavailable or has not been published in this language.</p><Button asChild variant="outline" className="mt-7 rounded-full"><Link href={localePath("")}><ArrowLeft className="mr-2 h-4 w-4" />{SITE_NAME}</Link></Button></main>;
  }
  return <CmsPageCanvas><div data-public-page-version={page.data.versionNumber}>{page.data.blocks.map((block, index) => <CmsBlock block={block} index={index} variables={{ siteName: SITE_NAME, pageTitle: page.data.title, pageSlug: page.data.slug, pageLocale: lang }} key={`${block.blockType}-${block.sortOrder}-${index}`} />)}</div></CmsPageCanvas>;
}
