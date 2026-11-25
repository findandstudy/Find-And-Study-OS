/** Synthetic templates through real Chromium; emits only unsigned TEST artifacts. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { PDFDocument } from "pdf-lib";
import { buildUnsignedContractPreview } from "../src/lib/contractUnsignedPreview";
import { buildUnsignedPreviewPdf } from "../src/lib/contractPdf";
import { withRenderLock } from "../src/lib/renderLock";

test("real unsigned EN/TR/AR preview and PDF retain layout without signatures, evidence or network", { timeout: 90_000 }, async () => {
  assert.equal(process.env.ALLOW_LIVE_INTEGRATIONS, "false");
  assert.ok(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
  const output = path.resolve(process.env.CONTRACT_UNSIGNED_PREVIEW_OUTPUT || "../../tmp/pdfs/unsigned-contract-preview");
  await mkdir(output, { recursive: true });
  for (const lang of ["en", "tr", "ar"]) {
    const title = lang === "ar" ? "معاينة عقد تجريبي" : lang === "tr" ? "TEST sözleşme tasarımı" : "TEST agreement design";
    const html = await buildUnsignedContractPreview(`<!doctype html><html lang="${lang}" ${lang === "ar" ? 'dir="rtl"' : ""}><head><style>.hero{background:#143591;color:white;border-radius:14px;padding:24px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{border:1px solid #94a3b8;border-radius:8px;padding:16px}h2{color:#143591}</style></head><body><header class="hero"><h1>${title}</h1><p>{{contract_number}}</p></header><div class="cards"><section class="card"><h2>TEST company</h2><p>{{agency_name}}</p></section><section class="card"><h2>TEST person</h2><p>{{contract.signerName}}</p></section></div><img src="{{signature}}"><img src="https://remote.invalid/signature.png"></body></html>`, lang, { brandName: "TEST BRAND", pdfFooterText: "TEST layout only" });
    // The screenshot probe runs beside the production renderer under the same
    // container PID/memory limits. Do not start Chromium's default process tree.
    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ["--single-process", "--no-zygote", "--disable-gpu"],
    });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
      let remoteRequests = 0;
      await page.route("**/*", route => { remoteRequests++; return route.abort(); });
      await page.setContent(html);
      for (const media of ["screen", "print"] as const) {
        await page.emulateMedia({ media });
        const observed = await page.evaluate(() => ({ color: getComputedStyle(document.querySelector(".hero")!).backgroundColor, radius: getComputedStyle(document.querySelector(".hero")!).borderRadius, columns: getComputedStyle(document.querySelector(".cards")!).gridTemplateColumns, direction: document.documentElement.dir, images: document.images.length, text: document.body.textContent, bannerVisibility: getComputedStyle(document.querySelector("#fas-unsigned-preview-banner")!).visibility }));
        assert.equal(observed.color, "rgb(20, 53, 145)"); assert.equal(observed.radius, "14px");
        assert.equal(observed.columns.split(" ").length, 2); assert.equal(observed.images, 0);
        assert.match(observed.text!, /UNSIGNED TEST PREVIEW/);
        assert.equal(observed.bannerVisibility, media === "print" ? "hidden" : "visible", "screen banner must not cover the printed brand header");
        if (lang === "ar") assert.equal(observed.direction, "rtl");
      }
      assert.equal(remoteRequests, 0);
      await page.emulateMedia({ media: "screen" });
      await page.screenshot({ path: path.join(output, `unsigned-${lang}.png`), fullPage: true });
    } finally { await browser.close(); }
    const bytes = await withRenderLock(() => buildUnsignedPreviewPdf(html));
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1, "no evidence page is appended");
    assert.equal(pdf.getTitle(), "Unsigned contract TEST preview");
    await writeFile(path.join(output, `unsigned-${lang}.pdf`), bytes);
    await writeFile(path.join(output, `unsigned-${lang}.html`), html);
  }
});
