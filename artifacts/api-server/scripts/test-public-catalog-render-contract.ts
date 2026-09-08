import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  matchPublicCatalogRenderPath,
  parsePublicWebRenderAllowlist,
  parsePublicWebRenderMode,
  publicCatalogCsp,
  renderPublicCatalogHtml,
  shouldRenderPublicCatalogPath,
  type PublicCatalogRenderModel,
} from "../src/lib/publicCatalogRenderContract";

const indexHtml = `<!doctype html><html lang="en"><head>
<title>Fallback</title><meta name="description" content="fallback" />
<meta name="robots" content="index, follow" /><link rel="canonical" href="https://example.test/" />
<meta property="og:title" content="fallback" /><meta property="og:description" content="fallback" />
<meta property="og:url" content="https://example.test/" /><meta name="twitter:title" content="fallback" />
<meta name="twitter:description" content="fallback" /></head><body><div id="root"></div>
<script>window.test=true</script><script type="module" src="/assets/app.js"></script></body></html>`;

test("render mode and exact allowlist fail closed", () => {
  assert.equal(parsePublicWebRenderMode("ALL"), "all");
  assert.equal(parsePublicWebRenderMode("allowlist"), "allowlist");
  assert.equal(parsePublicWebRenderMode("enabled"), "off");
  assert.deepEqual(
    [...parsePublicWebRenderAllowlist("/en/programs,https://evil.test,/en/../admin,/tr/programs")],
    ["/en/programs", "/tr/programs"],
  );
  assert.equal(
    shouldRenderPublicCatalogPath({ path: "/en/programs", mode: undefined, allowlist: "" }),
    null,
  );
  assert.equal(
    shouldRenderPublicCatalogPath({ path: "/en/programs", mode: "allowlist", allowlist: "/tr/programs" }),
    null,
  );
  assert.equal(
    shouldRenderPublicCatalogPath({ path: "/en/programs", mode: "allowlist", allowlist: "/en/programs" })?.kind,
    "program_list",
  );
});

test("only bounded program list and detail paths enter the render pilot", () => {
  assert.equal(matchPublicCatalogRenderPath("/en/programs")?.kind, "program_list");
  const detail = matchPublicCatalogRenderPath("/tr/programs/bilgisayar-muhendisligi-42");
  assert.equal(detail?.kind, "program_detail");
  assert.equal(detail?.kind === "program_detail" ? detail.identity?.id : null, 42);
  assert.equal(matchPublicCatalogRenderPath("/xx/programs"), null);
  assert.equal(matchPublicCatalogRenderPath("/en/admin"), null);
  assert.equal(matchPublicCatalogRenderPath("/en/programs/a/b"), null);
});

test("rendered shell escapes catalogue content, emits canonical metadata, and nonces every script", () => {
  const model: PublicCatalogRenderModel = {
    kind: "program_detail",
    locale: "en",
    canonicalPath: "/en/programs/security-42",
    title: `Security <script>alert(1)</script>`,
    description: `Safe </script><img src=x onerror=alert(1)>`,
    indexable: false,
    program: {
      id: 42,
      name: `Security </script>`,
      universityName: `Example & University`,
      universityPath: "/en/universities/example-university-7",
      country: "Turkey",
      city: "Istanbul",
      degree: "MSc",
      field: "Computing",
      duration: "2 years",
      language: "English",
      tuitionFee: 10_000,
      discountedFee: null,
      currency: "USD",
    },
  };
  const html = renderPublicCatalogHtml({
    indexHtml,
    model,
    siteUrl: "https://findandstudy.com/",
    nonce: "test-nonce",
  });
  assert.match(html, /data-public-render-shell-root="true"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/findandstudy\.com\/en\/programs\/security-42"/);
  assert.match(html, /<meta name="robots" content="noindex, follow"/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /Safe &lt;\/script&gt;&lt;img/);
  assert.match(html, /Safe \\u003c\/script\\u003e\\u003cimg/);
  const scripts = html.match(/<script\b[^>]*>/g) || [];
  assert.ok(scripts.length >= 3);
  assert.ok(scripts.every((tag) => tag.includes('nonce="test-nonce"')));
  assert.match(publicCatalogCsp("test-nonce"), /script-src 'self' 'nonce-test-nonce'/);
});

test("read model is on-demand, bounded, stale-while-revalidate, and detail indexing is fail-closed", () => {
  const readModel = readFileSync(
    new URL("../src/lib/publicCatalogRenderReadModel.ts", import.meta.url),
    "utf8",
  );
  assert.match(readModel, /const PILOT_LIST_LIMIT = 12/);
  assert.match(readModel, /const CACHE_MAX_ENTRIES = 500/);
  assert.match(readModel, /cacheStatus: "STALE"/);
  assert.match(readModel, /void refresh\(key, route\)/);
  assert.match(readModel, /indexable: false/);
  assert.doesNotMatch(readModel, /serviceFeeAmount|commissionRate|contactPerson/);
});
