import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicWebPublicationReadModel } from "../src/lib/publicWebPublicationReadModel.js";

const completeTranslations = Object.fromEntries([
  "tr", "ar", "fr", "ru", "fa", "zh", "hi", "es", "id", "ur", "tk",
  "ky", "kk", "uz", "tg", "bn", "pt", "ne", "vi", "ko", "uk", "it",
].map((locale) => [locale, { title: `Title ${locale}` }]));

test("builds a bounded publication and localization control view", () => {
  const result = buildPublicWebPublicationReadModel({
    generatedAt: "2026-09-09T00:00:00.000Z",
    pages: [
      {
        id: 1,
        title: "Ready page",
        slug: "ready",
        status: "published",
        locale: "en",
        metaTitle: "A complete search title",
        metaDescription: "A complete search description that is deliberately longer than fifty characters.",
        canonicalUrl: "https://findandstudy.com/en/ready",
        ogImageUrl: "https://findandstudy.com/assets/ready.jpg",
        robotsIndex: true,
        translationsJson: completeTranslations,
        publishedAt: "2026-09-08T00:00:00.000Z",
        updatedAt: "2026-09-08T00:00:00.000Z",
      },
      {
        id: 2,
        title: "Broken live page",
        slug: "broken",
        status: "published",
        locale: "en",
        metaTitle: null,
        metaDescription: null,
        canonicalUrl: null,
        ogImageUrl: null,
        robotsIndex: false,
        translationsJson: {},
        publishedAt: null,
        updatedAt: "2026-09-09T00:00:00.000Z",
      },
    ],
    blogPosts: [{
      id: 1,
      status: "published",
      locale: "en",
      metaTitle: "A complete blog title",
      metaDescription: "A complete blog description that is deliberately longer than fifty characters.",
      updatedAt: "2026-09-08T00:00:00.000Z",
    }],
    versions: [{
      id: 1,
      pageId: 1,
      versionNumber: 2,
      publishedAt: "2026-09-08T00:00:00.000Z",
      createdAt: "2026-09-08T00:00:00.000Z",
    }],
  });
  assert.equal(result.foundation.mutationsEnabled, false);
  assert.deepEqual(result.summary, {
    totalPages: 2,
    publishedPages: 2,
    draftPages: 0,
    indexablePublishedPages: 1,
    seoReadyPages: 1,
    translationCompletePages: 1,
    criticalPages: 1,
    totalBlogPosts: 1,
    publishedBlogPosts: 1,
    blogSeoReady: 1,
    recentVersionCount: 1,
  });
  assert.equal(result.queue[0]?.id, 2);
  assert.equal(result.queue[0]?.priority, "CRITICAL");
  assert.ok(result.queue[0]?.blockers.includes("PUBLISH_RECEIPT_MISSING"));
  assert.equal(result.localeCoverage.find((row) => row.locale === "tr")?.coveragePercent, 50);
});

test("rejects invalid time and unbounded input", () => {
  assert.throws(
    () => buildPublicWebPublicationReadModel({ pages: [], blogPosts: [], versions: [], generatedAt: "bad" }),
    /time_invalid/,
  );
  assert.throws(
    () => buildPublicWebPublicationReadModel({
      pages: Array.from({ length: 10_001 }, (_, id) => ({
        id, title: "x", slug: `x-${id}`, status: "draft", locale: "en",
        metaTitle: null, metaDescription: null, canonicalUrl: null, ogImageUrl: null,
        robotsIndex: false, translationsJson: {}, publishedAt: null, updatedAt: new Date(0),
      })),
      blogPosts: [], versions: [], generatedAt: new Date(0),
    }),
    /denominator_exceeded/,
  );
});
