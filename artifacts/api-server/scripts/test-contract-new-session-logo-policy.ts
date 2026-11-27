import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { applyContractBranding, sanitizeContractBranding } from "../src/lib/contractBranding";
const body = '<style>.hero{background:#143591}</style><section class="hero"><img alt="Find and Study" src="https://www.findandstudy.com/wp-content/uploads/2025/10/logotest-scaled.png"><h1>TEST-001 Agreement</h1><img alt="Campus" src="data:image/png;base64,test"></section>';
const legacy = {brandName:"Find And Study",logoUrl:"https://example.invalid/logo.png",pdfFooterText:"TEST ONLY"};
test("historical branding remains byte-identical to the pre-change renderer", () => {
  const frozen = JSON.stringify(legacy);
  assert.equal(createHash("sha256").update(applyContractBranding(body, legacy)).digest("hex"), "8300e4471cc8ee13c7bf4196e08623814718d92dc6e1fbd9bd4f50b67908bcd1");
  assert.equal(JSON.stringify(legacy), frozen);
  assert.equal(sanitizeContractBranding(legacy)?.showGeneratedHeader, undefined);
  assert.equal(sanitizeContractBranding(legacy)?.templateLogoPolicy, undefined);
});
test("new-session policy removes only designated logos and preserves design, links and other images", () => {
  const urls = ["https://www.findandstudy.com/wp-content/uploads/2024/12/Find-and-study-logo-wht-scaled.webp", "https://www.findandstudy.com/wp-content/uploads/2026/07/find-and-study-4.png"];
  const html = applyContractBranding(body + urls.map(src => '<img src="'+src+'" alt="Brand">').join('') + '<img alt="Find &amp; Study" src="data:image/png;base64,test"><img alt="Find and Study campus" src="data:image/png;base64,test"><a href="'+urls[0]+'">Unchanged link</a>', {...legacy,showGeneratedHeader:false,templateLogoPolicy:"hide"});
  const dom = new JSDOM(html); const doc=dom.window.document;
  assert.equal(doc.querySelector("header"), null);
  assert.equal(doc.querySelectorAll("img").length, 2);
  assert.equal(doc.querySelector("h1")?.textContent,"TEST-001 Agreement");
  assert.equal(doc.querySelector("a")?.getAttribute("href"),urls[0]);
  assert.equal(doc.querySelector(".hero")?.className,"hero");
  assert.ok(html.includes(".hero{background:#143591}"));
  assert.ok(html.includes("TEST ONLY")); dom.window.close();
});
test("session defaults are confined to the explicit new-session capture branch", () => {
  const source=readFileSync(new URL("../src/lib/contractTemplateBranding.ts",import.meta.url),"utf8");
  assert.ok(source.includes('if (options.captureLogo) {\n    config.showGeneratedHeader = false;\n    config.templateLogoPolicy = "hide";'));
});
