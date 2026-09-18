import { test, expect } from "@playwright/test";
const locales = ["en", "tr", "ar", "fr", "ru", "fa", "zh", "hi", "es", "id", "ur", "tk", "ky", "kk", "uz", "tg", "bn", "pt", "ne", "vi", "ko", "uk", "it"];
// Read-only against real public catalogue records; no login, forms or publication writes.
test("real program projections across all 23 locales", async ({ request }) => {
  for (const locale of locales) {
    const response = await request.get(`/api/public/catalog/programs/a-level-145793?locale=${locale}`);
    expect(response.status(), locale).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe(145793);
    expect(body.meta.canonicalPath).toMatch(new RegExp(`^/${locale}/programs/`));
    expect(Array.isArray(body.intakes)).toBe(true);
    expect(Array.isArray(body.prices)).toBe(true);
    if (body.data.fallbackUsed) { expect(body.meta.indexable).toBe(false); expect(Object.keys(body.meta.alternatePaths)).toHaveLength(0); }
  }
});
for (const locale of ["en", "tr", "ar"]) for (const width of [390, 768, 1440]) {
  test(`real program and university ${locale} at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const result = await request.get(`/api/public/catalog/programs/a-level-145793?locale=${locale}`);
    const data = await result.json();
    for (const path of [data.meta.canonicalPath, data.data.universityPath]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator("h1")).not.toBeEmpty();
      await expect.poll(() => page.locator('link[rel="canonical"]').getAttribute("href")).toContain(path);
      const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll("body *")].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).slice(0, 12).map(el => ({ tag: el.tagName, class: el.className })) }));
      expect.soft(overflow.scroll, `${path}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.width + 1);
      expect(await page.locator("main img").evaluateAll(images => images.filter(image => !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0).length)).toBe(0);
      for (const href of await page.locator('a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute("href")))) {
        if (href && href !== "#") expect.soft(await page.locator(`[id="${href.slice(1)}"]`).count(), `Missing anchor ${href}`).toBeGreaterThan(0);
      }
    }
    expect(errors).toEqual([]);
  });
}
test("missing public detail APIs fail closed", async ({ request }) => {
  for (const path of ["/api/public/catalog/programs/not-present-2147483000", "/api/public/catalog/universities/not-present-2147483000", "/api/public/web/cities/not-present-2147483000"]) {
    expect((await request.get(path)).status()).toBe(404);
  }
});
