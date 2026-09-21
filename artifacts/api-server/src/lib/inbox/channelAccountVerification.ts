import { accountVerificationAllowed } from "./channelAccountManagementPolicy";

const MAX_BODY_BYTES = 64 * 1024;
let pendingVerifications = 0;
/** Uncached read-only check, separate from the legacy sending/profile cache. */
export async function verifyZernioManagedAccount(apiKey: string, externalAccountId: string,
  options: { fetcher?: typeof fetch; timeoutMs?: number; allowed?: () => boolean } = {}): Promise<boolean> {
  const allowed = options.allowed ?? accountVerificationAllowed;
  if (!allowed() || pendingVerifications >= 2 || !apiKey || /[\r\n]/.test(apiKey)
    || !/^[A-Za-z0-9_-]{1,160}$/.test(externalAccountId)) return false;
  pendingVerifications++;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); };
  const work = (async () => {
    const response = await (options.fetcher ?? fetch)("https://zernio.com/api/v1/accounts?platform=whatsapp&includeOverLimit=true", {
      method: "GET", headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error", signal: controller.signal,
    });
    if (!response.ok || !allowed() || controller.signal.aborted
      || !/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      void response.body?.cancel().catch(() => {}); return false;
    }
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
      void response.body?.cancel().catch(() => {}); return false;
    }
    if (!response.body) return false;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES || controller.signal.aborted) { cancel(); return false; }
      chunks.push(value);
    }
    if (!allowed() || controller.signal.aborted) return false;
    const data: any = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const accounts: unknown = Array.isArray(data) ? data : data?.accounts ?? data?.data?.accounts ?? data?.data;
    if (!Array.isArray(accounts) || accounts.length > 1000) return false;
    const matches = accounts.filter(account => account && typeof account === "object"
      && String(account._id ?? account.id ?? account.accountId ?? "") === externalAccountId);
    if (matches.length !== 1) return false;
    const rawProfile = matches[0].profileId ?? matches[0].profile;
    const profile = typeof rawProfile === "string" ? rawProfile : rawProfile?._id ?? rawProfile?.id;
    return typeof profile === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(profile);
  })().catch(() => false).finally(() => { pendingVerifications--; });
  try {
    return await Promise.race([work, new Promise<false>(resolve => {
      timer = setTimeout(() => { cancel(); resolve(false); }, Math.min(10_000, Math.max(1, options.timeoutMs ?? 10_000)));
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
