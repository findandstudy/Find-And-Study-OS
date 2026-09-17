/** Absent = all accounts; zero = legacy/unlinked. Reject arrays and malformed IDs. */
export function parseInboxAccountFilter(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("Invalid channelAccountId");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 2147483647) throw new Error("Invalid channelAccountId");
  return id;
}
