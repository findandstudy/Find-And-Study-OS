import { META_API_VERSION } from "./channels/meta-shared";

/** No simulation, account fallback, or implicit switch from native to local blocking. */
export async function changeWhatsAppProviderBlock(input: {
  liveEnabled: boolean;
  channel: string;
  provider: string;
  active: boolean;
  phoneNumberId?: string;
  accessToken?: string;
  zernioAccountId?: string;
  zernioApiKey?: string;
  recipient: string;
  blocked: boolean;
}, request: typeof fetch = fetch): Promise<{ confirmed: boolean; reason: string }> {
  if (!input.liveEnabled) return { confirmed: false, reason: "LIVE_INTEGRATIONS_DISABLED" };
  if (input.channel !== "whatsapp" || !["direct", "zernio"].includes(input.provider)) return { confirmed: false, reason: "PROVIDER_BLOCK_UNSUPPORTED" };
  const zernio = input.provider === "zernio";
  if (!input.active || (zernio ? !input.zernioAccountId || !input.zernioApiKey : !/^\d+$/.test(input.phoneNumberId ?? "") || !input.accessToken)) return { confirmed: false, reason: "ACCOUNT_NOT_READY" };
  const recipient = input.recipient.replace(/^\+/, "");
  if (!/^\d{7,15}$/.test(recipient)) return { confirmed: false, reason: "INVALID_RECIPIENT" };
  try {
    const response = await request(zernio ? "https://zernio.com/api/v1/whatsapp/block-users" : `https://graph.facebook.com/${META_API_VERSION}/${input.phoneNumberId}/block_users`, {
      method: input.blocked ? "POST" : "DELETE",
      headers: { Authorization: `Bearer ${zernio ? input.zernioApiKey : input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(zernio ? { accountId: input.zernioAccountId, users: [recipient] } : { messaging_product: "whatsapp", block_users: [{ user: recipient }] }),
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    if (!response.ok) return { confirmed: false, reason: "PROVIDER_REJECTED" };
    const body = await response.json();
    if (zernio) {
      const users = body?.[input.blocked ? "blocked" : "unblocked"];
      const failed = Array.isArray(body?.failed) && body.failed.some((user: any) => typeof user?.input === "string" && user.input.replace(/^\+/, "") === recipient);
      const confirmed = !failed && Array.isArray(users) && users.some((user: any) => user?.waId === recipient && typeof user?.input === "string" && user.input.replace(/^\+/, "") === recipient);
      return { confirmed, reason: confirmed ? "PROVIDER_CONFIRMED" : "PROVIDER_NOT_CONFIRMED" };
    }
    const users = body?.block_users?.[input.blocked ? "added_users" : "removed_users"];
    const failed = Array.isArray(body?.block_users?.failed_users) && body.block_users.failed_users.some((user: any) => typeof user?.input === "string" && user.input.replace(/^\+/, "") === recipient);
    const confirmed = !failed && body?.messaging_product === "whatsapp" && Array.isArray(users) && users.some((user: any) =>
      typeof user?.wa_id === "string" && user.wa_id === recipient &&
      typeof user?.input === "string" && user.input.replace(/^\+/, "") === recipient);
    return { confirmed, reason: confirmed ? "PROVIDER_CONFIRMED" : "PROVIDER_NOT_CONFIRMED" };
  } catch {
    // A timeout can happen after the provider applied the change. Never report success.
    return { confirmed: false, reason: "PROVIDER_RESULT_UNKNOWN" };
  }
}
