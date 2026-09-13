import { PROGRAM_SUPPORTED_LOCALES } from "./programTranslationContract";

const PRIVATE_ROUTE_PREFIXES = [
  "/admin",
  "/staff",
  "/student",
  "/agent",
  "/institution",
  "/accommodation",
  "/instructor",
  "/sign",
];

const LOCALIZED_NOINDEX_ROUTES = new Set([
  "login",
  "register",
  "agency/apply",
  "agency-application",
]);

/**
 * Server-level crawler boundary for SPA routes whose client-side `useSeo`
 * cannot protect the initial HTML response seen by non-JavaScript crawlers.
 */
export function shouldNoindexSpaPath(value: unknown): boolean {
  const path = String(value ?? "").trim();
  if (!path.startsWith("/") || path.length > 2_048 || path.includes("\\")) {
    return true;
  }
  if (path === "/login" || path === "/register") return true;
  if (PRIVATE_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return true;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return false;
  const locale = segments[0];
  if (!PROGRAM_SUPPORTED_LOCALES.includes(locale as (typeof PROGRAM_SUPPORTED_LOCALES)[number])) {
    return true;
  }
  return LOCALIZED_NOINDEX_ROUTES.has(segments.slice(1).join("/"));
}
