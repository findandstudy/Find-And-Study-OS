import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  applyContractBranding, mergeContractBranding, publicContractBranding,
  sanitizeContractBranding, validateContractBrandingInput,
} from "../src/lib/contractBranding";
import { buildFinalSignedContractHtml } from "../src/lib/contractRenderer";

const sourceUrl = "https://brand.example/logo.png";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
const logoSnapshot = { sourceUrl, dataUrl, sha256: createHash("sha256").update(png).digest("hex") };
const branding = { brandName: "Synthetic brand", logoUrl: sourceUrl, logoSnapshot, companySignatureDataUrl: dataUrl };

test("frozen logo survives sanitization, JSON storage round-trip and public projection without exposing the company signature", () => {
  const stored = JSON.parse(JSON.stringify(sanitizeContractBranding(branding)));
  assert.deepEqual(sanitizeContractBranding(stored)?.logoSnapshot, logoSnapshot);
  assert.deepEqual(publicContractBranding(stored)?.logoSnapshot, logoSnapshot);
  assert.equal("companySignatureDataUrl" in publicContractBranding(stored)!, false);
  assert.deepEqual(branding.logoSnapshot, logoSnapshot);
});

test("changed logo source or snapshot hash cannot reuse different image bytes", () => {
  assert.equal(sanitizeContractBranding({ ...branding, logoUrl: "https://other.example/logo.png" })?.logoSnapshot, undefined);
  assert.equal(sanitizeContractBranding({ ...branding, logoSnapshot: { ...logoSnapshot, sha256: "0".repeat(64) } })?.logoSnapshot, undefined);
  assert.equal(mergeContractBranding(branding, { logoUrl: "https://other.example/logo.png" })?.logoSnapshot, undefined);
});

test("admin input cannot supply server-owned logo snapshots", () => {
  assert.match(validateContractBrandingInput(branding)!, /managed by the server/);
  assert.equal(validateContractBrandingInput({ logoUrl: sourceUrl }), null);
});

test("branding embeds only the captured logo's exact image source while preserving CSS and text", () => {
  const body = `<style>.title{color:#123456}</style><h1 class="title">Terms unchanged</h1><img src="${sourceUrl}"><img src="https://untrusted.example/a.png"><a href="${sourceUrl}">Logo source</a>`;
  const html = applyContractBranding(body, branding);
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    assert.equal(document.querySelector("h1")?.textContent, "Terms unchanged");
    assert.match(html, /\.title\{color:#123456\}/);
    assert.equal(document.querySelector("header img")?.getAttribute("src"), dataUrl);
    assert.equal(document.querySelectorAll(`img[src="${dataUrl}"]`).length, 2);
    assert.equal(document.querySelector('img[src="https://untrusted.example/a.png"]')?.getAttribute("src"), "https://untrusted.example/a.png");
    assert.equal(document.querySelector("a")?.getAttribute("href"), sourceUrl);
  } finally { dom.window.close(); }
});

test("shared final-render path uses only frozen bytes and leaves legacy input untouched", () => {
  const params = {
    bodyHtml: '<style>.title{color:#123456}</style><h1 class="title">{{contract_number}}</h1>',
    templateLanguage: "en", agent: null, intakeData: null,
    signerEmail: "synthetic@example.invalid", signerName: "Synthetic Signer",
    signedAt: new Date("2026-10-09T00:00:00Z"), signatureBase64: png.toString("base64"),
    contractNumber: "SYNTHETIC-001", signingPageConfig: branding,
  };
  const before = JSON.stringify(params);
  const rendered = buildFinalSignedContractHtml(params);
  assert.match(rendered, /SYNTHETIC-001/);
  assert.ok(rendered.includes(dataUrl));
  assert.equal(JSON.stringify(params), before);
  const { logoSnapshot: _unused, ...legacy } = branding;
  const legacyRendered = buildFinalSignedContractHtml({ ...params, signingPageConfig: legacy });
  assert.ok(legacyRendered.includes(`src="${sourceUrl}"`), "legacy records are not fetched or backfilled");
});

test("only new session writers opt into capture; historical PDF generation remains offline", () => {
  for (const [file, captures] of [["contracts.ts", 2], ["agentApplications.ts", 1], ["agentOnboarding.ts", 1], ["agents.ts", 1]] as const) {
    const source = readFileSync(new URL(`../src/routes/${file}`, import.meta.url), "utf8");
    assert.equal((source.match(/resolveContractTemplateBranding\([^;]+\{ captureLogo: true \}/g) || []).length, captures, file);
    assert.match(source, /templateSigningPageConfigSnapshot:/, file);
  }
  const resolver = readFileSync(new URL("../src/lib/contractTemplateBranding.ts", import.meta.url), "utf8");
  assert.match(resolver, /options\.captureLogo && config\.logoUrl/);
  const signing = readFileSync(new URL("../src/lib/signContract.ts", import.meta.url), "utf8");
  assert.doesNotMatch(signing, /captureContractLogoSnapshot|captureLogo:/);
  assert.match(signing, /session\?\.templateSigningPageConfigSnapshot \?\? template.signingPageConfig/);
  assert.ok(signing.indexOf("if (row.pdfObjectKey && row.evidenceHash)") < signing.indexOf("const renderedHtml ="));
  const pdf = readFileSync(new URL("../src/lib/contractPdf.ts", import.meta.url), "utf8");
  assert.doesNotMatch(pdf, /captureContractLogoSnapshot|safeOutboundRequest/);
  assert.match(pdf, /return route\.abort\(\)/);
});
