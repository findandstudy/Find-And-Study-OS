import { test, expect, type Page } from "@playwright/test";

const fixture = process.env.PAGE_EDITOR_APP_ROUTER === "1" ? "/tests/fixtures/page-editor-app-router-safety.html" : "/tests/fixtures/page-editor-safety.html";
const draft = { id: 1, title: "Safety fixture", slug: "safety-fixture", locale: "en", status: "draft", translationsJson: {} };
const hero = { id: 1, blockType: "hero", content: { title: "Original title" }, settings: {}, isVisible: true, sortOrder: 0 };

async function prepare(page: Page, language = "en") {
  if (process.env.PAGE_EDITOR_DISABLE_NAVIGATION === "1") {
    await page.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true }));
  }
  await page.addInitScript(lang => localStorage.setItem("edcons_lang", lang), language);
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/blocks") ? [hero] : path.endsWith("/versions") || path.endsWith("/detail-layouts") || path.endsWith("/pages") ? [] : path === "/api/website/pages/1" ? draft : {};
    await route.fulfill({ json: data });
  });
  await page.goto(`${fixture}?editor`);
  await expect(page.getByRole("heading", { name: "Safety fixture" })).toBeVisible();
}

async function editTitle(page: Page, title = "Keep this title") {
  await page.getByRole("button", { name: "Hero", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
}

test("back cancellation keeps edits, successful save allows clean navigation", async ({ page }) => {
  await prepare(page);
  await editTitle(page);
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Back to pages", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Keep this title");
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toHaveCount(0);
  let dialogs = 0;
  page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
  await page.getByRole("button", { name: "Back to pages", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/website\/pages$/);
  expect(dialogs).toBe(0);
});

test("SEO-only edits survive draft save and Turkish labels follow admin locale", async ({ page }) => {
  await prepare(page, "tr");
  await expect(page.getByRole("button", { name: "Taslağı kaydet", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "SEO", exact: true }).click();
  await page.getByLabel("SEO başlığı", { exact: true }).fill("SEO değişikliği");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Taslağı kaydet", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Kaydedilmedi (SEO)" })).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Sayfalara dön", exact: true }).click();
  await page.getByRole("button", { name: "SEO", exact: true }).click();
  await expect(page.getByLabel("SEO başlığı", { exact: true })).toHaveValue("SEO değişikliği");
  await page.getByRole("button", { name: "SEO ayarlarını kaydet", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Kaydedilmedi" })).toHaveCount(0);
});

test("save in flight blocks leaving and an older save cannot clear newer edits", async ({ page }) => {
  await prepare(page);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/website/pages/1/save-draft", async route => { await barrier; await route.fulfill({ json: {} }); });
  await editTitle(page, "First change");
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to pages", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Newer change");
  release();
  await expect(page.getByRole("button", { name: "Save Draft", exact: true })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Back to pages", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Newer change");
});

test("failed background block refresh keeps initialized edits usable and retry preserves them", async ({ page }) => {
  await prepare(page);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/website/pages/1/save-draft", async route => { await barrier; await route.fulfill({ json: {} }); });
  await page.route("**/api/website/pages/1/blocks", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await editTitle(page, "First change");
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Keep newer edits through refresh");
  release();
  await expect(page.getByRole("alert").filter({ hasText: "could not be refreshed" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Keep newer edits through refresh");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Draft", exact: true })).toBeEnabled();
  await page.route("**/api/website/pages/1/blocks", route => route.fulfill({ json: [hero] }));
  await page.getByRole("button", { name: "Retry content loading", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "could not be refreshed" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Keep newer edits through refresh");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toBeVisible();
});

test("unsupported history API shows an explicit warning only while edits are unsaved", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "navigation", { value: undefined, configurable: true }));
  await prepare(page);
  const warning = page.getByRole("alert").filter({ hasText: "This browser cannot reliably protect" });
  await expect(warning).toHaveCount(0);
  await editTitle(page);
  await expect(warning).toBeVisible();
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(warning).toHaveCount(0);
});

test("failed save retains edits and native unload warning", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/website/pages/1/save-draft", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await editTitle(page);
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toBeVisible();
  const prevented = await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  expect(prevented).toBe(true);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Keep this title");
});

test("browser back cancellation retains mounted editor and acceptance leaves", async ({ page }) => {
  await prepare(page);
  await page.getByRole("button", { name: "Back to pages", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pages list fixture" })).toBeVisible();
  await page.evaluate(() => history.pushState({}, "", "/admin/website/pages/1/edit"));
  await editTitle(page);
  await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toBeVisible();
  const dialog = page.waitForEvent("dialog", { timeout: 5000 });
  await page.evaluate(() => history.back());
  await (await dialog).dismiss();
  await expect(page).toHaveURL(/\/pages\/1\/edit$/);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Keep this title");
  page.once("dialog", dialog => dialog.accept());
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/admin\/website\/pages$/);
  await expect(page.getByRole("heading", { name: "Safety fixture" })).toHaveCount(0);
});

test("same-window link prompts once without a duplicate unload prompt", async ({ page }) => {
  await prepare(page);
  await editTitle(page);
  await page.evaluate(path => {
    const anchor = document.createElement("a");
    anchor.href = path;
    anchor.textContent = "Fixture navigation";
    document.body.append(anchor);
  }, fixture);
  let dialogs = 0;
  page.on("dialog", async dialog => { dialogs++; await dialog.accept(); });
  await page.getByRole("link", { name: "Fixture navigation" }).click();
  await expect(page).toHaveURL(new RegExp(`${fixture}$`));
  expect(dialogs).toBe(1);
});

test("a different page ID starts an isolated editor session and saves only its own blocks", async ({ page }) => {
  await prepare(page);
  const second = { ...draft, id: 2, title: "Second page", slug: "second-page" };
  await page.route("**/api/website/pages/2", route => route.fulfill({ json: second }));
  await page.route("**/api/website/pages/2/blocks", route => route.fulfill({ json: [{ ...hero, id: 2, content: { title: "Second original" } }] }));
  await editTitle(page, "First page unsaved");
  page.once("dialog", dialog => dialog.accept());
  await page.evaluate(() => history.pushState({}, "", "/admin/website/pages/2/edit"));
  await expect(page.getByRole("heading", { name: "Second page" })).toBeVisible();
  await page.getByRole("button", { name: "Hero", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Second original");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Second edited");
  const request = page.waitForRequest(req => req.url().endsWith("/pages/2/save-draft"));
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  expect((await request).postDataJSON().blocks).toEqual([{ ...hero, id: 2, content: { title: "Second edited" } }]);
});

test("switching to an absent translation preserves source edits without a runtime error", async ({ page }) => {
  await prepare(page);
  await editTitle(page);
  await page.getByLabel("Editing language", { exact: true }).click();
  await page.getByRole("option", { name: /Türkçe/ }).click();
  await page.getByRole("button", { name: "Hero", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Keep this title");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toBeVisible();
});

test("browser forward cancellation preserves edits; clean history traversal never prompts", async ({ page }) => {
  await prepare(page);
  await page.getByRole("button", { name: "Back to pages", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pages list fixture" })).toBeVisible();
  let dialogs = 0;
  page.on("dialog", async dialog => { dialogs++; await dialog.dismiss(); });
  await page.evaluate(() => history.back());
  await expect(page.getByRole("heading", { name: "Safety fixture" })).toBeVisible();
  expect(dialogs).toBe(0);
  await editTitle(page, "Keep forward edits");
  await page.evaluate(() => history.forward());
  await expect.poll(() => dialogs).toBe(1);
  await expect(page).toHaveURL(new RegExp(`${fixture}\\?editor$`));
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Keep forward edits");
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Unsaved" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to pages", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pages list fixture" })).toBeVisible();
  await page.evaluate(() => history.back());
  await expect(page.getByRole("heading", { name: "Safety fixture" })).toBeVisible();
  await page.evaluate(() => history.forward());
  await expect(page.getByRole("heading", { name: "Pages list fixture" })).toBeVisible();
  expect(dialogs).toBe(1);
});
