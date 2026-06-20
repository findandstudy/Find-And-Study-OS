import { isLiveIntegrationsEnabled } from "../liveMode";
import { parseMetaMessaging, type MetaInbound } from "./meta-shared";
import { CHANNEL_INSTAGRAM } from "./constants";

/**
 * Instagram Direct integration config, stored under the `instagram`
 * integration key.
 */
export interface InstagramConfig {
  igBusinessAccountId?: string;
  pageId?: string;
  pageAccessToken?: string;
  appSecret?: string;
  webhookVerifyToken?: string;
}

export interface InstagramSendResult {
  ok: boolean;
  externalMessageId?: string;
  error?: string;
  simulated: boolean;
}

/**
 * Parse an Instagram webhook payload (`object: "instagram"`) into normalized
 * inbound messages. Returns an empty array for non-message events and for
 * comment / mention change events.
 */
export function parseInstagramWebhook(payload: unknown): MetaInbound[] {
  return parseMetaMessaging(payload, CHANNEL_INSTAGRAM);
}

/**
 * Send a text message to an Instagram user via the Meta Graph API.
 *
 * STUB — the live Graph API implementation lands in the outbound phase (Faz 3).
 * For now it returns a simulated success so the rest of the pipeline can run.
 */
export async function sendInstagramText(opts: {
  config: InstagramConfig;
  recipientId: string;
  text: string;
}): Promise<InstagramSendResult> {
  void opts;
  if (!isLiveIntegrationsEnabled()) {
    return {
      ok: true,
      externalMessageId: `sim_ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      simulated: true,
    };
  }
  // Outbound delivery is implemented in Faz 3 (Messenger + Instagram outbound).
  return { ok: false, error: "Instagram outbound not implemented yet", simulated: false };
}
