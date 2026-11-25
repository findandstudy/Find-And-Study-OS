import { JSDOM } from "jsdom";
import { applyContractBranding, sanitizeContractBranding } from "./contractBranding";
import { captureContractLogoSnapshot } from "./contractPdfAssets";
import { buildAgentContext, cleanupSignatureImages, documentShell, renderTemplate } from "./contractRenderer";

export const UNSIGNED_PREVIEW_LABEL = "UNSIGNED TEST PREVIEW - NOT A SIGNED CONTRACT";
export const MAX_PREVIEW_TEMPLATE_BYTES = 512 * 1024;
export const MAX_PREVIEW_HTML_BYTES = 2 * 1024 * 1024;

/** No caller-supplied personal data, agent lookups, signature files or writes. */
export async function buildUnsignedContractPreview(bodyHtml: string, language: string, brandingValue: unknown): Promise<string> {
  if (typeof bodyHtml !== "string" || Buffer.byteLength(bodyHtml, "utf8") > MAX_PREVIEW_TEMPLATE_BYTES) {
    throw new Error("preview_template_too_large");
  }
  const branding = sanitizeContractBranding(brandingValue);
  if (branding) {
    delete branding.companySignatureDataUrl;
    delete branding.logoSnapshot;
    const logo = branding.logoUrl
      ? await captureContractLogoSnapshot(branding.logoUrl, { localOnly: true })
      : undefined;
    if (logo) branding.logoSnapshot = logo;
    else delete branding.logoUrl;
  }
  const sample = {
    firstName: "TEST", lastName: "PREVIEW", businessName: "TEST AGENCY - NOT A REAL COMPANY",
    companyName: "TEST AGENCY", email: "unsigned-preview@example.invalid", phone: "+12025550123",
    country: "TEST COUNTRY", city: "TEST CITY", address: "TEST ADDRESS", taxNumber: "TEST-0000",
  };
  const ctx = buildAgentContext(sample, {}, {
    signerName: "TEST PREVIEW - NOT SIGNED", signerEmail: sample.email,
    date: "2000-01-01", number: "TEST-UNSIGNED",
  });
  // Fill custom template variables with conspicuously synthetic text. Never
  // resolve an ID or use an operator-provided value to fetch an actual person.
  let count = 0;
  for (const match of bodyHtml.matchAll(/\{\{\{?\s*([\w.]+)\s*\}?\}\}/g)) {
    if (++count > 1000) throw new Error("preview_template_too_complex");
    const parts = match[1].split(".");
    if (parts.length > 3 || parts.some(key => ["__proto__", "constructor", "prototype"].includes(key))) continue;
    let target: Record<string, any> = ctx;
    for (const part of parts.slice(0, -1)) {
      if (!target[part] || typeof target[part] !== "object") target[part] = Object.create(null);
      target = target[part];
    }
    const key = parts.at(-1)!;
    if (/signature|stamp|seal/i.test(match[1])) target[key] = "";
    else if (target[key] === undefined || target[key] === "") target[key] = "TEST PREVIEW";
  }
  ctx.signature = "";
  ctx.main_agency_signature = "";
  const safePlaceholders = bodyHtml.replace(/\{\{\{?\s*([\w.]+)\s*\}?\}\}/g, (token, path: string) =>
    path.split(".").some(key => ["__proto__", "constructor", "prototype"].includes(key)) ? "" : token);
  const rendered = renderTemplate(safePlaceholders, ctx);
  const html = documentShell(applyContractBranding(cleanupSignatureImages(rendered, "UNSIGNED TEST - NO SIGNATURE"), branding));
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    doc.documentElement.lang = /^[a-z]{2}(?:-[A-Za-z]{2})?$/.test(language) ? language : "en";
    if (["ar", "he", "fa", "ur"].includes(language)) doc.documentElement.dir = "rtl";
    // Even a literal embedded image could be a real signature. Only the
    // exact operator-approved, locally captured public brand logo is retained.
    for (const image of doc.querySelectorAll("img")) {
      if (!branding?.logoSnapshot || image.getAttribute("src") !== branding.logoSnapshot.dataUrl) {
        const placeholder = doc.createElement("span");
        placeholder.textContent = "[UNSIGNED TEST - IMAGE OMITTED]";
        image.replaceWith(placeholder);
      }
    }
    for (const element of doc.querySelectorAll("*")) {
      for (const attr of ["href", "target", "poster", "background"]) element.removeAttribute(attr);
    }
    const csp = doc.createElement("meta");
    csp.httpEquiv = "Content-Security-Policy";
    csp.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'";
    doc.head.prepend(csp);
    const watermark = doc.createElement("div");
    watermark.id = "fas-unsigned-preview-banner";
    watermark.textContent = UNSIGNED_PREVIEW_LABEL;
    watermark.setAttribute("style", "all:initial;position:fixed!important;top:2px!important;left:0!important;right:0!important;z-index:2147483647!important;display:block!important;text-align:center!important;background:#fff7ed!important;color:#9a3412!important;font:700 10px sans-serif!important;padding:3px!important;direction:ltr!important;");
    doc.body.prepend(watermark);
    // PDF pages receive a separate post-render watermark in the page margin.
    // Hide this screen banner for print so it cannot cover the brand header.
    const printStyle = doc.createElement("style");
    printStyle.textContent = "@media print { #fas-unsigned-preview-banner { visibility:hidden!important; } }";
    doc.head.appendChild(printStyle);
    const output = dom.serialize();
    if (Buffer.byteLength(output, "utf8") > MAX_PREVIEW_HTML_BYTES) throw new Error("preview_html_too_large");
    return output;
  } finally { dom.window.close(); }
}
