export interface ManagedWebsitePageRouteInput {
  slug: string;
  template?: string | null;
  locale?: string | null;
  status?: string | null;
  publishedAt?: string | null;
}

const SYSTEM_TEMPLATES = new Set(["home", "about", "countries", "programs", "blog", "contact"]);

export function isInternalWebsitePage(page: Pick<ManagedWebsitePageRouteInput, "slug" | "template">): boolean {
  const template = String(page.template || "").toLowerCase();
  const slug = String(page.slug || "").toLowerCase();
  return template.startsWith("detail:") || template.startsWith("detail-content:") || slug.startsWith("_detail-layout-") || slug.startsWith("_detail-content-");
}

export function isSystemManagedPage(page: Pick<ManagedWebsitePageRouteInput, "slug" | "template">): boolean {
  const template = String(page.template || "").toLowerCase();
  return SYSTEM_TEMPLATES.has(template) && (template === "home" || page.slug === template);
}

export function managedPagePublicPath(page: Pick<ManagedWebsitePageRouteInput, "slug" | "template" | "locale">): string {
  const locale = String(page.locale || "en").trim().toLowerCase() || "en";
  const template = String(page.template || "").trim().toLowerCase();
  if (template === "home" && (page.slug === "home" || page.slug === "")) return `/${locale}`;
  if (SYSTEM_TEMPLATES.has(template) && template !== "home" && page.slug === template) return `/${locale}/${template}`;
  const slug = String(page.slug || "").trim().replace(/^\/+|\/+$/g, "");
  return slug ? `/${locale}/${slug}` : `/${locale}`;
}

export function canOpenManagedPage(page: ManagedWebsitePageRouteInput): boolean {
  if (isInternalWebsitePage(page)) return false;
  if (isSystemManagedPage(page)) return true;
  return page.status === "published" && Boolean(page.publishedAt);
}
