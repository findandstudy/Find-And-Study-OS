import { test, expect, type Page } from "@playwright/test";
import { defaultDetailLayout, type DetailLayoutKind } from "../../src/lib/website/detailLayoutContract";

function entry(kind: DetailLayoutKind, pageId = 21) {
  return { pageId, digest: "a".repeat(64), updatedAt: "2026-09-17T00:00:00.000Z", status: "draft", layout: defaultDetailLayout(kind) };
}
async function mock(page: Page, lang = "en") {
  await page.addInitScript(locale => localStorage.setItem("edcons_lang", locale), lang);
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") writes.push({ path, body: route.request().postDataJSON() });
    const body = path === "/api/website/detail-layouts" ? [entry("city")]
      : path === "/api/website/pages" ? [{ id: 1, title: "Synthetic page", slug: "synthetic-page", status: "draft", template: "default", publishedAt: null }]
        : path === "/api/website/catalog-pages" ? { items: [], pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 }, publicationEvaluated: false }
          : path === "/api/website/pages/1" ? { id: 1, title: "Synthetic page", slug: "synthetic-page", status: "draft", locale: "en", template: "default" }
            : path.endsWith("/blocks") || path.endsWith("/versions") ? [] : {};
    await route.fulfill({ json: body });
  });
  return writes;
}

test("unsupported history protection is disclosed for unsaved layouts", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true }));
  await mock(page);
  await page.goto("/tests/fixtures/page-authoring.html");
  await page.getByLabel("Programs", { exact: true }).uncheck();
  await expect(page.getByRole("alert")).toContainText("Save your changes before using browser history");
});

test("Pages and shared templates use Turkish copy and remain readable on mobile", async ({ page }) => {
  const writes = await mock(page, "tr");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/fixtures/page-authoring.html");
  await expect(page.getByRole("heading", { name: "Sayfalar", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ortak detay şablonları" })).toBeVisible();
  await expect(page.getByLabel("Üst bölüm", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Görsel galerisi", { exact: true })).toBeVisible();
  await expect(page.getByText("editorial-gallery", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Şablon taslağını kaydet" })).toBeVisible();
  await expect(page.getByLabel("Sayfa ara", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Yeni sayfa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sayfa taslağı oluştur" })).toBeVisible();
  await expect(page.getByLabel("Başlık", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Kaynak dil", { exact: true })).toContainText("Türkçe");
  expect(writes).toEqual([]);
});

test("cancelled and failed reloads preserve edits; confirmed successful reload clears them", async ({ page }) => {
  const writes = await mock(page);
  await page.goto("/tests/fixtures/page-authoring.html");
  const programs = page.getByLabel("Programs", { exact: true });
  await programs.uncheck();
  await page.getByRole("button", { name: "Reload drafts", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(programs).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Reload drafts", exact: true })).toBeFocused();
  await page.route("**/api/website/detail-layouts", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.getByRole("button", { name: "Reload drafts", exact: true }).click();
  await page.getByRole("button", { name: "Discard and continue" }).click();
  await expect(page.getByRole("alert")).toContainText("Your local edits are preserved");
  await expect(programs).not.toBeChecked();
  await page.unroute("**/api/website/detail-layouts");
  await page.getByRole("button", { name: "Reload drafts", exact: true }).click();
  await page.getByRole("button", { name: "Discard and continue" }).click();
  await expect(programs).toBeChecked();
  await expect(page.getByText("You have unsaved layout changes.", { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("dirty layout guards local navigation, history and browser unload, then removes its guard", async ({ page }) => {
  const writes = await mock(page);
  await page.goto("/tests/fixtures/page-authoring.html");
  await page.getByLabel("Programs", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByLabel("Programs", { exact: true })).not.toBeChecked();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  page.once("dialog", dialog => dialog.dismiss());
  await page.evaluate(() => history.pushState({}, "", "/admin/website/other"));
  await expect(page).toHaveURL(/page-authoring\.html$/);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Discard and continue" }).click();
  await expect(page).toHaveURL(/\/pages\/1\/edit$/);
  await expect(page.getByRole("heading", { name: "Shared detail templates" })).toHaveCount(0);
  expect(await page.evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  expect(writes).toEqual([]);
});

test("a pending save blocks reload, editing and Pages navigation, and leaves edits after failure", async ({ page }) => {
  await mock(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/website/detail-layouts/draft", async route => {
    await pending;
    await route.fulfill({ status: 409, json: { error: "Draft changed" } });
  });
  await page.goto("/tests/fixtures/page-authoring.html");
  await page.getByLabel("Programs", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save layout draft", exact: true }).click();
  try {
    await expect(page.getByText("Saving layout draft…", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload drafts", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Programs", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByText("Wait until the current operation finishes before leaving or reloading.")).toBeVisible();
    await expect(page).toHaveURL(/page-authoring\.html$/);
    await page.evaluate(() => history.pushState({}, "", "/admin/website/other"));
    await expect(page).toHaveURL(/page-authoring\.html$/);
    expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  } finally { release(); }
  await expect(page.getByRole("alert")).toContainText("Your local edits are preserved");
  await expect(page.getByLabel("Programs", { exact: true })).not.toBeChecked();
});

test("saving one template keeps another edit bound to its original revision", async ({ page }) => {
  await mock(page);
  const first = entry("city");
  const second = entry("university", 22);
  let readCount = 0;
  const saves: { expectedUpdatedAt: string; layout: { kind: string } }[] = [];
  await page.route("**/api/website/detail-layouts", route => route.fulfill({ json: [first, { ...second, updatedAt: readCount++ ? "2026-09-18T00:00:00.000Z" : second.updatedAt }] }));
  await page.route("**/api/website/detail-layouts/draft", async route => {
    saves.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  await page.goto("/tests/fixtures/page-authoring.html");
  const city = page.getByRole("group", { name: "City · Draft", exact: true });
  const university = page.getByRole("group", { name: "University · Draft", exact: true });
  await city.getByLabel("Programs", { exact: true }).uncheck();
  await university.getByLabel("Programs", { exact: true }).uncheck();
  await city.getByRole("button", { name: "Save layout draft" }).click();
  await expect(university.getByRole("button", { name: "Save layout draft" })).toBeEnabled();
  await expect(university.getByLabel("Programs", { exact: true })).not.toBeChecked();
  await university.getByRole("button", { name: "Save layout draft" }).click();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1].expectedUpdatedAt).toBe(second.updatedAt);
  expect(saves[1].layout.kind).toBe("university");
});
