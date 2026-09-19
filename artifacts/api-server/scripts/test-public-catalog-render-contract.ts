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

test("reviewed editorial SSR is bound, escaped, layout-controlled and cannot change SEO", async () => {
  const { defaultDetailLayout } = await import("../src/lib/websiteDetailLayoutContract");
  const model: PublicCatalogRenderModel = { kind: "program_detail", locale: "en", canonicalPath: "/en/programs/example-42", title: "Example", description: "Catalogue", indexable: false, alternatePaths: {}, relatedPrograms: [],
    program: { id: 42, name: "Example", universityName: "University", universityPath: "/en/universities/example-1", country: "Turkey", city: null, degree: "Bachelor", field: null, duration: null, language: "English", tuitionFee: null, discountedFee: null, currency: "USD" },
    editorial: { version: 1, kind: "program", entityId: 42, locale: "en", sections: [{ key: "faq", title: "Questions & answers", questions: [{ question: "When can I ask?", answer: "Contact admissions & discuss." }], sources: [{ label: "Source", url: "https://example.org/info?a=1&b=2" }], reviewedOn: "2026-09-01" }] },
    detailLayout: defaultDetailLayout("program") };
  const render = () => renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://example.test", nonce: "test" });
  Object.assign(model.editorial!.sections[0], { body: "Sourced editorial body", cards: [{ title: "Support card", body: "Contact support", href: "https://example.org/support" }], steps: [{ title: "Prepare", body: "Review your documents" }], images: [{ src: "https://example.org/campus.jpg", alt: "Campus photo", caption: "Approved image" }], table: { columns: ["Item"], rows: [["Sourced item"]] } });
  const html = render();
  assert.match(html, /id="editorial-faq"/); assert.match(html, /Questions &amp; answers/);
  assert.match(html, /Contact admissions &amp; discuss/); assert.match(html, /content="noindex, follow"/);
  for (const text of ["Sourced editorial body", "Support card", "Contact support", "Prepare", "Review your documents", "Campus photo", "Approved image", "Sourced item"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /"@type":"FAQPage"/);
  model.detailLayout!.hidden = ["editorial-faq"];
  assert.doesNotMatch(render(), /id="editorial-faq"|href="#editorial-faq"|When can I ask/);
  model.detailLayout = undefined;
  model.editorial!.locale = "tr"; assert.doesNotMatch(render(), /When can I ask/);
  model.editorial!.locale = "en"; model.editorial!.entityId = 43; assert.doesNotMatch(render(), /When can I ask/);
  model.editorial!.entityId = 42; model.editorial!.sections[0].body = "<script>alert(1)</script>";
  assert.doesNotMatch(render(), /When can I ask|alert\(1\)/);
});

test("admissions-closed program remains rendered and indexable without an available Offer", () => {
  const model: PublicCatalogRenderModel = {
    kind: "program_detail", locale: "en", canonicalPath: "/en/programs/example-42",
    title: "Example program", description: "Catalogue description", indexable: true,
    alternatePaths: { en: "/en/programs/example-42" }, relatedPrograms: [],
    program: {
      id: 42, name: "Example program", universityName: "Example university",
      universityPath: "/en/universities/example-7", universityIsActive: false,
      country: "Turkey", city: "Istanbul", degree: "Bachelor", field: null,
      countryPath: "/en/countries/turkey", cityPath: "/en/cities/istanbul-1",
      duration: null, language: "English", tuitionFee: 1000, discountedFee: null, currency: "USD",
      verifiedTuition: { amountMinor: "100000", currencyCode: "USD", frequency: "ANNUAL" },
    },
  };
  const html = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://example.test", nonce: "test" });
  assert.match(html, /data-public-render-shell="program-detail"/);
  assert.match(html, /Example program/);
  assert.match(html, /content="index, follow"/);
  assert.doesNotMatch(html, /"@type":"Offer"/);
  assert.doesNotMatch(html, /data-application-cta/);
  assert.match(html, /Applications closed/);
  assert.match(html, /href="\/en\/countries\/turkey"/);
  assert.match(html, /href="\/en\/cities\/istanbul-1"/);
  model.program.universityIsActive = true;
  const reopened = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://example.test", nonce: "test" });
  assert.match(reopened, /"@type":"Offer"/);
  assert.match(reopened, /data-application-cta/);
  model.program.verifiedTuition = null;
  const legacy = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://example.test", nonce: "test" });
  assert.match(legacy, /catalogue price; not verified/);
  assert.doesNotMatch(legacy, /"@type":"Offer"/);
  assert.match(legacy, /href="#fees"/);
  model.program.requirements = "IELTS: 6.0 | Edvoy Ref: private-import | Intake Years: 2024";
  model.prices = Object.assign([{ id: "price", componentType: "TUITION", amountMinor: "100000", currencyCode: "USD", frequency: "ANNUAL" }], { truncated: true });
  const overflow = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://example.test", nonce: "test" });
  assert.doesNotMatch(overflow, /"@type":"Offer"/);
  assert.doesNotMatch(overflow, /catalogue price; not verified/);
  assert.match(overflow, /IELTS: 6.0/);
  assert.doesNotMatch(overflow, /private-import|Intake Years/);
  assert.match(overflow, /data-detail-section="fees" id="fees"/);
  model.detailLayout = { version: 2, kind: "program", sections: ["hero", "navigation", "overview", "fees", "requirements", "intakes", "related"], hidden: [] };
  const reordered = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://example.test", nonce: "test" });
  assert.ok(reordered.indexOf('data-detail-section="fees"') < reordered.indexOf('data-detail-section="requirements"'));
  model.detailLayout.hidden = ["fees"];
  const hidden = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://example.test", nonce: "test" });
  assert.doesNotMatch(hidden, /href="#fees"|id="fees"/);
  model.detailLayout = undefined;
  model.prices = []; model.program.tuitionFee = null;
  const noFee = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://example.test", nonce: "test" });
  assert.doesNotMatch(noFee, /href="#fees"|id="fees"/);
});

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

test("production render middleware honors governed redirect and gone aliases", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /resolvePublicWebRouteAlias\(req\.path\)/);
  assert.match(source, /res\.redirect\(alias\.action\.status, alias\.action\.targetPath\)/);
  assert.match(source, /res\.status\(410\)\.type\("text\/plain"\)\.send\("Gone"\)/);
  assert.match(source, /X-Content-Type-Options/);
});

test("only bounded public content paths enter the render pilot and CMS pages cannot shadow system routes", () => {
  assert.equal(matchPublicCatalogRenderPath("/en/programs")?.kind, "program_list");
  const detail = matchPublicCatalogRenderPath("/tr/programs/bilgisayar-muhendisligi-42");
  assert.equal(detail?.kind, "program_detail");
  assert.equal(detail?.kind === "program_detail" ? detail.identity?.id : null, 42);
  const university = matchPublicCatalogRenderPath("/en/universities/example-university-7");
  assert.equal(university?.kind, "university_detail");
  assert.equal(university?.kind === "university_detail" ? university.identity?.id : null, 7);
  const destination = matchPublicCatalogRenderPath("/en/destinations/united-kingdom");
  assert.equal(destination?.kind, "destination_detail");
  assert.equal(destination?.kind === "destination_detail" ? destination.slug : null, "united-kingdom");
  assert.equal(matchPublicCatalogRenderPath("/en/countries/united-kingdom")?.kind, "destination_detail");
  const city = matchPublicCatalogRenderPath("/tr/cities/istanbul-34");
  assert.equal(city?.kind, "city_detail");
  assert.equal(city?.kind === "city_detail" ? city.identity?.id : null, 34);
  assert.equal(matchPublicCatalogRenderPath("/en/destinations/Unsafe_Slug"), null);
  const article = matchPublicCatalogRenderPath("/tr/guides/ogrenci-vizesi-19");
  assert.equal(article?.kind, "article_detail");
  assert.equal(article?.kind === "article_detail" ? article.identity?.id : null, 19);
  const page = matchPublicCatalogRenderPath("/tr/scholarship-guide");
  assert.equal(page?.kind, "page_detail");
  assert.equal(page?.kind === "page_detail" ? page.slug : null, "scholarship-guide");
  assert.equal(matchPublicCatalogRenderPath("/xx/programs"), null);
  assert.equal(matchPublicCatalogRenderPath("/en/admin"), null);
  assert.equal(matchPublicCatalogRenderPath("/en/login"), null);
  assert.equal(matchPublicCatalogRenderPath("/en/guides"), null);
  assert.equal(matchPublicCatalogRenderPath("/en/programs/a/b"), null);
  assert.equal(matchPublicCatalogRenderPath("/en/universities"), null);
});

test("rendered shell escapes catalogue content, emits canonical metadata, and nonces every script", () => {
  const model: PublicCatalogRenderModel = {
    kind: "program_detail",
    locale: "en",
    canonicalPath: "/en/programs/security-42",
    title: `Security <script>alert(1)</script>`,
    description: `Safe </script><img src=x onerror=alert(1)>`,
    indexable: false,
    alternatePaths: {},
    relatedPrograms: [{
      id: 43,
      name: "Related programme",
      universityName: "Related University",
      degree: "MSc",
      field: "Computing",
      canonicalPath: "/en/programs/related-programme-43",
    }],
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
  assert.match(html, />Degree<\/dt>/);
  assert.match(html, /href="#overview"/);
  assert.match(html, /id="fees"/);
  assert.match(html, /<section\b[^>]*\bid="related"/);
  assert.match(html, /href="\/en\/programs\/related-programme-43"/);
  const scripts = html.match(/<script\b[^>]*>/g) || [];
  assert.ok(scripts.length >= 3);
  assert.ok(scripts.every((tag) => tag.includes('nonce="test-nonce"')));
  assert.match(publicCatalogCsp("test-nonce"), /script-src 'self' 'nonce-test-nonce'/);
});

test("program SSR uses verified price components and structured active intakes", () => {
  const model: PublicCatalogRenderModel = {
    kind: "program_detail",
    locale: "en",
    canonicalPath: "/en/programs/verified-program-42",
    title: "Verified program",
    description: "Verified program description.",
    indexable: true,
    alternatePaths: { en: "/en/programs/verified-program-42" },
    relatedPrograms: [],
    program: {
      id: 42,
      name: "Verified program",
      universityName: "Verified University",
      universityPath: "/en/universities/verified-university-7",
      country: "Turkey",
      city: "Istanbul",
      degree: "MSc",
      field: "Computing",
      duration: "2 years",
      language: "English",
      tuitionFee: 1,
      discountedFee: 0,
      currency: "INVALID",
      verifiedTuition: {
        amountMinor: "1234500",
        currencyCode: "USD",
        frequency: "ANNUAL",
      },
    },
    intakes: [{
      id: "intake-1",
      intakeKey: "Fall",
      academicYear: 2026,
      startsOn: "2026-09-01",
      applicationDeadlineAt: "2026-06-30T00:00:00.000Z",
      capacityStatus: "OPEN",
      deliveryMode: "ON_CAMPUS",
      campusName: "Main Campus",
    }],
    prices: [{
      id: "price-1",
      componentType: "TUITION",
      amountMinor: "1234500",
      currencyCode: "USD",
      frequency: "ANNUAL",
    }],
  };
  const html = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://findandstudy.com", nonce: "verified-nonce" });
  assert.match(html, /\$12,345/);
  assert.match(html, /Fall · 2026/);
  assert.match(html, /"price":12345/);
  assert.match(html, /"priceCurrency":"USD"/);
  assert.doesNotMatch(html, /INVALID/);
  assert.doesNotMatch(html, /<div id="fees"><dt>Tuition<\/dt><dd>1/);
});

test("university detail emits a semantic institution shell and structured data", () => {
  const model: PublicCatalogRenderModel = {
    kind: "university_detail",
    locale: "en",
    canonicalPath: "/en/universities/example-university-7",
    title: "Example University",
    description: "A verified institution profile.",
    indexable: true,
    alternatePaths: { en: "/en/universities/example-university-7" },
    university: {
      id: 7,
      name: "Example University",
      country: "Turkey",
      city: "Istanbul",
      universityType: "Private",
      programCount: 1,
      programs: [{
        id: 42,
        name: "Computer Science",
        degree: "BSc",
        field: "Computing",
        canonicalPath: "/en/programs/computer-science-42",
      }],
    },
  };
  const html = renderPublicCatalogHtml({
    indexHtml,
    model,
    siteUrl: "https://findandstudy.com",
    nonce: "university-nonce",
  });
  assert.match(html, /data-public-render-shell="university-detail"/);
  assert.match(html, /"@type":"CollegeOrUniversity"/);
  assert.match(html, /href="#overview"/);
  assert.match(html, /<section\b[^>]*\bid="programs"/);
  assert.match(html, /href="\/en\/programs\/computer-science-42"/);
  assert.match(html, /hreflang="x-default"/);
});

test("destination detail emits a semantic destination shell without inventing translations", () => {
  const model: PublicCatalogRenderModel = {
    kind: "destination_detail",
    locale: "en",
    canonicalPath: "/en/destinations/turkey",
    title: "Study in Turkey",
    description: "Verified destination guidance.",
    indexable: true,
    alternatePaths: { en: "/en/destinations/turkey" },
    destination: {
      id: 3,
      name: "Turkey",
      country: "Turkey",
      livingCost: "Verified range",
      climate: "Varied",
      language: "Turkish",
      currency: "TRY",
      visaInfo: "Check current requirements",
      workPermit: null,
      popularCities: ["Istanbul", "Ankara"],
      universityCount: 1,
      programCount: 2,
      universities: [{
        id: 7,
        name: "Example University",
        city: "Istanbul",
        universityType: "Private",
        canonicalPath: "/en/universities/example-university-7",
      }],
    },
  };
  const html = renderPublicCatalogHtml({
    indexHtml,
    model,
    siteUrl: "https://findandstudy.com",
    nonce: "destination-nonce",
  });
  assert.match(html, /data-public-render-shell="destination-detail"/);
  assert.match(html, /"@type":"TouristDestination"/);
  assert.match(html, /href="\/en\/universities\/example-university-7"/);
  assert.match(html, /hreflang="x-default"/);
  assert.doesNotMatch(html, /service fee|commission|contact person/i);
});

test("city detail emits governed city structured data and bounded related links", () => {
  const model: PublicCatalogRenderModel = {
    kind: "city_detail",
    locale: "en",
    canonicalPath: "/en/cities/istanbul-34",
    title: "Study in Istanbul",
    description: "Verified city guidance for international students.",
    indexable: true,
    alternatePaths: { en: "/en/cities/istanbul-34" },
    city: {
      id: 34,
      name: "Istanbul",
      country: "Turkey",
      countryCode: "TR",
      description: "Verified city guidance for international students.",
      universityCount: 1,
      programCount: 1,
      universities: [{
        id: 7,
        name: "Example University",
        universityType: "Private",
        canonicalPath: "/en/universities/example-university-7",
      }],
      programs: [{
        id: 42,
        name: "Computer Science",
        universityName: "Example University",
        degree: "BSc",
        field: "Computing",
        canonicalPath: "/en/programs/computer-science-42",
      }],
    },
  };
  const html = renderPublicCatalogHtml({
    indexHtml,
    model,
    siteUrl: "https://findandstudy.com",
    nonce: "city-nonce",
  });
  assert.match(html, /data-public-render-shell="city-detail"/);
  assert.match(html, /"@type":"City"/);
  assert.match(html, /"@type":"Country"/);
  assert.match(html, /href="\/en\/universities\/example-university-7"/);
  assert.match(html, /href="\/en\/programs\/computer-science-42"/);
  assert.match(html, /hreflang="x-default"/);
  assert.doesNotMatch(html, /service fee|commission|contact person/i);
});

test("article detail emits safe semantic HTML and Article structured data", () => {
  const model: PublicCatalogRenderModel = {
    kind: "article_detail",
    locale: "en",
    canonicalPath: "/en/guides/student-visa-19",
    title: "Student visa guide",
    description: "Verified guide summary.",
    indexable: true,
    alternatePaths: { en: "/en/guides/student-visa-19" },
    relatedArticles: [{
      id: 20,
      title: "Application evidence guide",
      excerpt: "Prepare your evidence.",
      publishedAt: "2026-09-08T10:00:00.000Z",
      canonicalPath: "/en/guides/application-evidence-20",
    }],
    article: {
      id: 19,
      title: "Student visa guide",
      excerpt: "Verified guide summary.",
      body: "<h2>Prepare</h2><script>alert(1)</script><p>Use verified evidence.</p>",
      publishedAt: "2026-09-09T10:00:00.000Z",
      updatedAt: "2026-09-09T11:00:00.000Z",
      readTime: 4,
    },
  };
  const html = renderPublicCatalogHtml({
    indexHtml,
    model,
    siteUrl: "https://findandstudy.com",
    nonce: "article-nonce",
  });
  assert.match(html, /data-public-render-shell="article-detail"/);
  assert.match(html, /"@type":"Article"/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /Prepare alert\(1\) Use verified evidence/);
  assert.match(html, /href="\/en\/guides\/application-evidence-20"/);
  assert.match(html, /hreflang="x-default"/);
});

test("CMS page detail renders only the immutable projection and escapes block content", () => {
  const model: PublicCatalogRenderModel = {
    kind: "page_detail",
    locale: "en",
    canonicalPath: "/en/scholarship-guide",
    title: "Scholarship guide",
    description: "A reviewed public page.",
    indexable: true,
    alternatePaths: { en: "/en/scholarship-guide" },
    page: {
      id: 5,
      title: "Scholarship guide",
      slug: "scholarship-guide",
      versionNumber: 3,
      publishedAt: "2026-09-09T12:00:00.000Z",
      blocks: [{
        blockType: "rich_text",
        content: { content: "<h2>Safe heading</h2><img src=x onerror=alert(1)>" },
        settings: {},
        sortOrder: 0,
      }],
    },
  };
  const html = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://findandstudy.com", nonce: "page-nonce" });
  assert.match(html, /data-public-render-shell="page-detail"/);
  assert.match(html, /data-public-page-version="3"/);
  assert.match(html, /Safe heading/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /"@type":"WebPage"/);
  assert.match(html, /hreflang="x-default"/);
});

test("CMS catalogue grid renders current data bindings without storing duplicate facts", () => {
  const model: PublicCatalogRenderModel = {
    kind: "page_detail",
    locale: "en",
    canonicalPath: "/en/study-destinations",
    title: "Study destinations",
    description: "Browse destinations.",
    indexable: true,
    alternatePaths: { en: "/en/study-destinations" },
    page: {
      id: 9,
      title: "Study destinations",
      slug: "study-destinations",
      versionNumber: 1,
      publishedAt: "2026-09-09T12:00:00.000Z",
      blocks: [{
        blockType: "catalog_grid",
        content: {
          source: "destinations",
          title: "Live destinations",
          items: [{
            title: "Türkiye <script>alert(1)</script>",
            description: "Current catalogue row",
            canonicalPath: "/en/countries/turkey",
          }],
        },
        settings: {},
        sortOrder: 0,
      }],
    },
  };
  const html = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://findandstudy.com", nonce: "catalog-nonce" });
  assert.match(html, /data-catalog-source="destinations"/);
  assert.match(html, /aria-labelledby="catalog-grid-title-0"/);
  assert.match(html, /id="catalog-grid-title-0"/);
  assert.match(html, /focus-visible:ring-2 focus-visible:ring-primary/);
  assert.match(html, /sm:grid-cols-2 lg:grid-cols-3/);
  assert.match(html, /Türkiye &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /href="\/en\/countries\/turkey"/);
  assert.match(html, /"@type":"ItemList"/);
  assert.match(html, /"numberOfItems":1/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("SSR renders all allowlisted CMS presentation blocks with bounded safe media", () => {
  const model: PublicCatalogRenderModel = {
    kind: "page_detail",
    locale: "en",
    canonicalPath: "/en/about",
    title: "About",
    description: "About Find and Study.",
    indexable: true,
    alternatePaths: { en: "/en/about" },
    page: {
      id: 10,
      title: "About",
      slug: "about-content",
      versionNumber: 2,
      publishedAt: "2026-09-09T12:00:00.000Z",
      blocks: [
        { blockType: "team_grid", content: { title: "Team", members: [{ name: "A <script>", role: "Counselor", bio: "Bio", photo: "https://cdn.example/team.jpg" }] }, settings: {}, sortOrder: 0 },
        { blockType: "office_list", content: { title: "Offices", offices: [{ name: "Istanbul", city: "Istanbul", address: "Address", phone: "+90", email: "info@example.com" }] }, settings: {}, sortOrder: 1 },
        { blockType: "logo_grid", content: { title: "Partners", logos: [{ name: "Partner", imageUrl: "https://cdn.example/logo.svg", linkUrl: "https://partner.example" }] }, settings: {}, sortOrder: 2 },
        { blockType: "testimonials", content: { title: "Stories", items: [{ name: "Student", role: "Alumni", content: "Great support <script>alert(1)</script>" }] }, settings: {}, sortOrder: 3 },
        { blockType: "spacer_divider", content: { height: 999, showDivider: true }, settings: {}, sortOrder: 4 },
      ],
    },
  };
  const html = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://findandstudy.com", nonce: "blocks-nonce" });
  for (const marker of ["Team", "Offices", "Partners", "Stories", "team.jpg", "logo.svg", "<hr />"]) {
    assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /A &lt;script&gt;/);
  assert.match(html, /Great support &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /h-\[160px\]/);
  assert.doesNotMatch(html, /\sstyle=/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("SSR spacers use stylesheet-backed bounded heights under the strict CSP", () => {
  const spa = readFileSync(new URL("../../edcons/src/pages/public/PublicPage.tsx", import.meta.url), "utf8");
  const heights: Array<[unknown, number]> = [
    [-10, 8], [0, 8], [8, 8], [17, 16], [47, 48], [160, 160],
    [999, 160], ["not-a-height", 48], [undefined, 48],
  ];
  for (let height = 8; height <= 160; height += 8) heights.push([height, height]);
  for (const [requested, expected] of heights) {
    const model: PublicCatalogRenderModel = {
      kind: "page_detail", locale: "en", canonicalPath: "/en/spacer-test",
      title: "Spacer", description: "Spacer layout", indexable: false, alternatePaths: {},
      page: {
        id: 11, title: "Spacer", slug: "spacer-test", versionNumber: 1,
        publishedAt: "2026-09-09T12:00:00.000Z",
        blocks: [{ blockType: "spacer_divider", content: { height: requested }, settings: {}, sortOrder: 0 }],
      },
    };
    const html = renderPublicCatalogHtml({ indexHtml, model, siteUrl: "https://findandstudy.com", nonce: "spacer-nonce" });
    assert.ok(html.includes(`h-[${expected}px]`), `height ${String(requested)} must resolve to ${expected}px`);
    assert.doesNotMatch(html, /\sstyle=/);
    assert.ok(spa.includes(`"h-[${expected}px]"`), "SSR class must exist in the frontend CSS scan source");
  }
  assert.match(publicCatalogCsp("spacer-nonce"), /(?:^|; )style-src 'self'(?:;|$)/);
});

test("read model is on-demand, bounded, stale-while-revalidate, and detail indexing is fail-closed", () => {
  const readModel = readFileSync(
    new URL("../src/lib/publicCatalogRenderReadModel.ts", import.meta.url),
    "utf8",
  );
  assert.match(readModel, /const PILOT_LIST_LIMIT = 12/);
  assert.match(readModel, /const CACHE_MAX_ENTRIES = 500/);
  assert.match(readModel, /async function readUniversityDetail/);
  assert.match(readModel, /async function readDestinationDetail/);
  assert.match(readModel, /async function readCityDetail/);
  assert.match(readModel, /indexable: Boolean\(localizedDelivery\.snapshot\) && seoState.indexable/);
  assert.match(readModel, /alternatePaths: localizedDelivery\.snapshot \? seoState.alternates : \{\}/);
  assert.match(readModel, /localizedDelivery\.snapshot\?\.canonicalPath/);
  assert.match(readModel, /const candidateLimit = internalLinkMode === "published"/);
  assert.match(readModel, /async function readArticleDetail/);
  assert.match(readModel, /readIndexableArticleIds/);
  assert.match(readModel, /async function readPageDetail/);
  assert.match(readModel, /websitePageVersionsTable/);
  assert.match(readModel, /PUBLIC_PAGE_BLOCK_TYPES/);
  assert.match(readModel, /hydratePublicCatalogBlocks/);
  assert.match(readModel, /PUBLIC_CATALOG_BLOCK_LIMIT = 12/);
  assert.match(readModel, /parsePublicCatalogPageBlockSource/);
  assert.match(readModel, /\.limit\(PILOT_LIST_LIMIT\)/);
  assert.match(readModel, /cacheStatus: "STALE"/);
  assert.match(readModel, /void refresh\(key, route\)/);
  assert.match(readModel, /indexable: false/);
  assert.doesNotMatch(readModel, /serviceFeeAmount|commissionRate|contactPerson/);
});

test("catalogue block filters resolve Unicode aliases to stable catalogue IDs", () => {
  const readModel = readFileSync(
    new URL("../src/lib/publicCatalogRenderReadModel.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(readModel, /toLocaleLowerCase\("en-US"\)/);
  assert.match(readModel, /countryMatches\(config.country, c\)/);
  assert.match(readModel, /catalogName\(c.name\) === catalogName\(config.city\)/);
  assert.match(readModel, /eq\(countriesTable.id, country.id\)/);
  assert.match(readModel, /eq\(citiesTable.id, city.id\)/);
  assert.match(readModel, /city.countryId/);
});
