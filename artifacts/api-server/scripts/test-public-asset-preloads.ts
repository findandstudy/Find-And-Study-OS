import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublicAssetPreloads, type PublicAssetManifest } from "../src/lib/publicAssetPreloads";
import type { PublicCatalogRenderModel } from "../src/lib/publicCatalogRenderContract";

function model(kind: PublicCatalogRenderModel["kind"], locale = "en"): PublicCatalogRenderModel {
  return { kind, locale } as PublicCatalogRenderModel;
}

test("SSR preloads only the route entry so interaction-only imports do not compete with LCP", () => {
  const manifest: PublicAssetManifest = {
    "src/lib/i18n/translations/en.json": {
      file: "assets/en-abc123.js",
      imports: ["_vendor-react.js"],
    },
    "src/pages/public/ProgramDetail.tsx": {
      file: "assets/ProgramDetail-def456.js",
      imports: ["_vendor-react.js", "_detail.js"],
    },
    "_vendor-react.js": { file: "assets/vendor-react-ghi789.js" },
    "_detail.js": { file: "assets/DetailContentSections-jkl012.js" },
    "src/lib/i18n/translations/tr.json": { file: "assets/tr-unused.js" },
  };

  assert.deepEqual(resolvePublicAssetPreloads(manifest, model("program_detail")), [
    "/assets/ProgramDetail-def456.js",
  ]);
  assert.ok(!resolvePublicAssetPreloads(manifest, model("program_detail")).includes("/assets/en-abc123.js"));
  assert.ok(!resolvePublicAssetPreloads(manifest, model("program_detail")).includes("/assets/DetailContentSections-jkl012.js"));
});

test("unsafe and missing manifest entries fail closed", () => {
  const manifest: PublicAssetManifest = {
    "src/lib/i18n/translations/en.json": {
      file: "../secret.js",
      imports: ["_unsafe.js"],
    },
    "_unsafe.js": { file: "https://evil.example/payload.js" },
  };
  assert.deepEqual(resolvePublicAssetPreloads(manifest, model("not_found")), []);
});
