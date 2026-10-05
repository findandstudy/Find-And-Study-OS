import { test, expect, type Page } from "@playwright/test";
import { defaultDetailLayout } from "../../src/lib/website/detailLayoutContract";
import type { DetailContentKind } from "../../src/lib/website/detailContentContract";

// Synthetic public facts and editorial content. No authentication, real writes or database.
const collections = { destination: "countries", city: "cities", university: "universities", program: "programs" };
const sourcePaths = { destination: "/api/public/destinations/fixture-42", city: "/api/public/web/cities/fixture-42", university: "/api/public/catalog/universities/fixture-42", program: "/api/public/catalog/programs/fixture-42" };
function publicFacts(kind: DetailContentKind, locale: string) {
  const canonicalPath = `/${locale}/${collections[kind]}/fixture-42`;
  const data = { id: 42, name: "Synthetic canonical name", canonicalPath, country: "Synthetic country", countryCode: "GB", city: "Synthetic city", description: "Catalogue description", isActive: true, universityIsActive: true,
    universityId: 9, universityName: "Synthetic university", universityCountry: "Synthetic country", universityPath: `/${locale}/universities/university-9`, tuition: null,
    currency: "GBP", tuitionFee: null, discountedFee: null, degree: "Bachelor", field: "Science", language: "English", duration: "3 years", programs: [], universities: [], universityCount: 0, programCount: 0,
  };
  const meta = { locale, indexable: false, canonicalPath, requestedPathIsCanonical: true, alternatePaths: {}, programCount: 0, title: data.name, description: data.description };
  return kind === "destination" ? { destination: { ...data, catalogCountryId: 42, slug: "fixture-42" }, universities: [], programs: [], cities: [], stats: { universityCount: 0, programCount: 0 }, meta }
    : { data, meta, programs: [], intakes: [], prices: [], related: [] };
}
async function setup(page: Page, kind: DetailContentKind, mismatch = false) {
  const writes: string[] = [];
  const reads: string[] = [];
  await page.addInitScript(() => localStorage.setItem("edcons_lang", "en"));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") writes.push(url.pathname);
    else reads.push(url.pathname);
    const locale = url.searchParams.get("locale") || "en";
    let body: unknown = {};
    if (url.pathname === "/api/website/detail-content") body = { pageId: null, updatedAt: null, digest: null, published: null, content: { version: 1, kind, entityId: 42, locale, sections: [{ key: "faq", title: "Unpublished editorial heading", body: "Private synthetic draft text", reviewedOn: "2026-01-01", sources: [{ label: "Synthetic reference", url: "https://example.org/source" }] }] } };
    else if (url.pathname === sourcePaths[kind]) {
      const facts = publicFacts(kind, locale);
      if (mismatch) facts.meta.canonicalPath = `/tr/${collections[kind]}/wrong-43`;
      body = facts;
    } else if (url.pathname.includes("/detail-layouts/")) body = defaultDetailLayout(kind);
    else if (url.pathname === "/api/course-finder") body = { data: [], meta: { total: 0, totalPages: 0 } };
    else if (url.pathname === "/api/course-finder/filters") body = { countries: [], cities: [], universities: [], universityTypes: [], degrees: [], languages: [], fields: [], feeRange: null };
    await route.fulfill({ json: body });
  });
  await page.goto(`/tests/fixtures/page-authoring.html?detail=${kind}`);
  await expect(page.getByRole("dialog").first()).toBeVisible();
  await expect(page.getByText("Unpublished editorial heading", { exact: false }).first()).toBeVisible();
  return { writes, reads };
}

for (const kind of ["destination", "city", "university", "program"] as const) {
  test(`${kind} full draft preview reuses canonical facts without writes or navigation`, async ({ page }) => {
    const traffic = await setup(page, kind);
    const before = await page.evaluate(() => ({ title: document.title, lang: document.documentElement.lang, canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") }));
    await page.getByRole("button", { name: /Local draft preview/i }).click();
    const iframe = page.locator("iframe");
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute("sandbox", "");
    const frame = page.frameLocator("iframe");
    await expect(frame.getByRole("heading", { name: "Synthetic canonical name", exact: false, level: 1 })).toBeVisible();
    await expect(frame.getByRole("heading", { name: "Unpublished editorial heading" })).toBeVisible();
    await expect(frame.locator("script, form, iframe, object, embed")).toHaveCount(0);
    await expect(frame.locator('a[href]:not([href^="about:srcdoc#"])')).toHaveCount(0);
    await expect(frame.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    if (kind === "program") {
      for (const [label, width] of [["Desktop", 1280], ["Tablet", 768], ["Mobile", 375]] as const) {
        await page.getByRole("button", { name: new RegExp(`${label}.*${width}px`) }).click();
        expect(await frame.locator("html").evaluate(() => window.innerWidth)).toBe(width);
        const bounds = await iframe.boundingBox(), container = await page.locator("[data-preview-viewport]").boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(container!.x - 1);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(container!.x + container!.width + 1);
      }
    }
    expect(traffic.writes).toEqual([]);
    expect(traffic.reads).toContain(sourcePaths[kind]);
    expect(await page.evaluate(() => ({ title: document.title, lang: document.documentElement.lang, canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") }))).toEqual(before);
  });
}

test("locale mismatch fails closed and never renders the draft with other facts", async ({ page }) => {
  const traffic = await setup(page, "program", true);
  await page.getByRole("button", { name: /Local draft preview/i }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(traffic.writes).toEqual([]);
});

test("Arabic mobile draft uses its own locale without changing the admin language", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const traffic = await setup(page, "city");
  await page.getByLabel("Content language", { exact: true }).selectOption("ar");
  await page.getByRole("button", { name: /Local draft preview/i }).click();
  await expect(page.getByRole("button", { name: /Mobile.*375px/i })).toHaveAttribute("aria-pressed", "true");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(frame.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(frame.getByRole("heading", { name: "Unpublished editorial heading" })).toBeVisible();
  expect(await frame.locator("html").evaluate(() => window.innerWidth)).toBe(375);
  const bounds = await page.locator("iframe").boundingBox(), container = await page.locator("[data-preview-viewport]").boundingBox();
  expect(bounds!.width).toBeLessThan(375);
  expect(bounds!.x).toBeGreaterThanOrEqual(container!.x - 1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(container!.x + container!.width + 1);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(traffic.writes).toEqual([]);
  await frame.locator("html").evaluate(() => window.scrollTo(0, 0));
  await page.locator("iframe").evaluate(element => element.scrollIntoView({ block: "center" }));
  await expect(frame.locator("h1")).toBeInViewport();
  // Give the scaled, sandboxed frame a paint after scrolling the modal into view.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: testInfo.outputPath("arabic-mobile-draft.png"), fullPage: true });
  const visibleFrame = (await page.locator("iframe").boundingBox())!;
  const screenshot = await page.screenshot({ path: testInfo.outputPath("arabic-mobile-preview-body.png"), clip: visibleFrame });
  expect(screenshot.byteLength).toBeGreaterThan(5000); // Reject an unpainted, blank frame capture.
});

test("chapter anchors scroll inside the static preview without loading an admin or public route", async ({ page }) => {
  await setup(page, "program");
  await page.getByRole("button", { name: /Local draft preview/i }).click();
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("h1")).toBeVisible();
  const traffic: string[] = [];
  page.on("request", request => { traffic.push(request.url()); });
  const chapter = frame.locator(".detail-nav a").filter({ hasText: "Unpublished editorial heading" });
  await chapter.scrollIntoViewIfNeeded();
  const linkPosition = await chapter.evaluate(element => { const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, viewport: window.innerWidth }; });
  const iframePosition = (await page.locator("iframe").boundingBox())!;
  // Explicitly map the simulated viewport into its fitted display coordinates.
  const displayScale = iframePosition.width / linkPosition.viewport;
  await page.mouse.click(iframePosition.x + linkPosition.x * displayScale, iframePosition.y + linkPosition.y * displayScale);
  await expect(frame.getByRole("heading", { name: "Unpublished editorial heading" })).toBeVisible();
  await expect.poll(() => frame.locator("html").evaluate(() => location.href)).toBe("about:srcdoc#editorial-faq");
  expect(traffic).toEqual([]);
});

test("static document sanitizer removes execution, exfiltration and authenticated media paths", async ({ page }) => {
  await setup(page, "program");
  const inspected = await page.evaluate(async () => {
    const modulePath = "/src/pages/admin/website/detailFullPreviewRender.tsx";
    const { createDetailPreviewDocument } = await import(modulePath);
    const markup = `<script>parent.evil=1</script><form action="/api/write"><button formaction="https://evil.example/write">Send</button></form><iframe src="https://evil.example"></iframe><object data="https://evil.example"></object><embed src="https://evil.example"><link rel="preload" href="https://evil.example/payload"><a href="https://evil.example/draft" ping="https://evil.example/ping" target="_top">External</a><a href="/admin/settings">Admin</a><a href="#overview">Chapter</a><section id="overview">Text</section><img src="https://evil.example/draft.png" srcset="https://evil.example/other.png 2x" onerror="parent.evil=1"><img src="/api/storage/objects/public/secret.png"><img src="/api/storage/objects/private/secret.png"><img src="/images/approved.png"><img src="/assets/approved.webp"><div style="background:url(https://evil.example/css)">Styled</div><button>Apply</button><input value="Private draft"><select><option>A</option></select><textarea>Draft</textarea>`;
    const html = createDetailPreviewDocument(markup, "ar");
    const template = document.createElement("template");
    template.innerHTML = html;
    return {
      executable: template.content.querySelectorAll("script,form,iframe,object,embed,link").length,
      attributes: Array.from(template.content.querySelectorAll("*")).flatMap(element => Array.from(element.attributes).filter(attr => /^(on|srcset|ping|formaction|action|target)/i.test(attr.name)).map(attr => attr.name)),
      sources: Array.from(template.content.querySelectorAll("img[src]")).map(element => element.getAttribute("src")),
      links: Array.from(template.content.querySelectorAll("a[href]")).map(element => element.getAttribute("href")),
      controls: Array.from(template.content.querySelectorAll("button,input,select,textarea")).every(element => element.hasAttribute("disabled")),
      inlineStyles: Array.from(template.content.querySelectorAll("[style]")).map(element => element.getAttribute("style")),
      csp: template.content.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
    };
  });
  expect(inspected.executable).toBe(0);
  expect(inspected.attributes).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(inspected.sources).toEqual([`${origin}/images/approved.png`, `${origin}/assets/approved.webp`]);
  expect(inspected.controls).toBe(true);
  expect(inspected.inlineStyles).toEqual([]);
  expect(inspected.csp).not.toContain("/api/storage/");
  expect(inspected.csp).toContain("connect-src 'none'");
  expect(inspected.links).toHaveLength(1);
  expect(inspected.links[0]).toBe("about:srcdoc#overview");
});
