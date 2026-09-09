import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  PROGRAM_SUPPORTED_LOCALES,
} from "../src/lib/programTranslationContract";
import {
  PUBLIC_WEB_SITEMAP_PAGE_SIZE,
  renderPublicWebSitemapIndex,
  renderPublicWebUrlSet,
  type PublicWebSitemapEntry,
} from "../src/lib/publicWebDiscoveryContract";
import {
  renderPublicCatalogHtml,
  type PublicCatalogRenderModel,
} from "../src/lib/publicCatalogRenderContract";

test("target catalogue cardinality remains a bounded sitemap index", () => {
  const counts = PROGRAM_SUPPORTED_LOCALES.flatMap((locale) => [
    { entityType: "PROGRAM" as const, locale, count: 200_000 },
    { entityType: "UNIVERSITY" as const, locale, count: 2_000 },
  ]);
  const xml = renderPublicWebSitemapIndex({
    siteUrl: "https://findandstudy.com",
    counts,
  });
  assert.equal((xml.match(/<sitemap>/g) || []).length, 944);
  assert.ok(Buffer.byteLength(xml) < 256 * 1024);
  assert.equal(PUBLIC_WEB_SITEMAP_PAGE_SIZE, 5_000);
});

test("a worst-case shard stays below the uncompressed sitemap size ceiling", () => {
  const alternates = Object.fromEntries(
    PROGRAM_SUPPORTED_LOCALES.map((locale) => [
      locale,
      `/${locale}/programs/international-business-management-2147483647`,
    ]),
  );
  const entries: PublicWebSitemapEntry[] = Array.from(
    { length: PUBLIC_WEB_SITEMAP_PAGE_SIZE },
    (_, index) => ({
      path: `/en/programs/international-business-management-${index + 1}`,
      lastModified: "2026-09-09T12:00:00.000Z",
      alternates,
    }),
  );
  const startedAt = performance.now();
  const xml = renderPublicWebUrlSet({ siteUrl: "https://findandstudy.com", entries });
  const durationMs = performance.now() - startedAt;
  assert.equal((xml.match(/<url>/g) || []).length, PUBLIC_WEB_SITEMAP_PAGE_SIZE);
  assert.equal((xml.match(/hreflang="x-default"/g) || []).length, PUBLIC_WEB_SITEMAP_PAGE_SIZE);
  assert.ok(Buffer.byteLength(xml) < 50 * 1024 * 1024);
  assert.ok(durationMs < 10_000, `sitemap rendering exceeded local safety budget: ${durationMs.toFixed(1)}ms`);
});

test("semantic render shell stays small, escaped and nonce-complete", () => {
  const model: PublicCatalogRenderModel = {
    kind: "program_detail",
    locale: "tr",
    canonicalPath: "/tr/programs/guvenlik-42",
    title: "Güvenlik Programı",
    description: "Doğrulanmış program açıklaması",
    indexable: true,
    alternatePaths: {
      en: "/en/programs/security-42",
      tr: "/tr/programs/guvenlik-42",
    },
    relatedPrograms: [],
    program: {
      id: 42,
      name: "Güvenlik Programı",
      universityName: "Örnek Üniversitesi",
      universityPath: "/tr/universities/ornek-universitesi-7",
      country: "Türkiye",
      city: "İstanbul",
      degree: "Yüksek Lisans",
      field: "Bilgi Güvenliği",
      duration: "2 yıl",
      language: "Türkçe",
      tuitionFee: 12_000,
      discountedFee: 10_000,
      currency: "USD",
    },
  };
  const indexHtml = "<!doctype html><html lang=\"en\"><head><title>Fallback</title><link rel=\"canonical\" href=\"/\"></head><body><div id=\"root\"></div><script type=\"module\" src=\"/assets/app.js\"></script></body></html>";
  const html = renderPublicCatalogHtml({
    indexHtml,
    model,
    siteUrl: "https://findandstudy.com",
    nonce: "scale-gate-nonce",
  });
  assert.ok(Buffer.byteLength(html) < 64 * 1024);
  assert.equal((html.match(/hreflang="[^"]+"/g) || []).length, 3);
  assert.match(html, />Derece<\/dt>/);
  assert.doesNotMatch(html, />Degree<\/dt>/);
  assert.ok((html.match(/<script\b[^>]*>/g) || []).every((tag) => tag.includes('nonce="scale-gate-nonce"')));
  assert.doesNotMatch(html, /commission|service fee|contact person/i);
});
