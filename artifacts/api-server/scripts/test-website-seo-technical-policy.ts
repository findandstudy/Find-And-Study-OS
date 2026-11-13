import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WEBSITE_SEO_TECHNICAL_POLICY,
  parseWebsiteSeoTechnicalPolicy,
  validateWebsiteSeoOverride,
  websiteRobotsDirective,
} from "../src/lib/websiteSeoTechnicalPolicy";

test("technical SEO policy is bounded and fails to safe defaults", () => {
  assert.deepEqual(parseWebsiteSeoTechnicalPolicy(null), DEFAULT_WEBSITE_SEO_TECHNICAL_POLICY);
  assert.deepEqual(parseWebsiteSeoTechnicalPolicy({
    allowOaiSearchBot: false,
    allowGptBot: true,
    allowGoogleExtended: true,
    maxSnippet: 240,
    maxImagePreview: "standard",
    maxVideoPreview: 60,
    xDefaultLocale: "TR",
    indexNowEnabled: true,
  }), {
    version: 1,
    allowOaiSearchBot: false,
    allowGptBot: true,
    allowGoogleExtended: true,
    maxSnippet: 240,
    maxImagePreview: "standard",
    maxVideoPreview: 60,
    xDefaultLocale: "tr",
    indexNowEnabled: true,
  });
  assert.equal(parseWebsiteSeoTechnicalPolicy({ maxSnippet: 10_001 }).maxSnippet, -1);
  assert.equal(parseWebsiteSeoTechnicalPolicy({ xDefaultLocale: "xx" }).xDefaultLocale, "en");
});

test("robots directives expose preview policy only on indexable pages", () => {
  assert.equal(
    websiteRobotsDirective({ indexable: true }),
    "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1",
  );
  assert.equal(websiteRobotsDirective({ indexable: false }), "noindex, follow");
});

test("page SEO validation rejects unsafe and off-domain canonicals", () => {
  assert.deepEqual(validateWebsiteSeoOverride({
    metaTitle: "A useful title for prospective students",
    metaDescription: "A clear description for prospective students that is long enough to describe the page accurately and avoids unsupported claims.",
    canonicalUrl: "/en/countries/turkey",
    canonicalBaseUrl: "https://staging.findandstudy.com",
  }).errors, []);

  const unsafe = validateWebsiteSeoOverride({
    canonicalUrl: "https://evil.example/page?tracking=1#fragment",
    canonicalBaseUrl: "https://staging.findandstudy.com",
  });
  assert.deepEqual(unsafe.errors, ["SEO_CANONICAL_OFF_DOMAIN", "SEO_CANONICAL_QUERY_OR_HASH"]);
});
