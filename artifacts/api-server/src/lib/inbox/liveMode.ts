/**
 * Deployment-level outbound integration policy.
 * Returns true when live third-party integrations should be writable / sendable.
 *
 * - An explicit ALLOW_LIVE_INTEGRATIONS value allows only exact "true".
 *   False, empty and invalid values disable delivery in every environment.
 * - When unset, retain the production default; other environments stay off.
 *
 * Webhooks (inbound) work in every environment regardless of this flag, so
 * developers can still test signature/HMAC verification and inbound flows.
 * Outbound calls (sending WhatsApp, etc.) are simulated when this is false.
 */
export function isLiveIntegrationsEnabled(): boolean {
  if (process.env.ALLOW_LIVE_INTEGRATIONS !== undefined) {
    return process.env.ALLOW_LIVE_INTEGRATIONS === "true";
  }
  return process.env.NODE_ENV === "production";
}

export function liveModeReason(): string {
  if (isLiveIntegrationsEnabled()) return "live";
  return "simulated (live integrations disabled by environment policy)";
}
