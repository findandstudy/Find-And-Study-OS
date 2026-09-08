import {
  PROGRAM_SUPPORTED_LOCALES,
  type ProgramSupportedLocale,
} from "./programTranslationContract";
import {
  parsePublicCatalogRouteKey,
  type PublicCatalogRouteIdentity,
} from "./publicCatalogRouteContract";

export type PublicWebRenderMode = "off" | "allowlist" | "all";

export type PublicCatalogRenderRoute =
  | {
      kind: "program_list";
      locale: ProgramSupportedLocale;
      path: string;
    }
  | {
      kind: "program_detail";
      locale: ProgramSupportedLocale;
      path: string;
      routeKey: string;
      identity: PublicCatalogRouteIdentity | null;
    };

export type PublicCatalogRenderModel =
  | {
      kind: "not_found";
      locale: ProgramSupportedLocale;
      canonicalPath: string;
      title: string;
      description: string;
      indexable: false;
    }
  | {
      kind: "program_list";
      locale: ProgramSupportedLocale;
      canonicalPath: string;
      title: string;
      description: string;
      total: number;
      indexable: true;
      programs: Array<{
        id: number;
        name: string;
        universityName: string;
        country: string;
        city: string | null;
        degree: string | null;
        field: string | null;
        duration: string | null;
        language: string | null;
        canonicalPath: string;
      }>;
    }
  | {
      kind: "program_detail";
      locale: ProgramSupportedLocale;
      canonicalPath: string;
      title: string;
      description: string;
      indexable: boolean;
      program: {
        id: number;
        name: string;
        universityName: string;
        universityPath: string;
        country: string;
        city: string | null;
        degree: string | null;
        field: string | null;
        duration: string | null;
        language: string | null;
        tuitionFee: number | null;
        discountedFee: number | null;
        currency: string | null;
      };
    };

const MAX_ALLOWLIST_ENTRIES = 64;
const MAX_RENDER_PATH_LENGTH = 512;

export function parsePublicWebRenderMode(value: unknown): PublicWebRenderMode {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("en-US");
  return normalized === "allowlist" || normalized === "all"
    ? normalized
    : "off";
}

export function parsePublicWebRenderAllowlist(value: unknown): Set<string> {
  const entries = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) =>
      item.length >= 4
      && item.length <= MAX_RENDER_PATH_LENGTH
      && item.startsWith("/")
      && !item.includes("//")
      && !item.includes("?")
      && !item.includes("#")
      && !item.includes(".."),
    )
    .slice(0, MAX_ALLOWLIST_ENTRIES);
  return new Set(entries);
}

export function matchPublicCatalogRenderPath(
  rawPath: unknown,
): PublicCatalogRenderRoute | null {
  const path = String(rawPath ?? "");
  if (path.length > MAX_RENDER_PATH_LENGTH || path.includes("//")) return null;
  const segments = path.split("/").filter(Boolean);
  const locale = segments[0] as ProgramSupportedLocale;
  if (!PROGRAM_SUPPORTED_LOCALES.includes(locale)) return null;
  if (segments.length === 2 && segments[1] === "programs") {
    return { kind: "program_list", locale, path };
  }
  if (segments.length === 3 && segments[1] === "programs") {
    return {
      kind: "program_detail",
      locale,
      path,
      routeKey: segments[2],
      identity: parsePublicCatalogRouteKey(segments[2]),
    };
  }
  return null;
}

export function shouldRenderPublicCatalogPath(input: {
  path: unknown;
  mode: unknown;
  allowlist: unknown;
}): PublicCatalogRenderRoute | null {
  const route = matchPublicCatalogRenderPath(input.path);
  if (!route) return null;
  const mode = parsePublicWebRenderMode(input.mode);
  if (mode === "off") return null;
  if (mode === "allowlist") {
    const allowlist = parsePublicWebRenderAllowlist(input.allowlist);
    if (!allowlist.has(route.path)) return null;
  }
  return route;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function replaceMeta(
  html: string,
  attribute: "name" | "property",
  key: string,
  value: string,
): string {
  const escaped = escapeHtml(value);
  const pattern = new RegExp(`<meta\\s+${attribute}=["']${key}["'][^>]*>`, "i");
  const tag = `<meta ${attribute}="${key}" content="${escaped}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace("</head>", `  ${tag}\n</head>`);
}

function renderProgramList(model: Extract<PublicCatalogRenderModel, { kind: "program_list" }>): string {
  const cards = model.programs.map((program) => `
      <article class="rounded-2xl border border-border bg-card p-5">
        <p class="text-sm text-primary">${escapeHtml(program.universityName)}</p>
        <h2 class="mt-2 text-xl font-bold"><a href="${escapeHtml(program.canonicalPath)}">${escapeHtml(program.name)}</a></h2>
        <p class="mt-2 text-muted-foreground">${escapeHtml([program.degree, program.field, program.duration, program.language].filter(Boolean).join(" · "))}</p>
        <p class="mt-2 text-sm text-muted-foreground">${escapeHtml([program.city, program.country].filter(Boolean).join(", "))}</p>
      </article>`).join("");
  return `<main data-public-render-shell="program-list" class="mx-auto max-w-7xl px-4 py-24">
    <header><h1 class="text-4xl font-bold">${escapeHtml(model.title)}</h1><p class="mt-3 text-muted-foreground">${escapeHtml(model.description)}</p><p class="mt-2 text-sm">${model.total.toLocaleString("en-US")} programs</p></header>
    <section class="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">${cards}</section>
  </main>`;
}

function renderProgramDetail(model: Extract<PublicCatalogRenderModel, { kind: "program_detail" }>): string {
  const program = model.program;
  const price = program.discountedFee ?? program.tuitionFee;
  return `<main data-public-render-shell="program-detail" class="mx-auto max-w-7xl px-4 py-24">
    <nav aria-label="Breadcrumb"><a href="/${escapeHtml(model.locale)}/programs">Programs</a> / <span>${escapeHtml(program.name)}</span></nav>
    <article class="mt-8">
      <p class="text-sm text-primary"><a href="${escapeHtml(program.universityPath)}">${escapeHtml(program.universityName)}</a></p>
      <h1 class="mt-3 text-4xl font-bold">${escapeHtml(program.name)}</h1>
      <p class="mt-4 text-muted-foreground">${escapeHtml(model.description)}</p>
      <dl class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt>Degree</dt><dd>${escapeHtml(program.degree || "—")}</dd></div>
        <div><dt>Field</dt><dd>${escapeHtml(program.field || "—")}</dd></div>
        <div><dt>Duration</dt><dd>${escapeHtml(program.duration || "—")}</dd></div>
        <div><dt>Language</dt><dd>${escapeHtml(program.language || "—")}</dd></div>
        <div><dt>Location</dt><dd>${escapeHtml([program.city, program.country].filter(Boolean).join(", "))}</dd></div>
        <div><dt>Tuition</dt><dd>${price === null ? "—" : `${escapeHtml(String(price))} ${escapeHtml(program.currency || "USD")}`}</dd></div>
      </dl>
    </article>
  </main>`;
}

function renderNotFound(model: Extract<PublicCatalogRenderModel, { kind: "not_found" }>): string {
  return `<main data-public-render-shell="not-found" class="mx-auto max-w-3xl px-4 py-32 text-center"><h1 class="text-3xl font-bold">${escapeHtml(model.title)}</h1><p class="mt-3 text-muted-foreground">${escapeHtml(model.description)}</p></main>`;
}

function structuredData(model: PublicCatalogRenderModel, siteUrl: string): unknown {
  if (model.kind === "program_detail") {
    const program = model.program;
    const price = program.discountedFee ?? program.tuitionFee;
    return {
      "@context": "https://schema.org",
      "@type": "Course",
      name: program.name,
      description: model.description,
      url: `${siteUrl}${model.canonicalPath}`,
      provider: {
        "@type": "CollegeOrUniversity",
        name: program.universityName,
        url: `${siteUrl}${program.universityPath}`,
      },
      ...(program.language ? { inLanguage: program.language } : {}),
      ...(program.duration ? { timeRequired: program.duration } : {}),
      ...(price !== null ? {
        offers: {
          "@type": "Offer",
          price,
          priceCurrency: program.currency || "USD",
        },
      } : {}),
    };
  }
  if (model.kind === "program_list") {
    return {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: model.title,
      description: model.description,
      url: `${siteUrl}${model.canonicalPath}`,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: model.total,
        itemListElement: model.programs.map((program, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${siteUrl}${program.canonicalPath}`,
          name: program.name,
        })),
      },
    };
  }
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: model.title,
    url: `${siteUrl}${model.canonicalPath}`,
  };
}

export function renderPublicCatalogHtml(input: {
  indexHtml: string;
  model: PublicCatalogRenderModel;
  siteUrl: string;
  nonce: string;
}): string {
  const siteUrl = input.siteUrl.replace(/\/$/, "");
  const canonicalUrl = `${siteUrl}${input.model.canonicalPath}`;
  let html = input.indexHtml
    .replace(/<html\s+lang=["'][^"']+["']([^>]*)>/i, `<html lang="${input.model.locale}"${["ar", "fa", "ur"].includes(input.model.locale) ? " dir=\"rtl\"" : ""}$1>`)
    .replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(input.model.title)}</title>`)
    .replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`)
    .replace(/<script\b/g, `<script nonce="${escapeHtml(input.nonce)}"`);

  html = replaceMeta(html, "name", "description", input.model.description);
  html = replaceMeta(html, "name", "robots", input.model.indexable ? "index, follow" : "noindex, follow");
  html = replaceMeta(html, "property", "og:title", input.model.title);
  html = replaceMeta(html, "property", "og:description", input.model.description);
  html = replaceMeta(html, "property", "og:url", canonicalUrl);
  html = replaceMeta(html, "name", "twitter:title", input.model.title);
  html = replaceMeta(html, "name", "twitter:description", input.model.description);

  const shell = input.model.kind === "program_list"
    ? renderProgramList(input.model)
    : input.model.kind === "program_detail"
      ? renderProgramDetail(input.model)
      : renderNotFound(input.model);
  const extraHead = `  <meta name="csp-nonce" content="${escapeHtml(input.nonce)}" />\n  <meta name="public-render" content="ssr-isr-pilot" />\n  <script nonce="${escapeHtml(input.nonce)}" type="application/ld+json">${safeJson(structuredData(input.model, siteUrl))}</script>\n`;
  return html
    .replace("</head>", `${extraHead}</head>`)
    .replace(/<div\s+id=["']root["']\s*><\/div>/i, `<div id="root" data-public-render-shell-root="true">${shell}</div>`);
}

export function publicCatalogCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
