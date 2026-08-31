import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

// Keep IPv4 and IPv6 rules in separate BlockLists. Node's BlockList maps an
// IPv4 address into the IPv4-mapped IPv6 range while checking a mixed-family
// list. Consequently, an IPv6 rule such as ::ffff:0:0/96 would otherwise
// classify every ordinary public IPv4 address as blocked.
const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export interface SafeOutboundRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedProtocols?: readonly ("http:" | "https:")[];
  allowedPorts?: readonly number[];
  allowedHostnames?: readonly string[];
  headersOnly?: boolean;
}

export interface SafeOutboundResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  url: string;
}

let safeOutboundRequestOverride: ((
  rawUrl: string,
  options: SafeOutboundRequestOptions,
) => Promise<SafeOutboundResponse>) | null = null;

export function __setSafeOutboundRequestOverrideForTests(
  override: typeof safeOutboundRequestOverride,
): void {
  if (process.env.NODE_ENV !== "test" && !process.env.NODE_TEST_CONTEXT) {
    throw new Error("safe_outbound_override_test_only");
  }
  safeOutboundRequestOverride = override;
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isBlockedOutboundIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedIpv4Addresses.check(address, "ipv4");
  if (family === 6) return blockedIpv6Addresses.check(address, "ipv6");
  return true;
}

export function parseSafeOutboundUrl(
  rawUrl: string,
  options: Pick<SafeOutboundRequestOptions, "allowedProtocols" | "allowedPorts" | "allowedHostnames"> = {},
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("outbound_url_invalid");
  }
  const allowedProtocols = options.allowedProtocols ?? ["https:"];
  if (!allowedProtocols.includes(url.protocol as "http:" | "https:")) {
    throw new Error("outbound_protocol_not_allowed");
  }
  if (url.username || url.password) throw new Error("outbound_url_credentials_not_allowed");
  const hostname = normalizedHostname(url);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("outbound_destination_not_allowed");
  }
  if (isIP(hostname) && isBlockedOutboundIp(hostname)) {
    throw new Error("outbound_destination_not_allowed");
  }
  if (options.allowedHostnames) {
    const allowed = options.allowedHostnames.map((value) => value.trim().toLowerCase());
    if (!allowed.includes(hostname)) throw new Error("outbound_hostname_not_allowed");
  }
  if (options.allowedPorts) {
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!options.allowedPorts.includes(port)) throw new Error("outbound_port_not_allowed");
  }
  return url;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  let addresses: Array<{ address: string; family: 4 | 6 }>;
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  } else {
    try {
      const resolved = await lookup(hostname, { all: true, verbatim: true });
      addresses = resolved.map(({ address, family }) => ({
        address,
        family: family === 6 ? 6 : 4,
      }));
    } catch {
      throw new Error("outbound_host_unresolvable");
    }
  }
  // Reject the hostname if any answer is private/reserved. This prevents a
  // mixed public/private DNS response from becoming an address-selection
  // bypass and keeps the connection pinned to a vetted answer.
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedOutboundIp(address))) {
    throw new Error("outbound_destination_not_allowed");
  }
  return addresses[0];
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

/**
 * Make a bounded outbound HTTP request after resolving and validating every
 * address. The socket connects to the already-validated IP while Host/SNI keep
 * the original hostname, eliminating the DNS rebinding gap of validate-then-
 * fetch implementations. Redirect targets are independently revalidated.
 */
export async function safeOutboundRequest(
  rawUrl: string,
  options: SafeOutboundRequestOptions = {},
): Promise<SafeOutboundResponse> {
  if (safeOutboundRequestOverride) return safeOutboundRequestOverride(rawUrl, options);
  const url = parseSafeOutboundUrl(rawUrl, options);
  const hostname = normalizedHostname(url);
  const resolved = await resolvePublicAddress(hostname);
  const method = options.method ?? "GET";
  const body = options.body === undefined
    ? undefined
    : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body);
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 10_000, 60_000));
  const maxBytes = Math.max(1, Math.min(options.maxBytes ?? 5 * 1024 * 1024, 50 * 1024 * 1024));

  const response = await new Promise<SafeOutboundResponse>((resolve, reject) => {
    const requestFn = url.protocol === "https:" ? https.request : http.request;
    const headers: Record<string, string> = {
      "User-Agent": "FindAndStudy-SafeFetcher/1.0",
      ...options.headers,
      Host: url.host,
    };
    if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) {
      headers["Content-Length"] = String(body.length);
    }
    const request = requestFn({
      protocol: url.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || undefined,
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      ...(url.protocol === "https:" ? {
        servername: isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: true,
      } : {}),
    }, (incoming) => {
      const status = incoming.statusCode ?? 0;
      const location = headerValue(incoming.headers.location);
      if (status >= 300 && status < 400 && location) {
        incoming.resume();
        const redirectsLeft = options.maxRedirects ?? 0;
        if (redirectsLeft <= 0) {
          reject(new Error("outbound_redirect_not_allowed"));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        const nextHeaders = { ...(options.headers ?? {}) };
        if (new URL(nextUrl).origin !== url.origin) {
          for (const key of Object.keys(nextHeaders)) {
            if (["authorization", "cookie", "proxy-authorization"].includes(key.toLowerCase())) {
              delete nextHeaders[key];
            }
          }
        }
        const switchToGet = status === 303 || ((status === 301 || status === 302) && method === "POST");
        safeOutboundRequest(nextUrl, {
          ...options,
          headers: nextHeaders,
          method: switchToGet ? "GET" : method,
          body: switchToGet ? undefined : body,
          maxRedirects: redirectsLeft - 1,
        }).then(resolve, reject);
        return;
      }

      const declaredLength = Number(incoming.headers["content-length"] || 0);
      if (declaredLength > maxBytes) {
        incoming.resume();
        reject(new Error("outbound_response_too_large"));
        return;
      }
      if (options.headersOnly) {
        const normalizedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(incoming.headers)) {
          normalizedHeaders[key.toLowerCase()] = headerValue(value);
        }
        incoming.destroy();
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: normalizedHeaders,
          body: Buffer.alloc(0),
          url: url.toString(),
        });
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      incoming.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes) {
          request.destroy(new Error("outbound_response_too_large"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      incoming.on("end", () => {
        const normalizedHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(incoming.headers)) {
          normalizedHeaders[key.toLowerCase()] = headerValue(value);
        }
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: normalizedHeaders,
          body: Buffer.concat(chunks),
          url: url.toString(),
        });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("outbound_request_timeout")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });

  return response;
}
