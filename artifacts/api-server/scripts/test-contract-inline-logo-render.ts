/** Synthetic only: existing frozen HTML/logo flow, no DB, storage, signatures or sends. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import { chromium } from "playwright-core";
import { PDFDocument } from "pdf-lib";
import { sanitizeContractTemplateHtml } from "../src/lib/contractHtmlSanitizer";
import { documentShell } from "../src/lib/contractRenderer";
import { buildSignedPdf } from "../src/lib/contractPdf";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://contract_test@127.0.0.1:1/fas_contract_inline_logo_test";
process.env.ALLOW_LIVE_INTEGRATIONS = "false";
process.env.EMAIL_DELIVERY_DISABLED = "true";
process.env.SIGNED_CONTRACT_DELIVERY_ENABLED = "false";
process.env.SIGNED_CONTRACT_PDF_WORKER_ENABLED = "false";
const { prepareFrozenContractPdf } = await import("../src/lib/contractSigningPreflight");
const { pool } = await import("@workspace/db");
// The pure preparation boundary must never contact a database.
pool.query = (() => { throw new Error("TEST_DATABASE_ACCESS_FORBIDDEN"); }) as typeof pool.query;
pool.connect = (() => { throw new Error("TEST_DATABASE_ACCESS_FORBIDDEN"); }) as typeof pool.connect;
after(async () => { await pool.end(); });

const heroPng = await sharp(Buffer.from('<svg width="320" height="80" xmlns="http://www.w3.org/2000/svg"><rect width="320" height="80" fill="white"/><text x="12" y="50" font-family="sans-serif" font-size="34" fill="#143591">SYNTHETIC TEST</text></svg>')).png().toBuffer();
const headerPng = await sharp({ create: { width: 240, height: 60, channels: 4, background: "#143591" } }).png().toBuffer();
const hero = `data:image/png;base64,${heroPng.toString("base64")}`;
const header = `data:image/png;base64,${headerPng.toString("base64")}`;
const stamp = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const headerUrl = "https://branding.example.invalid/colored.png";
const template = `<!doctype html><html lang="en"><head><style>/* Example {{ignored_example}} */
@page{size:A4;margin:16mm}.hero{background:#143591;padding:12px}.hero img{width:240px}
.legal{color:#143591;font-size:18px;border:2px solid #143591;padding:14px}</style></head><body>
<div class="hero"><img alt="Synthetic body logo" src="${hero}"></div>
<p class="legal">SYNTHETIC TEST — unchanged terms for {{agency_name}}. WhatsApp: {{whatsapp_phone}}</p>
<img src="{{signature}}"><img src="{{main_agency_signature}}"></body></html>`;
const snapshot = {
  contract: { id: 1, signing_session_id: 2, template_id: 3, pdf_object_key: null, evidence_hash: null,
    signature_image_base64: stamp, signed_at: "2026-11-26T12:00:00Z", email_verified_at: "2026-11-26T11:59:00Z",
    email_verification_required: true, email_verification_method: "one_time_code", signer_email: "synthetic@example.invalid", signer_name: "SYNTHETIC TEST" },
  session: { id: 2, template_id: 3, status: "signed", revoked_at: null, signed_at: "2026-11-26T12:00:00Z",
    template_version_snapshot: 7, template_name_snapshot: "SYNTHETIC INLINE LOGO TEST", template_language_snapshot: "en",
    template_body_html_snapshot: sanitizeContractTemplateHtml(template), template_intake_schema_snapshot: [],
    intake_data: { companyName: "TEST COMPANY", whatsapp_phone: "+12025550123" },
    template_signing_page_config_snapshot: { logoUrl: headerUrl,
      logoSnapshot: { sourceUrl: headerUrl, dataUrl: header, sha256: createHash("sha256").update(headerPng).digest("hex") },
      companySignatureDataUrl: `data:image/png;base64,${stamp}` } },
};

test("inline body logo and CSS survive storage sanitization and frozen future-PDF preparation", () => {
  assert.ok(hero.length > 2000, "exercise a real embedded logo larger than URL field limits");
  const original = JSON.stringify(snapshot);
  const prepared = prepareFrozenContractPdf(snapshot);
  const dom = new JSDOM(prepared.bodyHtml);
  try {
    assert.equal(dom.window.document.querySelector(".hero img")?.getAttribute("src"), hero);
    assert.equal(dom.window.document.querySelector("header img")?.getAttribute("src"), header);
    assert.match(dom.window.document.querySelector(".legal")!.textContent!, /unchanged terms for TEST COMPANY/);
    assert.match(dom.window.document.querySelector(".legal")!.textContent!, /WhatsApp: \+12025550123/);
    assert.match(prepared.bodyHtml, /\.hero\{background:#143591;padding:12px\}/);
    assert.ok(Array.from(dom.window.document.images).every(image => image.getAttribute("src")?.startsWith("data:image/png;base64,")));
  } finally { dom.window.close(); }
  assert.equal(JSON.stringify(snapshot), original, "preparation never rewrites frozen evidence");
});

test("inline-image path still rejects external source, MIME spoof and absent real WhatsApp", () => {
  for (const source of ["https://untrusted.example.invalid/logo.png", "data:image/png;base64,AAAA"]) {
    const changed = structuredClone(snapshot);
    changed.session.template_body_html_snapshot = changed.session.template_body_html_snapshot.replace(hero, source);
    assert.throws(() => prepareFrozenContractPdf(changed), /CONTRACT_LOGO_SNAPSHOT_REQUIRED/);
  }
  const missing = structuredClone(snapshot);
  missing.session.intake_data.whatsapp_phone = "";
  assert.throws(() => prepareFrozenContractPdf(missing), /CONTRACT_FROZEN_FIELD_MISSING/);
});

test("real Chromium shows embedded logos and design, then emits a valid PDF without outbound assets", { timeout: 90_000 }, async () => {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  assert.ok(executablePath, "use an existing installed Chromium; never download one");
  const prepared = prepareFrozenContractPdf(snapshot);
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--single-process", "--no-zygote", "--disable-gpu"] });
  let externalRequests = 0;
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => {
      if (/^(data:|about:|blob:)/.test(route.request().url())) return route.continue();
      externalRequests++; return route.abort();
    });
    await page.setContent(documentShell(prepared.bodyHtml));
    await page.evaluate(async () => { await Promise.all(Array.from(document.images, image => image.decode())); });
    await page.emulateMedia({ media: "print" });
    const actual = await page.evaluate(() => ({
      hero: (document.querySelector(".hero img") as HTMLImageElement).naturalWidth,
      header: (document.querySelector("header img") as HTMLImageElement).naturalWidth,
      background: getComputedStyle(document.querySelector(".hero")!).backgroundColor,
      border: getComputedStyle(document.querySelector(".legal")!).borderTopWidth,
    }));
    assert.deepEqual(actual, { hero: 320, header: 240, background: "rgb(20, 53, 145)", border: "2px" });
    assert.equal(externalRequests, 0);
  } finally { await browser.close(); }
  const built = await buildSignedPdf(prepared);
  const pdf = await PDFDocument.load(built.pdfBytes);
  assert.equal(pdf.getPageCount(), 2, "one synthetic design page plus synthetic evidence page");
  assert.match(built.evidenceHash, /^[a-f0-9]{64}$/);
  assert.ok(built.pdfBytes.length > 15_000);
});
