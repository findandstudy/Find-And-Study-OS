export type CmsTextVariable = { key: string; label: string; labelTr: string; group: string; groupTr: string };
export const CMS_TEXT_VARIABLES: readonly CmsTextVariable[] = [
  { key: "site.name", label: "Site name", labelTr: "Site adı", group: "Site", groupTr: "Site" },
  { key: "page.title", label: "Current page title", labelTr: "Geçerli sayfa başlığı", group: "Page", groupTr: "Sayfa" },
  { key: "page.slug", label: "Current page address", labelTr: "Geçerli sayfa adresi", group: "Page", groupTr: "Sayfa" },
  { key: "page.locale", label: "Current language code", labelTr: "Geçerli dil kodu", group: "Page", groupTr: "Sayfa" },
  { key: "date.year", label: "Current year", labelTr: "Güncel yıl", group: "Date", groupTr: "Tarih" },
] as const;
const TOKEN = /\{\{\s*(site\.name|page\.(?:title|slug|locale)|date\.year)\s*(?:\|\s*([^{}]{1,160}?))?\s*\}\}/g;
export type CmsTextVariableValues = { siteName: string; pageTitle: string; pageSlug: string; pageLocale: string; currentYear?: number };
export function resolveCmsText(value: string, values: CmsTextVariableValues): string {
  const map: Record<string, string> = { "site.name": values.siteName, "page.title": values.pageTitle, "page.slug": values.pageSlug, "page.locale": values.pageLocale, "date.year": String(values.currentYear ?? new Date().getFullYear()) };
  return value.replace(TOKEN, (_token, key: string, fallback?: string) => map[key]?.trim() || fallback?.trim() || "").replace(/[ \t]{2,}/g, " ").trim();
}
export function resolveCmsValue<T>(value: T, variables: CmsTextVariableValues): T {
  if (typeof value === "string") return resolveCmsText(value, variables) as T;
  if (Array.isArray(value)) return value.map(item => resolveCmsValue(item, variables)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveCmsValue(item, variables)])) as T;
  return value;
}
