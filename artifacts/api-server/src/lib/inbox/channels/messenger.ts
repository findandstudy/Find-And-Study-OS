import { isLiveIntegrationsEnabled } from "../liveMode";
import { parseMetaMessaging, type MetaInbound } from "./meta-shared";
import { CHANNEL_MESSENGER } from "./constants";

/**
 * Facebook Messenger integration config, stored under the
 * `facebook_messenger` integration key.
 */
export interface MessengerConfig {
  pageId?: string;
  pageAccessToken?: string;
  appSecret?: string;
  webhookVerifyToken?: string;
}

export interface MessengerSendResult {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
  simulated: boolean;
}

/**
 * Parse a Facebook Messenger webhook payload (`object: "page"`) into normalized
 * inbound messages. Returns an empty array for non-message events (delivery /
 * read receipts, postbacks) and for feed/comment change events.
 */
export function parseMessengerWebhook(payload: unknown): MetaInbound[] {
  return parseMetaMessaging(payload, CHANNEL_MESSENGER);
}

/**
 * Send a text message to a Messenger user via the Meta Graph API.
 *
 * STUB — the live Graph API implementation lands in the outbound phase (Faz 3).
 * For now it returns a simulated success so the rest of the pipeline can run.
 */
export async function sendMessengerText(opts: {
  config: MessengerConfig;
  recipientId: string;
  text: string;
}): Promise<MessengerSendResult> {
  void opts;
  if (!isLiveIntegrationsEnabled()) {
    return {
      ok: true,
      externalMessageId: `sim_msgr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      simulated: true,
    };
  }
  // Outbound delivery is implemented in Faz 3 (Messenger + Instagram outbound).
  return { ok: false, error: "Messenger outbound not implemented yet", simulated: false };
}
