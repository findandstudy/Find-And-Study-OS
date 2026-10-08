// Built-frontend navigation regression. Every request is fulfilled or aborted
// locally, including requests for the synthetic staging/production origins.
// No actual server, account, credential, provider, or database is accessed.
import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { chromium } = requireApi("playwright-core");
const publicRoot = fileURLToPath(new URL("../dist/public/", import.meta.url));
const previewPath = "/admin/agent-team-preview/";
const previewTemplatePath = `${previewPath}template.json`;
const stagingOrigin = "https://staging.findandstudy.com";
const productionOrigin = "https://apply.findandstudy.com";
const syntheticUserId = 987654;
const screenshotRoot = process.env.PERSONA_TEAM_PREVIEW_SCREENSHOT_DIR;
if (screenshotRoot) {
  assert.ok(path.isAbsolute(screenshotRoot), "screenshot output must be an explicit absolute directory");
  await mkdir(screenshotRoot, { recursive: true });
}
const syntheticTemplate = {
  schemaVersion: 1,
  name: "Synthetic design team",
  members: [
    ["manager", "Genel müdür", "manager", null],
    ["social", "Sosyal medya birimi", "department", "manager"],
    ["research", "Araştırma uzmanı", "specialist", "social"],
    ["copy", "Metin uzmanı", "specialist", "social"],
    ["creative", "Görsel/video taslak uzmanı", "specialist", "social"],
  ].map(([key, name, kind, parent]) => ({
    key, name, kind, parent,
    purpose: "Synthetic instructions — never executed",
    output: "Synthetic output description — no content generation",
    provider: "mock", model: "mock-fixture", tools: ["mock_draft"],
    dataScopes: ["persona_mock_context"], capMicros: 100000,
    timeoutSeconds: 30, concurrency: 1, humanApproval: true,
  })),
};
const mime = {
  ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff", ".html": "text/html",
};
await access(path.join(publicRoot, "index.html"));
// Browser routing can omit an HTTP redirect's follow-up request. A local proxy
// that never forwards anything makes that gap fail closed instead of touching
// a real staging or production host. No DNS/network fallback is possible here.
const blockedNetworkAttempts = [];
const denyProxy = createServer((req, res) => {
  blockedNetworkAttempts.push(req.url);
  res.writeHead(502, { "Content-Type": "text/plain" }).end("Synthetic browser test: network disabled");
});
denyProxy.on("connect", (req, socket) => {
  blockedNetworkAttempts.push(req.url);
  socket.end("HTTP/1.1 502 Network Disabled\r\nConnection: close\r\n\r\n");
});
await new Promise(resolve => denyProxy.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : { channel: process.platform === "win32" ? "msedge" : "chrome" }),
  args: ["--disable-background-networking"],
  proxy: { server: `http://127.0.0.1:${denyProxy.address().port}` },
});

async function fixture({ origin = stagingOrigin, role = "admin", locale = "en", authenticated = true, staleFavorite = false, staleAuthCache = false, width = 1440, templateStatus = 200 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: "block" });
  const errors = [];
  const unexpectedRequests = [];
  const documentRequests = [];
  let signedIn = authenticated;
  let loginPosts = 0;
  let authMeRequests = 0;
  let templateRequests = 0;
  let currentTemplateStatus = templateStatus;
  const user = {
    id: syntheticUserId, firstName: "Synthetic", lastName: "Preview",
    email: "preview-navigation@example.invalid", role, language: locale,
    isActive: true, emailVerified: true, permissions: [], createdAt: "2026-01-01T00:00:00Z",
  };
  context.on("page", page => {
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => {
      if (dialog.type() === "beforeunload") void dialog.accept();
      else { unexpectedRequests.push(`unexpected dialog: ${dialog.type()}`); void dialog.dismiss(); }
    });
  });
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
      assert.equal(request.resourceType(), "document", "only direct entry/login return reaches the server document guard");
      if (origin !== stagingOrigin || !signedIn || !["admin", "super_admin"].includes(role)) {
        await route.fulfill({ status: signedIn ? 403 : 401, contentType: "application/json", body: '{"error":"Denied"}' });
      } else {
        // Browser test simulates the fixed handoff destination with a fresh
        // document navigation. The actual HTTP 302 contract is covered by the
        // backend tests; fulfill(302) can skip interception for its next hop.
        await route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><html><body><script>window.location.replace("/?workspace=team-preview")</script></body></html>' });
      }
      return;
    }
    if (url.pathname === previewTemplatePath) {
      assert.equal(request.method(), "GET", "memory-only editor must only read its guarded template");
      templateRequests++;
      const status = origin !== stagingOrigin ? 404 : !signedIn ? 401 : !["admin", "super_admin"].includes(role) ? 403 : currentTemplateStatus;
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(status === 200 ? syntheticTemplate : { error: "PREVIEW_UNAVAILABLE" }) });
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
    templateRequests: () => templateRequests,
    setTemplateStatus: (status) => { currentTemplateStatus = status; },
    async ready() {
      try { await page.getByTestId("team-node-manager").waitFor(); }
      catch (error) {
        console.error(JSON.stringify({ url: page.url(), documentRequests, authMeRequests, templateRequests, errors, unexpectedRequests, syntheticBody: (await page.locator("body").innerText()).slice(0, 1200) }));
        throw error;
      }
    },
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

async function screenshot(page, name) {
  if (screenshotRoot) await page.screenshot({ path: path.join(screenshotRoot, name), fullPage: true, animations: "disabled" });
}

async function cardPosition(page, key) {
  return page.getByTestId(`team-node-${key}`).evaluate(button => ({
    x: parseFloat(button.parentElement.style.left),
    y: parseFloat(button.parentElement.style.top),
  }));
}

async function expectEditorValue(page, id, expected, message) {
  // Selection/undo update controlled fields through MemberEditor's effect;
  // pointer-up completion alone does not mean that effect has painted yet.
  await page.waitForFunction(({ id, expected }) => document.getElementById(id)?.value === expected, { id, expected });
  assert.equal(await page.locator(`#${id}`).inputValue(), expected, message);
}

async function dragCard(page, key, destination, expectedTarget = null) {
  const card = page.getByTestId(`team-node-${key}`);
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  assert.ok(box, "draggable card has geometry");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 12 });
  if (expectedTarget) {
    await page.waitForFunction(key => document.querySelector(`[data-testid="team-node-${key}"]`)?.classList.contains("is-drop-target"), expectedTarget);
  }
  await page.mouse.up();
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
    assert.equal(await links.first().getAttribute("target"), null);

    const menuRow = links.first().locator('xpath=ancestor::li[1]');
    await menuRow.locator('[data-sidebar="menu-action"]').click();
    await f.page.waitForFunction(path => document.querySelectorAll(`a[href="${path}"]`).length === 2, previewPath);
    assert.equal(await links.count(), 2, "normal and favorite entries use the same SPA route");
    await links.nth(1).click();
    await f.page.getByTestId("persona-team-preview").waitFor();
    await f.page.getByTestId("team-node-manager").waitFor();
    assert.equal(await f.page.locator('[data-sidebar="sidebar"]').count(), 1, "designer stays inside the existing dashboard shell");
    assert.equal(f.templateRequests(), 1);
    assert.equal(f.documentRequests.length, 1, "normal menu uses SPA navigation without reloading");
    assert.equal(f.context.pages().length, 1, "no detached preview tab");
    await f.page.goBack();
    await f.page.getByTestId("persona-team-preview").waitFor({ state: "hidden" });
    await links.nth(0).click();
    await f.page.getByTestId("team-node-manager").waitFor();
    assert.equal(f.documentRequests.length, 1, "favorite also uses SPA navigation");
    await f.finish();
    console.log(`PASS ${role}/${locale}: visible menu, favorite, existing dashboard shell, no reload or new tab`);
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
    await f.ready();
    assert.equal(await f.page.locator('[data-sidebar="sidebar"]').count(), 1);
    assert.equal(f.page.url(), stagingOrigin + previewPath, "the one-shot workspace hint is replaced by the canonical route");
    assert.equal(f.loginPosts(), 1);
    assert.equal(f.documentRequests.filter(request => request.url === stagingOrigin + previewPath).length, 1);
    assert.equal(f.templateRequests(), 1);
    await f.finish();
    console.log(`PASS login ${returnTo}: guarded canonical document entry returns to the React dashboard`);
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
    await f.page.getByTestId("team-node-manager").waitFor();
    assert.equal(f.page.url(), stagingOrigin + previewPath, "expired-cache recovery consumes the bridge query too");
    assert.equal(f.loginPosts(), 1);
    assert.equal(f.documentRequests.length, 3, "fresh login performs one guarded preview entry and its fixed workspace handoff");
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

  {
    const f = await fixture();
    await f.page.goto(stagingOrigin + previewPath);
    await f.page.getByTestId("team-node-manager").waitFor();
    await screenshot(f.page, "desktop.png");
    await f.page.getByRole("button", { name: /switch to dark/i }).click();
    await f.page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    await screenshot(f.page, "desktop-dark.png");
    await f.page.getByRole("button", { name: /switch to light/i }).click();

    await f.page.getByLabel("Name", { exact: true }).fill("Synthetic edited manager");
    await f.page.getByLabel("Instructions", { exact: true }).fill("Synthetic edited instructions; never run");
    await f.page.getByLabel("Expected output", { exact: true }).fill("Synthetic edited output");
    await f.page.getByRole("button", { name: "Apply changes", exact: true }).click();
    assert.match(await f.page.getByTestId("team-node-manager").innerText(), /Synthetic edited manager/);
    await f.page.getByTestId("team-undo").click();
    assert.match(await f.page.getByTestId("team-node-manager").innerText(), /Genel müdür/);
    await f.page.getByTestId("team-redo").click();
    assert.match(await f.page.getByTestId("team-node-manager").innerText(), /Synthetic edited manager/);

    const research = f.page.getByTestId("team-node-research");
    await research.focus();
    await research.press("Enter");
    await expectEditorValue(f.page, "team-member-name", "Araştırma uzmanı");
    const beforeKey = await cardPosition(f.page, "research");
    await research.press("ArrowRight");
    assert.equal((await cardPosition(f.page, "research")).x, beforeKey.x + 10, "keyboard really moves the focused card");
    await f.page.getByTestId("team-undo").click();
    assert.deepEqual(await cardPosition(f.page, "research"), beforeKey);

    const beforeDrag = await cardPosition(f.page, "copy");
    const copyBox = await f.page.getByTestId("team-node-copy").boundingBox();
    await dragCard(f.page, "copy", { x: copyBox.x + copyBox.width / 2 + 35, y: copyBox.y + copyBox.height / 2 - 35 });
    const afterDrag = await cardPosition(f.page, "copy");
    assert.ok(afterDrag.x > beforeDrag.x && afterDrag.y < beforeDrag.y, "real pointer drag changes the card position");
    await expectEditorValue(f.page, "team-member-parent", "social", "free-position drop preserves the hierarchy");
    await f.page.getByTestId("team-undo").click();
    assert.deepEqual(await cardPosition(f.page, "copy"), beforeDrag);

    const managerBox = await f.page.getByTestId("team-node-manager").boundingBox();
    await dragCard(f.page, "copy", { x: managerBox.x + managerBox.width / 2, y: managerBox.y + managerBox.height / 2 }, "manager");
    await expectEditorValue(f.page, "team-member-parent", "manager", "drop onto a manager updates the relationship");
    await f.page.getByTestId("team-undo").click();
    await expectEditorValue(f.page, "team-member-parent", "social");

    await f.page.getByRole("button", { name: "Change connection: Araştırma uzmanı", exact: true }).click();
    await f.page.getByTestId("team-node-manager").click();
    await research.click();
    await expectEditorValue(f.page, "team-member-parent", "manager", "connection control provides an alternative to dragging");
    await f.page.getByTestId("team-undo").click();
    await expectEditorValue(f.page, "team-member-parent", "social");

    await f.page.getByTestId("team-node-manager").click();
    await f.page.getByRole("button", { name: "Add department", exact: true }).click();
    await f.page.getByTestId("team-node-department_1").waitFor();
    await f.page.getByRole("button", { name: "Add specialist", exact: true }).click();
    await f.page.getByTestId("team-node-specialist_1").waitFor();
    await expectEditorValue(f.page, "team-member-parent", "department_1");
    assert.equal(await f.page.locator('[data-testid^="team-node-"]').count(), 7);
    await f.page.getByRole("button", { name: "Delete member", exact: true }).click();
    await f.page.getByRole("alertdialog").getByRole("button", { name: "Remove from draft", exact: true }).click();
    await f.page.getByTestId("team-node-specialist_1").waitFor({ state: "hidden" });
    await f.page.getByTestId("team-undo").click();
    await f.page.getByTestId("team-node-specialist_1").waitFor();
    await f.page.getByTestId("team-redo").click();
    await f.page.getByTestId("team-node-specialist_1").waitFor({ state: "hidden" });

    await f.page.getByRole("tab", { name: /^Members/ }).click();
    assert.equal(await f.page.getByTestId("team-canvas").count(), 0);
    await f.page.getByRole("button", { name: /New department.*Department/ }).click();
    await expectEditorValue(f.page, "team-member-name", "New department");
    await f.page.getByRole("tab", { name: "Organization", exact: true }).press("Enter");
    await f.page.getByTestId("team-canvas").waitFor();

    const zoom = parseInt(await f.page.getByTestId("team-zoom-level").innerText(), 10);
    await f.page.getByTestId("team-zoom-in").press("Enter");
    assert.ok(parseInt(await f.page.getByTestId("team-zoom-level").innerText(), 10) > zoom);
    await f.page.getByTestId("team-zoom-out").press("Enter");
    assert.ok(Math.abs(parseInt(await f.page.getByTestId("team-zoom-level").innerText(), 10) - zoom) <= 1);
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(f.documentRequests.length, 2, "all editing remains in memory without reload");
    assert.equal(f.templateRequests(), 1, "no save, task or provider request occurs during editing");
    await f.page.reload();
    await f.page.getByTestId("team-node-manager").waitFor();
    assert.match(await f.page.getByTestId("team-node-manager").innerText(), /Genel müdür/);
    assert.equal(await f.page.locator('[data-testid^="team-node-"]').count(), 5, "refresh discards all local design changes");
    await f.finish();
    console.log("PASS desktop editing: form, undo/redo, keyboard movement, actual drag/drop reparenting, connection control, add/delete, zoom, no persistence or task calls");
  }

  for (const [locale, width] of [["tr", 390], ["ar", 390], ["tr", 820]]) {
    const f = await fixture({ locale, width });
    await f.page.goto(stagingOrigin + previewPath);
    await f.page.getByTestId("team-node-manager").waitFor();
    await screenshot(f.page, width === 820 ? "tablet.png" : locale === "tr" ? "mobile.png" : "mobile-rtl.png");
    if (locale === "ar") assert.equal(await f.page.locator("html").getAttribute("dir"), "rtl");
    await f.page.getByTestId("team-node-manager").press("Enter");
    const sheet = f.page.getByRole("dialog");
    await sheet.waitFor();
    const name = locale === "tr" ? "Ad" : "Name";
    await sheet.getByLabel(name, { exact: true }).fill("Synthetic mobile manager");
    await sheet.getByRole("button", { name: locale === "tr" ? "Uygula" : "Apply changes", exact: true }).click();
    await sheet.press("Escape");
    await sheet.waitFor({ state: "hidden" });
    assert.match(await f.page.getByTestId("team-node-manager").innerText(), /Synthetic mobile manager/);
    await f.page.getByTestId("team-undo").press("Enter");
    assert.match(await f.page.getByTestId("team-node-manager").innerText(), /Genel müdür/);
    await f.page.getByTestId("team-redo").press("Enter");
    assert.match(await f.page.getByTestId("team-node-manager").innerText(), /Synthetic mobile manager/);
    await f.page.getByRole("button", { name: locale === "tr" ? "Yeni birim" : "Add department", exact: true }).click();
    await sheet.waitFor();
    assert.equal(await sheet.getByLabel(locale === "tr" ? "Bağlı olduğu birim" : "Reports to").inputValue(), "manager");
    await sheet.press("Escape");
    await sheet.waitFor({ state: "hidden" });
    await f.page.getByTestId("team-node-department_1").waitFor();
    const zoom = parseInt(await f.page.getByTestId("team-zoom-level").innerText(), 10);
    await f.page.getByTestId("team-zoom-in").click();
    assert.ok(parseInt(await f.page.getByTestId("team-zoom-level").innerText(), 10) > zoom);
    await f.page.getByTestId("team-zoom-out").click();
    assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale} mobile has no body overflow`);
    assert.equal(f.templateRequests(), 1);
    await f.finish();
    console.log(`PASS ${locale}/${width}px: keyboard selection, responsive details sheet, editing, add, undo/redo, zoom, bounded layout`);
  }

  for (const templateStatus of [403, 503]) {
    const f = await fixture({ templateStatus });
    await f.page.goto(stagingOrigin + previewPath);
    await f.page.getByTestId("persona-team-preview-error").waitFor();
    assert.equal(await f.page.getByTestId("persona-team-preview").count(), 0, "failed guard/read never falls back to a client-created team");
    assert.equal(await f.page.getByTestId("team-canvas").count(), 0);
    if (templateStatus === 503) {
      f.setTemplateStatus(200);
      await f.page.getByRole("button", { name: "Try again", exact: true }).click();
      await f.page.getByTestId("team-node-manager").waitFor();
      assert.equal(f.templateRequests(), 2);
    } else assert.equal(await f.page.getByRole("button", { name: "Try again", exact: true }).count(), 0);
    await f.finish();
    console.log(`PASS template ${templateStatus}: fail-closed editor${templateStatus === 503 ? ", explicit retry recovers" : ", no permission bypass"}`);
  }
  console.log("PASS 21 built-frontend scenarios; all requests intercepted, no real network, account, database, or provider used");
  console.log(`Fail-closed loopback proxy: ${blockedNetworkAttempts.length} blocked browser/background network attempts, zero forwarded`);
} finally {
  await browser.close();
  await new Promise(resolve => denyProxy.close(resolve));
}
