/** Synthetic, DB-free verification through the real PDF renderer. No signed records or storage writes. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { buildSignedPdf } from "../src/lib/contractPdf";
import { applyContractBranding } from "../src/lib/contractBranding";
import { captureContractLogoSnapshot } from "../src/lib/contractPdfAssets";
import { documentShell, renderTemplate } from "../src/lib/contractRenderer";

test("designed fragment and full-document contracts retain styling and embedded logo in real Chromium PDFs", { timeout: 90_000 }, async () => {
  assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false", "run with external integrations disabled");
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  assert.ok(executablePath, "set an installed Chromium path; this test never downloads a browser");
  const outputDir = resolve(process.env.CONTRACT_RENDER_TEST_OUTPUT || "../../tmp/pdfs/contract-render-regression");
  await mkdir(outputDir, { recursive: true });
  const logo = await sharp(Buffer.from('<svg width="240" height="80" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="80" rx="12" fill="#143591"/><text x="120" y="49" text-anchor="middle" fill="white" font-family="sans-serif" font-size="24">TEST LOGO</text></svg>')).png().toBuffer();
  const sourceUrl = "https://brand.example/logo.png";
  const logoSnapshot = await captureContractLogoSnapshot(sourceUrl, {
    trustedLogoUrls: [sourceUrl],
    request: async () => ({ ok: true, status: 200, url: sourceUrl, headers: { "content-type": "image/png" }, body: logo }),
  });
  assert.ok(logoSnapshot);
  const dataUrl = logoSnapshot.dataUrl;
  assert.ok(dataUrl.length > 2000, "exercise a real image larger than the old URL truncation limit");
  const branding = {
    brandName: "Synthetic Contract QA", logoUrl: sourceUrl,
    logoSnapshot,
    pdfFooterText: "LOCAL TEST ONLY - NOT A SIGNED CONTRACT",
  };
  const css = '<style>@page{size:A4;margin:18mm}.contract-title{color:#143591;font-size:28px}.terms-box{border:2px solid #143591;background:#eaf1ff;padding:18px;border-radius:8px}td{padding:8px;border-bottom:1px solid #cbd5e1}</style>';
  const body = `<h1 class="contract-title">Sözleşme tasarım kontrolü</h1><p>SENTETİK TEST - İMZALI BELGE DEĞİLDİR</p><img src="${sourceUrl}" width="180"><div class="terms-box"><h2>Koşullar / Terms</h2><p>{{company}} metni değişmeden korunur.</p><table><tr><td>Hizmet</td><td>Örnek danışmanlık</td></tr><tr><td>Süre</td><td>12 ay</td></tr></table></div><p dir="rtl">اختبار تنسيق العقد</p>`;
  for (const [name, template] of [
    ["fragment", `${css}${body}`],
    ["full-document", `<!doctype html><html lang="tr"><head>${css}</head><body>${body}</body></html>`],
  ] as const) {
    const rendered = applyContractBranding(renderTemplate(template, { company: "Örnek Şirket" }), branding);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage();
      let externalRequests = 0;
      await page.route("**/*", route => {
        if (/^(data:|about:|blob:)/.test(route.request().url())) return route.continue();
        externalRequests++;
        return route.abort();
      });
      await page.emulateMedia({ media: "print" });
      await page.setContent(documentShell(rendered));
      await page.evaluate(async () => { await Promise.all(Array.from(document.images, image => image.decode())); });
      const appearance = await page.evaluate(() => ({
        color: getComputedStyle(document.querySelector(".contract-title")!).color,
        background: getComputedStyle(document.querySelector(".terms-box")!).backgroundColor,
        text: document.body.textContent,
        logos: Array.from(document.images).filter(image => image.src.startsWith("data:image/png;") && image.naturalWidth === 240).length,
      }));
      assert.equal(appearance.color, "rgb(20, 53, 145)");
      assert.equal(appearance.background, "rgb(234, 241, 255)");
      assert.match(appearance.text!, /Örnek Şirket metni değişmeden korunur/);
      assert.equal(appearance.logos, 2);
      assert.equal(externalRequests, 0, "no external image request is needed");
    } finally { await browser.close(); }
    const built = await buildSignedPdf({
      bodyHtml: rendered, templateName: `SYNTHETIC QA ${name}`, signerEmail: "synthetic@example.invalid",
      signerName: "Synthetic Test - Not a Real Signature", signedAt: new Date("2026-10-09T09:00:00Z"),
      emailVerificationRequired: true, emailVerificationMethod: "one_time_code", emailVerifiedAt: new Date("2026-10-09T08:59:00Z"),
    });
    const pdf = await PDFDocument.load(built.pdfBytes);
    assert.equal(pdf.getPageCount(), 2, "one contract page plus its evidence test page");
    assert.match(built.evidenceHash, /^[a-f0-9]{64}$/);
    await writeFile(resolve(outputDir, `${name}.pdf`), built.pdfBytes);
  }
});
