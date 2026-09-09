import {
  normalizeProgramLocale,
  type ProgramSupportedLocale,
} from "./programTranslationContract";

export const PUBLIC_CATALOG_RELATED_LIMIT = 8;
export const PUBLIC_CATALOG_RELATED_CANDIDATE_LIMIT = 32;
export const PUBLIC_CATALOG_UNIVERSITY_PROGRAM_LIMIT = 12;

export type PublicWebInternalLinkMode = "off" | "published";

export function parsePublicWebInternalLinkMode(value: unknown): PublicWebInternalLinkMode {
  return String(value ?? "").trim().toLowerCase() === "published" ? "published" : "off";
}

export type PublicCatalogEntityType = "program" | "university";

export type PublicCatalogRouteIdentity = {
  id: number;
  slug: string;
  routeKey: string;
};

/** Stable ASCII slug generation for DB-backed catalogue routes. */
export function publicCatalogSlug(value: unknown): string {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150)
    .replace(/-+$/g, "");
  return normalized || "item";
}

export function publicCatalogRouteKey(id: number, name: unknown): string {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) {
    throw new Error("invalid_public_catalog_id");
  }
  return `${publicCatalogSlug(name)}-${id}`;
}

export function parsePublicCatalogRouteKey(
  value: unknown,
): PublicCatalogRouteIdentity | null {
  const routeKey = String(value ?? "").trim().toLocaleLowerCase("en-US");
  if (routeKey.length < 3 || routeKey.length > 180) return null;
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d+)$/.exec(routeKey);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) {
    return null;
  }
  return { id, slug: match[1], routeKey };
}

export function publicCatalogPath(input: {
  locale: unknown;
  entityType: PublicCatalogEntityType;
  id: number;
  name: unknown;
}): string {
  const locale: ProgramSupportedLocale = normalizeProgramLocale(input.locale);
  const segment = input.entityType === "program" ? "programs" : "universities";
  return `/${locale}/${segment}/${publicCatalogRouteKey(input.id, input.name)}`;
}

export function publicCatalogCanonicalState(input: {
  requestedRouteKey: unknown;
  locale: unknown;
  entityType: PublicCatalogEntityType;
  id: number;
  name: unknown;
}) {
  const routeKey = publicCatalogRouteKey(input.id, input.name);
  return {
    routeKey,
    canonicalPath: publicCatalogPath(input),
    isCanonical: String(input.requestedRouteKey ?? "") === routeKey,
  };
}
