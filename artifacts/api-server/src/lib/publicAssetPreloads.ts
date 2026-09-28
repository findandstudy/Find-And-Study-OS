import fs from "node:fs";
import path from "node:path";
import type { PublicCatalogRenderModel } from "./publicCatalogRenderContract";

type ManifestChunk = {
  file?: unknown;
  imports?: unknown;
};

const ROUTE_SOURCE_BY_KIND: Partial<Record<PublicCatalogRenderModel["kind"], string>> = {
  program_list: "src/pages/public/Programs.tsx",
  program_detail: "src/pages/public/ProgramDetail.tsx",
  university_detail: "src/pages/public/UniversityDetail.tsx",
  destination_detail: "src/pages/public/CountryDetail.tsx",
  city_detail: "src/pages/public/CityDetail.tsx",
  article_detail: "src/pages/public/GuideDetail.tsx",
  page_detail: "src/pages/public/PublicPage.tsx",
};

const SAFE_ASSET_FILE = /^assets\/[A-Za-z0-9._-]+\.js$/;

export type PublicAssetManifest = Record<string, ManifestChunk>;

export function readPublicAssetManifest(distPath: string): PublicAssetManifest {
  const manifestPath = path.join(distPath, ".vite", "manifest.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as PublicAssetManifest
      : {};
  } catch (error) {
    console.warn("[public-render] asset manifest unavailable; continuing without route preloads", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return {};
  }
}

function safeChunk(manifest: PublicAssetManifest, key: string): ManifestChunk | null {
  const chunk = manifest[key];
  return chunk && typeof chunk === "object" ? chunk : null;
}

export function resolvePublicAssetPreloads(
  manifest: PublicAssetManifest,
  model: PublicCatalogRenderModel,
): string[] {
  const sourceKeys = [
    `src/lib/i18n/translations/${model.locale}.json`,
    ROUTE_SOURCE_BY_KIND[model.kind],
  ].filter((value): value is string => Boolean(value));
  const queued = [...sourceKeys];
  const visited = new Set<string>();
  const hrefs = new Set<string>();

  while (queued.length > 0 && visited.size < 32 && hrefs.size < 16) {
    const key = queued.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const chunk = safeChunk(manifest, key);
    if (!chunk) continue;
    if (typeof chunk.file === "string" && SAFE_ASSET_FILE.test(chunk.file)) {
      hrefs.add(`/${chunk.file}`);
    }
    if (Array.isArray(chunk.imports)) {
      for (const imported of chunk.imports) {
        if (typeof imported === "string" && !visited.has(imported)) queued.push(imported);
      }
    }
  }

  return [...hrefs];
}
