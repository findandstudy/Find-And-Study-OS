import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { sanitizeContractTemplateHtml } from "../src/lib/contractHtmlSanitizer";
import { documentShell, renderTemplate } from "../src/lib/contractRenderer";

const css = ".contract-title{color:#143591} @media print{.signature{break-inside:avoid}}";
const fragment = `<style>${css}</style><h1 class="contract-title">{{contract.signerName}}</h1><div class="signature" style="display:flex;gap:12px">Signature</div>`;

test("leading fragment styles survive storage and the complete render pipeline", () => {
  const stored = sanitizeContractTemplateHtml(fragment);
  const rendered = renderTemplate(stored, { contract: { signerName: "Synthetic Signer" } });
  const html = documentShell(rendered);
  assert.ok(stored.includes(css));
  assert.ok(rendered.includes(css));
  assert.ok(html.includes(css));
  assert.ok(html.includes("Synthetic Signer"));
  assert.ok(html.includes('style="display:flex;gap:12px"'));
});

test("multiple leading styles retain cascade order across repeated save/new-version sanitization", () => {
  let html = `\n<!-- Design -->\n<style>.x{color:red}</style>\n<style>.x{color:blue}</style><p class="x">Synthetic</p>`;
  const first = sanitizeContractTemplateHtml(html);
  for (let round = 0; round < 5; round++) html = sanitizeContractTemplateHtml(html);
  assert.equal(html, first);
  assert.equal(html.match(/<style>/g)?.length, 2);
  assert.ok(html.indexOf("color:red") < html.indexOf("color:blue"));
});

test("full documents preserve head CSS, document attributes, inline layout and body content", () => {
  const input = `<!doctype html><html lang="ar" dir="rtl"><head><style>${css}</style></head><body class="agreement"><table style="width:100%"><tr><td>{{name}}</td></tr></table></body></html>`;
  const sanitized = sanitizeContractTemplateHtml(input);
  assert.equal(sanitizeContractTemplateHtml(sanitized), sanitized);
  assert.ok(sanitized.includes(css));
  assert.match(sanitized, /<html lang="ar" dir="rtl">/);
  assert.match(sanitized, /<body class="agreement">/);
  assert.match(renderTemplate(sanitized, { name: "Synthetic" }), /<td>Synthetic<\/td>/);
});

test("nested body styles and harmless CSS escapes remain available", () => {
  const input = String.raw`<div><style>.bullet:before{content:"\2022"}.x{color:blue}/* design */</style><p class="x">Synthetic</p></div>`;
  const result = sanitizeContractTemplateHtml(input);
  assert.ok(result.includes(String.raw`content:"\2022"`));
  assert.ok(result.includes("color:blue"));
  assert.equal(sanitizeContractTemplateHtml(result), result);
});

test("preserved CSS still strips external fetches and active CSS expressions", () => {
  const input = `<style>/* Custom layout */@import "https://invalid.example/style.css";.x{color:blue;background:url(https://invalid.example/image);background-image:image-set("https://invalid.example/image" 1x);width:expression(alert(1));behavior:url(https://invalid.example/code);-moz-binding:url(https://invalid.example/code)}</style><p class="x" style="color:red;background:url(https://invalid.example/image)">Synthetic</p>`;
  const html = sanitizeContractTemplateHtml(input);
  assert.ok(html.includes("color:blue"));
  assert.ok(html.includes("color:red"));
  assert.doesNotMatch(html, /invalid\.example|@import|url\s*\(|image-set\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:/i);
});

test("escaped and comment-split CSS fetches cannot bypass the preserved style boundary", () => {
  for (const dangerous of [
    String.raw`.x{background:u\72l(https://invalid.example/image)}`,
    String.raw`@\69mport "https://invalid.example/style.css";`,
    String.raw`.x{background:im\61ge-set("https://invalid.example/image" 1x)}`,
    `.x{background:u/**/rl(https://invalid.example/image)}`,
    String.raw`.x{width:e\78pression(alert(1))}`,
  ]) {
    assert.equal(sanitizeContractTemplateHtml(`<style>${dangerous}</style><p>Safe</p>`), "<style></style><p>Safe</p>");
    assert.equal(sanitizeContractTemplateHtml(`<p style='${dangerous}'>Safe</p>`), "<p>Safe</p>");
  }
});

test("import at-rules without whitespace cannot fetch external styles", () => {
  for (const rule of ['@import"https://invalid.example/style.css";', "@import'https://invalid.example/style.css';", "@import url(https://invalid.example/style.css);"]) {
    const html = sanitizeContractTemplateHtml(`<style>${rule}.x{color:blue}</style><p>Safe</p>`);
    assert.ok(html.includes(".x{color:blue}"));
    assert.doesNotMatch(html, /@import|invalid\.example/);
  }
});

test("scripts, event handlers, forms and active URL attributes remain blocked", () => {
  const html = sanitizeContractTemplateHtml(`<style>${css}</style><script>alert(1)</script><iframe srcdoc="bad"></iframe><form><input></form><p onclick="alert(1)">Safe</p><a href="javascript:alert(1)" target="_blank">Link</a><img src="javascript:alert(1)" onerror="alert(1)" srcset="https://invalid.example 1x">`);
  const dom = new JSDOM(html);
  try {
    assert.equal(dom.window.document.querySelectorAll("script,iframe,form,input,[onclick],[onerror],[srcset]").length, 0);
    assert.equal(dom.window.document.querySelector("a")?.getAttribute("href"), null);
    assert.equal(dom.window.document.querySelector("img")?.getAttribute("src"), null);
    assert.equal(dom.window.document.querySelector("a")?.getAttribute("rel"), "noopener noreferrer");
    assert.equal(dom.window.document.querySelector("style")?.textContent, css);
  } finally {
    dom.window.close();
  }
});

test("placeholder expansion stays escaped and rechecks URL values while retaining CSS", () => {
  const html = renderTemplate(`<style>${css}</style><p>{{{name}}}</p><img src="{{image}}"><a href="{{href}}">Link</a>`, {
    name: '<script>alert(1)</script><img src=x onerror="alert(1)">',
    image: "javascript:alert(1)", href: "javascript:alert(1)",
  });
  assert.ok(html.includes(css));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.doesNotMatch(html, /<script|<img[^>]+(?:onerror|javascript:)|href="javascript:/i);
});
