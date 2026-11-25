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
const pdfBytes = process.env.CONTRACT_PREVIEW_REAL_PDF_PATH
  ? await readFile(process.env.CONTRACT_PREVIEW_REAL_PDF_PATH) : Buffer.from(await fixture.save());
assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
const realHttpDownload = process.env.CONTRACT_PREVIEW_HTTP_DOWNLOAD === "true";
let actualPdfResponses = 0;
const root = fileURLToPath(new URL("../dist/public/", import.meta.url));
const output = process.env.CONTRACT_UNSIGNED_PREVIEW_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const mime = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const parentCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const previewCsp = "sandbox; default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src data:; font-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (realHttpDownload && pathname === "/api/contract-templates/18/unsigned-preview" && req.method === "POST") {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; assert.ok(bytes < 1024); chunks.push(chunk); }
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { format: "pdf" });
      assert.equal(req.headers["x-csrf-token"], "SYNTHETIC-TEST-CSRF");
      await new Promise(resolve => setTimeout(resolve, 1250));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="UNSIGNED-TEST-template-18.pdf"');
      res.setHeader("Content-Security-Policy", parentCsp); res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Length", pdfBytes.length);
      actualPdfResponses++; res.end(pdfBytes); return;
    }
    if (pathname.startsWith("/api/")) throw new Error("API must be intercepted");
    const target = path.resolve(root, path.extname(pathname) ? pathname.slice(1) : "index.html");
    if (!target.startsWith(path.resolve(root) + path.sep)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Security-Policy", parentCsp);
    res.setHeader("Content-Type", mime[path.extname(target)] || "text/html"); res.end(await readFile(target));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: process.env.CONTRACT_PREVIEW_HEADED !== "true", ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chrome" }) });
try {
  for (const [lang, width] of [["en", 1440], ["tr", 390], ["ar", 390]]) {
    const words = lang === "tr" ? { preview: "İmzasız test önizlemesi", retry: "Yeniden dene", download: "İmzasız test PDF’ini indir", close: "Kapat" }
      : lang === "ar" ? { preview: "معاينة تجريبية غير موقعة", retry: "إعادة المحاولة", download: "تنزيل ملف PDF تجريبي غير موقع", close: "إغلاق" }
      : { preview: "Unsigned test preview", retry: "Retry", download: "Download unsigned test PDF", close: "Close" };
    const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
    await page.context().addCookies([{ name: "csrf_token", value: "SYNTHETIC-TEST-CSRF", url: base }]);
    const errors = [], mutations = [];
    let htmlCalls = 0, documentCalls = 0, pdfCalls = 0, downloads = 0;
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
      else if (url.pathname === "/api/contract-templates/18/unsigned-preview.html") {
        assert.equal(method, "GET"); documentCalls++;
        await route.fulfill({ status: 200, contentType: "text/html", headers: { "Content-Security-Policy": previewCsp, "Cache-Control": "private, no-store" }, body: `<!doctype html><html ${lang === "ar" ? 'dir="rtl"' : ''}><head><style>.hero{background:#143591;color:white;padding:24px;border-radius:12px}body{margin:20px}</style></head><body><div style="background:#fff7ed;font-weight:bold">UNSIGNED TEST PREVIEW</div><section class="hero"><h1>TEST AGENCY</h1><p class="inline" style="color:#112233">Not a signed contract</p></section></body></html>` }); return;
      }
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
          if (realHttpDownload) { await route.continue(); return; }
          await route.fulfill({ status: 200, contentType: "application/pdf", body: pdfBytes }); return;
        }
      }
      if (url.pathname.endsWith("/events")) { await route.fulfill({ status: 200, contentType: "text/event-stream", body: ": TEST\n\n" }); return; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    const parentResponse = await page.goto(`${base}/admin/contract-templates`);
    assert.equal(parentResponse.headers()["content-security-policy"], parentCsp);
    // Negative control reproduces the deployed failure: srcDoc cannot loosen
    // the parent's style-src 'self', even with its own unsafe-inline meta CSP.
    await page.evaluate(() => {
      const frame = document.createElement("iframe"); frame.id = "csp-negative-control"; frame.sandbox = "";
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>.blocked{background:#143591}</style><div class="blocked" style="color:#112233">TEST</div>`;
      document.body.appendChild(frame);
    });
    const blocked = page.frameLocator("#csp-negative-control").locator(".blocked");
    assert.equal(await blocked.evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
    await page.locator("#csp-negative-control").evaluate(el => el.remove());
    await page.getByRole("button", { name: `${words.preview}: TEST Draft`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("alert").waitFor();
    await dialog.getByRole("button", { name: words.retry, exact: true }).click();
    await dialog.locator("iframe").waitFor();
    assert.equal(await dialog.locator("iframe").getAttribute("sandbox"), "");
    assert.equal(await dialog.locator("iframe").getAttribute("referrerpolicy"), "no-referrer");
    assert.equal(await dialog.locator("iframe").getAttribute("srcdoc"), null);
    assert.match(await dialog.locator("iframe").getAttribute("src"), /\/unsigned-preview\.html$/);
    assert.equal(await dialog.frameLocator("iframe").locator(".hero").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(20, 53, 145)");
    assert.equal(await dialog.frameLocator("iframe").locator(".inline").evaluate(el => getComputedStyle(el).color), "rgb(17, 34, 51)");
    assert.equal(documentCalls, 1);
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
    console.log(`PASS ${lang}/${width}: draft preview, busy retry, CSS iframe sandbox, mobile modal, PDF error/retry/download${realHttpDownload ? " via real HTTP" : ""}, no mutation`);
    await page.close();
  }
  if (realHttpDownload) assert.equal(actualPdfResponses, 3);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
