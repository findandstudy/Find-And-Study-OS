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
  const sourceKey = ROUTE_SOURCE_BY_KIND[model.kind];
  if (!sourceKey) return [];
  const chunk = safeChunk(manifest, sourceKey);
  if (!chunk || typeof chunk.file !== "string" || !SAFE_ASSET_FILE.test(chunk.file)) return [];

  // The base HTML already preloads the shared runtime/vendor graph. Recursing
  // through every route import also pulled interaction-only dialog, upload and
  // document-processing chunks into the critical network queue. On constrained
  // mobile connections those speculative downloads competed with the blocking
  // stylesheet and delayed the server-rendered LCP. Hint only the route entry;
  // Vite's module graph loads its dependencies when hydration actually begins.
  return [`/${chunk.file}`];
}
