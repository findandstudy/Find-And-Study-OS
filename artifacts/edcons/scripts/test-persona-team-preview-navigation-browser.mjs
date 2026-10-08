// Built-frontend navigation regression. Every request is fulfilled or aborted
// locally, including requests for the synthetic staging/production origins.
// No actual server, account, credential, provider, or database is accessed.
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { chromium } = requireApi("playwright-core");
const publicRoot = fileURLToPath(new URL("../dist/public/", import.meta.url));
const previewPath = "/admin/agent-team-preview/";
const stagingOrigin = "https://staging.findandstudy.com";
const productionOrigin = "https://apply.findandstudy.com";
const syntheticUserId = 987654;
const mime = {
  ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".html": "text/html",
};
await access(path.join(publicRoot, "index.html"));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : { channel: process.platform === "win32" ? "msedge" : "chrome" }),
  args: ["--disable-background-networking"],
});

async function fixture({ origin = stagingOrigin, role = "admin", locale = "en", authenticated = true, staleFavorite = false, staleAuthCache = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: "block" });
  const errors = [];
  const unexpectedRequests = [];
  const documentRequests = [];
  let signedIn = authenticated;
  let loginPosts = 0;
  let authMeRequests = 0;
  const user = {
    id: syntheticUserId, firstName: "Synthetic", lastName: "Preview",
    email: "preview-navigation@example.invalid", role, language: locale,
    isActive: true, emailVerified: true, permissions: [], createdAt: "2026-01-01T00:00:00Z",
  };
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  await context.addInitScript(({ origin, locale, staleFavorite, staleAuthCache, user, syntheticUserId, previewPath }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("edcons_lang", locale);
    if (staleFavorite) {
      // Favorites must not resurrect a link excluded by the role/origin gate.
      localStorage.setItem(`edcons:sidebarPinned:${syntheticUserId}`, JSON.stringify([previewPath]));
      localStorage.setItem("edcons:sidebarPinned:anon", JSON.stringify([previewPath]));
    }
    if (staleAuthCache) localStorage.setItem("edcons_auth_v2", JSON.stringify({ data: user, ts: Date.now() }));
  }, { origin, locale, staleFavorite, staleAuthCache, user, syntheticUserId, previewPath });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.resourceType() === "document") documentRequests.push({ url: url.href, method: request.method() });
    if (url.origin !== origin) {
      // Existing font and language-flag requests are blocked, never fetched.
      // They cannot whitelist external document navigation or script execution.
      const knownPassiveAsset = request.method() === "GET" && (
        (url.origin === "https://fonts.googleapis.com" && request.resourceType() === "stylesheet") ||
        (url.origin === "https://flagcdn.com" && request.resourceType() === "image" && /^\/16x12\/[a-z]{2}\.png$/.test(url.pathname))
      );
      if (!knownPassiveAsset) unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (url.pathname === previewPath || url.pathname === previewPath.slice(0, -1)) {
      assert.equal(request.method(), "GET");
      assert.equal(request.resourceType(), "document", "preview must be a document navigation, not a fetch or SPA route");
      await route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><html><body><h1 data-testid="preview-document">Synthetic preview document</h1></body></html>' });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      let body = {};
      let status = 200;
      if (url.pathname === "/api/auth/login" && request.method() === "POST") {
        assert.deepEqual(request.postDataJSON(), { email: user.email, password: "Synthetic!ForTestOnly99" });
        loginPosts++;
        signedIn = true;
        body = { user };
      } else if (request.method() === "POST" && [
        "/api/activity/session/start", "/api/activity/session/end", "/api/activity/page-visit",
        "/api/activity/page-leave", "/api/activity/event", "/api/activity/heartbeat",
      ].includes(url.pathname)) {
        // The existing shell's telemetry is a local no-op fixture too.
        body = { sessionId: 987654, visitId: 987654 };
      } else if (request.method() !== "GET") {
        unexpectedRequests.push(`${request.method()} ${url.pathname}`);
        status = 405;
      } else if (url.pathname === "/api/auth/me") {
        authMeRequests++;
        body = signedIn ? user : { error: "Authentication required" };
        status = signedIn ? 200 : 401;
      } else if (url.pathname === "/api/conversations" || url.pathname === "/api/student/conversations" || url.pathname === "/api/popups/active") {
        body = { data: [] };
      } else if (url.pathname === "/api/settings/available-years") {
        body = { years: [2026] };
      } else if (url.pathname === "/api/notifications") {
        body = [];
      }
      if (url.pathname.endsWith("/events")) {
        await route.fulfill({ status: 200, contentType: "text/event-stream", body: ": synthetic\n\n" });
        return;
      }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      return;
    }
    if (request.method() !== "GET") {
      unexpectedRequests.push(`${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }
    // Serve the actual compiled application through interception only. Never
    // route.continue(), fetch(), or fall through to the real origin.
    const pathname = decodeURIComponent(url.pathname);
    const target = path.resolve(publicRoot, request.resourceType() === "document" ? "index.html" : pathname.slice(1));
    if (!target.startsWith(path.resolve(publicRoot) + path.sep)) {
      unexpectedRequests.push(`static path outside build: ${url.pathname}`);
      await route.abort();
      return;
    }
    try {
      await route.fulfill({ status: 200, contentType: mime[path.extname(target)] || "application/octet-stream", body: await readFile(target) });
    } catch {
      unexpectedRequests.push(`missing built asset: ${url.pathname}`);
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  return {
    context, page, user, documentRequests,
    loginPosts: () => loginPosts,
    authMeRequests: () => authMeRequests,
    async finish() {
      assert.deepEqual(errors, [], "no application runtime exceptions");
      assert.deepEqual(unexpectedRequests, [], "only bounded synthetic traffic and blocked passive font/flag requests");
      await context.close();
    },
  };
}

async function login(f, returnTo, origin = stagingOrigin) {
  await f.page.goto(`${origin}/en/login?returnTo=${encodeURIComponent(returnTo)}`);
  await f.page.locator("#login-email").fill(f.user.email);
  await f.page.locator("#login-password").fill("Synthetic!ForTestOnly99");
  await f.page.locator('form:has(#login-email) button[type="submit"]').click();
}

try {
  for (const [role, locale] of [["admin", "en"], ["super_admin", "tr"]]) {
    const f = await fixture({ role, locale });
    await f.page.goto(`${stagingOrigin}/staff/preview-navigation-test`);
    const links = f.page.locator(`a[href="${previewPath}"]`);
    await links.first().waitFor({ state: "attached" });
    assert.equal(await links.count(), 1, "one normal menu entry before pinning");
    const title = locale === "tr" ? "Takım Tasarımcısı — Önizleme" : "Team Designer — Preview";
    assert.equal((await links.first().innerText()).trim(), title);
    const group = links.first().locator('xpath=ancestor::*[@data-sidebar="group"][1]');
    await group.locator(":scope > button").click();
    await links.first().waitFor({ state: "visible" });
    assert.equal(await links.first().getAttribute("target"), "_blank");
    assert.equal(await links.first().getAttribute("rel"), "noopener noreferrer");

    const menuRow = links.first().locator('xpath=ancestor::li[1]');
    await menuRow.locator('[data-sidebar="menu-action"]').click();
    await f.page.waitForFunction(path => document.querySelectorAll(`a[href="${path}"]`).length === 2, previewPath);
    assert.equal(await links.count(), 2, "normal and favorite entries use the same native document link");
    for (const index of [0, 1]) {
      const popupPromise = f.context.waitForEvent("page");
      await links.nth(index).click();
      const popup = await popupPromise;
      await popup.getByTestId("preview-document").waitFor();
      assert.equal(popup.url(), stagingOrigin + previewPath);
      await popup.close();
    }
    assert.equal(f.documentRequests.filter(request => request.url === stagingOrigin + previewPath).length, 2);
    assert.equal(f.page.url(), `${stagingOrigin}/staff/preview-navigation-test`, "menu keeps the existing workspace open");
    await f.finish();
    console.log(`PASS ${role}/${locale}: visible menu, pinning/favorite, two native preview document navigations`);
  }

  for (const [origin, role] of [[stagingOrigin, "manager"], [stagingOrigin, "staff"], [stagingOrigin, "student"], [productionOrigin, "admin"], [productionOrigin, "super_admin"]]) {
    const f = await fixture({ origin, role, staleFavorite: true });
    const route = role === "student" ? "/student/preview-navigation-test" : "/staff/preview-navigation-test";
    await f.page.goto(origin + route);
    await f.page.locator('[data-sidebar="sidebar"]').waitFor();
    assert.equal(await f.page.locator(`a[href="${previewPath}"]`).count(), 0, "no preview menu or stale favorite outside its gate");
    await f.finish();
    console.log(`PASS ${new URL(origin).hostname}/${role}: preview menu and stale favorite hidden`);
  }

  for (const returnTo of [previewPath, previewPath.slice(0, -1)]) {
    const f = await fixture({ authenticated: false });
    await login(f, returnTo);
    await f.page.getByTestId("preview-document").waitFor();
    assert.equal(f.page.url(), stagingOrigin + previewPath, "login returns to the fixed canonical document path");
    assert.equal(f.loginPosts(), 1);
    assert.equal(f.documentRequests.filter(request => request.url === stagingOrigin + previewPath).length, 1);
    await f.finish();
    console.log(`PASS login ${returnTo}: real synthetic form submission and native canonical preview return`);
  }

  {
    const f = await fixture({ authenticated: false, staleAuthCache: true });
    const response = f.page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/me" && response.status() === 401);
    await f.page.goto(`${stagingOrigin}/en/login?returnTo=${encodeURIComponent(previewPath)}`);
    await response;
    await f.page.locator("#login-email").waitFor({ state: "visible" });
    await f.page.waitForFunction(() => localStorage.getItem("edcons_auth_v2") === null);
    assert.ok(f.authMeRequests() >= 1, "server checks must invalidate the expired cached user");
    assert.equal(f.documentRequests.length, 1, "expired cache must not bounce login back to the preview");
    await f.page.locator("#login-email").fill(f.user.email);
    await f.page.locator("#login-password").fill("Synthetic!ForTestOnly99");
    await f.page.locator('form:has(#login-email) button[type="submit"]').click();
    await f.page.getByTestId("preview-document").waitFor();
    assert.equal(f.page.url(), stagingOrigin + previewPath);
    assert.equal(f.loginPosts(), 1);
    assert.equal(f.documentRequests.length, 2, "fresh login performs exactly one native preview navigation");
    await f.finish();
    console.log("PASS expired cached user: server 401 clears stale cache, login stays usable, fresh login opens preview without a loop");
  }

  for (const [origin, returnTo] of [
    [stagingOrigin, "/staff/preview-navigation-test"],
    [stagingOrigin, "https://untrusted.example.invalid/"],
    [stagingOrigin, "//untrusted.example.invalid/"],
    [stagingOrigin, `${previewPath}?next=https://untrusted.example.invalid/`],
    [productionOrigin, previewPath],
  ]) {
    const f = await fixture({ origin, authenticated: false });
    await login(f, returnTo, origin);
    await f.page.locator('[data-sidebar="sidebar"]').waitFor();
    assert.equal(f.loginPosts(), 1);
    assert.equal(f.documentRequests.length, 1, "non-preview and untrusted returns never trigger the special document redirect");
    assert.equal(new URL(f.page.url()).origin, origin);
    await f.finish();
    console.log(`PASS safe return ${new URL(origin).hostname}/${returnTo}: existing SPA behavior, no external document navigation`);
  }
  console.log("PASS 15 built-frontend scenarios; all requests intercepted, no real network, account, database, or provider used");
} finally {
  await browser.close();
}
