// AI Agent Faz 2 — text extraction for the RAG knowledge pipeline. Converts a
// knowledge_sources row (type='file'|'url'|'text') into plain text ready for
// chunking + embedding. Each extractor is defensive: unsupported/corrupt input
// throws a descriptive error so the ingest pipeline can record status='error'
// instead of silently storing an empty source.
import * as nodePath from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { ObjectStorageService } from "../objectStorage";
import { safeOutboundRequest } from "../safeOutboundRequest";

const objectStorageService = new ObjectStorageService();

const MAX_URL_BYTES = 5 * 1024 * 1024; // 5MB cap on fetched HTML
const URL_FETCH_TIMEOUT_MS = 15000;

export interface FileSourceConfig {
  objectPath: string;
  fileName: string;
  mimeType: string;
}

export interface UrlSourceConfig {
  url: string;
}

export interface TextSourceConfig {
  rawText: string;
}

async function bufferFromObjectPath(objectPath: string): Promise<Buffer> {
  const file = await objectStorageService.getObjectEntityFile(objectPath);
  const [contents] = await file.download();
  return contents;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

async function extractXlsx(buffer: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) parts.push(`## ${sheetName}\n${csv.trim()}`);
  }
  return parts.join("\n\n");
}

/**
 * Extract plain text from an uploaded file, dispatching on extension/mime
 * type. Supported: PDF, DOC/DOCX (mammoth handles .docx; legacy .doc is
 * rejected with a clear message since it needs a binary-format parser we
 * don't ship), XLS/XLSX/CSV.
 */
export async function extractFileText(config: FileSourceConfig): Promise<string> {
  const buffer = await bufferFromObjectPath(config.objectPath);
  const ext = nodePath.extname(config.fileName).toLowerCase();

  if (config.mimeType === "application/pdf" || ext === ".pdf") {
    return extractPdf(buffer);
  }
  if (
    config.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    return extractDocx(buffer);
  }
  if (config.mimeType === "application/msword" || ext === ".doc") {
    throw new Error("Legacy .doc files are not supported — please re-save as .docx and re-upload.");
  }
  if (
    config.mimeType === "application/vnd.ms-excel" ||
    config.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === ".xlsx" ||
    ext === ".xls"
  ) {
    return extractXlsx(buffer);
  }
  if (config.mimeType === "text/csv" || ext === ".csv") {
    return extractXlsx(buffer);
  }
  if (config.mimeType === "text/plain" || ext === ".txt") {
    return buffer.toString("utf-8");
  }
  throw new Error(`Unsupported file type: ${config.mimeType || ext}`);
}

/**
 * Fetch a URL and extract its main article text via Readability, stripping
 * navigation/ads/boilerplate. SSRF-guarded: only http(s) URLs, size-capped,
 * timeout-bounded. Private/loopback hosts are rejected.
 */
export async function extractUrlText(config: UrlSourceConfig): Promise<{ text: string; title: string | null }> {
  const response = await safeOutboundRequest(config.url, {
    allowedProtocols: ["http:", "https:"],
    timeoutMs: URL_FETCH_TIMEOUT_MS,
    maxBytes: MAX_URL_BYTES,
    maxRedirects: 3,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EduConsultBot/1.0)" },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed: HTTP ${response.status}`);
  }
  const html = response.body.toString("utf-8");
  const dom = new JSDOM(html, { url: response.url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article || !article.textContent || !article.textContent.trim()) {
    throw new Error("Could not extract readable article content from this URL.");
  }
  return { text: article.textContent.trim(), title: article.title || null };
}

/** Free-text sources need no extraction — the admin-typed text IS the content. */
export function extractPlainText(config: TextSourceConfig): string {
  return config.rawText.trim();
}
