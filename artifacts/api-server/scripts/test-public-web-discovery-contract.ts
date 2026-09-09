import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PUBLIC_WEB_SITEMAP_PAGE_SIZE,
  buildStaticSitemapEntries,
  parsePublicWebDiscoveryConfig,
  parsePublicWebSitemapRoute,
  renderPublicWebSitemapIndex,
  renderPublicWebUrlSet,
} from "../src/lib/publicWebDiscoveryContract";
import {
  parsePublicWebRobotsConfig,
  renderPublicWebRobots,
} from "../src/lib/publicWebRobotsContract";

const TENANT_ID = "018f8400-0000-7000-8000-000000000001";
const ORGANIZATION_ID = "018f8400-0000-7000-8000-000000000002";

test("robots publication is explicit and invalid configuration fails closed", () => {
  assert.deepEqual(parsePublicWebRobotsConfig({}), {
    mode: "disallow",
    siteUrl: null,
    reason: "disabled",
  });
  assert.deepEqual(
    parsePublicWebRobotsConfig({ mode: "published", siteUrl: "http://findandstudy.com" }),
    { mode: "disallow", siteUrl: null, reason: "invalid_site_url" },
  );
  assert.deepEqual(
    parsePublicWebRobotsConfig({ mode: "published", siteUrl: "https://user:pass@findandstudy.com" }),
    { mode: "disallow", siteUrl: null, reason: "invalid_site_url" },
  );
  const published = parsePublicWebRobotsConfig({
    mode: "published",
    siteUrl: "https://findandstudy.com/",
  });
  assert.equal(published.mode, "published");
  const robots = renderPublicWebRobots(published);
  assert.match(robots, /^User-agent: \*\nAllow: \/$/m);
  assert.match(robots, /^Disallow: \/institution\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/findandstudy\.com\/sitemap\.xml$/m);
  assert.equal(renderPublicWebRobots(parsePublicWebRobotsConfig({})), "User-agent: *\nDisallow: /\n");
});

test("discovery rollout and tenant scope fail closed", () => {
  assert.equal(parsePublicWebDiscoveryConfig({}).mode, "off");
  assert.equal(parsePublicWebDiscoveryConfig({ mode: "published", siteUrl: "https://findandstudy.com" }).reason, "invalid_scope");
  assert.equal(parsePublicWebDiscoveryConfig({ mode: "static", siteUrl: "http://findandstudy.com" }).reason, "invalid_site_url");
  assert.equal(parsePublicWebDiscoveryConfig({ mode: "published", siteUrl: "https://user:pass@example.test", tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }).reason, "invalid_site_url");
  assert.deepEqual(
    parsePublicWebDiscoveryConfig({
      mode: "published",
      siteUrl: "https://findandstudy.com",
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    }),
    {
      mode: "published",
      siteUrl: "https://findandstudy.com",
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      reason: "enabled",
    },
  );
});

test("sitemap routes accept only known locale, entity and bounded shard", () => {
  assert.deepEqual(parsePublicWebSitemapRoute("/sitemap.xml"), { kind: "index" });
  assert.deepEqual(parsePublicWebSitemapRoute("/sitemaps/static.xml"), { kind: "static" });
  assert.deepEqual(parsePublicWebSitemapRoute("/sitemaps/programs-tr-2.xml"), {
    kind: "published",
    entityType: "PROGRAM",
    locale: "tr",
    shard: 2,
  });
  assert.deepEqual(parsePublicWebSitemapRoute("/sitemaps/destinations-en-1.xml"), {
    kind: "published",
    entityType: "DESTINATION",
    locale: "en",
    shard: 1,
  });
  assert.deepEqual(parsePublicWebSitemapRoute("/sitemaps/cities-tr-1.xml"), {
    kind: "published",
    entityType: "CITY",
    locale: "tr",
    shard: 1,
  });
  assert.deepEqual(parsePublicWebSitemapRoute("/sitemaps/guides-tr-3.xml"), {
    kind: "published",
    entityType: "ARTICLE",
    locale: "tr",
    shard: 3,
  });
  assert.deepEqual(parsePublicWebSitemapRoute("/sitemaps/pages-en-1.xml"), {
    kind: "published",
    entityType: "PAGE",
    locale: "en",
    shard: 1,
  });
  assert.equal(parsePublicWebSitemapRoute("/sitemaps/programs-xx-1.xml"), null);
  assert.equal(parsePublicWebSitemapRoute("/sitemaps/programs-en-0.xml"), null);
  assert.equal(parsePublicWebSitemapRoute("/sitemaps/../../admin.xml"), null);
});

test("sitemap index shards governed counts at five thousand URLs", () => {
  assert.equal(PUBLIC_WEB_SITEMAP_PAGE_SIZE, 5_000);
  const xml = renderPublicWebSitemapIndex({
    siteUrl: "https://findandstudy.com",
    counts: [
      { entityType: "PROGRAM", locale: "en", count: 10_001 },
      { entityType: "UNIVERSITY", locale: "tr", count: 1 },
      { entityType: "DESTINATION", locale: "en", count: 30 },
      { entityType: "CITY", locale: "tr", count: 450 },
      { entityType: "ARTICLE", locale: "tr", count: 5_001 },
      { entityType: "PAGE", locale: "en", count: 1 },
    ],
  });
  assert.match(xml, /\/sitemaps\/static\.xml/);
  assert.match(xml, /programs-en-1\.xml/);
  assert.match(xml, /programs-en-3\.xml/);
  assert.doesNotMatch(xml, /programs-en-4\.xml/);
  assert.match(xml, /universities-tr-1\.xml/);
  assert.match(xml, /destinations-en-1\.xml/);
  assert.match(xml, /cities-tr-1\.xml/);
  assert.match(xml, /guides-tr-2\.xml/);
  assert.match(xml, /pages-en-1\.xml/);
});

test("static and dynamic URL sets emit reciprocal hreflang without unsafe paths", () => {
  const staticEntries = buildStaticSitemapEntries(new Date("2026-09-09T12:00:00.000Z"));
  assert.equal(staticEntries.length, 23 * 6);
  const xml = renderPublicWebUrlSet({
    siteUrl: "https://findandstudy.com",
    entries: [
      {
        path: "/tr/programs/guvenlik-42",
        lastModified: "2026-09-09T12:00:00.000Z",
        alternates: {
          en: "/en/programs/security-42",
          tr: "/tr/programs/guvenlik-42",
          fr: "//evil.example/programs/security-42",
        },
      },
    ],
  });
  assert.match(xml, /hreflang="en"/);
  assert.match(xml, /hreflang="tr"/);
  assert.match(xml, /hreflang="x-default"/);
  assert.doesNotMatch(xml, /evil\.example/);
});

test("read model is read-only, RLS-scoped and selects only published indexed records", () => {
  const server = readFileSync(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(server, /if \(config\.mode === "off"\) \{/);
  assert.match(server, /status\(404\)\.type\("text\/plain"\)\.send\("Sitemap not found"\)/);
  assert.doesNotMatch(server, /if \(config\.mode === "off"\) return next\(\)/);
  const source = readFileSync(
    new URL("../src/lib/publicWebDiscoveryReadModel.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /BEGIN READ ONLY/);
  assert.match(source, /set_config\('app\.tenant_id'/);
  assert.match(source, /set_config\('app\.organization_id'/);
  assert.match(source, /state\.status='PUBLISHED' AND state\.index_state='INDEX'/);
  assert.match(source, /translation\.status='published'/);
  assert.match(source, /website_page_versions/);
  assert.match(source, /version\.meta_snapshot->'translationsJson'/);
  assert.match(source, /LIMIT \$5 OFFSET \$6/);
  assert.match(source, /const SEO_CACHE_MAX_ENTRIES = 5_000/);
  assert.match(source, /const seoInFlight = new Map/);
  assert.match(source, /export async function readIndexableProgramIds/);
  assert.match(source, /export async function readIndexableArticleIds/);
  assert.match(source, /export async function readIndexableUniversityIds/);
  assert.match(source, /export async function readPublishedLocalizedEntity/);
  assert.match(source, /export async function resolvePublishedLocalizedDestinationRoute/);
  assert.match(source, /export async function readPublishedLocalizedEntities/);
  assert.match(source, /export async function resolvePublicWebRouteAlias/);
  assert.match(source, /alias\.route_kind IN \('REDIRECT','GONE'\)/);
  assert.match(source, /alias\.route_kind='GONE' OR state\.status='PUBLISHED'/);
  assert.match(source, /const ROUTE_ALIAS_CACHE_MAX_ENTRIES = 5_000/);
  assert.match(source, /content\.\$\{idColumn\}=ANY\(\$5::integer\[\]\)/);
  assert.match(source, /content\.canonical_path=\$4/);
  assert.match(source, /city: "city_id"/);
  assert.match(source, /page\.entity_type='CITY' AND alt\.city_id=page\.city_id/);
  assert.match(source, /localizedDeliveryMode/);
  assert.match(source, /revision\.id=state\.revision_id/);
  assert.match(source, /revision\.quality_status='PASS'/);
  assert.match(source, /revision\.source_coverage='COMPLETE'/);
  assert.match(source, /CASE WHEN content\.locale='en' THEN 'SOURCE' ELSE 'PUBLISHED' END/);
  assert.match(source, /content\.program_id=ANY\(\$4::integer\[\]\)/);
  assert.match(source, /LIMIT 64/);
  assert.doesNotMatch(source, /service_fee|commission|contact_person/i);

  const migration = readFileSync(
    new URL("../../../lib/db/drizzle/0119_public_web_discovery_indexes.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /WHERE "status" = 'PUBLISHED' AND "index_state" = 'INDEX'/);
  assert.doesNotMatch(migration, /^\s*(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)/im);
});
