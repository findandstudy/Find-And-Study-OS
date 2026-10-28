import { safeOutboundRequest } from "./safeOutboundRequest";

export const BLOG_AI_LIMITS = {
  maxSources: 4,
  maxSourceBytes: 384 * 1024,
  maxSourceText: 32_000,
  maxNotes: 20_000,
  maxInstructions: 4_000,
} as const;

export type BlogAiSource = {
  url: string;
  title: string;
  description: string;
  imageUrl: string | null;
  text: string;
  warning?: string;
};

export type BlogAiDraft = {
  title: string;
  slug: string;
  excerpt: string;
  bodyHtml: string;
  metaTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  twitterTitle: string;
  twitterDescription: string;
  categorySlug: string;
  tagSlugs: string[];
};

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16) || 32);
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10) || 32);
    return named[lower] ?? " ";
  });
}

function meta(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]).replace(/\s+/g, " ").trim().slice(0, 500);
  }
  return "";
}

function htmlTitle(html: string): string {
  return decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function htmlText(html: string): string {
  return decodeHtml(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, BLOG_AI_LIMITS.maxSourceText);
}

function safePublicImage(raw: string, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

export async function readBlogAiSource(rawUrl: string): Promise<BlogAiSource> {
  const response = await safeOutboundRequest(rawUrl, {
    method: "GET",
    headers: { Accept: "text/html,text/plain;q=0.9" },
    timeoutMs: 8_000,
    maxBytes: BLOG_AI_LIMITS.maxSourceBytes,
    maxRedirects: 2,
    allowedProtocols: ["https:"],
    allowedPorts: [443],
  });
  if (!response.ok) throw new Error(`source_http_${response.status}`);
  const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) throw new Error("source_content_type_not_supported");
  const raw = response.body.toString("utf8");
  const isHtml = contentType.includes("text/html") || /<html[\s>]/i.test(raw);
  const title = isHtml ? meta(raw, "og:title") || htmlTitle(raw) : new URL(response.url).hostname;
  const description = isHtml ? meta(raw, "og:description") || meta(raw, "description") : "";
  return {
    url: response.url,
    title,
    description,
    imageUrl: isHtml ? safePublicImage(meta(raw, "og:image"), response.url) : null,
    text: isHtml ? htmlText(raw) : raw.trim().slice(0, BLOG_AI_LIMITS.maxSourceText),
  };
}
export async function readBlogAiSources(urls: string[]): Promise<BlogAiSource[]> {
  const unique = [...new Set(urls.map(value => value.trim()).filter(Boolean))].slice(0, BLOG_AI_LIMITS.maxSources);
  return Promise.all(unique.map(async url => {
    try { return await readBlogAiSource(url); }
    catch (error) {
      return { url, title: "", description: "", imageUrl: null, text: "", warning: error instanceof Error ? error.message : "source_unavailable" };
    }
  }));
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function safeBlogSlug(value: unknown, fallback: string): string {
  const supplied = cleanString(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const fromFallback = fallback.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (supplied || fromFallback || "generated-article").slice(0, 120).replace(/-+$/g, "");
}

export function parseBlogAiDraft(raw: string, allowedCategories: string[], allowedTags: string[]): BlogAiDraft {
  const withoutFence = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let value: Record<string, unknown>;
  try { value = JSON.parse(withoutFence) as Record<string, unknown>; }
  catch { throw new Error("AI_BLOG_RESPONSE_INVALID_JSON"); }
  const title = cleanString(value.title, 180);
  const bodyHtml = cleanString(value.bodyHtml, 80_000);
  if (title.length < 4 || bodyHtml.length < 300) throw new Error("AI_BLOG_RESPONSE_INCOMPLETE");
  if (/<\s*(script|style|iframe|form|object|embed|link|meta)\b/i.test(bodyHtml) || /\son[a-z]+\s*=/i.test(bodyHtml)) {
    throw new Error("AI_BLOG_RESPONSE_UNSAFE_HTML");
  }
  const categorySlug = cleanString(value.categorySlug, 120);
  const tagSlugs = Array.isArray(value.tagSlugs)
    ? [...new Set(value.tagSlugs.map(item => cleanString(item, 120)).filter(item => allowedTags.includes(item)))].slice(0, 8)
    : [];
  const excerpt = cleanString(value.excerpt, 320);
  const metaTitle = cleanString(value.metaTitle, 60) || title.slice(0, 60);
  const metaDescription = cleanString(value.metaDescription, 160) || excerpt.slice(0, 160);
  return {
    title,
    slug: safeBlogSlug(value.slug, title),
    excerpt,
    bodyHtml,
    metaTitle,
    metaDescription,
    ogTitle: cleanString(value.ogTitle, 180) || metaTitle,
    ogDescription: cleanString(value.ogDescription, 300) || metaDescription,
    twitterTitle: cleanString(value.twitterTitle, 180) || metaTitle,
    twitterDescription: cleanString(value.twitterDescription, 300) || metaDescription,
    categorySlug: allowedCategories.includes(categorySlug) ? categorySlug : "",
    tagSlugs,
  };
}
