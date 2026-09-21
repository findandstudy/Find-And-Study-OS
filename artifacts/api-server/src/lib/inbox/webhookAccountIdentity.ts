/** Provider channel aliases are routing identities, never separate accounts. */
export function zernioWebhookChannel(value: unknown): string | null {
  if (value === "facebook") return "messenger";
  return typeof value === "string" && ["whatsapp", "messenger", "instagram", "telegram"].includes(value)
    ? value : null;
}

/** Keep existing row/channel identity so historical conversations stay attached. */
export function existingZernioWebhookAccount<T extends { channel: string; isActive: boolean }>(
  rows: T[], canonicalChannel: string,
): { kind: "new" } | { kind: "blocked" } | { kind: "existing"; account: T } {
  if (rows.length === 0) return { kind: "new" };
  if (rows.length !== 1 || !rows[0].isActive || zernioWebhookChannel(rows[0].channel) !== canonicalChannel) {
    return { kind: "blocked" };
  }
  return { kind: "existing", account: rows[0] };
}
