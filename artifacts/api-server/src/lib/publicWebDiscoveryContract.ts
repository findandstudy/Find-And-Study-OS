import {
  PROGRAM_SUPPORTED_LOCALES,
  type ProgramSupportedLocale,
} from "./programTranslationContract";

export const PUBLIC_WEB_SITEMAP_PAGE_SIZE = 5_000;
export const PUBLIC_WEB_SITEMAP_MAX_SHARDS = 10_000;

export const PUBLIC_WEB_DISCOVERY_ENTITY_TYPES = [
  "PROGRAM",
  "UNIVERSITY",
  "DESTINATION",
  "ARTICLE",
] as const;

export type PublicWebDiscoveryEntityType =
  (typeof PUBLIC_WEB_DISCOVERY_ENTITY_TYPES)[number];
export type PublicWebSitemapMode = "off" | "static" | "published";

export type PublicWebDiscoveryScope = {
  tenantId: string;
  organizationId: string;
};

export type PublicWebDiscoveryConfig = {
  mode: PublicWebSitemapMode;
  siteUrl: string;
  scope: PublicWebDiscoveryScope | null;
  reason: "enabled" | "disabled" | "invalid_site_url" | "invalid_scope";
};

export type PublicWebSitemapCount = {
  entityType: PublicWebDiscoveryEntityType;
  locale: ProgramSupportedLocale;
  count: number;
};

export type PublicWebSitemapEntry = {
  path: string;
  lastModified: string;
  alternates: Partial<Record<ProgramSupportedLocale, string>>;
};

export type PublicWebSitemapRoute =
  | { kind: "index" }
  | { kind: "static" }
  | {
      kind: "published";
      entityType: PublicWebDiscoveryEntityType;
      locale: ProgramSupportedLocale;
      shard: number;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_SEGMENTS: Record<string, PublicWebDiscoveryEntityType> = {
  programs: "PROGRAM",
  universities: "UNIVERSITY",
  destinations: "DESTINATION",
  guides: "ARTICLE",
};
const ENTITY_PATHS: Record<PublicWebDiscoveryEntityType, string> = {
  PROGRAM: "programs",
  UNIVERSITY: "universities",
  DESTINATION: "destinations",
  ARTICLE: "guides",
};

const STATIC_PUBLIC_PATHS = ["", "/about", "/programs", "/countries", "/blog", "/contact"] as const;

function parseMode(value: unknown): PublicWebSitemapMode {
  const mode = String(value ?? "").trim().toLocaleLowerCase("en-US");
  return mode === "static" || mode === "published" ? mode : "off";
}

function parseSiteUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value) && value !== "00000000-0000-0000-0000-000000000000";
}

export function parsePublicWebDiscoveryConfig(input: {
  mode?: unknown;
  siteUrl?: unknown;
  tenantId?: unknown;
  organizationId?: unknown;
}): PublicWebDiscoveryConfig {
  const mode = parseMode(input.mode);
  const siteUrl = parseSiteUrl(input.siteUrl);
  if (mode === "off") {
    return {
      mode: "off",
      siteUrl: siteUrl || "https://findandstudy.com",
      scope: null,
      reason: "disabled",
    };
  }
  if (!siteUrl) {
    return {
      mode: "off",
      siteUrl: "https://findandstudy.com",
      scope: null,
      reason: "invalid_site_url",
    };
  }
  if (mode === "published" && (!validUuid(input.tenantId) || !validUuid(input.organizationId))) {
    return { mode: "off", siteUrl, scope: null, reason: "invalid_scope" };
  }
  return {
    mode,
    siteUrl,
    scope: mode === "published"
      ? { tenantId: input.tenantId as string, organizationId: input.organizationId as string }
      : null,
    reason: "enabled",
  };
}

export function parsePublicWebSitemapRoute(path: unknown): PublicWebSitemapRoute | null {
  const value = String(path ?? "");
  if (value === "/sitemap.xml") return { kind: "index" };
  if (value === "/sitemaps/static.xml") return { kind: "static" };
  const match = /^\/sitemaps\/(programs|universities|destinations|guides)-([a-z]{2})-(\d{1,5})\.xml$/.exec(value);
  if (!match) return null;
  const locale = match[2] as ProgramSupportedLocale;
  const shard = Number(match[3]);
  if (!PROGRAM_SUPPORTED_LOCALES.includes(locale) || shard < 1 || shard > PUBLIC_WEB_SITEMAP_MAX_SHARDS) {
    return null;
  }
  return {
    kind: "published",
    entityType: ENTITY_SEGMENTS[match[1]],
    locale,
    shard,
  };
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safePath(value: unknown): string | null {
  const path = String(value ?? "");
  if (path.length < 3 || path.length > 2_048 || !path.startsWith("/") || path.startsWith("//")) return null;
  if (path.includes("?") || path.includes("#") || path.includes("..") || /[\u0000-\u001f\u007f]/.test(path)) return null;
  return path;
}

function absoluteUrl(siteUrl: string, path: unknown): string | null {
  const safe = safePath(path);
  return safe ? `${siteUrl}${safe}` : null;
}

function renderUrlEntry(siteUrl: string, entry: PublicWebSitemapEntry): string {
  const loc = absoluteUrl(siteUrl, entry.path);
  if (!loc) return "";
  const alternates = PROGRAM_SUPPORTED_LOCALES.flatMap((locale) => {
    const href = absoluteUrl(siteUrl, entry.alternates[locale]);
    return href
      ? [`    <xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(href)}"/>`]
      : [];
  });
  const defaultHref = absoluteUrl(siteUrl, entry.alternates.en);
  if (defaultHref) {
    alternates.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(defaultHref)}"/>`);
  }
  return [
    "  <url>",
    `    <loc>${escapeXml(loc)}</loc>`,
    `    <lastmod>${escapeXml(entry.lastModified)}</lastmod>`,
    ...alternates,
    "  </url>",
  ].join("\n");
}

export function renderPublicWebUrlSet(input: {
  siteUrl: string;
  entries: PublicWebSitemapEntry[];
}): string {
  const entries = input.entries.map((entry) => renderUrlEntry(input.siteUrl, entry)).filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`;
}

export function buildStaticSitemapEntries(now = new Date()): PublicWebSitemapEntry[] {
  const lastModified = now.toISOString().slice(0, 10);
  return STATIC_PUBLIC_PATHS.flatMap((path) => {
    const alternates = Object.fromEntries(
      PROGRAM_SUPPORTED_LOCALES.map((locale) => [locale, `/${locale}${path}`]),
    ) as Record<ProgramSupportedLocale, string>;
    return PROGRAM_SUPPORTED_LOCALES.map((locale) => ({
      path: alternates[locale],
      lastModified,
      alternates,
    }));
  });
}

export function renderPublicWebSitemapIndex(input: {
  siteUrl: string;
  counts: PublicWebSitemapCount[];
}): string {
  const locations = [`${input.siteUrl}/sitemaps/static.xml`];
  for (const count of input.counts) {
    const shards = Math.min(
      PUBLIC_WEB_SITEMAP_MAX_SHARDS,
      Math.ceil(Math.max(0, count.count) / PUBLIC_WEB_SITEMAP_PAGE_SIZE),
    );
    const segment = ENTITY_PATHS[count.entityType];
    for (let shard = 1; shard <= shards; shard += 1) {
      locations.push(`${input.siteUrl}/sitemaps/${segment}-${count.locale}-${shard}.xml`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations.map((location) => `  <sitemap><loc>${escapeXml(location)}</loc></sitemap>`).join("\n")}\n</sitemapindex>\n`;
}
