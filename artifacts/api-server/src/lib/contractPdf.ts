import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import crypto from "crypto";
import { readFileSync, existsSync } from "fs";
import path from "path";

interface BuildPdfParams {
  templateName: string;
  bodyHtml: string;
  signerEmail: string;
  signerName?: string | null;
  signerIp?: string | null;
  signerUserAgent?: string | null;
  signedAt: Date;
  signatureImagePngBase64?: string | null;
}

interface BuildPdfResult {
  pdfBytes: Uint8Array;
  evidenceHash: string;
}

/**
 * Locate a bundled font file. We deliberately avoid `import.meta.url` /
 * `__dirname` because the production bundle is emitted by esbuild as a
 * single CJS file (`dist/index.cjs`) where `import.meta` is empty and
 * `__dirname` collapses to the dist root — both unreliable across
 * dev (tsx + ESM) and prod (CJS bundle).
 *
 * Strategy: probe a fixed set of well-known paths anchored to either
 * `process.cwd()` (varies by how the workflow is launched) or the system
 * font install. The cwd candidates cover both running from the repo root
 * (pnpm dev) and from `artifacts/api-server` (production process manager).
 */
function resolveFontPath(filename: string): string {
  const cwd = process.cwd();
  const candidates = [
    // Dev (tsx) — workflow runs from artifacts/api-server, src tree present
    path.join(cwd, "src/assets/fonts", filename),
    path.join(cwd, "dist/assets/fonts", filename),
    // Repo-root launches
    path.join(cwd, "artifacts/api-server/src/assets/fonts", filename),
    path.join(cwd, "artifacts/api-server/dist/assets/fonts", filename),
    // System DejaVu install — last-resort fallback so PDF generation
    // never silently breaks on Replit/Linux even if the bundle copy is
    // missing. DejaVu Sans covers the same Unicode ranges we ship.
    `/usr/share/fonts/truetype/dejavu/${filename}`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`Font not found: ${filename}. Tried: ${candidates.join(", ")}`);
}

let cachedRegular: Buffer | null = null;
let cachedBold: Buffer | null = null;
function loadFontBytes(): { regular: Buffer; bold: Buffer } {
  if (!cachedRegular) cachedRegular = readFileSync(resolveFontPath("DejaVuSans.ttf"));
  if (!cachedBold) cachedBold = readFileSync(resolveFontPath("DejaVuSans-Bold.ttf"));
  return { regular: cachedRegular, bold: cachedBold };
}

/**
 * Convert simplified HTML (h1/h2/h3, p, ul/li, br) to plain text blocks.
 * We don't run a full HTML parser — templates are author-controlled markup
 * meant for a contract document, not arbitrary user input.
 */
function htmlToBlocks(html: string): { kind: "h1" | "h2" | "h3" | "p" | "li" | "blank"; text: string }[] {
  const blocks: { kind: "h1" | "h2" | "h3" | "p" | "li" | "blank"; text: string }[] = [];
  const normalized = html
    .replace(/\r\n/g, "\n")
    // Strip non-textual blocks entirely (their inner content is CSS/JS, not
    // contract prose, and would otherwise leak into the PDF as visible text).
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Drop <img> entirely — signature artwork is rendered separately on the
    // signature page, and template-side signature placeholders should not
    // print as anything in the body text.
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|li|ul|ol|div|section|article|header|footer)>/gi, "\n")
    .replace(/<(?!\/?(?:h1|h2|h3|p|li|ul|ol|div|section|article|header|footer|br)\b)[^>]+>/gi, "");

  let mode: "h1" | "h2" | "h3" | "p" | "li" = "p";
  const tagRe = /<(h1|h2|h3|p|li|ul|ol|div|section|article|header|footer)[^>]*>/gi;
  const segments: { tag: string; text: string }[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(normalized)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ tag: mode, text: normalized.slice(lastIndex, m.index) });
    }
    const t = m[1].toLowerCase();
    if (t === "h1" || t === "h2" || t === "h3" || t === "li" || t === "p") mode = t as any;
    else mode = "p"; // div/section/article/header/footer treated as paragraph blocks
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < normalized.length) segments.push({ tag: mode, text: normalized.slice(lastIndex) });

  for (const seg of segments) {
    const lines = seg.text.split("\n").map(l => decodeEntities(l).trim()).filter(l => l.length > 0);
    for (const line of lines) {
      blocks.push({ kind: seg.tag as any, text: line });
    }
    if (lines.length > 0) blocks.push({ kind: "blank", text: "" });
  }
  return blocks;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function wrapLine(font: any, fontSize: number, maxWidth: number, line: string): string[] {
  const words = line.split(/\s+/);
  const wrapped: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      cur = candidate;
    } else {
      if (cur) wrapped.push(cur);
      cur = w;
    }
  }
  if (cur) wrapped.push(cur);
  return wrapped.length === 0 ? [""] : wrapped;
}

export async function buildSignedPdf(params: BuildPdfParams): Promise<BuildPdfResult> {
  const pdf = await PDFDocument.create();
  // Register fontkit so pdf-lib can embed custom Unicode TTFs. Without it,
  // embedFont is restricted to the WinAnsi-only StandardFonts and Turkish,
  // Cyrillic, Greek etc. would render as `?` glyphs.
  pdf.registerFontkit(fontkit);
  const { regular, bold } = loadFontBytes();
  // subset:true would shrink the embed, but pdf-lib 1.17 trips a fontkit
  // edge-case ("Cannot read properties of undefined (reading 'advanceWidth')")
  // for some glyphs in DejaVu Sans. The full embed is ~1.5MB but stable.
  const font = await pdf.embedFont(regular);
  const fontBold = await pdf.embedFont(bold);

  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 56;
  const usableWidth = pageWidth - margin * 2;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - margin;

  const drawText = (text: string, opts: { size: number; bold?: boolean; spaceAfter?: number }) => {
    const f = opts.bold ? fontBold : font;
    const wrapped = wrapLine(f, opts.size, usableWidth, text);
    for (const line of wrapped) {
      if (cursorY - opts.size - 4 < margin) {
        page = pdf.addPage([pageWidth, pageHeight]);
        cursorY = pageHeight - margin;
      }
      page.drawText(line, {
        x: margin,
        y: cursorY - opts.size,
        size: opts.size,
        font: f,
        color: rgb(0.1, 0.1, 0.15),
      });
      cursorY -= opts.size + 4;
    }
    cursorY -= opts.spaceAfter ?? 4;
  };

  drawText(params.templateName, { size: 18, bold: true, spaceAfter: 18 });

  const blocks = htmlToBlocks(params.bodyHtml);
  for (const block of blocks) {
    if (block.kind === "blank") {
      cursorY -= 6;
      continue;
    }
    if (block.kind === "h1") drawText(block.text, { size: 16, bold: true, spaceAfter: 8 });
    else if (block.kind === "h2") drawText(block.text, { size: 14, bold: true, spaceAfter: 6 });
    else if (block.kind === "h3") drawText(block.text, { size: 12, bold: true, spaceAfter: 4 });
    else if (block.kind === "li") drawText("• " + block.text, { size: 11, spaceAfter: 2 });
    else drawText(block.text, { size: 11, spaceAfter: 4 });
  }

  // Signature block
  if (cursorY < margin + 180) {
    page = pdf.addPage([pageWidth, pageHeight]);
    cursorY = pageHeight - margin;
  }
  cursorY -= 24;
  drawText("Signature / İmza", { size: 12, bold: true, spaceAfter: 6 });
  if (params.signatureImagePngBase64) {
    try {
      const sigBase64 = params.signatureImagePngBase64.replace(/^data:image\/[a-z]+;base64,/, "");
      const sigBytes = Buffer.from(sigBase64, "base64");
      const sigImg = await pdf.embedPng(sigBytes);
      const targetWidth = 220;
      const ratio = sigImg.height / sigImg.width;
      const targetHeight = Math.min(120, targetWidth * ratio);
      if (cursorY - targetHeight < margin) {
        page = pdf.addPage([pageWidth, pageHeight]);
        cursorY = pageHeight - margin;
      }
      page.drawImage(sigImg, {
        x: margin,
        y: cursorY - targetHeight,
        width: targetWidth,
        height: targetHeight,
      });
      cursorY -= targetHeight + 8;
    } catch (err) {
      drawText("[signature image could not be embedded]", { size: 10, spaceAfter: 4 });
    }
  }
  drawText(`Signer: ${params.signerName || params.signerEmail}`, { size: 10, spaceAfter: 2 });
  drawText(`Email: ${params.signerEmail}`, { size: 10, spaceAfter: 2 });
  drawText(`Date: ${params.signedAt.toISOString()}`, { size: 10, spaceAfter: 4 });

  // Two-pass evidence hash:
  //   pass 1 — render the contract pages (without an evidence page), serialize
  //   to bytes, and compute sha256(contentBytes || signerEmail || signerName
  //   || signedAtIso). This makes the hash bind tamper-evidently to the actual
  //   signed PDF content plus the signer identity + timestamp.
  //   pass 2 — append a human-readable evidence page that prints the hash.
  const contentBytes = await pdf.save();
  const hasher = crypto.createHash("sha256");
  hasher.update(Buffer.from(contentBytes));
  hasher.update("|");
  hasher.update(params.signerEmail);
  hasher.update("|");
  hasher.update(params.signerName || "");
  hasher.update("|");
  hasher.update(params.signedAt.toISOString());
  const evidenceHash = hasher.digest("hex");

  page = pdf.addPage([pageWidth, pageHeight]);
  cursorY = pageHeight - margin;
  drawText("Evidence / Delil Sayfası", { size: 16, bold: true, spaceAfter: 14 });
  drawText("This page records the cryptographic evidence for the signed contract.", { size: 10, spaceAfter: 10 });

  drawText(`Signer name: ${params.signerName || "-"}`, { size: 10, spaceAfter: 2 });
  drawText(`Signer email: ${params.signerEmail}`, { size: 10, spaceAfter: 2 });
  drawText(`IP address: ${params.signerIp || "-"}`, { size: 10, spaceAfter: 2 });
  drawText(`User agent: ${params.signerUserAgent || "-"}`, { size: 10, spaceAfter: 2 });
  drawText(`Signed at (UTC): ${params.signedAt.toISOString()}`, { size: 10, spaceAfter: 2 });
  drawText(`Template: ${params.templateName}`, { size: 10, spaceAfter: 8 });
  drawText("Evidence hash (SHA-256 of signed PDF content + signer + timestamp):", { size: 10, bold: true, spaceAfter: 2 });
  drawText(evidenceHash, { size: 9, spaceAfter: 2 });

  const pdfBytes = await pdf.save();
  return { pdfBytes, evidenceHash };
}
