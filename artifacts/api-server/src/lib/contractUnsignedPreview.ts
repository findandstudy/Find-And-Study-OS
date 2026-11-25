import { JSDOM } from "jsdom";
import { createHash } from "node:crypto";
import { applyContractBranding, sanitizeContractBranding } from "./contractBranding";
import { captureContractLogoSnapshot, parseContractTrustedLogoUrls, MAX_CONTRACT_LOGO_BYTES } from "./contractPdfAssets";
import { buildAgentContext, cleanupSignatureImages, documentShell, renderTemplate } from "./contractRenderer";

export const UNSIGNED_PREVIEW_LABEL = "UNSIGNED TEST PREVIEW - NOT A SIGNED CONTRACT";
export const MAX_PREVIEW_TEMPLATE_BYTES = 512 * 1024;
export const MAX_PREVIEW_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_PREVIEW_LOGOS = 4;

function inlineLogoSource(source: string, trustedLogoUrls: readonly string[]): string | undefined {
  if (trustedLogoUrls.includes(source)) return source;
  // Some designed templates embed the public logo. A data image is not trusted
  // merely because it looks like a logo: its exact bytes must identify an
  // allowlisted content-addressed public object, which is still read/validated.
  if (source.length > 22 + Math.ceil(MAX_CONTRACT_LOGO_BYTES / 3) * 4) return;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  if (!match || match[1].length % 4 !== 0) return;
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length || bytes.length > MAX_CONTRACT_LOGO_BYTES || bytes.toString("base64") !== match[1]) return;
  let origin: string;
  try { origin = new URL(process.env.APP_BASE_URL || "").origin; } catch { return; }
  const hash = createHash("sha256").update(bytes).digest("hex");
  return trustedLogoUrls.find(value => {
    const url = new URL(value);
    return url.origin === origin && url.pathname === `/api/storage/public-branding/embed-widget/contract-logo-${hash}.png`;
  });
}

/** No caller-supplied personal data, agent lookups, signature files or writes. */
export async function buildUnsignedContractPreview(bodyHtml: string, language: string, brandingValue: unknown): Promise<string> {
  if (typeof bodyHtml !== "string" || Buffer.byteLength(bodyHtml, "utf8") > MAX_PREVIEW_TEMPLATE_BYTES) {
    throw new Error("preview_template_too_large");
  }
  const trustedLogoUrls = parseContractTrustedLogoUrls(process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS);
  const branding = sanitizeContractBranding(brandingValue);
  if (branding) {
    delete branding.companySignatureDataUrl;
    delete branding.logoSnapshot;
    if (!branding.logoUrl || !trustedLogoUrls.includes(branding.logoUrl)) delete branding.logoUrl;
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
    // Designed templates can contain a separate white/header logo rather than
    // the profile's logo. Capture only the exact operator-approved sources via
    // the existing public local-object boundary. Deduplicate repeated logos and
    // cap concurrent captures; arbitrary inline images can still be signatures.
    const sourceMap = new Map([...new Set(Array.from(doc.querySelectorAll("img"), image => image.getAttribute("src") || ""))]
      .map(source => [source, inlineLogoSource(source, trustedLogoUrls)] as const));
    const sources = [...new Set([...sourceMap.values()].filter((source): source is string => Boolean(source)))];
    if (sources.length > MAX_PREVIEW_LOGOS) throw new Error("preview_template_too_complex");
    const captures = await Promise.allSettled(sources.map(async source => [source,
      (await captureContractLogoSnapshot(source, { localOnly: true, trustedLogoUrls }))?.dataUrl,
    ] as const));
    const capturedLogos = new Map(captures.map(result => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    }));
    let projectedBytes = Buffer.byteLength(html, "utf8");
    for (const image of doc.querySelectorAll("img")) {
      const source = image.getAttribute("src") || "";
      const captured = capturedLogos.get(sourceMap.get(source) || "");
      if (captured) {
        projectedBytes += Buffer.byteLength(captured, "utf8") - Buffer.byteLength(source, "utf8");
        if (projectedBytes > MAX_PREVIEW_HTML_BYTES) throw new Error("preview_html_too_large");
        image.setAttribute("src", captured);
      }
      else {
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
