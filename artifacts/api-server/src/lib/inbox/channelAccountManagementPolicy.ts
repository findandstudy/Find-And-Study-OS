/** Management policy only. Saving credentials neither verifies nor sends messages. */
export const MANAGED_CHANNELS = ["whatsapp", "messenger", "instagram", "telegram", "sms"] as const;
export type ManagedChannel = typeof MANAGED_CHANNELS[number];
export type AccountProvider = "direct" | "zernio";
export const ACCOUNT_SECRET_MASK = "••••••••";
const META_CHANNELS = new Set<string>(["whatsapp", "messenger", "instagram"]);
const FIELDS: Record<ManagedChannel, readonly string[]> = {
  whatsapp: ["phoneNumberId", "accessToken", "businessAccountId", "webhookVerifyToken", "appSecret"],
  messenger: ["pageId", "pageAccessToken", "webhookVerifyToken", "appSecret"],
  instagram: ["igBusinessAccountId", "pageId", "pageAccessToken", "webhookVerifyToken", "appSecret"],
  telegram: ["botToken", "defaultChatId"],
  sms: ["accountSid", "authToken", "fromNumber"],
};
export class ChannelAccountInputError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export function accountRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChannelAccountInputError("ACCOUNT_INPUT_INVALID");
  return value as Record<string, unknown>;
}
export function accountText(value: unknown, max: number, code: string, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new ChannelAccountInputError(code);
  const text = value.trim();
  if (!allowEmpty && !text) throw new ChannelAccountInputError(code);
  return text;
}
export function accountKind(channel: unknown, provider: unknown = "direct"): { channel: ManagedChannel; provider: AccountProvider } {
  if (channel === "facebook" && provider === "zernio") channel = "messenger";
  if (!MANAGED_CHANNELS.includes(channel as ManagedChannel) || !["direct", "zernio"].includes(provider as string)
    || (provider === "zernio" && !META_CHANNELS.has(channel as string) && channel !== "telegram")) throw new ChannelAccountInputError("ACCOUNT_KIND_UNSUPPORTED");
  return { channel: channel as ManagedChannel, provider: provider as AccountProvider };
}
export function accountFilter(query: Record<string, unknown>): { channel?: ManagedChannel; provider?: AccountProvider } {
  const { channel, provider } = query;
  if (channel !== undefined && !MANAGED_CHANNELS.includes(channel as ManagedChannel)) throw new ChannelAccountInputError("ACCOUNT_CHANNEL_FILTER_INVALID");
  if (provider !== undefined && !["direct", "zernio"].includes(provider as string)) throw new ChannelAccountInputError("ACCOUNT_PROVIDER_FILTER_INVALID");
  if (channel !== undefined && provider !== undefined) accountKind(channel, provider);
  return { channel: channel as ManagedChannel | undefined, provider: provider as AccountProvider | undefined };
}
function secretKey(key: string): boolean { return /token|secret|password|apikey|api_key/i.test(key); }
export function managedAccountConfig(channel: ManagedChannel, provider: AccountProvider, input: unknown,
  previous?: Record<string, unknown>): Record<string, string> {
  const data = input === undefined ? {} : accountRecord(input);
  const allowed = provider === "zernio" ? [] : FIELDS[channel];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new ChannelAccountInputError("ACCOUNT_CONFIG_FIELD_UNSUPPORTED");
  const merged: Record<string, string> = {};
  for (const key of allowed) {
    const before = previous?.[key];
    const incoming = data[key];
    const retain = previous && secretKey(key) && (incoming === undefined || incoming === "" || (typeof incoming === "string" && incoming.includes("•")));
    const raw = retain || incoming === undefined ? before : incoming;
    if (raw === undefined) continue;
    const value = accountText(raw, secretKey(key) ? 4096 : 160, "ACCOUNT_CONFIG_INVALID", true);
    if (value.startsWith("enc::") || value.includes("•")) throw new ChannelAccountInputError("ACCOUNT_SECRET_INVALID");
    merged[key] = value;
  }
  if (channel === "telegram" && provider === "direct" && !/^\d{5,20}:[A-Za-z0-9_-]{20,128}$/.test(merged.botToken ?? "")) {
    throw new ChannelAccountInputError("TELEGRAM_BOT_TOKEN_INVALID");
  }
  if (merged.defaultChatId && !/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(merged.defaultChatId)) throw new ChannelAccountInputError("TELEGRAM_CHAT_ID_INVALID");
  if (channel === "sms" && provider === "direct") {
    if (!/^AC[a-fA-F0-9]{32}$/.test(merged.accountSid ?? "") || !/^[a-fA-F0-9]{32}$/.test(merged.authToken ?? "")
      || !/^\+[1-9]\d{7,14}$/.test(merged.fromNumber ?? "")) throw new ChannelAccountInputError("TWILIO_CONFIG_INVALID");
  }
  return merged;
}
/** An allowlisted flat projection prevents legacy nested/unrecognized secret fields leaking. */
export function safeManagedAccountConfig(channel: string, provider: string, config: Record<string, unknown>): Record<string, string> {
  const allowed = provider === "direct" ? FIELDS[channel as ManagedChannel] ?? [] : [];
  const result: Record<string, string> = {};
  for (const key of allowed) {
    const value = config[key];
    if (typeof value !== "string" || !value || value.startsWith("enc::")) continue;
    result[key] = secretKey(key) ? ACCOUNT_SECRET_MASK : value;
  }
  return result;
}
export function managedExternalId(channel: ManagedChannel, provider: AccountProvider, config: Record<string, string>, explicit?: unknown): string | null {
  if (provider === "zernio") {
    const id = accountText(explicit, 160, "ZERNIO_ACCOUNT_ID_REQUIRED");
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new ChannelAccountInputError("ZERNIO_ACCOUNT_ID_INVALID");
    return id;
  }
  if (explicit !== undefined) throw new ChannelAccountInputError("ACCOUNT_EXTERNAL_ID_DERIVED");
  if (channel === "telegram") return config.botToken.split(":")[0];
  if (channel === "sms") return config.fromNumber;
  if (channel === "whatsapp") return config.phoneNumberId || null;
  if (channel === "messenger") return config.pageId || null;
  return config.igBusinessAccountId || config.pageId || null;
}
export function assertAccountActivation(channel: ManagedChannel, provider: AccountProvider, config: Record<string, string>, externalId: string | null): void {
  if (accountCapabilities(channel, provider).configurationOnly) throw new ChannelAccountInputError("ACCOUNT_DELIVERY_UNSUPPORTED", 409);
  if (!externalId || (provider === "direct" && !(channel === "whatsapp" ? config.accessToken : config.pageAccessToken))) {
    throw new ChannelAccountInputError("ACCOUNT_CREDENTIALS_REQUIRED", 409);
  }
}
export function accountCapabilities(channel: string, provider: string) {
  if (channel === "facebook" && provider === "zernio") channel = "messenger";
  const nativeNotificationOnly = provider === "direct" && (channel === "telegram" || channel === "sms");
  return { inboxSupported: !nativeNotificationOnly && (META_CHANNELS.has(channel) || (provider === "zernio" && channel === "telegram")), configurationOnly: nativeNotificationOnly,
    webhookPath: provider === "zernio" ? "/api/webhooks/zernio" : channel === "whatsapp" ? "/api/webhooks/whatsapp" : META_CHANNELS.has(channel) ? "/api/webhooks/meta" : null,
    verificationSupported: !nativeNotificationOnly && (provider !== "zernio" || channel === "whatsapp"),
    verificationDoesNotSendMessage: true, externalAccountIdEditable: false,
    credentialsSource: provider === "zernio" ? "integration" : "account" };
}
/** Explicit deployment kill-switch wins, including NODE_ENV=production staging. */
export function accountVerificationAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.ALLOW_LIVE_INTEGRATIONS !== undefined) return env.ALLOW_LIVE_INTEGRATIONS === "true";
  return env.NODE_ENV === "production";
}
