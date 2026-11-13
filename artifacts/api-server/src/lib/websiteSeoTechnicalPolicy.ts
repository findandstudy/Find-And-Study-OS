export type SeoImagePreview = "none" | "standard" | "large";

export interface WebsiteSeoTechnicalPolicy {
  version: 1;
  allowOaiSearchBot: boolean;
  allowGptBot: boolean;
  allowGoogleExtended: boolean;
  maxSnippet: number;
  maxImagePreview: SeoImagePreview;
  maxVideoPreview: number;
  xDefaultLocale: string;
  indexNowEnabled: boolean;
}

export const DEFAULT_WEBSITE_SEO_TECHNICAL_POLICY: WebsiteSeoTechnicalPolicy = Object.freeze({
  version: 1,
  allowOaiSearchBot: true,
  allowGptBot: false,
  allowGoogleExtended: false,
  maxSnippet: -1,
  maxImagePreview: "large",
  maxVideoPreview: -1,
  xDefaultLocale: "en",
  indexNowEnabled: false,
});

const SUPPORTED_LOCALES = new Set([
  "en", "tr", "ar", "fr", "ru", "fa", "zh", "hi", "es", "id", "ur", "tk",
  "ky", "kk", "uz", "tg", "bn", "pt", "ne", "vi", "ko", "uk", "it",
]);

function boundedPreviewNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < -1 || parsed > 10_000) return null;
  return parsed;
}

export function parseWebsiteSeoTechnicalPolicy(value: unknown): WebsiteSeoTechnicalPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_WEBSITE_SEO_TECHNICAL_POLICY };
  }
  const candidate = value as Record<string, unknown>;
  const maxSnippet = boundedPreviewNumber(candidate.maxSnippet);
  const maxVideoPreview = boundedPreviewNumber(candidate.maxVideoPreview);
  const xDefaultLocale = String(candidate.xDefaultLocale ?? "").trim().toLowerCase();
  const maxImagePreview = candidate.maxImagePreview;
  return {
    version: 1,
    allowOaiSearchBot: candidate.allowOaiSearchBot !== false,
    allowGptBot: candidate.allowGptBot === true,
    allowGoogleExtended: candidate.allowGoogleExtended === true,
    maxSnippet: maxSnippet ?? DEFAULT_WEBSITE_SEO_TECHNICAL_POLICY.maxSnippet,
    maxImagePreview: maxImagePreview === "none" || maxImagePreview === "standard" || maxImagePreview === "large"
      ? maxImagePreview
      : DEFAULT_WEBSITE_SEO_TECHNICAL_POLICY.maxImagePreview,
    maxVideoPreview: maxVideoPreview ?? DEFAULT_WEBSITE_SEO_TECHNICAL_POLICY.maxVideoPreview,
    xDefaultLocale: SUPPORTED_LOCALES.has(xDefaultLocale) ? xDefaultLocale : "en",
    indexNowEnabled: candidate.indexNowEnabled === true,
  };
}

export function websiteRobotsDirective(input: {
  indexable: boolean;
  follow?: boolean;
  policy?: WebsiteSeoTechnicalPolicy;
}): string {
  const policy = input.policy ?? DEFAULT_WEBSITE_SEO_TECHNICAL_POLICY;
  const directives = [input.indexable ? "index" : "noindex", input.follow === false ? "nofollow" : "follow"];
  if (input.indexable) {
    directives.push(`max-snippet:${policy.maxSnippet}`);
    directives.push(`max-image-preview:${policy.maxImagePreview}`);
    directives.push(`max-video-preview:${policy.maxVideoPreview}`);
  }
  return directives.join(", ");
}

export function validateWebsiteSeoOverride(input: {
  metaTitle?: unknown;
  metaDescription?: unknown;
  canonicalUrl?: unknown;
  canonicalBaseUrl?: unknown;
}): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const title = String(input.metaTitle ?? "").trim();
  const description = String(input.metaDescription ?? "").trim();
  if (title.length > 120) errors.push("SEO_TITLE_TOO_LONG");
  else if (title && (title.length < 20 || title.length > 60)) warnings.push("SEO_TITLE_DISPLAY_RANGE");
  if (description.length > 500) errors.push("SEO_DESCRIPTION_TOO_LONG");
  else if (description && (description.length < 70 || description.length > 160)) warnings.push("SEO_DESCRIPTION_DISPLAY_RANGE");

  const canonical = String(input.canonicalUrl ?? "").trim();
  if (canonical) {
    try {
      const parsed = new URL(canonical, String(input.canonicalBaseUrl ?? "https://findandstudy.com"));
      const base = new URL(String(input.canonicalBaseUrl ?? "https://findandstudy.com"));
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) errors.push("SEO_CANONICAL_UNSAFE");
      if (parsed.origin !== base.origin) errors.push("SEO_CANONICAL_OFF_DOMAIN");
      if (parsed.search || parsed.hash) errors.push("SEO_CANONICAL_QUERY_OR_HASH");
    } catch {
      errors.push("SEO_CANONICAL_INVALID");
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
