// Real built admin panel; synthetic API fixtures only, every external URL blocked.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const requireApi = createRequire(new URL("../../api-server/package.json", import.meta.url));
const { chromium } = requireApi("playwright-core");
const { PDFDocument } = requireApi("pdf-lib");
const fixture = await PDFDocument.create(); fixture.addPage().drawText("UNSIGNED TEST PREVIEW");
const pdfBytes = Buffer.from(await fixture.save());
const root = fileURLToPath(new URL("../dist/public/", import.meta.url));
const output = process.env.CONTRACT_UNSIGNED_PREVIEW_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.startsWith("/api/")) throw new Error("API must be intercepted");
    const target = path.resolve(root, path.extname(pathname) ? pathname.slice(1) : "index.html");
    if (!target.startsWith(path.resolve(root) + path.sep)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", mime[path.extname(target)] || "text/html"); res.end(await readFile(target));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chrome" }) });
try {
  for (const [lang, width] of [["en", 1440], ["tr", 390], ["ar", 390]]) {
    const words = lang === "tr" ? { preview: "İmzasız test önizlemesi", retry: "Yeniden dene", download: "İmzasız test PDF’ini indir", close: "Kapat" }
      : lang === "ar" ? { preview: "معاينة تجريبية غير موقعة", retry: "إعادة المحاولة", download: "تنزيل ملف PDF تجريبي غير موقع", close: "إغلاق" }
      : { preview: "Unsigned test preview", retry: "Retry", download: "Download unsigned test PDF", close: "Close" };
    const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
    await page.context().addCookies([{ name: "csrf_token", value: "SYNTHETIC-TEST-CSRF", url: base }]);
    const errors = [], mutations = [];
    let htmlCalls = 0, pdfCalls = 0, downloads = 0;
    page.on("pageerror", error => errors.push(error.message)); page.on("download", () => downloads++);
    await page.addInitScript(locale => { if (window.top === window) localStorage.setItem("edcons_lang", locale); }, lang);
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { await route.abort(); return; }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
      const method = route.request().method();
      if (method !== "GET") mutations.push(`${method} ${url.pathname}`);
      let body = { data: [], total: 0 };
      if (url.pathname === "/api/auth/me") body = { id: 987654, firstName: "TEST", lastName: "Admin", role: "super_admin", language: lang, isActive: true, emailVerified: true, email: "synthetic@example.invalid", permissions: [] };
      else if (url.pathname === "/api/contract-templates") body = { data: [{ id: 18, name: "TEST Draft", title: "TEST Draft", language: lang, version: 1, entityType: "company", publicationStatus: "draft", isActive: false, bodyHtml: "<style>.hero{color:blue}</style><h1>TEST</h1>", intakeSchema: [], signingPageConfig: {}, updatedAt: "2000-01-01" }] };
      else if (url.pathname === "/api/settings/available-years") body = { years: [2026] };
      else if (url.pathname === "/api/contract-templates/18/unsigned-preview") {
        assert.equal(route.request().headers()["x-csrf-token"], "SYNTHETIC-TEST-CSRF", "real cookie-protected POST must use the existing CSRF adapter");
        const payload = route.request().postDataJSON();
        assert.deepEqual(Object.keys(payload), ["format"]);
        if (payload.format === "html") {
          htmlCalls++;
          if (htmlCalls === 1) { await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "TEST busy" }) }); return; }
          body = { data: { unsignedTestPreview: true, html: `<!doctype html><html ${lang === "ar" ? 'dir="rtl"' : ''}><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>.hero{background:#143591;color:white;padding:24px;border-radius:12px}body{margin:20px}</style></head><body><div>UNSIGNED TEST PREVIEW</div><section class="hero"><h1>TEST AGENCY</h1><p>Not a signed contract</p></section></body></html>` } };
        } else {
          assert.equal(payload.format, "pdf"); pdfCalls++;
          if (pdfCalls === 1) { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "TEST unavailable" }) }); return; }
          await route.fulfill({ status: 200, contentType: "application/pdf", body: pdfBytes }); return;
        }
      }
      if (url.pathname.endsWith("/events")) { await route.fulfill({ status: 200, contentType: "text/event-stream", body: ": TEST\n\n" }); return; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/admin/contract-templates`);
    await page.getByRole("button", { name: `${words.preview}: TEST Draft`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("alert").waitFor();
    await dialog.getByRole("button", { name: words.retry, exact: true }).click();
    await dialog.locator("iframe").waitFor();
    assert.equal(await dialog.locator("iframe").getAttribute("sandbox"), "");
    assert.equal(await dialog.locator("iframe").getAttribute("referrerpolicy"), "no-referrer");
    assert.equal(await dialog.frameLocator("iframe").locator(".hero").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(20, 53, 145)");
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${lang} modal fits viewport`);
    if (output) await dialog.screenshot({ path: path.join(output, `admin-unsigned-preview-${lang}.png`) });
    const button = dialog.getByRole("button", { name: words.download, exact: true });
    await button.click(); await dialog.getByRole("alert").waitFor();
    assert.equal(downloads, 0, "failure JSON must not download as PDF");
    const downloaded = page.waitForEvent("download"); await button.click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), "UNSIGNED-TEST-template-18.pdf");
    assert.deepEqual(await readFile(await download.path()), pdfBytes);
    assert.equal(downloads, 1);
    await dialog.getByRole("button", { name: words.close, exact: true }).first().click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    assert.equal(mutations.filter(value => !/^POST \/api\/(?:contract-templates\/18\/unsigned-preview|activity|notifications\/section\/)/.test(value)).length, 0, "no business mutation, signing or email API");
    console.log(`PASS ${lang}/${width}: draft preview, busy retry, CSS iframe sandbox, mobile modal, PDF error/retry/download, no mutation`);
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
