import { createHash } from "node:crypto";
import sharp from "sharp";
import { parseSafeOutboundUrl, safeOutboundRequest } from "./safeOutboundRequest";

export type ContractLogoSnapshot = {
  sourceUrl: string;
  dataUrl: string;
  sha256: string;
};

export const MAX_CONTRACT_LOGO_BYTES = 256 * 1024;
export const CONTRACT_LOGO_TIMEOUT_MS = 5_000;
const MAX_LOGO_PIXELS = 4_000_000;
const MAX_URL_LENGTH = 2_000;
const MAX_TRUSTED_URLS = 8;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function canonicalLogoUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.length > MAX_URL_LENGTH || value.trim() !== value) return;
  try {
    const url = parseSafeOutboundUrl(value, { allowedProtocols: ["https:"], allowedPorts: [443] });
    // Static public assets only. No query tokens, credentials, fragments or
    // alternate spellings that could enlarge the exact configured trust set.
    if (/[?#]/.test(value) || url.search || url.hash || url.href !== value) return;
    return url.href;
  } catch { return; }
}

function validateTrustedUrls(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_TRUSTED_URLS) throw new Error("contract_logo_trust_config_invalid");
  const urls = value.map(canonicalLogoUrl);
  if (urls.some(url => !url) || new Set(urls).size !== urls.length) throw new Error("contract_logo_trust_config_invalid");
  return urls as string[];
}

/** Server-owned JSON exact-URL allowlist. Unset/empty is deliberately off. */
export function parseContractTrustedLogoUrls(raw?: string): readonly string[] {
  if (!raw?.trim()) return [];
  if (raw.length > MAX_TRUSTED_URLS * (MAX_URL_LENGTH + 4) + 2) throw new Error("contract_logo_trust_config_invalid");
  try { return validateTrustedUrls(JSON.parse(raw)); }
  catch { throw new Error("contract_logo_trust_config_invalid"); }
}

function imageMime(bytes: Buffer): "image/png" | "image/jpeg" | undefined {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(PNG_MAGIC)
    && bytes.toString("ascii", 12, 16) === "IHDR") return "image/png";
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) return "image/jpeg";
  return undefined;
}

/** Pure historical-snapshot check. Does not consult current trust config or fetch. */
export function validateContractLogoSnapshot(value: unknown, logoUrl: unknown): ContractLogoSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  const sourceUrl = canonicalLogoUrl(logoUrl);
  if (!sourceUrl || input.sourceUrl !== sourceUrl || typeof input.dataUrl !== "string"
    || input.dataUrl.length > 22 + Math.ceil(MAX_CONTRACT_LOGO_BYTES / 3) * 4
    || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256)) return;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.dataUrl);
  if (!match || match[1].length % 4 !== 0) return;
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length || bytes.length > MAX_CONTRACT_LOGO_BYTES || imageMime(bytes) !== "image/png"
    || bytes.readUInt32BE(8) !== 13 || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 1024
    || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 1024
    || !bytes.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex"))
    || bytes.toString("base64") !== match[1]
    || createHash("sha256").update(bytes).digest("hex") !== input.sha256) return;
  return { sourceUrl, dataUrl: input.dataUrl, sha256: input.sha256 };
}

export type ContractLogoCaptureOptions = {
  trustedLogoUrls?: readonly string[];
  /** Synthetic transport only; explicitly rejected outside NODE_ENV=test. */
  request?: typeof safeOutboundRequest;
};

function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new Error("contract_logo_capture_failed"));
    if (signal.aborted) { pending.catch(() => {}); aborted(); return; }
    signal.addEventListener("abort", aborted, { once: true });
    pending.then(
      value => { signal.removeEventListener("abort", aborted); resolve(value); },
      error => { signal.removeEventListener("abort", aborted); reject(error); },
    );
  });
}

/**
 * Capture before a NEW signing session is issued. Never call this from signed
 * PDF rendering, download, regeneration or a historical-session resolver.
 * The only requested URL is the configured brand logo, never arbitrary HTML.
 */
export async function captureContractLogoSnapshot(
  logoUrl: string,
  options: ContractLogoCaptureOptions = {},
): Promise<ContractLogoSnapshot | undefined> {
  if (options.request && (process.env.NODE_ENV !== "test" || options.request === safeOutboundRequest)) {
    throw new Error("contract_logo_test_transport_forbidden");
  }
  const trustedUrls = options.trustedLogoUrls === undefined
    ? parseContractTrustedLogoUrls(process.env.CONTRACT_PDF_TRUSTED_LOGO_URLS)
    : validateTrustedUrls(options.trustedLogoUrls);
  const sourceUrl = canonicalLogoUrl(logoUrl);
  if (!sourceUrl || !trustedUrls.includes(sourceUrl)) return;
  if (!options.request && process.env.ALLOW_LIVE_INTEGRATIONS !== "true") return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTRACT_LOGO_TIMEOUT_MS);
  const request = options.request ?? safeOutboundRequest;
  try {
    const response = await untilAborted(request(sourceUrl, {
      method: "GET",
      headers: { Accept: "image/png, image/jpeg", "Accept-Encoding": "identity" },
      allowedProtocols: ["https:"], allowedPorts: [443],
      allowedHostnames: [new URL(sourceUrl).hostname],
      maxBytes: MAX_CONTRACT_LOGO_BYTES, maxRedirects: 0,
      timeoutMs: CONTRACT_LOGO_TIMEOUT_MS, signal: controller.signal,
    }), controller.signal);
    if (controller.signal.aborted || response.status !== 200 || !response.ok || response.url !== sourceUrl
      || response.body.length === 0 || response.body.length > MAX_CONTRACT_LOGO_BYTES) throw new Error();
    const mime = (response.headers["content-type"] ?? "").trim().toLowerCase();
    const encoding = (response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
    const length = response.headers["content-length"];
    if (!["image/png", "image/jpeg"].includes(mime) || imageMime(response.body) !== mime
      || encoding !== "identity" || (length !== undefined && (!/^[1-9][0-9]*$/.test(length)
        || Number(length) !== response.body.length))) throw new Error();

    // Decode with a pixel ceiling, then strip metadata and normalize to bounded
    // static PNG bytes. SVG, malformed raster bytes and decompression
    // bombs never become trusted snapshots just because their MIME looks right.
    const normalizer = sharp(response.body, { failOn: "warning", limitInputPixels: MAX_LOGO_PIXELS, animated: false })
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .png().timeout({ seconds: 2 });
    const abortDecode = () => { normalizer.destroy(); };
    controller.signal.addEventListener("abort", abortDecode, { once: true });
    let bytes: Buffer;
    try { bytes = await untilAborted(normalizer.toBuffer(), controller.signal); }
    finally { controller.signal.removeEventListener("abort", abortDecode); }
    if (controller.signal.aborted || bytes.length === 0 || bytes.length > MAX_CONTRACT_LOGO_BYTES) throw new Error();
    return {
      sourceUrl,
      dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    // Deliberately omit URL, provider error and content from the error surface.
    throw new Error("contract_logo_capture_failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
