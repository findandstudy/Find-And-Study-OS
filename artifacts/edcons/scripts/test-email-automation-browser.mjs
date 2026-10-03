// Local built-app UI smoke with synthetic API fixtures. All external requests
// and every API request are intercepted; never contacts a provider or database.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { chromium } = requireApi("playwright-core");
const root = fileURLToPath(new URL("../dist/public/", import.meta.url));
const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const target = path.resolve(root, path.extname(pathname) ? pathname.slice(1) : "index.html");
    if (!target.startsWith(path.resolve(root) + path.sep)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", mime[path.extname(target)] || "text/html"); res.end(await readFile(target));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chrome" }) });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [lang, width] of [["en", 1440], ["tr", 390], ["ar", 390]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [], writes = [], historySources = [];
    const tr = lang === "tr";
    const templates = [{ id: 1, name: "Synthetic stage email", channel: "email", category: "applications", language: "en", isActive: true, versions: [
      { id: 11, templateId: 1, version: 1, status: "approved", language: "en", subject: "Application update", content: "Hello {{studentName}}", variables: ["studentName"], createdById: 5 },
      { id: 12, templateId: 1, version: 2, status: "review", language: "tr", subject: "Own version", content: "Hello", variables: [], createdById: 987654 },
    ] }];
    const senders = [{ id: 1, displayName: "Synthetic admissions", fromEmail: "admissions@example.test", fromName: "Admissions", replyTo: null, revision: 1, verified: true, isActive: true, createdById: 5, lastChangedById: 5, config: { host: "smtp.example.test", port: 587, username: "synthetic", passwordConfigured: true } }];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(locale => { if (window === window.top) localStorage.setItem("edcons_lang", locale); }, lang);
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { await route.abort(); return; }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
      const method = route.request().method();
      let body = {};
      if (url.pathname === "/api/auth/me") body = { id: 987654, firstName: "Synthetic", lastName: "Admin", role: "super_admin", language: lang, isActive: true, emailVerified: true, email: "synthetic@example.test", permissions: [], createdAt: "2026-01-01T00:00:00Z" };
      else if (url.pathname === "/api/notification-email/capabilities") body = { enabled: false, verificationAllowed: false, canManage: true, variables: ["studentName"], stageVariables: ["studentName"], languages: ["en", "tr", "ar"], categories: ["applications", "general"] };
      else if (url.pathname === "/api/notification-email/templates" && method === "GET") body = { templates };
      else if (url.pathname === "/api/notification-email/senders" && method === "GET") body = { senders };
      else if (url.pathname === "/api/notification-email/history") {
        historySources.push(url.searchParams.get("source"));
        body = { items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, templateVersionId: 11, senderAccountId: 1, applicationId: 1, stageKey: "offer", status: ["unknown", "processing", "enqueued"][index % 3], createdAt: "2026-09-21T10:00:00Z" })), nextCursor: 100 };
      }
      else if (url.pathname === "/api/notification-email/templates" && method === "POST") {
        const draft = route.request().postDataJSON(); writes.push({ path: url.pathname, body: draft });
        const version = { ...draft, id: 21, templateId: 2, version: 1, status: "draft", variables: ["studentName"], createdById: 987654 };
        const template = { ...draft, id: 2, isActive: true, channel: "email", versions: [version] }; templates.push(template); body = { template, version };
      } else if (url.pathname.endsWith("/preview")) {
        assert.equal(method, "POST"); body = { subject: "Synthetic preview", html: "<p>Safe preview</p><script>parent.__unsafePreview = true</script>", text: "Safe preview" };
      } else if (url.pathname.startsWith("/api/notification-email/")) { throw new Error(`Unexpected automation action ${method} ${url.pathname}`); }
      else if (url.pathname === "/api/notification-rules") body = { data: [] };
      else if (url.pathname === "/api/conversations") body = { data: [] };
      else if (url.pathname === "/api/settings/available-years") body = { years: [2026] };
      else if (url.pathname.includes("popup") || url.pathname.includes("notifications")) body = [];
      if (url.pathname.endsWith("/events")) { await route.fulfill({ status: 200, contentType: "text/event-stream", body: ": synthetic\n\n" }); return; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/admin/settings?tab=notifications#notification-email`);
    const panel = page.getByTestId("email-automation-manager"); await panel.waitFor();
    await panel.getByText("Synthetic stage email", { exact: true }).waitFor();
    assert.match(await page.getByTestId("email-runtime-status").innerText(), tr ? /kapalı/ : /disabled/);
    assert.equal(await panel.getByRole("button", { name: tr ? "Sürümü onayla" : "Approve version", exact: true }).isDisabled(), true);
    await panel.getByRole("button", { name: tr ? "Önizleme" : "Preview", exact: true }).first().click();
    await page.getByRole("dialog").locator("iframe").waitFor();
    assert.equal(await page.getByRole("dialog").locator("iframe").getAttribute("sandbox"), "");
    assert.equal(await page.evaluate(() => window.__unsafePreview), undefined);
    await page.keyboard.press("Escape");
    await panel.getByRole("button", { name: tr ? "Yeni e-posta şablonu" : "New email template", exact: true }).click();
    const form = page.getByTestId("email-template-form");
    await form.getByLabel(tr ? "Ad" : "Name", { exact: true }).fill("Synthetic new template");
    await form.getByLabel(tr ? "Konu" : "Subject", { exact: true }).fill("Hello {{studentName}}");
    await form.getByLabel(tr ? "E-posta gövdesi (metin veya HTML)" : "Email body (text or HTML)", { exact: true }).fill("<p>Update</p>");
    assert.ok(await page.getByRole("dialog").evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${lang} dialog overflow`);
    await form.getByRole("button", { name: tr ? "Taslağı kaydet" : "Save draft", exact: true }).click();
    await panel.getByText("Synthetic new template", { exact: true }).waitFor();
    assert.equal(writes.length, 1); assert.equal(writes[0].body.subject, "Hello {{studentName}}");
    await panel.getByRole("button", { name: tr ? "Gönderici e-posta adresleri" : "Sender email addresses", exact: true }).click();
    await panel.getByText("Synthetic admissions", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("button", { name: tr ? "SMTP bağlantısını doğrula" : "Verify SMTP connection", exact: true }).isDisabled(), true);
    await panel.getByRole("button", { name: tr ? "Gönderim geçmişi" : "Delivery history", exact: true }).click();
    await Promise.all([page.waitForResponse(response => response.url().includes("/notification-email/history?source=system")), page.getByTestId("email-delivery-history").getByLabel(tr ? "Kaynak" : "Source", { exact: true }).selectOption("system")]);
    assert.ok(historySources.includes("system"));
    for (const label of tr ? ["Gönderim sonucu bilinmiyor", "İşleniyor", "Gönderim kuyruğuna alındı"] : ["Delivery outcome unknown", "Processing", "Queued for sending"]) await page.getByTestId("email-delivery-history").getByText(new RegExp(label)).first().waitFor();
    assert.equal(await page.getByTestId("email-history-limit").innerText(), tr ? "Son 100 kayıt gösteriliyor." : "Only the latest 100 records are shown.");
    if (lang === "ar") assert.equal(await panel.getAttribute("dir"), "rtl");
    assert.ok(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${lang} panel overflow`);
    assert.deepEqual(errors, [], `${lang} client errors`);
    console.log(`PASS ${lang}/${width}: library, draft, maker-checker, preview isolation, SMTP disabled, history, layout`);
    await page.close();
  }
  // The legacy rules list remains readable, but its write controls must follow
  // the same session-only admin capability as the new email library.
  for (const scenario of ["manager", "impersonated-admin", "denied-session"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    let writes = 0, authorityChecks = 0;
    await page.addInitScript(() => { if (window === window.top) localStorage.setItem("edcons_lang", "en"); });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { await route.abort(); return; }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
      if (!["GET", "HEAD"].includes(route.request().method()) && (url.pathname.startsWith("/api/notification-rules") || url.pathname.startsWith("/api/notification-email"))) writes++;
      let body = {}, status = 200;
      if (url.pathname === "/api/auth/me") body = { id: 987650, firstName: "Synthetic", lastName: "Read-only", role: scenario === "manager" ? "manager" : "admin", isImpersonating: scenario === "impersonated-admin", isActive: true, emailVerified: true, language: "en", email: "synthetic@example.test", permissions: [], createdAt: "2026-01-01T00:00:00Z" };
      else if (url.pathname === "/api/notification-rules") body = { data: [{ id: 1, event: "application.stage_changed", name: "Synthetic rule", category: "applications", channels: ["email"], recipientType: "owner", recipientRoles: [], isActive: true }] };
      else if (url.pathname === "/api/notification-email/capabilities") { authorityChecks++; status = 403; body = { error: "EMAIL_HUMAN_ADMIN_REQUIRED" }; }
      else if (url.pathname === "/api/conversations") body = { data: [] };
      else if (url.pathname === "/api/settings/available-years") body = { years: [2026] };
      else if (url.pathname.includes("popup") || url.pathname.includes("notifications")) body = [];
      if (url.pathname.endsWith("/events")) { await route.fulfill({ status: 200, contentType: "text/event-stream", body: ": synthetic\n\n" }); return; }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/staff/settings?tab=notifications`);
    await page.getByTestId("notification-rules-readonly").getByText(/Read-only/).waitFor();
    await page.getByText("Synthetic rule", { exact: true }).waitFor();
    for (const id of ["notification-rule-channel", "notification-rule-template", "notification-rule-active"]) {
      const controls = page.getByTestId(id); assert.ok(await controls.count() > 0);
      for (const control of await controls.all()) assert.equal(await control.isDisabled(), true, `${scenario}: ${id}`);
    }
    assert.equal(await page.getByTestId("email-automation-manager").count(), 0);
    assert.equal(writes, 0);
    assert.equal(authorityChecks, scenario === "denied-session" ? 1 : 0);
    console.log(`PASS ${scenario}: readable rules, editing/toggles disabled, no writes`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
