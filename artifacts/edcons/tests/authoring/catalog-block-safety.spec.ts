import { test, expect, type Page } from "@playwright/test";

const fixture = "/tests/fixtures/page-editor-safety.html?editor";
const draft = { id: 1, title: "Catalogue fixture", slug: "catalogue-fixture", locale: "en", status: "draft", translationsJson: {} };
const block = { id: 1, blockType: "catalog_grid", content: { source: "programs", limit: 6 }, settings: {}, isVisible: true, sortOrder: 0 };
const item = { id: 42, title: "Source programme title", description: "Source description", canonicalPath: "/en/programs/source-42" };
const fields = [{ key: "countryId", label: "Country", options: [{ id: "1", label: "United Kingdom", aliases: ["UK"] }] }];

async function prepare(page: Page, language: string, responses: { preview: unknown; filters: unknown; status?: number }) {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(lang => localStorage.setItem("edcons_lang", lang), language);
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes.push(path);
    if (path === "/api/website/catalog-preview") return route.fulfill({ status: responses.status || 200, json: responses.preview });
    if (path === "/api/website/catalog-filters") return route.fulfill({ json: responses.filters });
    const json = path.endsWith("/blocks") ? [block] : path.endsWith("/versions") ? [] : path === "/api/website/pages/1" ? draft : {};
    await route.fulfill({ json });
  });
  await page.goto(fixture);
  await page.getByRole("button", { name: language === "tr" ? "Güncel katalog listesi" : "Live Catalog Grid", exact: true }).click();
  return { errors, writes };
}

test("malformed or oversized catalogue payloads show recoverable errors without crashing", async ({ page }) => {
  const responses: { preview: unknown; filters: unknown } = { preview: { items: {} }, filters: { unexpected: [] } };
  const observed = await prepare(page, "en", responses);
  const previewError = page.getByRole("alert").filter({ hasText: "Preview unavailable" });
  const filterError = page.getByRole("alert").filter({ hasText: "Filter options unavailable" });
  await expect(previewError).toBeVisible();
  await expect(filterError).toBeVisible();
  for (const malformed of [
    { preview: { items: [{ ...item, title: {} }] }, filters: [{ ...fields[0], options: [{ id: "1", label: "UK", aliases: [null] }] }] },
    { preview: { items: Array.from({ length: 13 }, (_, id) => ({ ...item, id: id + 1 })) }, filters: [{ ...fields[0], options: Array.from({ length: 20001 }, (_, id) => ({ id: String(id), label: "Country" })) }] },
  ]) {
    Object.assign(responses, malformed);
    await page.getByRole("button", { name: "Refresh data", exact: true }).click();
    await page.getByRole("button", { name: "Retry filter options", exact: true }).click();
    await expect(previewError).toBeVisible();
    await expect(filterError).toBeVisible();
  }
  responses.preview = { items: [item] };
  responses.filters = fields;
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await page.getByRole("button", { name: "Retry filter options", exact: true }).click();
  await expect(page.getByRole("heading", { name: item.title })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Country", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "United Kingdom", exact: true })).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(observed.errors).toEqual([]);
  expect(observed.writes).toEqual([]);
});

test("Turkish controls follow admin language while source catalogue facts stay unchanged", async ({ page }) => {
  const responses = { preview: { items: [item] } as unknown, filters: fields, status: 200 };
  const observed = await prepare(page, "tr", responses);
  await expect(page.getByRole("heading", { name: "Kataloğumuzu keşfedin" })).toBeVisible();
  await expect(page.getByRole("heading", { name: item.title })).toBeVisible();
  await expect(page.getByRole("link", { name: "Detayı aç" })).toHaveAttribute("href", item.canonicalPath);
  await expect(page.getByLabel("Gösterilecek kayıt sayısı (1–12)")).toHaveValue("6");
  await expect(page.getByRole("combobox", { name: "Görünüm", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Izgara", exact: true })).toHaveCount(1);
  await expect(page.getByRole("combobox", { name: "Ülke", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ülke seçeneklerinde ara", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "United Kingdom", exact: true })).toHaveCount(1);
  responses.status = 503;
  responses.preview = { error: "SECRET_INTERNAL_DIAGNOSTIC" };
  await page.getByRole("button", { name: "Verileri yenile", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Önizleme kullanılamıyor");
  await expect(page.getByText("SECRET_INTERNAL_DIAGNOSTIC")).toHaveCount(0);
  responses.status = 200;
  responses.preview = { items: [] };
  await page.getByRole("button", { name: "Verileri yenile", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bu filtrelerle eşleşen halka açık kayıt yok." })).toBeVisible();
  expect(observed.errors).toEqual([]);
  expect(observed.writes).toEqual([]);
});
