import { test, expect, type Page } from "@playwright/test";
import { defaultDetailLayout } from "../../src/lib/website/detailLayoutContract";

const draft = { id: 1, title: "Catalogue preview", slug: "catalogue-preview", status: "draft", template: "default", locale: "ar", translationsJson: {}, publishedAt: null };
const block = { id: 1, blockType: "catalog_grid", content: { source: "programs", title: "Current programmes", limit: 6, items: [{ title: "STALE CMS FACT" }] }, settings: {}, sortOrder: 0, isVisible: true };

test("shared template review is explicit, bounded and mobile usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await mock(page);
  const entry = { pageId: 21, digest: "a".repeat(64), updatedAt: "2026-09-17T00:00:00.000Z", status: "draft", layout: defaultDetailLayout("city") };
  await page.route("**/api/website/detail-layouts", route => route.fulfill({ json: [entry] }));
  await page.route("**/api/website/detail-layouts/publish", async route => {
    writes.push({ path: "/api/website/detail-layouts/publish", body: route.request().postDataJSON() });
    await route.fulfill({ status: 403, json: { error: "Different reviewer required" } });
  });
  await page.goto("/tests/fixtures/page-authoring.html");
  await expect(page.getByRole("heading", { name: "Shared detail templates" })).toBeVisible();
  await expect(page.getByLabel("hero", { exact: true })).toBeDisabled();
  await page.getByLabel("Include saved draft in review").check();
  const publish = page.getByRole("button", { name: "Publish approved layouts" });
  await expect(publish).toBeDisabled();
  await page.getByLabel("I reviewed these exact saved layouts and approve publication.").check();
  await publish.click();
  await expect(page.getByRole("alert")).toContainText("different administrator");
  expect(writes).toEqual([{ path: "/api/website/detail-layouts/publish", body: { approved: true, selections: [{ pageId: 21, digest: entry.digest }] } }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("programs", { exact: true }).uncheck();
  await expect(publish).toHaveCount(0);
});

async function mock(page: Page) {
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method !== "GET") writes.push({ path, body: route.request().postDataJSON() });
    let body: unknown = {};
    if (path === "/api/website/pages/drafts") body = draft;
    else if (path === "/api/website/detail-layouts") body = [];
    else if (path === "/api/website/pages") body = [];
    else if (path.endsWith("/blocks")) body = [block];
    else if (path.endsWith("/versions")) body = [];
    else if (path === "/api/website/pages/1") body = draft;
    else if (path === "/api/website/catalog-preview") body = { items: [{ id: 77, title: "Live nursing programme", description: "Current public source", canonicalPath: "/ar/programs/nursing-77" }] };
    await route.fulfill({ json: body });
  });
  return writes;
}

test("empty Pages stays read-only until explicit draft creation", async ({ page }) => {
  const writes = await mock(page);
  await page.goto("/tests/fixtures/page-authoring.html");
  await expect(page.getByText("No pages found.")).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Study options");
  await page.getByLabel("Page address").fill("study-options");
  await page.getByLabel("Starting layout").click();
  await page.getByRole("option", { name: "Live programs", exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ path: "/api/website/pages/drafts", body: { title: "Study options", slug: "study-options", locale: "en", starter: "programs", country: "", city: "" } });
  await expect(page.getByRole("heading", { name: "Live nursing programme" })).toBeVisible();
});

test("preview uses live records and source locale, supports refresh, RTL and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await mock(page);
  await page.goto("/tests/fixtures/page-authoring.html?editor");
  await expect(page.getByRole("heading", { name: "Live nursing programme" })).toBeVisible();
  await expect(page.getByText("STALE CMS FACT")).toHaveCount(0);
  await expect(page.locator('[lang="ar"][dir="rtl"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Open detail" })).toHaveAttribute("href", "/ar/programs/nursing-77");
  const response = page.waitForRequest(request => request.url().includes("catalog-preview") && request.url().includes("locale=ar"));
  await page.getByRole("button", { name: "Refresh data" }).click();
  await response;
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  await page.getByRole("button", { name: "Live Catalog Grid", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit: Live Catalog Grid" })).toBeVisible();
  expect(writes).toHaveLength(0);
});

test("preview errors are visible and recoverable, never a fake successful empty result", async ({ page }) => {
  await mock(page);
  await page.route("**/api/website/catalog-preview?**", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto("/tests/fixtures/page-authoring.html?editor");
  await expect(page.getByRole("alert")).toContainText("Preview unavailable");
  await page.unroute("**/api/website/catalog-preview?**");
  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(page.getByRole("heading", { name: "Live nursing programme" })).toBeVisible();
});

test("a conflicting address preserves form input for correction", async ({ page }) => {
  await mock(page);
  await page.route("**/api/website/pages/drafts", route => route.fulfill({ status: 409, json: { error: "Address already in use" } }));
  await page.goto("/tests/fixtures/page-authoring.html");
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Keep my title");
  await page.getByLabel("Page address").fill("existing-address");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not create");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Keep my title");
  await expect(page.getByLabel("Page address")).toHaveValue("existing-address");
});
