import { PDFDocument } from "pdf-lib";
import crypto from "crypto";
import { execSync } from "child_process";

interface BuildPdfParams {
  templateName: string;
  bodyHtml: string;
  signerEmail: string;
  signerName?: string | null;
  signerIp?: string | null;
  signerUserAgent?: string | null;
  signedAt: Date;
}

interface BuildPdfResult {
  pdfBytes: Uint8Array;
  evidenceHash: string;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Resolve the Chromium executable for headless PDF rendering.
 *
 * On Replit the browser binary is provided by Nix (`pkgs.chromium` in
 * replit.nix) rather than downloaded by Playwright, so we point
 * `playwright-core` at it explicitly. `.replit` exports
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (a nix-store path); if that is missing
 * we fall back to whatever `chromium` resolves to on PATH. Returning
 * `undefined` lets playwright-core try its own bundled lookup as a last resort.
 */
function resolveChromiumPath(): string | undefined {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (fromEnv) return fromEnv;
  try {
    const found = execSync("which chromium", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (found) return found;
  } catch {
    /* fall through */
  }
  return undefined;
}

/**
 * Wrap author-designed contract markup in a complete, print-ready HTML
 * document. We keep the template's own `<style>` blocks, inline CSS, tables,
 * colors and signature `<img>` placement intact — the templates are explicitly
 * authored for browser-to-PDF rendering (CSS variables, flexbox,
 * `print-color-adjust:exact`). The shell only supplies an A4 page box and a
 * font fallback chain so Turkish/Cyrillic/Arabic glyphs resolve.
 */
function documentShell(innerHtml: string): string {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @page { size: A4; margin: 14mm 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', 'DejaVu Sans', 'Noto Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
    color: #0f172a;
    font-size: 12px;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  img { max-width: 100%; }
  table { border-collapse: collapse; }
</style>
</head>
<body>${innerHtml}</body>
</html>`;
}

function evidencePageHtml(params: BuildPdfParams, evidenceHash: string): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#0f172a;word-break:break-word;">${escapeHtml(value)}</td></tr>`;
  return `<section style="max-width:920px;margin:0 auto;padding:18px;font-size:12px;color:#0f172a;">
  <h1 style="font-size:20px;margin:0 0 6px;color:#143591;">Delil Sayfası / Evidence Page</h1>
  <p style="margin:0 0 18px;color:#475569;">Bu sayfa imzalanan sözleşmenin kriptografik delilini kaydeder. / This page records the cryptographic evidence for the signed contract.</p>
  <table style="width:100%;border-collapse:collapse;">
    ${row("İmzalayan / Signer", params.signerName || "-")}
    ${row("E-posta / Email", params.signerEmail)}
    ${row("IP adresi / IP address", params.signerIp || "-")}
    ${row("Tarayıcı / User agent", params.signerUserAgent || "-")}
    ${row("İmza zamanı (UTC) / Signed at", params.signedAt.toISOString())}
    ${row("Şablon / Template", params.templateName)}
  </table>
  <div style="margin-top:18px;">
    <div style="font-weight:600;margin-bottom:6px;">Delil özeti (SHA-256) / Evidence hash:</div>
    <div style="font-family:'DejaVu Sans Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;word-break:break-all;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;">${escapeHtml(evidenceHash)}</div>
  </div>
</section>`;
}

/**
 * SSRF guard: decide whether Chromium may fetch a subresource URL referenced by
 * the contract HTML (logo image, fonts, etc.). The document itself is supplied
 * via `setContent` (not fetched), so this only governs subresources.
 *
 * We allow inline `data:`/`blob:` payloads and public http(s) origins (the
 * templates legitimately load a remote brand logo), but block private,
 * loopback, link-local and cloud-metadata targets plus any non-web scheme so a
 * crafted URL can't turn PDF rendering into a server-side request primitive.
 */
function isBlockedSubresourceHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h === "metadata.google.internal") return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}

async function renderHtmlToPdf(browser: any, html: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    await page.route("**/*", (route: any) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) {
        return route.continue();
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return route.abort();
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return route.abort();
      }
      if (isBlockedSubresourceHost(parsed.hostname)) {
        return route.abort();
      }
      return route.continue();
    });
    try {
      await page.setContent(html, { waitUntil: "networkidle", timeout: 15000 });
    } catch {
      // A slow or blocked external asset can prevent networkidle from settling.
      // The DOM content is already in place, so render what loaded rather than
      // failing the whole signing flow.
      console.warn("[contractPdf] networkidle wait timed out; rendering current state");
    }
    const buf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    return new Uint8Array(buf);
  } finally {
    await page.close();
  }
}

/**
 * Render the signer-facing HTML contract to a PDF that faithfully reproduces
 * the designed document (CSS, tables, colors, signature placement), then append
 * a tamper-evident evidence page.
 *
 * Rendering uses headless Chromium via `playwright-core`. The signer's drawn
 * signature is expected to already be embedded in `bodyHtml` (the caller injects
 * it into the template's `{{signature}}` placeholder), so this function does NOT
 * draw signatures separately — that is what kept the old pdf-lib text renderer
 * from matching the on-screen design.
 *
 * Two-pass evidence hash: pass 1 renders the contract content and computes
 * sha256(contentBytes || signerEmail || signerName || signedAtIso); pass 2
 * renders a human-readable evidence page printing that hash. The hash binds to
 * the content PDF (excluding the evidence page) exactly as before.
 */
// Hard ceiling on a single render. On expiry we throw, and the finally block
// below closes the browser — terminating the in-flight Chromium render so its
// memory is freed BEFORE the serialization lock (in signContract.ts) releases
// and the next render starts. Without this, a timed-out render would keep
// running in the background, overlap the next one, multiply RSS, and re-introduce
// the OOM that crashes the autoscale instance and surfaces as an opaque proxy
// "403 Forbidden". Normal renders finish in well under 10s.
const RENDER_TIMEOUT_MS = 30_000;
function renderWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function buildSignedPdf(params: BuildPdfParams): Promise<BuildPdfResult> {
  const { chromium } = await import("playwright-core");
  const executablePath = resolveChromiumPath();
  const browser = await chromium.launch({
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
  });

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  const remainingMs = () => Math.max(1, deadline - Date.now());
  try {
    const contentBytes = await renderWithTimeout(
      renderHtmlToPdf(browser, documentShell(params.bodyHtml)),
      remainingMs(),
      "Contract PDF content render",
    );

    const hasher = crypto.createHash("sha256");
    hasher.update(Buffer.from(contentBytes));
    hasher.update("|");
    hasher.update(params.signerEmail);
    hasher.update("|");
    hasher.update(params.signerName || "");
    hasher.update("|");
    hasher.update(params.signedAt.toISOString());
    const evidenceHash = hasher.digest("hex");

    const evidenceBytes = await renderWithTimeout(
      renderHtmlToPdf(browser, documentShell(evidencePageHtml(params, evidenceHash))),
      remainingMs(),
      "Contract PDF evidence render",
    );

    // Merge content + evidence into a single document. pdf-lib copies page
    // content faithfully, preserving the Chromium-rendered vector/text output.
    const merged = await PDFDocument.create();
    const contentDoc = await PDFDocument.load(contentBytes);
    const evidenceDoc = await PDFDocument.load(evidenceBytes);
    const contentPages = await merged.copyPages(contentDoc, contentDoc.getPageIndices());
    contentPages.forEach((p) => merged.addPage(p));
    const evidencePages = await merged.copyPages(evidenceDoc, evidenceDoc.getPageIndices());
    evidencePages.forEach((p) => merged.addPage(p));
    const pdfBytes = await merged.save();

    return { pdfBytes, evidenceHash };
  } finally {
    await browser.close();
  }
}
