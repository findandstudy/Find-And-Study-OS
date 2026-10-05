// Built-app smoke. Every API request is synthetic and every external URL blocked.
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
    const errors = [], writes = [], lists = [];
    const accounts = [
      { id: 1, channel: "telegram", provider: "direct", displayName: "Synthetic Telegram A", config: { botToken: "••••••••" }, isActive: false, isDefault: false, capabilities: { configurationOnly: true, verificationSupported: false } },
      { id: 2, channel: "sms", provider: "direct", displayName: "Synthetic SMS A", config: { accountSid: `AC${"a".repeat(32)}`, authToken: "••••••••", fromNumber: "+12025550100" }, isActive: false, isDefault: false, capabilities: { configurationOnly: true, verificationSupported: false } },
      { id: 3, channel: "whatsapp", provider: "zernio", externalAccountId: "synthetic-zernio", displayName: "Synthetic Zernio A", config: {}, isActive: false, isDefault: false, capabilities: { configurationOnly: false, verificationSupported: true } },
    ];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(locale => localStorage.setItem("edcons_lang", locale), lang);
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { await route.abort(); return; }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
      const method = route.request().method();
      let body = {};
      if (url.pathname === "/api/auth/me") body = { id: 987654, firstName: "Synthetic", lastName: "Admin", role: "super_admin", language: lang, isActive: true, emailVerified: true, email: "synthetic@example.test", permissions: [], createdAt: "2026-01-01T00:00:00Z" };
      else if (url.pathname === "/api/integrations") body = { data: [] };
      else if (url.pathname === "/api/integrations/live-mode") body = { live: false, reason: "synthetic" };
      else if (url.pathname === "/api/notification-email/capabilities") body = { enabled: false, verificationAllowed: false, canManage: true, variables: [], languages: ["en"], categories: ["applications"] };
      else if (url.pathname === "/api/notification-email/senders") body = { senders: [{ id: 10, displayName: "Synthetic SMTP A", fromEmail: "admissions@example.test", fromName: "Admissions", isActive: false, verified: false, revision: 1, config: { host: "smtp.example.test", port: 587, username: "synthetic", passwordConfigured: true } }] };
      else if (url.pathname === "/api/notification-email/templates") body = { templates: [] };
      else if (url.pathname === "/api/channel-accounts" && method === "GET") {
        lists.push(url.search);
        body = { accounts: accounts.filter(a => a.provider === url.searchParams.get("provider") && (!url.searchParams.has("channel") || a.channel === url.searchParams.get("channel"))) };
      } else if (url.pathname === "/api/channel-accounts" && method === "POST") {
        const data = route.request().postDataJSON(); writes.push(data);
        const account = { ...data, id: 50, isActive: false, isDefault: false, config: { botToken: "••••••••" }, capabilities: { configurationOnly: true, verificationSupported: false } };
        accounts.push(account); body = { account };
      } else if (url.pathname.startsWith("/api/channel-accounts") && method !== "GET") throw new Error(`Unexpected account mutation ${method} ${url.pathname}`);
      else if (url.pathname === "/api/settings/available-years") body = { years: [2026] };
      else if (url.pathname === "/api/conversations") body = { data: [] };
      else if (url.pathname.includes("popup") || url.pathname.includes("notifications")) body = [];
      if (url.pathname.endsWith("/events")) { await route.fulfill({ status: 200, contentType: "text/event-stream", body: ": synthetic\n\n" }); return; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/admin/settings?tab=integrations`);
    await page.getByRole("button", { name: lang === "tr" ? "Entegrasyonlar" : lang === "ar" ? "التكاملات" : "Integrations", exact: true }).click();
    const panel = page.getByTestId("integrations-manager");
    try { await panel.waitFor(); } catch (error) {
      console.error({ url: page.url(), errors, text: (await page.locator("body").innerText()).slice(0, 1800) }); throw error;
    }
    for (const key of ["smtp", "telegram", "sms_twilio", "zernio", "whatsapp", "instagram", "facebook_messenger"]) {
      await panel.getByTestId(`integration-accounts-${key}`).waitFor();
    }
    assert.equal(await panel.getByTestId("add-anthropic-connection").count(), 1);
    assert.equal(await panel.getByTestId("integration-card-claude").getByTestId("add-anthropic-connection").count(), 1);
    await panel.getByTestId("integration-accounts-smtp").click();
    const smtp = page.getByTestId("smtp-accounts-dialog");
    await smtp.getByText("Synthetic SMTP A", { exact: true }).waitFor();
    assert.ok(await smtp.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${lang} SMTP layout`);
    await page.keyboard.press("Escape");
    for (const [key, name] of [["telegram", "Synthetic Telegram A"], ["sms_twilio", "Synthetic SMS A"], ["zernio", "Synthetic Zernio A"]]) {
      await panel.getByTestId(`integration-accounts-${key}`).click();
      const dialog = page.getByTestId("channel-accounts-dialog");
      await dialog.getByText(name, { exact: true }).waitFor();
      if (key !== "zernio") {
        await dialog.getByTestId("account-configuration-only").waitFor();
        const id = key === "telegram" ? 1 : 2;
        for (const action of ["toggle", "default", "test"]) assert.equal(await dialog.getByTestId(`account-${action}-${id}`).isDisabled(), true);
      }
      assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${lang}/${key} layout`);
      if (lang === "ar") assert.equal(await dialog.getAttribute("dir"), "rtl");
      await page.keyboard.press("Escape");
    }
    await panel.getByTestId("integration-accounts-telegram").click();
    const dialog = page.getByTestId("channel-accounts-dialog");
    await dialog.getByTestId("account-add").click();
    await dialog.locator("#channel-account-name").fill("Synthetic Telegram B");
    await dialog.locator("#channel-account-botToken").fill("123456789:abcdefghijklmnopqrstuvwxyz123456");
    await dialog.getByTestId("account-save").click();
    await dialog.getByText("Synthetic Telegram B", { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].provider, "direct"); assert.equal(writes[0].channel, "telegram"); assert.equal(writes[0].isActive, false);
    assert.ok(lists.some(query => query.includes("provider=zernio")));
    assert.ok(lists.some(query => query.includes("channel=telegram") && query.includes("provider=direct")));
    assert.deepEqual(errors, [], `${lang} browser errors`);
    console.log(`PASS ${lang}/${width}: Accounts links, scoped Anthropic, SMTP reuse, provider filters, configuration-only guard, add, RTL/layout`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
