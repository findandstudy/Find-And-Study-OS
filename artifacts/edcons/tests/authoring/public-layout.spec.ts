import { test, expect } from "@playwright/test";
import { defaultDetailLayout } from "../../src/lib/website/detailLayoutContract";
// Opt-in real public staging data replayed through local components; no remote writes.
test.skip(process.env.PUBLIC_LAYOUT_REAL_DATA !== "true", "Set PUBLIC_LAYOUT_REAL_DATA=true for read-only staging data replay");
for (const locale of ["en", "ar"]) for (const width of [390, 768, 1440]) for (const kind of ["program", "university"] as const) {
  test(`${kind} real data through local code ${locale}/${width}`, async ({ page, request }) => {
    const source = kind === "program" ? "programs/a-level-145793" : "universities/abbey-dld-colleges-1563";
    const response = await request.get(`https://staging.findandstudy.com/api/public/catalog/${source}?locale=${locale}`);
    expect(response.status()).toBe(200);
    const payload = await response.json();
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(lang => localStorage.setItem("edcons_lang", lang), locale);
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      const body = path.includes("/public/catalog/") ? payload : path.includes("/detail-layouts/") ? defaultDetailLayout(kind) : {};
      return route.fulfill({ json: body });
    });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/tests/fixtures/page-authoring.html?public=${kind}`);
    await expect(page.locator("h1")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    for (const href of await page.locator('a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute("href")))) {
      if (href && href !== "#") expect(await page.locator(`[id="${href.slice(1)}"]`).count(), `Missing ${href}`).toBeGreaterThan(0);
    }
    if (kind === "program") await expect(page.locator('a[href*="/apply"]').first()).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator('a[href="#main-content"]')).toBeFocused();
    expect(errors).toEqual([]);
  });
}
